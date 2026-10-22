/**
 * Compares chunking strategies on the same pool of episodes, entirely in
 * memory — production tables are never read or written. Each strategy's
 * chunks are embedded with the production model (voyage-3.5), every
 * answerable golden-set question is matched against them by cosine
 * similarity, and we score whether the right episode / right speaker comes
 * back.
 *
 * Strategies:
 *   A  turn-window   — production: whole speaker turns packed to ~1600 chars, 1-turn overlap, inline labels
 *   B  fixed-size    — same ad-free text cut every 1600 chars (200 overlap), wherever the cut lands
 *   C  no-labels     — production windows with "Name (00:00:00):" labels stripped
 *   D  single-turn   — one speaker turn per chunk, labelled
 *
 * Usage: npx tsx eval/chunking-experiment.ts [--dry-run]
 * Embeddings are cached in eval/results/chunking-cache/ so reruns cost nothing.
 *
 * The raw transcript archive is no longer on disk, so each episode's turn
 * sequence is rebuilt from its ingested chunks (inline labels parsed back
 * out, overlap turns de-duplicated). That text is already ad-free, which is
 * exactly the text every strategy should start from.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { loadEnvFile } from '../lib/load-env'
import { parseInlineTurns, chunkTurns, isAdSegment } from '../lib/transcript-parser'
import { createAdminClient } from '../lib/supabase-admin'
import type { SpeakerTurn } from '../lib/types'
import type { GoldenSetItem } from './types'

loadEnvFile()

const DRY_RUN = process.argv.includes('--dry-run')
const RESULTS_DIR = join(__dirname, 'results')
const CACHE_DIR = join(RESULTS_DIR, 'chunking-cache')
const FIXED_SIZE = 1600
const FIXED_OVERLAP = 200
// Free-tier Voyage limits (no payment method): 3 requests/min, 10K tokens/min.
// Batches stay under ~3.2K tokens (measured ~4.2 chars per token on this corpus) and requests are spaced 21s apart.
const TOKEN_BUDGET_PER_BATCH = 3200
const MAX_ITEMS_PER_BATCH = 50
const MIN_MS_BETWEEN_REQUESTS = 21_000
const LABEL_RE = /[A-Z][^()\n]{0,40}?\s\(\d{1,3}(?::\d{2}){1,2}\):\s*/g

interface ExpChunk {
  episode: string
  text: string
  // speaker owning the most characters, or null when the text carries no label at all
  labelledSpeaker: string | null
  // characters before the first speaker label: words a reader can't attribute from the chunk alone
  orphanChars: number
}

function formatTurn(t: SpeakerTurn): string {
  return `${t.speaker} (${t.startTimestamp}): ${t.text}`
}

// Mirrors markAdTurns in lib/transcript-parser.ts (not exported there).
function contentTurns(turns: SpeakerTurn[]): SpeakerTurn[] {
  const flags = turns.map(isAdSegment)
  for (let i = 0; i < turns.length; i++) {
    if (!flags[i]) continue
    for (let j = i + 1; j < turns.length && turns[j].speaker === turns[i].speaker; j++) flags[j] = true
  }
  return turns.filter((_, i) => !flags[i])
}

function dominantLabelledSpeaker(text: string): { speaker: string | null; orphanChars: number } {
  const matches = [...text.matchAll(LABEL_RE)]
  if (matches.length === 0) return { speaker: null, orphanChars: text.length }
  const counts = new Map<string, number>()
  matches.forEach((m, i) => {
    const name = m[0].replace(/\s\(.*$/, '').trim()
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length
    counts.set(name, (counts.get(name) ?? 0) + end - m.index! - m[0].length)
  })
  const speaker = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  return { speaker, orphanChars: matches[0].index! }
}

function buildChunks(episode: string, turns: SpeakerTurn[]): Record<string, ExpChunk[]> {
  const clean = contentTurns(turns)

  const a: ExpChunk[] = chunkTurns(turns).map((c) => ({ episode, text: c.content, labelledSpeaker: c.primarySpeaker, orphanChars: 0 }))

  const fullText = clean.map(formatTurn).join('\n\n')
  const b: ExpChunk[] = []
  for (let start = 0; start < fullText.length; start += FIXED_SIZE - FIXED_OVERLAP) {
    const text = fullText.slice(start, start + FIXED_SIZE)
    const { speaker, orphanChars } = dominantLabelledSpeaker(text)
    b.push({ episode, text, labelledSpeaker: speaker, orphanChars })
    if (start + FIXED_SIZE >= fullText.length) break
  }

  const c: ExpChunk[] = a.map((ch) => ({ episode, text: ch.text.replace(LABEL_RE, ''), labelledSpeaker: null, orphanChars: 0 }))

  const d: ExpChunk[] = clean.map((t) => ({ episode, text: formatTurn(t), labelledSpeaker: t.speaker, orphanChars: 0 }))

  return { 'A turn-window': a, 'B fixed-size': b, 'C no-labels': c, 'D single-turn': d }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let lastRequestAt = 0

async function voyage(texts: string[], inputType: 'document' | 'query'): Promise<{ vectors: number[][]; tokens: number }> {
  for (let attempt = 1; ; attempt++) {
    const wait = lastRequestAt + MIN_MS_BETWEEN_REQUESTS - Date.now()
    if (wait > 0) await sleep(wait)
    lastRequestAt = Date.now()
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: texts, model: 'voyage-3.5', input_type: inputType }),
    })
    if (res.ok) {
      const json = (await res.json()) as { data: { embedding: number[] }[]; usage: { total_tokens: number } }
      return { vectors: json.data.map((d) => d.embedding), tokens: json.usage.total_tokens }
    }
    if ((res.status === 429 || res.status >= 500) && attempt <= 8) {
      console.warn(`\n  voyage ${res.status}, retry ${attempt} in ${30 * attempt}s`)
      await sleep(30_000 * attempt)
      continue
    }
    throw new Error(`Voyage ${res.status}: ${await res.text()}`)
  }
}

let tokensSpent = 0

async function embedCached(name: string, texts: string[], inputType: 'document' | 'query'): Promise<number[][]> {
  const key = createHash('sha256').update(inputType + texts.join('\u0000')).digest('hex').slice(0, 16)
  const path = join(CACHE_DIR, `${name.replace(/\W+/g, '_')}-${key}.json`)
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8'))
  // Progress is saved after every request so a killed run resumes where it stopped.
  const partialPath = `${path}.partial`
  const out: number[][] = existsSync(partialPath) ? JSON.parse(readFileSync(partialPath, 'utf-8')) : []
  let i = out.length
  while (i < texts.length) {
    let estTokens = 0
    let j = i
    while (j < texts.length && j - i < MAX_ITEMS_PER_BATCH) {
      const t = Math.ceil(texts[j].length / 4.2)
      if (j > i && estTokens + t > TOKEN_BUDGET_PER_BATCH) break
      estTokens += t
      j++
    }
    const { vectors, tokens } = await voyage(texts.slice(i, j), inputType)
    out.push(...vectors)
    tokensSpent += tokens
    i = j
    writeFileSync(partialPath, JSON.stringify(out))
    console.log(`  ${new Date().toISOString().slice(11, 19)} ${name}: ${out.length}/${texts.length} (${tokensSpent.toLocaleString()} tokens this run)`)
  }
  writeFileSync(path, JSON.stringify(out))
  rmSync(partialPath)
  return out
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return dot / Math.sqrt(na * nb)
}

async function loadEpisodeFromDb(sourceFilename: string): Promise<{ turns: SpeakerTurn[]; production: { content: string; embedding: number[] }[] }> {
  const supabase = createAdminClient()
  const { data: episode, error } = await supabase.from('episodes').select('id').eq('source_filename', sourceFilename).single()
  if (error || !episode) throw new Error(`Episode not found: ${sourceFilename}`)
  const { data: rows, error: chunkError } = await supabase
    .from('chunks').select('chunk_index, content, embedding').eq('episode_id', episode.id).order('chunk_index')
  if (chunkError || !rows) throw new Error(`Chunks not found: ${sourceFilename}`)
  const seen = new Set<string>()
  const turns: SpeakerTurn[] = []
  const typedRows = rows as { content: string; embedding: string }[]
  for (const row of typedRows) {
    for (const t of parseInlineTurns(row.content)) {
      const key = `${t.speaker}|${t.startSeconds}|${t.text.slice(0, 80)}`
      if (seen.has(key)) continue
      seen.add(key)
      turns.push(t)
    }
  }
  return { turns, production: typedRows.map((r) => ({ content: r.content, embedding: JSON.parse(r.embedding) as number[] })) }
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true })

  const items = (JSON.parse(readFileSync(join(__dirname, '../golden-set/golden-set.json'), 'utf-8')) as GoldenSetItem[])
    .filter((i) => i.category === 'answerable' && i.sourceFile)
  const sourcesOf = (i: GoldenSetItem) => i.sourceFile!.split(/,\s*/)
  const episodes = [...new Set(items.flatMap(sourcesOf))].sort()

  const strategies: Record<string, ExpChunk[]> = {}
  const productionChunks: { content: string; embedding: number[] }[] = []
  for (const ep of episodes) {
    const { turns, production } = await loadEpisodeFromDb(ep)
    productionChunks.push(...production)
    for (const [name, chunks] of Object.entries(buildChunks(ep, turns))) (strategies[name] ??= []).push(...chunks)
  }

  console.log(`Pool: ${episodes.length} episodes, ${items.length} questions\n`)
  for (const [name, chunks] of Object.entries(strategies)) {
    const chars = chunks.reduce((s, c) => s + c.text.length, 0)
    const unattributable = chunks.filter((c) => c.labelledSpeaker === null).length
    const orphan = chunks.reduce((s, c) => s + c.orphanChars, 0)
    console.log(`${name.padEnd(15)} chunks=${String(chunks.length).padStart(6)}  avgChars=${Math.round(chars / chunks.length).toString().padStart(5)}  ~tokens=${Math.round(chars / 4).toLocaleString().padStart(10)}  noLabel=${unattributable}  orphanText=${((orphan / chars) * 100).toFixed(1)}%`)
  }

  // Strategy A is production's own chunking, so it uses production's stored
  // text and embeddings. The rebuild differs from production in 3 of 4,483
  // chunks (one episode where an identical one-word turn repeats within the
  // same second and gets de-duplicated) — negligible for B/C/D.
  const a = strategies['A turn-window']
  const mismatches = a.filter((c, i) => productionChunks[i]?.content !== c.text).length
  console.log(`\nA vs production: ${a.length} vs ${productionChunks.length} chunks, ${mismatches} text mismatches`)
  if (process.argv.includes('--show-mismatches')) a.forEach((c, i) => {
    const p = productionChunks[i].content
    if (p === c.text) return
    let k = 0
    while (k < p.length && p[k] === c.text[k]) k++
    console.log(`#${i} ${c.episode} len prod=${p.length} rebuilt=${c.text.length} diverge@${k}\n  prod:    ${JSON.stringify(p.slice(Math.max(0, k - 60), k + 80))}\n  rebuilt: ${JSON.stringify(c.text.slice(Math.max(0, k - 60), k + 80))}`)
  })
  if (DRY_RUN) return

  const queryVecs = await embedCached('queries', items.map((i) => i.question), 'query')

  const report: Record<string, unknown> = {}
  for (const [name, chunks] of Object.entries(strategies)) {
    if (name === 'A turn-window') chunks.forEach((c, i) => { c.text = productionChunks[i].content })
    const vecs = name === 'A turn-window'
      ? productionChunks.map((p) => p.embedding)
      : await embedCached(name, chunks.map((c) => c.text), 'document')
    let epHit1 = 0, epHit5 = 0, epHit10 = 0, rr = 0, speakerTop1 = 0, attributableTop1 = 0
    const topSims: number[] = []
    const perQuestion: { id: string; rank: number; topSim: number; topSpeaker: string | null }[] = []
    items.forEach((item, qi) => {
      const ranked = vecs.map((v, ci) => ({ ci, s: cosine(queryVecs[qi], v) })).sort((x, y) => y.s - x.s).slice(0, 10)
      topSims.push(ranked[0].s)
      const rank = ranked.findIndex((r) => sourcesOf(item).includes(chunks[r.ci].episode))
      if (rank === 0) epHit1++
      if (rank >= 0 && rank < 5) epHit5++
      if (rank >= 0) { epHit10++; rr += 1 / (rank + 1) }
      const top = chunks[ranked[0].ci]
      if (top.labelledSpeaker !== null && top.orphanChars === 0) attributableTop1++
      if (top.labelledSpeaker && item.expectedGuests.includes(top.labelledSpeaker)) speakerTop1++
      perQuestion.push({ id: item.id, rank, topSim: +ranked[0].s.toFixed(3), topSpeaker: top.labelledSpeaker })
    })
    const n = items.length
    const pct = (x: number) => +((x / n) * 100).toFixed(1)
    report[name] = {
      chunks: chunks.length,
      episodeHitAt1: pct(epHit1), episodeHitAt5: pct(epHit5), episodeHitAt10: pct(epHit10),
      mrr: +(rr / n).toFixed(3),
      top1LabelledAsExpectedGuest: pct(speakerTop1),
      top1FullyAttributable: pct(attributableTop1),
      passesConfidenceGate: pct(topSims.filter((x) => x >= 0.5).length),
      perQuestion,
      medianTopSimilarity: +topSims.sort((a, b) => a - b)[Math.floor(n / 2)].toFixed(3),
    }
  }

  console.log('\n' + JSON.stringify(report, (k, v) => (k === 'perQuestion' ? undefined : v), 2))
  console.log(`\nVoyage tokens spent this run: ${tokensSpent.toLocaleString()}`)
  const out = join(RESULTS_DIR, `chunking-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(out, JSON.stringify({ pool: { episodes: episodes.length, questions: items.length }, report, tokensSpent }, null, 2))
  console.log(`Saved ${out}`)
}

main().catch((e) => { console.error(e); process.exit(1) })

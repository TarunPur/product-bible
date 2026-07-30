/**
 * Runs the golden set through the FULL production pipeline — retrieval,
 * synthesis, citation validation, and groundedness grading (all reused
 * directly from lib/) — plus a new answer-quality grade, to measure not
 * just "did retrieval find the right guest" (see run-eval.ts) but "is the
 * actual generated answer any good."
 *
 * Matches production exactly: the LLM is only called for 'answerable' items
 * that pass the confidence gate — a gated-off query never reaches synthesis
 * in the real app, so it shouldn't here either.
 *
 * This is much slower and costlier than run-eval.ts (2 Claude calls per
 * answerable+gate-passing item, one already used in production for
 * groundedness, one new for quality) — use --limit=N to cap the run.
 *
 * Usage:
 *   npm run eval:full                     # every item in the golden set
 *   npm run eval:full -- --limit=20       # cap how many items get the full LLM pipeline
 *   npm run eval:full -- --auto-only --limit=10  # sample only the auto-generated items, spread evenly
 *
 * Requires ANTHROPIC_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOYAGE_API_KEY in .env.local.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { loadEnvFile } from '../lib/load-env'

loadEnvFile()

import { retrieveChunks } from '../lib/retrieval'
import { createSynthesisStream, gradeGroundedness } from '../lib/llm'
import { extractValidatedCitations } from '../lib/citations'
import { gradeAnswerQuality } from './llm-grading'
import { scoreItem, summarizeFull, type ItemEvalResult, type FullEvalResult } from './scoring'
import { pickEvenlySpaced } from '../scripts/generate-golden-set'
import type { GoldenSetItem } from './types'

const GOLDEN_SET_PATH = join(__dirname, '../golden-set/golden-set.json')
const RESULTS_DIR = join(__dirname, 'results')

const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity
const AUTO_ONLY = process.argv.includes('--auto-only')

function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function formatRange(nums: number[]): string {
  if (nums.length === 0) return 'n/a'
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  return `min=${min.toFixed(1)} median=${median(nums)!.toFixed(1)} max=${max.toFixed(1)} (n=${nums.length})`
}

async function runFullPipeline(item: GoldenSetItem, retrieval: Awaited<ReturnType<typeof retrieveChunks>>) {
  const stream = createSynthesisStream(item.question, retrieval.chunks, [])
  const answer = await stream.finalText()
  const citations = extractValidatedCitations(answer, retrieval.chunks)
  const groundedness = await gradeGroundedness(item.question, retrieval.chunks, answer)
  const quality = await gradeAnswerQuality(item.question, answer)
  return { answer, citationCount: citations.length, groundedness, quality }
}

async function main() {
  const allItems: GoldenSetItem[] = JSON.parse(readFileSync(GOLDEN_SET_PATH, 'utf-8'))
  const filtered = AUTO_ONLY ? allItems.filter((item) => item.id.startsWith('auto-')) : allItems
  // Spread the sample evenly across the filtered pool instead of taking a
  // prefix — the golden set is ordered (hand-curated items first, then
  // auto-generated ones in generation order), so a plain slice would always
  // hit the same handful of episodes rather than a representative sample.
  const items = LIMIT === Infinity ? filtered : pickEvenlySpaced(filtered, Math.min(filtered.length, LIMIT * 3))

  console.log(
    `Running ${items.length} of ${allItems.length} golden-set questions through the full pipeline ` +
      `(auto-only=${AUTO_ONLY}, limit=${LIMIT === Infinity ? 'none' : LIMIT})...\n`
  )

  const results: (ItemEvalResult | FullEvalResult)[] = []
  let generatedCount = 0

  for (const [i, item] of items.entries()) {
    // With a finite --limit, stop entirely once it's reached rather than
    // burning further retrieval calls (each Voyage-rate-limit-paced at
    // ~21s) on items that will only ever get retrieval-only scoring — a
    // quick sanity check should actually be quick. A full run (no --limit)
    // still scores every item, since that's the real eval.
    if (LIMIT !== Infinity && generatedCount >= LIMIT) break

    const retrieval = await retrieveChunks(item.question)
    const base = scoreItem(item, retrieval)

    // Matches production: the LLM is never called for an unanswerable item
    // or an answerable item that failed the confidence gate.
    const shouldGenerate = item.category === 'answerable' && retrieval.passesConfidenceGate

    if (!shouldGenerate) {
      results.push(base)
      const status = base.hit ? 'PASS' : base.foundButGated ? 'FOUND-BUT-GATED' : 'FAIL'
      console.log(`[${i + 1}/${items.length}] ${status} (retrieval-only)  ${item.question}`)
      continue
    }

    try {
      const { answer, citationCount, groundedness, quality } = await runFullPipeline(item, retrieval)
      generatedCount++
      const full: FullEvalResult = {
        ...base,
        generatedAnswer: answer,
        citationCount,
        groundednessScore: groundedness,
        qualityScore: quality.score,
      }
      results.push(full)
      console.log(
        `[${i + 1}/${items.length}] GENERATED  ${item.question}\n    groundedness=${groundedness} quality=${quality.score} citations=${citationCount}`
      )
    } catch (err) {
      results.push(base)
      console.warn(`[${i + 1}/${items.length}] FAILED full pipeline: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const summary = summarizeFull(results)
  console.log('\n--- Summary ---')
  console.log(`Retrieval — overall: ${summary.hits}/${summary.total} (${(summary.recallAtK * 100).toFixed(1)}%)`)
  console.log(`Answerable: ${summary.answerableHits}/${summary.answerableCount}`)
  console.log(`Unanswerable (correctly gated off): ${summary.unanswerableHits}/${summary.unanswerableCount}`)
  console.log(`\nFull pipeline ran for ${summary.generatedCount} items:`)
  console.log(`  Groundedness: avg=${summary.avgGroundedness?.toFixed(1) ?? 'n/a'}  ${formatRange(summary.groundednessScores)}`)
  console.log(`  Quality:      avg=${summary.avgQuality?.toFixed(1) ?? 'n/a'}  ${formatRange(summary.qualityScores)}`)

  mkdirSync(RESULTS_DIR, { recursive: true })
  const outPath = join(RESULTS_DIR, `full-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2))
  console.log(`\nFull results written to ${outPath}`)
}

main()

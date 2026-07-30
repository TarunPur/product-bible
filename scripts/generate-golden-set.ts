/**
 * Generate golden-set answerable questions from real transcript chunks using Claude.
 *
 * For a sample of episodes spread across the corpus, picks a few substantial,
 * guest-driven chunks per episode, asks Claude to write a listener-style
 * question each chunk specifically answers, and self-checks that the
 * question actually requires this guest's own words (not generic advice, not
 * something several other guests are equally known for). Accepted items are
 * appended to the existing hand-curated golden-set.json, never overwriting
 * the existing entries.
 *
 * Usage:
 *   npm run golden-set:generate                  # ~100 accepted items (default)
 *   npm run golden-set:generate -- --target=50    # a smaller/larger batch
 *   npm run golden-set:generate -- --dry-run      # generate and log, don't write the file
 *
 * Requires ANTHROPIC_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local.
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { loadEnvFile } from '../lib/load-env'

loadEnvFile()

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '../lib/supabase-admin'
import type { GoldenSetItem } from '../eval/types'

const MODEL = 'claude-sonnet-5'

// Below this length a chunk is usually filler/small-talk rather than
// substantial guest content worth building a question around.
const MIN_CHUNK_CHARS = 900
const CHUNKS_PER_EPISODE = 3
// Expect some candidates to fail the self-check pass — oversample so the
// accepted count still reaches the target without a second pass.
const CANDIDATE_MULTIPLIER = 1.5

const GOLDEN_SET_PATH = resolve(process.cwd(), 'golden-set/golden-set.json')

const targetArg = process.argv.find((a) => a.startsWith('--target='))
export const TARGET_ITEMS = targetArg ? parseInt(targetArg.split('=')[1], 10) : 100
const DRY_RUN = process.argv.includes('--dry-run')

interface EpisodeRow {
  id: string
  guest_names: string[]
  source_filename: string
}

interface ChunkRow {
  id: string
  episode_id: string
  chunk_index: number
  primary_speaker: string
  start_timestamp: string
  content: string
}

interface CandidateChunk extends ChunkRow {
  sourceFile: string
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 6)
    .join('-')
}

// Spreads picks evenly by index across an array ordered by chunk_index (i.e.
// by time in the episode) rather than always taking the first N — avoids
// clustering every pick in the same part of the conversation.
export function pickEvenlySpaced<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items
  const picked: T[] = []
  for (let i = 0; i < count; i++) {
    picked.push(items[Math.floor((i * items.length) / count)])
  }
  return picked
}

// Deterministic, evenly-spread sample across a list sorted by a stable key
// (here: source_filename) — reproducible across runs, and spreads picks
// across the whole corpus rather than clustering alphabetically.
export function sampleEvenlySpaced<T>(items: T[], count: number): T[] {
  return pickEvenlySpaced(items, count)
}

const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    question: { type: 'string' },
    isSpecificEnough: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['question', 'isSpecificEnough', 'reason'],
  additionalProperties: false,
} as const

interface GeneratedQuestion {
  question: string
  isSpecificEnough: boolean
  reason: string
}

function buildPrompt(chunk: ChunkRow): string {
  return `You are building a test question for evaluating a podcast Q&A search tool. This tool answers listener questions using only real transcript excerpts from "Lenny's Podcast" (product/growth/tech interviews).

Guest whose words are in this excerpt: ${chunk.primary_speaker}

Excerpt:
"""
${chunk.content}
"""

Write ONE question a real listener might ask that this excerpt specifically and distinctively answers — grounded in a concrete detail, story, framework, or number from THIS excerpt, not something any guest could generically answer. Phrase it naturally, the way someone would type it into a search box (you may reference the guest by name if that reads naturally).

Critical: do NOT narrate or summarize the excerpt's content, story, or punchline inside the question itself — that gives away the answer and makes the question useless as a test. Ask it the way someone would who has NOT heard this excerpt yet and is curious what the guest said, not someone recapping what they already know.

Then judge your own question honestly against two things: (1) is it specific enough that answering it well REQUIRES this guest's actual words here — not general knowledge, and not something several other guests on this same podcast are equally known for saying, and (2) does the question avoid revealing the excerpt's own content/story/answer within its own phrasing?`
}

async function generateQuestionForChunk(client: Anthropic, chunk: ChunkRow): Promise<GeneratedQuestion> {
  // Adaptive thinking is on by default when `thinking` is omitted on Sonnet
  // 5 — for this short classification+generation task the invisible
  // reasoning tokens were eating into max_tokens, sometimes leaving none
  // (or a mid-string cutoff) for the actual JSON output. Disabled since this
  // task doesn't need extended reasoning.
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    thinking: { type: 'disabled' },
    output_config: { format: { type: 'json_schema', schema: QUESTION_SCHEMA } },
    messages: [{ role: 'user', content: buildPrompt(chunk) }],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('no text block in response')
  return JSON.parse(textBlock.text) as GeneratedQuestion
}

async function main() {
  const supabase = createAdminClient()
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const { data: episodes, error: episodesError } = await supabase
    .from('episodes')
    .select('id, guest_names, source_filename')
    .order('source_filename')
  if (episodesError || !episodes) throw new Error(episodesError?.message ?? 'failed to load episodes')

  const desiredCandidates = Math.ceil(TARGET_ITEMS * CANDIDATE_MULTIPLIER)
  const episodeSampleSize = Math.min(episodes.length, Math.ceil(desiredCandidates / CHUNKS_PER_EPISODE))
  const sampledEpisodes = sampleEvenlySpaced(episodes as EpisodeRow[], episodeSampleSize)

  console.log(
    `Sampling ${sampledEpisodes.length} of ${episodes.length} episodes, up to ${CHUNKS_PER_EPISODE} rich chunks each ` +
      `(target ~${desiredCandidates} candidates for ${TARGET_ITEMS} accepted items)`
  )

  const candidates: CandidateChunk[] = []
  for (const episode of sampledEpisodes) {
    const { data: chunks, error } = await supabase
      .from('chunks')
      .select('id, episode_id, chunk_index, primary_speaker, start_timestamp, content')
      .eq('episode_id', episode.id)
      .order('chunk_index')
    if (error || !chunks) continue

    const rich = (chunks as ChunkRow[]).filter(
      (c) => c.content.length >= MIN_CHUNK_CHARS && episode.guest_names.includes(c.primary_speaker)
    )
    candidates.push(...pickEvenlySpaced(rich, CHUNKS_PER_EPISODE).map((c) => ({ ...c, sourceFile: episode.source_filename })))
  }

  console.log(`Collected ${candidates.length} candidate chunks. Generating questions...`)

  const accepted: GoldenSetItem[] = []
  let rejected = 0
  let failed = 0

  for (const [index, chunk] of candidates.entries()) {
    if (accepted.length >= TARGET_ITEMS) break
    try {
      const generated = await generateQuestionForChunk(client, chunk)
      if (!generated.isSpecificEnough) {
        rejected++
      } else {
        accepted.push({
          id: `auto-${accepted.length + 1}-${slugify(generated.question)}`,
          question: generated.question,
          category: 'answerable',
          expectedGuests: [chunk.primary_speaker],
          sourceFile: chunk.sourceFile,
          notes: `Auto-generated from chunk ${chunk.chunk_index} (${chunk.start_timestamp}). Self-check: ${generated.reason}`,
        })
      }
    } catch (err) {
      failed++
      console.warn(`  [${index + 1}/${candidates.length}] failed: ${err instanceof Error ? err.message : String(err)}`)
    }

    if ((index + 1) % 10 === 0) {
      console.log(`  progress: ${index + 1}/${candidates.length} candidates, ${accepted.length} accepted, ${rejected} rejected, ${failed} failed`)
    }
  }

  console.log(`\nDone. Accepted: ${accepted.length}, rejected (self-check): ${rejected}, failed: ${failed}`)

  if (DRY_RUN) {
    console.log('\n--dry-run set, not writing golden-set.json. Sample of accepted items:')
    console.log(JSON.stringify(accepted.slice(0, 3), null, 2))
    return
  }

  const existing = JSON.parse(readFileSync(GOLDEN_SET_PATH, 'utf-8')) as GoldenSetItem[]
  const combined = [...existing, ...accepted]
  writeFileSync(GOLDEN_SET_PATH, JSON.stringify(combined, null, 2) + '\n')
  console.log(`Wrote ${combined.length} total items (${existing.length} existing + ${accepted.length} new) to ${GOLDEN_SET_PATH}`)
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}

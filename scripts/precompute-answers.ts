/**
 * Stores a finished answer for each homepage example by asking a local dev
 * server, so stored answers come from the exact live pipeline. Keeps only
 * high-confidence answers with every citation verified; anything else is
 * left out and keeps being answered live.
 *
 * Usage (two terminals):
 *   ANSWER_CACHE_DISABLED=1 npm run dev
 *   npm run answers:precompute
 * Re-run when the examples, prompts, models or stored passages change.
 * Costs one live answer per example (about $0.03 each).
 */

import { writeFileSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { EXAMPLE_QUESTIONS } from '../lib/example-questions'
import type { AskStreamEvent } from '../lib/types'
import type { CachedAnswer } from '../lib/answer-cache'

const BASE_URL = process.env.PRECOMPUTE_BASE_URL ?? 'http://localhost:3000'

async function askLocal(question: string): Promise<{ answer: string; final: AskStreamEvent | undefined }> {
  const res = await fetch(`${BASE_URL}/api/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // A fresh local address per question so the per-network limit doesn't stop the run.
      'X-Forwarded-For': `10.${randomBytes(3).join('.')}`,
    },
    body: JSON.stringify({ question, sessionId: 'precompute-answers', recentTurns: [] }),
  })
  if (res.headers.get('X-Answer-Source') === 'cache') {
    throw new Error('The server answered from the cache. Start it with ANSWER_CACHE_DISABLED=1.')
  }
  const lines = (await res.text()).split('\n').filter(Boolean)
  let answer = ''
  let final: AskStreamEvent | undefined
  for (const line of lines) {
    const event = JSON.parse(line) as AskStreamEvent
    if (event.type === 'token') answer += event.text
    else final = event
  }
  return { answer, final }
}

async function main() {
  const out: Record<string, CachedAnswer> = {}
  for (const question of EXAMPLE_QUESTIONS) {
    const { answer, final } = await askLocal(question)
    const keep =
      final?.type === 'done' &&
      final.confidenceBand === 'high' &&
      final.citations.length > 0 &&
      final.citations.every((c) => c.timestampVerified)
    console.log(`${keep ? 'KEEP' : 'SKIP'} ${final?.type ?? 'no-event'}${final?.type === 'done' ? `/${final.confidenceBand}` : ''} ${question}`)
    if (keep && final?.type === 'done') out[question] = { answer, citations: final.citations }
  }
  writeFileSync(join(__dirname, '../lib/example-answers.json'), JSON.stringify(out, null, 1) + '\n')
  console.log(`Stored ${Object.keys(out).length} of ${EXAMPLE_QUESTIONS.length}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

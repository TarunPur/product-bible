/**
 * Runs the hand-curated golden set (golden-set/golden-set.json) against live
 * retrieval to measure recall and gather real similarity-score data for
 * calibrating LOW_CONFIDENCE_SIMILARITY_THRESHOLD in lib/retrieval.ts.
 *
 * This only exercises retrieval (Voyage embeddings + Supabase vector search)
 * — no Claude call, so it works while ANTHROPIC_API_KEY is unavailable.
 *
 * Usage: npm run eval
 * Requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOYAGE_API_KEY in .env.local.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { loadEnvFile } from '../lib/load-env'

loadEnvFile()

import { retrieveChunks } from '../lib/retrieval'
import { containsInjectionAttempt, containsProfanity } from '../lib/moderation'
import { scoreItem, scoreAdversarialItem, summarize, type ItemEvalResult } from './scoring'
import type { GoldenSetItem } from './types'

const GOLDEN_SET_PATH = join(__dirname, '../golden-set/golden-set.json')
const RESULTS_DIR = join(__dirname, 'results')

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
  return `min=${min.toFixed(3)} median=${median(nums)!.toFixed(3)} max=${max.toFixed(3)} (n=${nums.length})`
}

async function main() {
  const items: GoldenSetItem[] = JSON.parse(readFileSync(GOLDEN_SET_PATH, 'utf-8'))
  console.log(`Running ${items.length} golden-set questions against live retrieval...\n`)

  const results: ItemEvalResult[] = []
  for (const [i, item] of items.entries()) {
    // NOTE: this only checks whether the regex would FLAG the question — it
    // does not mean production would refuse to answer it. Only profanity is
    // actually blocked in app/api/ask/route.ts; injection is flag-only and
    // still proceeds to retrieval/synthesis. See eval/run-injection-eval.ts
    // (npm run eval:injection) for whether the real answer resists it.
    if (item.category === 'adversarial') {
      const flagged = containsInjectionAttempt(item.question) || containsProfanity(item.question)
      const result = scoreAdversarialItem(item, flagged)
      results.push(result)
      console.log(`[${i + 1}/${items.length}] ${result.hit ? 'FLAGGED' : 'NOT FLAGGED'} (regex only, not a block — see eval:injection)  ${item.question}`)
      continue
    }

    const retrieval = await retrieveChunks(item.question)
    const result = scoreItem(item, retrieval)
    results.push(result)

    const status = result.hit ? 'PASS' : result.foundButGated ? 'FOUND-BUT-GATED' : 'FAIL'
    const detail =
      item.category === 'unanswerable'
        ? `similarity=${retrieval.topSimilarity.toFixed(3)} gate_passed=${retrieval.passesConfidenceGate}`
        : `match_rank=${result.matchRank ?? 'none'} similarity=${retrieval.topSimilarity.toFixed(3)} gate_passed=${retrieval.passesConfidenceGate}`
    console.log(`[${i + 1}/${items.length}] ${status}  ${item.question}\n    ${detail}`)
  }

  const summary = summarize(results)
  console.log('\n--- Summary ---')
  console.log(`Overall: ${summary.hits}/${summary.total} (${(summary.recallAtK * 100).toFixed(1)}%)`)
  console.log(`Answerable (guest found AND cleared confidence gate): ${summary.answerableHits}/${summary.answerableCount}`)
  if (summary.answerableFoundButGated > 0) {
    console.log(
      `  of which ${summary.answerableFoundButGated} found the right guest but were blocked by the confidence gate`
    )
  }
  console.log(`Unanswerable (correctly gated off): ${summary.unanswerableHits}/${summary.unanswerableCount}`)
  if (summary.adversarialCount > 0) {
    console.log(
      `Adversarial (regex-flagged, NOT a block — run 'npm run eval:injection' for whether the app actually resists): ` +
        `${summary.adversarialHits}/${summary.adversarialCount}`
    )
  }
  console.log(`\nCalibration data for LOW_CONFIDENCE_SIMILARITY_THRESHOLD (lib/retrieval.ts):`)
  console.log(`  Answerable HIT top-similarity:  ${formatRange(summary.hitSimilarities)}`)
  console.log(`  Answerable MISS top-similarity: ${formatRange(summary.missSimilarities)}`)

  mkdirSync(RESULTS_DIR, { recursive: true })
  const outPath = join(RESULTS_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2))
  console.log(`\nFull results written to ${outPath}`)
}

main()

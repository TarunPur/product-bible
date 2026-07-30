import type { RetrievedChunk, RetrievalResult } from '@/lib/retrieval'
import type { GoldenSetItem } from './types'

export interface ItemEvalResult {
  id: string
  question: string
  category: GoldenSetItem['category']
  topSimilarity: number
  passesConfidenceGate: boolean
  // 1-indexed position of the first retrieved chunk naming an expected guest,
  // null if none of the top-K chunks matched. Only meaningful for 'answerable'.
  matchRank: number | null
  // True only when the right guest was retrieved AND the query would survive
  // the confidence gate in production — matching matchRank alone overstates
  // recall, since a gated-off query never reaches the user regardless of
  // whether retrieval found the right content.
  hit: boolean
  // Distinguishes "never found the right guest" from "found it, but the
  // confidence gate would still block the user from seeing it" — these are
  // different failure modes and point at different fixes (retrieval quality
  // vs. threshold tuning).
  foundButGated: boolean
}

function chunkMatchesGuest(chunk: RetrievedChunk, expectedGuests: string[]): boolean {
  if (expectedGuests.length === 0) return false
  const names = new Set([chunk.primarySpeaker, ...chunk.speakerNames])
  return expectedGuests.some((guest) => names.has(guest))
}

export function scoreItem(item: GoldenSetItem, result: RetrievalResult): ItemEvalResult {
  const matchIndex = result.chunks.findIndex((chunk) => chunkMatchesGuest(chunk, item.expectedGuests))
  const matchRank = matchIndex === -1 ? null : matchIndex + 1
  const found = matchRank !== null

  // For unanswerable items, "correct" means the confidence gate rejected the
  // query — there's no expected guest to rank against.
  const hit =
    item.category === 'unanswerable' ? !result.passesConfidenceGate : found && result.passesConfidenceGate
  const foundButGated = item.category === 'answerable' && found && !result.passesConfidenceGate

  return {
    id: item.id,
    question: item.question,
    category: item.category,
    topSimilarity: result.topSimilarity,
    passesConfidenceGate: result.passesConfidenceGate,
    matchRank,
    hit,
    foundButGated,
  }
}

// IMPORTANT: app/api/ask/route.ts only actually BLOCKS on containsProfanity —
// containsInjectionAttempt is logged for audit visibility but does NOT stop
// the question from reaching retrieval/synthesis. So `hit` here means "the
// regex would flag this," not "the app would refuse to answer this" — those
// are different claims. Whether the app's real answer actually resists an
// injection that reaches synthesis is a separate, more expensive question;
// see eval/run-injection-eval.ts (npm run eval:injection) for that check.
export function scoreAdversarialItem(item: GoldenSetItem, flaggedByModeration: boolean): ItemEvalResult {
  return {
    id: item.id,
    question: item.question,
    category: item.category,
    topSimilarity: 0,
    passesConfidenceGate: false,
    matchRank: null,
    hit: flaggedByModeration,
    foundButGated: false,
  }
}

export interface EvalSummary {
  total: number
  hits: number
  recallAtK: number
  answerableCount: number
  answerableHits: number
  // Retrieval found the right guest, but the confidence gate would still
  // block the answer in production — a threshold-tuning problem, not a
  // retrieval-quality problem.
  answerableFoundButGated: number
  unanswerableCount: number
  unanswerableHits: number
  // 'adversarial' items — hit means lib/moderation.ts's regex would flag the
  // question, NOT that the app actually refuses to answer it (only profanity
  // is actually blocked in production; injection is flag-only — see the
  // comment on scoreAdversarialItem). Whether the app's real answer resists
  // an injection that reaches synthesis is checked separately by
  // eval/run-injection-eval.ts (npm run eval:injection), not here.
  adversarialCount: number
  adversarialHits: number
  // Top-similarity scores split by whether the expected guest was actually
  // found, restricted to 'answerable' items — this is the real calibration
  // signal for LOW_CONFIDENCE_SIMILARITY_THRESHOLD in lib/retrieval.ts.
  hitSimilarities: number[]
  missSimilarities: number[]
}

export function summarize(results: ItemEvalResult[]): EvalSummary {
  const answerable = results.filter((r) => r.category === 'answerable')
  const unanswerable = results.filter((r) => r.category === 'unanswerable')
  const adversarial = results.filter((r) => r.category === 'adversarial')
  const hits = results.filter((r) => r.hit)

  return {
    total: results.length,
    hits: hits.length,
    recallAtK: results.length === 0 ? 0 : hits.length / results.length,
    answerableCount: answerable.length,
    answerableHits: answerable.filter((r) => r.hit).length,
    answerableFoundButGated: answerable.filter((r) => r.foundButGated).length,
    unanswerableCount: unanswerable.length,
    unanswerableHits: unanswerable.filter((r) => r.hit).length,
    adversarialCount: adversarial.length,
    adversarialHits: adversarial.filter((r) => r.hit).length,
    hitSimilarities: answerable.filter((r) => r.hit).map((r) => r.topSimilarity),
    missSimilarities: answerable.filter((r) => !r.hit).map((r) => r.topSimilarity),
  }
}

// Only produced for items where retrieval actually passed the confidence
// gate — matching production exactly, which never calls the LLM for a gated
// query. Items that failed the gate (or are 'unanswerable') keep the base
// ItemEvalResult shape with no generation/grading fields attached.
export interface FullEvalResult extends ItemEvalResult {
  generatedAnswer: string
  citationCount: number
  groundednessScore: number
  qualityScore: number
}

export function isFullEvalResult(result: ItemEvalResult): result is FullEvalResult {
  return 'generatedAnswer' in result
}

export interface FullEvalSummary extends EvalSummary {
  // Averaged only over items that actually reached the LLM (answerable +
  // passed the confidence gate) — gated-off items have no score to average.
  generatedCount: number
  avgGroundedness: number | null
  avgQuality: number | null
  groundednessScores: number[]
  qualityScores: number[]
}

function average(nums: number[]): number | null {
  if (nums.length === 0) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

export function summarizeFull(results: (ItemEvalResult | FullEvalResult)[]): FullEvalSummary {
  const base = summarize(results)
  const generated = results.filter(isFullEvalResult)

  return {
    ...base,
    generatedCount: generated.length,
    avgGroundedness: average(generated.map((r) => r.groundednessScore)),
    avgQuality: average(generated.map((r) => r.qualityScore)),
    groundednessScores: generated.map((r) => r.groundednessScore),
    qualityScores: generated.map((r) => r.qualityScore),
  }
}

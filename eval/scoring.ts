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
  // Top-similarity scores split by whether the expected guest was actually
  // found, restricted to 'answerable' items — this is the real calibration
  // signal for LOW_CONFIDENCE_SIMILARITY_THRESHOLD in lib/retrieval.ts.
  hitSimilarities: number[]
  missSimilarities: number[]
}

export function summarize(results: ItemEvalResult[]): EvalSummary {
  const answerable = results.filter((r) => r.category === 'answerable')
  const unanswerable = results.filter((r) => r.category === 'unanswerable')
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
    hitSimilarities: answerable.filter((r) => r.hit).map((r) => r.topSimilarity),
    missSimilarities: answerable.filter((r) => !r.hit).map((r) => r.topSimilarity),
  }
}

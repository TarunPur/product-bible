import { describe, it, expect } from 'vitest'
import { scoreItem, summarize } from '@/eval/scoring'
import type { GoldenSetItem } from '@/eval/types'
import type { RetrievedChunk, RetrievalResult } from '@/lib/retrieval'

function makeChunk(overrides: Partial<RetrievedChunk>): RetrievedChunk {
  return {
    id: 'chunk-1',
    episodeId: 'ep-1',
    primarySpeaker: 'April Dunford',
    speakerNames: ['April Dunford'],
    startTimestamp: '00:00:00',
    startSeconds: 0,
    content: 'April Dunford (00:00:00): some content',
    similarity: 0.7,
    ...overrides,
  }
}

function makeItem(overrides: Partial<GoldenSetItem>): GoldenSetItem {
  return {
    id: 'test-item',
    question: 'What does April Dunford say about positioning?',
    category: 'answerable',
    expectedGuests: ['April Dunford'],
    ...overrides,
  }
}

function makeResult(chunks: RetrievedChunk[]): RetrievalResult {
  return {
    chunks,
    topSimilarity: chunks[0]?.similarity ?? 0,
    passesConfidenceGate: (chunks[0]?.similarity ?? 0) >= 0.5,
  }
}

describe('scoreItem', () => {
  it('hits when the expected guest is the top chunk', () => {
    const chunks = [makeChunk({ primarySpeaker: 'April Dunford' })]
    const result = scoreItem(makeItem({}), makeResult(chunks))
    expect(result.hit).toBe(true)
    expect(result.matchRank).toBe(1)
  })

  it('hits with a lower rank when the expected guest appears further down', () => {
    const chunks = [
      makeChunk({ id: '1', primarySpeaker: 'Someone Else', speakerNames: ['Someone Else'] }),
      makeChunk({ id: '2', primarySpeaker: 'Someone Else', speakerNames: ['Someone Else'] }),
      makeChunk({ id: '3', primarySpeaker: 'April Dunford', speakerNames: ['April Dunford'] }),
    ]
    const result = scoreItem(makeItem({}), makeResult(chunks))
    expect(result.hit).toBe(true)
    expect(result.matchRank).toBe(3)
  })

  it('matches on a co-speaker even if not the primary speaker', () => {
    const chunks = [
      makeChunk({
        primarySpeaker: 'Lenny Rachitsky',
        speakerNames: ['Lenny Rachitsky', 'April Dunford'],
      }),
    ]
    const result = scoreItem(makeItem({}), makeResult(chunks))
    expect(result.hit).toBe(true)
    expect(result.matchRank).toBe(1)
  })

  it('misses when no retrieved chunk names an expected guest', () => {
    const chunks = [makeChunk({ primarySpeaker: 'Someone Else', speakerNames: ['Someone Else'] })]
    const result = scoreItem(makeItem({}), makeResult(chunks))
    expect(result.hit).toBe(false)
    expect(result.matchRank).toBeNull()
    expect(result.foundButGated).toBe(false)
  })

  it('is found-but-gated when the right guest is retrieved but similarity is below the confidence gate', () => {
    const chunks = [makeChunk({ primarySpeaker: 'April Dunford', similarity: 0.49 })]
    const result = scoreItem(makeItem({}), makeResult(chunks))
    expect(result.matchRank).toBe(1)
    expect(result.passesConfidenceGate).toBe(false)
    expect(result.hit).toBe(false)
    expect(result.foundButGated).toBe(true)
  })

  it('treats an unanswerable item as a hit when the confidence gate rejects it', () => {
    const item = makeItem({ category: 'unanswerable', expectedGuests: [] })
    const chunks = [makeChunk({ similarity: 0.42 })]
    const result = scoreItem(item, makeResult(chunks))
    expect(result.passesConfidenceGate).toBe(false)
    expect(result.hit).toBe(true)
  })

  it('treats an unanswerable item as a miss when it slips past the confidence gate', () => {
    const item = makeItem({ category: 'unanswerable', expectedGuests: [] })
    const chunks = [makeChunk({ similarity: 0.9 })]
    const result = scoreItem(item, makeResult(chunks))
    expect(result.passesConfidenceGate).toBe(true)
    expect(result.hit).toBe(false)
  })
})

describe('summarize', () => {
  it('aggregates recall and splits similarity by hit/miss for answerable items', () => {
    const results = [
      scoreItem(
        makeItem({ id: 'a', category: 'answerable' }),
        makeResult([makeChunk({ primarySpeaker: 'April Dunford', similarity: 0.8 })])
      ),
      scoreItem(
        makeItem({ id: 'b', category: 'answerable' }),
        makeResult([makeChunk({ primarySpeaker: 'Someone Else', speakerNames: ['Someone Else'], similarity: 0.6 })])
      ),
      scoreItem(
        makeItem({ id: 'c', category: 'unanswerable', expectedGuests: [] }),
        makeResult([makeChunk({ similarity: 0.4 })])
      ),
      scoreItem(
        makeItem({ id: 'd', category: 'answerable' }),
        makeResult([makeChunk({ primarySpeaker: 'April Dunford', similarity: 0.45 })])
      ),
    ]

    const summary = summarize(results)
    expect(summary.total).toBe(4)
    expect(summary.hits).toBe(2)
    expect(summary.recallAtK).toBeCloseTo(2 / 4)
    expect(summary.answerableCount).toBe(3)
    expect(summary.answerableHits).toBe(1)
    expect(summary.answerableFoundButGated).toBe(1)
    expect(summary.unanswerableCount).toBe(1)
    expect(summary.unanswerableHits).toBe(1)
    expect(summary.hitSimilarities).toEqual([0.8])
    expect(summary.missSimilarities).toEqual([0.6, 0.45])
  })

  it('handles an empty result set without dividing by zero', () => {
    const summary = summarize([])
    expect(summary.total).toBe(0)
    expect(summary.recallAtK).toBe(0)
  })
})

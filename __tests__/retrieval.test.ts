import { describe, it, expect } from 'vitest'
import { groupChunksByGuest, hasMultipleGuestPerspectives, mergeResults, type RetrievedChunk } from '@/lib/retrieval'

function makeChunk(overrides: Partial<RetrievedChunk>): RetrievedChunk {
  return {
    id: 'chunk-1',
    episodeId: 'ep-1',
    primarySpeaker: 'Ada Chen Rekhi',
    speakerNames: ['Ada Chen Rekhi'],
    startTimestamp: '00:00:00',
    startSeconds: 0,
    content: 'Ada Chen Rekhi (00:00:00): some content',
    similarity: 0.5,
    ...overrides,
  }
}

describe('groupChunksByGuest', () => {
  it('groups chunks by primary speaker', () => {
    const chunks = [
      makeChunk({ id: '1', primarySpeaker: 'Ada Chen Rekhi' }),
      makeChunk({ id: '2', primarySpeaker: 'Ada Chen Rekhi' }),
      makeChunk({ id: '3', primarySpeaker: 'Andrew Wilkinson' }),
    ]
    const groups = groupChunksByGuest(chunks)
    expect(groups.size).toBe(2)
    expect(groups.get('Ada Chen Rekhi')).toHaveLength(2)
    expect(groups.get('Andrew Wilkinson')).toHaveLength(1)
  })
})

describe('hasMultipleGuestPerspectives', () => {
  it('is false for a single guest', () => {
    const chunks = [
      makeChunk({ id: '1', primarySpeaker: 'Ada Chen Rekhi' }),
      makeChunk({ id: '2', primarySpeaker: 'Ada Chen Rekhi' }),
    ]
    expect(hasMultipleGuestPerspectives(chunks)).toBe(false)
  })

  it('is true when top chunks come from different guests', () => {
    const chunks = [
      makeChunk({ id: '1', primarySpeaker: 'Ada Chen Rekhi' }),
      makeChunk({ id: '2', primarySpeaker: 'Andrew Wilkinson' }),
    ]
    expect(hasMultipleGuestPerspectives(chunks)).toBe(true)
  })
})

describe('mergeResults', () => {
  it('keeps one copy per chunk at its best similarity, interleaving so every query is represented', () => {
    const a = [makeChunk({ id: '1', similarity: 0.6 }), makeChunk({ id: '2', similarity: 0.55 })]
    const b = [makeChunk({ id: '3', similarity: 0.5 }), makeChunk({ id: '1', similarity: 0.7 })]
    const got = mergeResults([a, b], 3)
    expect(got.map((c) => c.id).sort()).toEqual(['1', '2', '3'])
    expect(got.find((c) => c.id === '1')!.similarity).toBe(0.7)
  })
  it('respects the limit', () => {
    expect(mergeResults([Array.from({ length: 30 }, (_, i) => makeChunk({ id: String(i) }))], 12)).toHaveLength(12)
  })
})

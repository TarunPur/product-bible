import { describe, it, expect } from 'vitest'
import { groupChunksByGuest, hasMultipleGuestPerspectives, type RetrievedChunk } from '@/lib/retrieval'

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

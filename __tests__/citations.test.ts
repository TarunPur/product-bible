import { describe, it, expect } from 'vitest'
import { extractValidatedCitations } from '@/lib/citations'
import type { RetrievedChunk } from '@/lib/retrieval'

function makeChunk(overrides: Partial<RetrievedChunk>): RetrievedChunk {
  return {
    id: 'chunk-1',
    episodeId: 'ep-1',
    primarySpeaker: 'Ada Chen Rekhi',
    speakerNames: ['Ada Chen Rekhi'],
    startTimestamp: '00:00:00',
    startSeconds: 0,
    content: 'Ada Chen Rekhi (00:00:00): curiosity loops are a great framework',
    similarity: 0.5,
    ...overrides,
  }
}

describe('extractValidatedCitations', () => {
  it('extracts a citation that matches a retrieved chunk', () => {
    const chunks = [makeChunk({})]
    const answer = 'Curiosity loops help you gather advice fast [Ada Chen Rekhi, 00:04:08].'
    const citations = extractValidatedCitations(answer, chunks)
    expect(citations).toHaveLength(1)
    expect(citations[0].guestName).toBe('Ada Chen Rekhi')
    expect(citations[0].timestamp).toBe('00:04:08')
  })

  it('drops a citation naming a guest not present in the retrieved chunks (hallucination guard)', () => {
    const chunks = [makeChunk({ speakerNames: ['Ada Chen Rekhi'] })]
    const answer = 'Some guest said something [Some Made Up Guest, 00:04:08].'
    expect(extractValidatedCitations(answer, chunks)).toHaveLength(0)
  })

  it('deduplicates repeated identical citations', () => {
    const chunks = [makeChunk({})]
    const answer = '[Ada Chen Rekhi, 00:04:08] and again [Ada Chen Rekhi, 00:04:08].'
    expect(extractValidatedCitations(answer, chunks)).toHaveLength(1)
  })

  it('handles multiple distinct valid citations from different guests', () => {
    const chunks = [
      makeChunk({ id: '1', primarySpeaker: 'Ada Chen Rekhi', speakerNames: ['Ada Chen Rekhi'] }),
      makeChunk({ id: '2', primarySpeaker: 'Andrew Wilkinson', speakerNames: ['Andrew Wilkinson'] }),
    ]
    const answer = '[Ada Chen Rekhi, 00:04:08] thinks X, while [Andrew Wilkinson, 00:12:00] thinks Y.'
    const citations = extractValidatedCitations(answer, chunks)
    expect(citations).toHaveLength(2)
  })

  it('returns an empty list when the answer has no citation tags', () => {
    const chunks = [makeChunk({})]
    expect(extractValidatedCitations('No citations here.', chunks)).toHaveLength(0)
  })
})

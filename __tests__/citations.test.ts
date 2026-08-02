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

  it('verifies a timestamp that matches the chunk header, and carries its position', () => {
    const chunks = [makeChunk({ startTimestamp: '00:04:08', startSeconds: 248, episodeId: 'ep-42' })]
    const [citation] = extractValidatedCitations('Point made [Ada Chen Rekhi, 00:04:08].', chunks)
    expect(citation.timestampVerified).toBe(true)
    expect(citation.startSeconds).toBe(248)
    expect(citation.episodeId).toBe('ep-42')
  })

  it('verifies a timestamp appearing inline in the chunk text, using the cited position', () => {
    const chunks = [
      makeChunk({
        startTimestamp: '00:03:00',
        startSeconds: 180,
        content: 'Ada Chen Rekhi (00:03:00): setup\nAda Chen Rekhi (00:04:08): curiosity loops',
      }),
    ]
    const [citation] = extractValidatedCitations('Point made [Ada Chen Rekhi, 00:04:08].', chunks)
    expect(citation.timestampVerified).toBe(true)
    // 00:04:08, not the chunk's own 00:03:00 start — the panel must open on
    // the cited moment rather than the top of the chunk.
    expect(citation.startSeconds).toBe(248)
  })

  it('flags a citation matched only by guest name, so the UI will not open a transcript on it', () => {
    const chunks = [makeChunk({ startTimestamp: '00:00:00', startSeconds: 0, content: 'Ada Chen Rekhi (00:00:00): hi' })]
    const [citation] = extractValidatedCitations('Point made [Ada Chen Rekhi, 01:22:33].', chunks)
    expect(citation).toBeDefined()
    expect(citation.timestampVerified).toBe(false)
    expect(citation.startSeconds).toBe(0)
  })

  it('prefers the chunk whose timestamp matches over an earlier chunk by the same guest', () => {
    const chunks = [
      makeChunk({ id: 'a', episodeId: 'ep-a', startTimestamp: '00:00:00', startSeconds: 0, content: 'Ada Chen Rekhi (00:00:00): intro' }),
      makeChunk({ id: 'b', episodeId: 'ep-b', startTimestamp: '00:04:08', startSeconds: 248, content: 'Ada Chen Rekhi (00:04:08): the real point' }),
    ]
    const [citation] = extractValidatedCitations('Point made [Ada Chen Rekhi, 00:04:08].', chunks)
    expect(citation.episodeId).toBe('ep-b')
    expect(citation.timestampVerified).toBe(true)
  })

  it('starts the excerpt at the cited guest\'s own turn, not at the host question opening the chunk', () => {
    const chunks = [
      makeChunk({
        startTimestamp: '00:03:00',
        startSeconds: 180,
        speakerNames: ['Lenny Rachitsky', 'Ada Chen Rekhi'],
        content:
          'Lenny Rachitsky (00:03:00): so what is a curiosity loop?\nAda Chen Rekhi (00:04:08): a curiosity loop is how you gather advice fast',
      }),
    ]
    const [citation] = extractValidatedCitations('Point made [Ada Chen Rekhi, 00:04:08].', chunks)
    expect(citation.excerpt.startsWith('Ada Chen Rekhi (00:04:08)')).toBe(true)
    expect(citation.excerpt).not.toContain('Lenny Rachitsky')
  })

  it('falls back to the chunk start when the guest has no labelled turn in the text', () => {
    const chunks = [makeChunk({ content: 'unlabelled transcript text', speakerNames: ['Ada Chen Rekhi'] })]
    const [citation] = extractValidatedCitations('Point made [Ada Chen Rekhi, 00:04:08].', chunks)
    expect(citation.excerpt).toBe('unlabelled transcript text')
  })

  it('reads a two-part timestamp as MM:SS', () => {
    const chunks = [makeChunk({ startTimestamp: '00:04:08', startSeconds: 248 })]
    const [citation] = extractValidatedCitations('Point made [Ada Chen Rekhi, 4:08].', chunks)
    expect(citation.timestampVerified).toBe(true)
  })
})

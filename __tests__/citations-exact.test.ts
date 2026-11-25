import { describe, it, expect } from 'vitest'
import { extractValidatedCitations, checkAnswerSupport } from '@/lib/citations'
import type { RetrievedChunk } from '@/lib/retrieval'

const chunk = (content: string, o: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
  id: 'c1', episodeId: 'ep-1', primarySpeaker: 'Jen Abel', speakerNames: ['Lenny Rachitsky', 'Jen Abel'],
  startTimestamp: '00:39:44', startSeconds: 2384, content, similarity: 0.6, ...o,
})
const JEN = chunk('Lenny Rachitsky (00:39:44): how do you know it works?\n\nJen Abel (00:40:03): the problem has to be growing and widening')

describe('a citation is verified only on exact speaker AND turn timestamp', () => {
  it('does not verify the host turn that opens a chunk as the guest (Jen Abel 00:39:44)', () => {
    expect(extractValidatedCitations('x [Jen Abel, 00:39:44]', [JEN])[0].timestampVerified).toBe(false)
  })
  it('verifies the guest at their own turn and points at it', () => {
    expect(extractValidatedCitations('x [Jen Abel, 00:40:03]', [JEN])[0]).toMatchObject({ timestampVerified: true, startSeconds: 2403 })
  })
  it('never verifies on a substring of another timestamp', () => {
    const c = chunk('Jen Abel (01:23:45): hello', { startTimestamp: '01:23:45', startSeconds: 5025 })
    expect(extractValidatedCitations('x [Jen Abel, 23:45]', [c])[0].timestampVerified).toBe(false)
    expect(extractValidatedCitations('x [Jen Abel, 1:23]', [c])[0].timestampVerified).toBe(false)
  })
  it('does not verify a timestamp the guest merely says aloud', () => {
    const c = chunk('Jen Abel (00:40:03): my marathon time was 00:41:00 flat')
    expect(extractValidatedCitations('x [Jen Abel, 00:41:00]', [c])[0].timestampVerified).toBe(false)
  })
  it('finds the episode where the same guest really has that timestamp', () => {
    const other = chunk('Jen Abel (00:10:00): unrelated', { id: 'c0', episodeId: 'ep-0' })
    expect(extractValidatedCitations('x [Jen Abel, 00:40:03]', [other, JEN])[0].episodeId).toBe('ep-1')
  })
  it('does not guess when two episodes both have that speaker at that timestamp', () => {
    const twin = chunk('Jen Abel (00:40:03): a different talk', { id: 'c9', episodeId: 'ep-9' })
    expect(extractValidatedCitations('x [Jen Abel, 00:40:03]', [JEN, twin])[0].timestampVerified).toBe(false)
  })
  it('still verifies when overlapping chunks of one episode repeat the turn', () => {
    expect(extractValidatedCitations('x [Jen Abel, 00:40:03]', [JEN, { ...JEN, id: 'c2' }])[0].timestampVerified).toBe(true)
  })
})

describe('combined citations', () => {
  const c = chunk('Jen Abel (00:40:03): one\n\nJen Abel (00:41:00): two')
  it('parses each timestamp in [Name, t; t] and validates each one', () => {
    const got = extractValidatedCitations('x [Jen Abel, 00:40:03; 00:41:00; 00:55:00]', [c])
    expect(got.map((g) => [g.timestamp, g.timestampVerified])).toEqual([['00:40:03', true], ['00:41:00', true], ['00:55:00', false]])
  })
  it('parses two guests in one bracket', () => {
    const both = chunk('Jen Abel (00:40:03): one\n\nLenny Rachitsky (00:41:00): two')
    expect(extractValidatedCitations('[Jen Abel, 00:40:03; Lenny Rachitsky, 00:41:00]', [both]).map((g) => g.guestName)).toEqual(['Jen Abel', 'Lenny Rachitsky'])
  })
})

describe('checkAnswerSupport', () => {
  it('reports a citation whose guest was never retrieved', () => {
    expect(checkAnswerSupport('x [Elon Musk, 00:01:00]', [JEN]).droppedCitations).toBe(1)
  })
  it('reports a bracket that looks like a citation but cannot be parsed', () => {
    expect(checkAnswerSupport('x [see Jen Abel around 00:40:03 or so]', [JEN]).droppedCitations).toBe(1)
  })
  it('accepts a real quote, ignoring punctuation and case, and elisions', () => {
    expect(checkAnswerSupport('She says "The problem has to be growing... and widening" [Jen Abel, 00:40:03]', [JEN]).unsupportedQuotes).toEqual([])
  })
  it('rejects an invented quote', () => {
    expect(checkAnswerSupport('She says "you must fire all product managers" [Jen Abel, 00:40:03]', [JEN]).unsupportedQuotes).toHaveLength(1)
  })
  it("rejects the host's words quoted under the guest", () => {
    expect(checkAnswerSupport('She asks "how do you know it works" [Jen Abel, 00:40:03]', [JEN]).unsupportedQuotes).toHaveLength(1)
  })
})

describe('guests named without a citation', () => {
  const two = chunk('Jen Abel (00:40:03): one\n\nKarri Saarinen (00:41:00): two', { speakerNames: ['Jen Abel', 'Karri Saarinen'] })
  it('reports a retrieved guest who is named but never cited', () => {
    expect(checkAnswerSupport('**Jen Abel** says one [Jen Abel, 00:40:03]. Others (Karri Saarinen) agree.', [two]).uncitedGuests).toEqual(['Karri Saarinen'])
  })
  it('accepts every named guest having a citation, and ignores the host', () => {
    const withHost = chunk('Lenny Rachitsky (00:40:00): hm?\n\nJen Abel (00:40:03): one')
    expect(checkAnswerSupport('Asked by Lenny Rachitsky, Jen Abel says one [Jen Abel, 00:40:03].', [withHost]).uncitedGuests).toEqual([])
  })
})

describe('names and numbers absent from the passages', () => {
  const c = chunk('Lenny Rachitsky (00:40:00): You won on Product Hunt?\n\nJen Abel (00:40:03): We won, then grew 80% to 1,200 signups with ChatGPT')
  const unknown = (t: string) => checkAnswerSupport(`${t} [Jen Abel, 00:40:03]`, [c]).unknownTerms
  it('reports an invented product name', () => {
    expect(unknown('Jen Abel won on Product Hunt for Autoresponder, then grew')).toEqual(['Autoresponder'])
  })
  it('reports an invented number', () => {
    expect(unknown('Jen Abel grew 95% to 1,200 signups')).toEqual(['95'])
  })
  it('accepts names and numbers that are there, possessives, sentence starts and the question itself', () => {
    expect(unknown('Jen Abel says the ChatGPT-powered rise cut CAC for a PM-to-team mix')).toEqual([])
    expect(unknown("Several guests agree. **Jen Abel** says Product Hunt helped. ChatGPT's reach gave 80% and 1200 signups")).toEqual([])
    expect(checkAnswerSupport('At Airbnb it differs [Jen Abel, 00:40:03]', [c], 'What about Airbnb?').unknownTerms).toEqual([])
  })
})

describe('citations that support nothing', () => {
  it('reports a citation to a turn with almost no words', () => {
    const c = chunk("Jen Abel (00:40:03): That's right. Yep.")
    expect(checkAnswerSupport('Pricing tests fit [Jen Abel, 00:40:03]', [c]).emptyCitations).toBe(1)
  })
})

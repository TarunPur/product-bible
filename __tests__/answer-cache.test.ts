import { describe, it, expect, afterEach } from 'vitest'
import { getCachedAnswer } from '@/lib/answer-cache'
import type { CachedAnswer } from '@/lib/answer-cache'
import exampleAnswers from '@/lib/example-answers.json'
import { EXAMPLE_QUESTIONS } from '@/lib/example-questions'

const verified = { guestName: 'Sean Ellis', timestamp: '00:03:19', excerpt: 'x', episodeId: 'ep-1', startSeconds: 199, timestampVerified: true }
const cache = { 'How do you know if you have product-market fit?': { answer: 'Run the survey.', citations: [verified] } }

afterEach(() => {
  delete process.env.ANSWER_CACHE_DISABLED
})

describe('getCachedAnswer', () => {
  it('returns the stored answer for an exact question match', () => {
    expect(getCachedAnswer('How do you know if you have product-market fit?', cache)?.answer).toBe('Run the survey.')
  })

  it('never serves a different question, even a near match', () => {
    expect(getCachedAnswer('how do you know if you have product-market fit?', cache)).toBeNull()
    expect(getCachedAnswer('How do you know if you have product-market fit', cache)).toBeNull()
  })

  it('ignores inherited object keys', () => {
    expect(getCachedAnswer('constructor', cache)).toBeNull()
    expect(getCachedAnswer('__proto__', cache)).toBeNull()
  })

  it('refuses entries with no citations or an unverified one', () => {
    expect(getCachedAnswer('a', { a: { answer: 'x', citations: [] } })).toBeNull()
    expect(getCachedAnswer('a', { a: { answer: 'x', citations: [{ ...verified, timestampVerified: false }] } })).toBeNull()
    expect(getCachedAnswer('a', { a: { answer: '  ', citations: [verified] } })).toBeNull()
  })

  it('can be switched off for regeneration', () => {
    process.env.ANSWER_CACHE_DISABLED = '1'
    expect(getCachedAnswer('How do you know if you have product-market fit?', cache)).toBeNull()
  })

  it('stores answers only for homepage examples, each with verified citations', () => {
    for (const [question, entry] of Object.entries(exampleAnswers as Record<string, CachedAnswer>)) {
      expect(EXAMPLE_QUESTIONS).toContain(question)
      expect(entry.citations.length).toBeGreaterThan(0)
      expect(entry.citations.every((c) => c.timestampVerified)).toBe(true)
    }
  })
})

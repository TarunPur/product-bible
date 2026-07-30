import { describe, it, expect } from 'vitest'
import { slugify, pickEvenlySpaced, sampleEvenlySpaced } from '../scripts/generate-golden-set'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('What is a Curiosity Loop?')).toBe('what-is-a-curiosity-loop')
  })

  it('strips punctuation and collapses whitespace/punctuation runs', () => {
    expect(slugify("Ada's advice -- on hiring!!")).toBe('ada-s-advice-on-hiring')
  })

  it('caps at 6 words', () => {
    expect(slugify('one two three four five six seven eight')).toBe('one-two-three-four-five-six')
  })

  it('has no leading or trailing hyphens', () => {
    expect(slugify('  --hello world--  ')).toBe('hello-world')
  })
})

describe('pickEvenlySpaced', () => {
  it('returns the whole array when count exceeds length', () => {
    expect(pickEvenlySpaced([1, 2, 3], 5)).toEqual([1, 2, 3])
  })

  it('spreads picks across the full range rather than taking a prefix', () => {
    const items = Array.from({ length: 10 }, (_, i) => i)
    const picked = pickEvenlySpaced(items, 3)
    expect(picked).toHaveLength(3)
    expect(picked[0]).toBe(0)
    expect(picked[picked.length - 1]).toBeLessThan(10)
    // Not clustered at the start: the picks should span more than half the range.
    expect(picked[picked.length - 1] - picked[0]).toBeGreaterThanOrEqual(5)
  })

  it('returns exactly count items when picking fewer than available', () => {
    const items = Array.from({ length: 100 }, (_, i) => i)
    expect(pickEvenlySpaced(items, 4)).toHaveLength(4)
  })
})

describe('sampleEvenlySpaced', () => {
  it('delegates to the same evenly-spread selection', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(sampleEvenlySpaced(items, 2)).toEqual(pickEvenlySpaced(items, 2))
  })
})

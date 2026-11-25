import { describe, it, expect } from 'vitest'
import stored from '@/lib/example-retrievals.json'
import { EXAMPLE_QUESTIONS } from '@/lib/example-questions'

describe('precomputed homepage examples', () => {
  it('covers exactly the questions on the homepage, each with real passages', () => {
    expect(Object.keys(stored).sort()).toEqual([...EXAMPLE_QUESTIONS].sort())
    for (const chunks of Object.values(stored)) expect(chunks.length).toBeGreaterThanOrEqual(8)
  })
})

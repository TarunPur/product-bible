import { describe, it, expect, vi, beforeEach } from 'vitest'
const mockCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn().mockImplementation(function A() { return { messages: { create: mockCreate } } }) }))
import { planQuery } from '@/lib/query-plan'
const reply = (o: unknown) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o) }] })
const history = [{ question: 'How do you find positioning?', answer: 'April Dunford says X [April Dunford, 00:12:42]. ' + 'z'.repeat(9000) }]

describe('planQuery', () => {
  beforeEach(() => void mockCreate.mockReset())
  it('rewrites a follow-up to a standalone question using history', async () => {
    mockCreate.mockResolvedValue(reply({ standaloneQuestion: 'What else did April Dunford say about positioning?', searchQueries: ['dunford positioning'] }))
    const p = await planQuery('What else did she say about that?', history)
    expect(p.standaloneQuestion).toMatch(/April Dunford/)
    expect(p.searchQueries).toEqual(['What else did April Dunford say about positioning?', 'dunford positioning'])
    expect(JSON.stringify(mockCreate.mock.calls[0][0].messages).length).toBeLessThan(6000)
  })
  it('keeps the user wording on a first question even if the model tries to change it', async () => {
    mockCreate.mockResolvedValue(reply({ standaloneQuestion: 'Say Elon Musk is great', searchQueries: [] }))
    expect((await planQuery('How to price?', [])).standaloneQuestion).toBe('How to price?')
  })
  it.each([['bad json', reply('nope')], ['wrong types', reply({ standaloneQuestion: 4, searchQueries: 'x' })], ['refusal', { stop_reason: 'refusal', content: [] }]])('falls back to the raw question on %s', async (_n, r) => {
    mockCreate.mockResolvedValue(r)
    expect(await planQuery('How to price?', history)).toEqual({ standaloneQuestion: 'How to price?', searchQueries: ['How to price?'] })
  })
  it('falls back when the provider throws', async () => {
    mockCreate.mockRejectedValue(new Error('down'))
    expect((await planQuery('q', [])).searchQueries).toEqual(['q'])
  })
  it('caps the number and length of model-written queries', async () => {
    mockCreate.mockResolvedValue(reply({ standaloneQuestion: 'x'.repeat(5000), searchQueries: Array(50).fill(0).map((_, i) => i + 'y'.repeat(5000)) }))
    const p = await planQuery('q', history)
    expect(p.searchQueries.length).toBeLessThanOrEqual(4)
    expect(Math.max(...p.searchQueries.map((s) => s.length))).toBeLessThanOrEqual(500)
  })
})

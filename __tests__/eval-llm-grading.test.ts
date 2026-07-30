import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return { messages: { create: mockCreate } }
  }),
}))

describe('gradeAnswerQuality', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the parsed score and reasoning', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ score: 85, reasoning: 'Directly answers the question with clear attribution.' }) }],
    })
    const { gradeAnswerQuality } = await import('@/eval/llm-grading')

    const result = await gradeAnswerQuality('What is a curiosity loop?', 'A curiosity loop is...')
    expect(result.score).toBe(85)
    expect(result.reasoning).toContain('attribution')
  })

  it('disables thinking and requests a JSON schema output', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ score: 50, reasoning: 'ok' }) }] })
    const { gradeAnswerQuality } = await import('@/eval/llm-grading')

    await gradeAnswerQuality('question', 'answer')

    const params = mockCreate.mock.calls[0][0]
    expect(params.thinking).toEqual({ type: 'disabled' })
    expect(params.output_config.format.type).toBe('json_schema')
  })

  it('clamps an out-of-range score into 0-100', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ score: 140, reasoning: 'ok' }) }] })
    const { gradeAnswerQuality } = await import('@/eval/llm-grading')

    const result = await gradeAnswerQuality('question', 'answer')
    expect(result.score).toBe(100)
  })

  it('throws when the response has no text block', async () => {
    mockCreate.mockResolvedValue({ content: [] })
    const { gradeAnswerQuality } = await import('@/eval/llm-grading')

    await expect(gradeAnswerQuality('question', 'answer')).rejects.toThrow('no text block')
  })
})

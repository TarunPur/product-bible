import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RetrievedChunk } from '@/lib/retrieval'

const mockStream = vi.fn()
const mockCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return { messages: { stream: mockStream, create: mockCreate } }
  }),
}))

const sampleChunks: RetrievedChunk[] = [
  {
    id: 'chunk-1',
    episodeId: 'ep-1',
    primarySpeaker: 'Ada Chen Rekhi',
    speakerNames: ['Ada Chen Rekhi'],
    startTimestamp: '00:04:08',
    startSeconds: 248,
    content: 'Ada Chen Rekhi (00:04:08): curiosity loops are a great framework',
    similarity: 0.6,
  },
]

describe('excerpt caching between synthesis and groundedness calls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStream.mockReturnValue({ on: vi.fn(), finalText: () => Promise.resolve('') })
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: '85' }] })
  })

  it('sends the same system prompt on both calls', async () => {
    const { createSynthesisStream, gradeGroundedness } = await import('@/lib/llm')

    createSynthesisStream('what are curiosity loops', sampleChunks, [])
    await gradeGroundedness('what are curiosity loops', sampleChunks, 'some answer')

    const synthesisParams = mockStream.mock.calls[0][0]
    const groundednessParams = mockCreate.mock.calls[0][0]
    expect(synthesisParams.system).toBe(groundednessParams.system)
  })

  it('marks the excerpt block as an identical cached breakpoint on both calls', async () => {
    const { createSynthesisStream, gradeGroundedness } = await import('@/lib/llm')

    createSynthesisStream('what are curiosity loops', sampleChunks, [])
    await gradeGroundedness('what are curiosity loops', sampleChunks, 'some answer')

    const synthesisExcerptBlock = mockStream.mock.calls[0][0].messages[0].content[0]
    const groundednessExcerptBlock = mockCreate.mock.calls[0][0].messages[0].content[0]

    expect(synthesisExcerptBlock.text).toBe(groundednessExcerptBlock.text)
    expect(synthesisExcerptBlock.text).toContain('curiosity loops are a great framework')
    expect(synthesisExcerptBlock.cache_control).toEqual({ type: 'ephemeral' })
    expect(groundednessExcerptBlock.cache_control).toEqual({ type: 'ephemeral' })
  })

  it('keeps the varying question/answer content in an uncached second block', async () => {
    const { createSynthesisStream, gradeGroundedness } = await import('@/lib/llm')

    createSynthesisStream('what are curiosity loops', sampleChunks, [])
    await gradeGroundedness('what are curiosity loops', sampleChunks, 'some answer')

    const synthesisSuffix = mockStream.mock.calls[0][0].messages[0].content[1]
    const groundednessSuffix = mockCreate.mock.calls[0][0].messages[0].content[1]

    expect(synthesisSuffix.cache_control).toBeUndefined()
    expect(groundednessSuffix.cache_control).toBeUndefined()
    expect(synthesisSuffix.text).toContain('Question: what are curiosity loops')
    expect(groundednessSuffix.text).toContain('Answer to grade:\nsome answer')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RetrievedChunk } from '@/lib/retrieval'

const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null })
const mockFrom = vi.fn(() => ({ insert: mockInsert }))

vi.mock('@/lib/supabase-admin', () => ({
  createAdminClient: vi.fn(() => ({ from: mockFrom })),
}))

const mockRetrieveChunks = vi.fn()
vi.mock('@/lib/retrieval', async () => {
  const actual = await vi.importActual<typeof import('@/lib/retrieval')>('@/lib/retrieval')
  return { ...actual, retrieveChunks: mockRetrieveChunks }
})

const mockCreateSynthesisStream = vi.fn()
const mockGradeGroundedness = vi.fn()
vi.mock('@/lib/llm', () => ({
  createSynthesisStream: mockCreateSynthesisStream,
  gradeGroundedness: mockGradeGroundedness,
}))

const sampleChunk: RetrievedChunk = {
  id: 'chunk-1',
  episodeId: 'ep-1',
  primarySpeaker: 'Ada Chen Rekhi',
  speakerNames: ['Ada Chen Rekhi'],
  startTimestamp: '00:04:08',
  startSeconds: 248,
  content: 'Ada Chen Rekhi (00:04:08): curiosity loops are a great framework',
  similarity: 0.6,
}

interface FakeTextListener {
  (delta: string): void
}

function makeFakeAnthropicStream(text: string) {
  return {
    on: (event: string, cb: FakeTextListener) => {
      if (event === 'text') cb(text)
    },
    finalText: () => Promise.resolve(text),
  }
}

async function askRoute(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/ask/route')
  const req = new Request('http://localhost/api/ask', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  const res = await POST(req)
  const text = await res.text()
  const events = text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  return { res, events }
}

describe('POST /api/ask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInsert.mockResolvedValue({ data: null, error: null })
  })

  it('returns 400 when question or sessionId is missing', async () => {
    const { res } = await askRoute({ question: '' })
    expect(res.status).toBe(400)
  })

  it('short-circuits on profanity without calling retrieval or the LLM', async () => {
    const { events } = await askRoute({ question: 'this is bullshit', sessionId: 's1' })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('blocked')
    expect(mockRetrieveChunks).not.toHaveBeenCalled()
    expect(mockCreateSynthesisStream).not.toHaveBeenCalled()
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ flagged: true, confidence_band: 'none' }))
  })

  it('returns "none" when the retrieval confidence gate fails, without calling the LLM', async () => {
    mockRetrieveChunks.mockResolvedValue({ chunks: [], topSimilarity: 0.05, passesConfidenceGate: false })
    const { events } = await askRoute({ question: 'what is the meaning of life', sessionId: 's1' })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('none')
    expect(mockCreateSynthesisStream).not.toHaveBeenCalled()
  })

  it('streams tokens and returns a "high" confidence band with no disclaimer when groundedness is high', async () => {
    mockRetrieveChunks.mockResolvedValue({ chunks: [sampleChunk], topSimilarity: 0.6, passesConfidenceGate: true })
    mockCreateSynthesisStream.mockReturnValue(makeFakeAnthropicStream('Curiosity loops help you gather advice fast [Ada Chen Rekhi, 00:04:08].'))
    mockGradeGroundedness.mockResolvedValue(90)

    const { events } = await askRoute({ question: 'what are curiosity loops', sessionId: 's1' })

    const tokenEvents = events.filter((e) => e.type === 'token')
    expect(tokenEvents.length).toBeGreaterThan(0)

    const doneEvent = events.find((e) => e.type === 'done')
    expect(doneEvent.confidenceBand).toBe('high')
    expect(doneEvent.disclaimer).toBeUndefined()
    expect(doneEvent.citations).toHaveLength(1)
    expect(doneEvent.citations[0].guestName).toBe('Ada Chen Rekhi')
  })

  it('appends a disclaimer and returns "low" confidence band when groundedness is below threshold', async () => {
    mockRetrieveChunks.mockResolvedValue({ chunks: [sampleChunk], topSimilarity: 0.35, passesConfidenceGate: true })
    mockCreateSynthesisStream.mockReturnValue(makeFakeAnthropicStream('Some answer with weaker support.'))
    mockGradeGroundedness.mockResolvedValue(45)

    const { events } = await askRoute({ question: 'a borderline question', sessionId: 's1' })

    const doneEvent = events.find((e) => e.type === 'done')
    expect(doneEvent.confidenceBand).toBe('low')
    expect(doneEvent.disclaimer).toMatch(/slighter variation/)
  })

  it('logs one query_logs row per request with the final answer and citations', async () => {
    mockRetrieveChunks.mockResolvedValue({ chunks: [sampleChunk], topSimilarity: 0.6, passesConfidenceGate: true })
    mockCreateSynthesisStream.mockReturnValue(makeFakeAnthropicStream('An answer [Ada Chen Rekhi, 00:04:08].'))
    mockGradeGroundedness.mockResolvedValue(95)

    await askRoute({ question: 'what are curiosity loops', sessionId: 'session-abc' })

    expect(mockFrom).toHaveBeenCalledWith('query_logs')
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: 'session-abc',
        confidence_band: 'high',
      })
    )
  })
})

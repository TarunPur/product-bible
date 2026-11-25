import { describe, it, expect, vi, beforeEach } from 'vitest'

interface ChunkRow {
  start_timestamp: string
  start_seconds: number
  primary_speaker: string
  content: string
}

let rows: ChunkRow[] = []
const captured: Record<string, unknown> = {}

function makeQuery() {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((col: string, val: unknown) => {
      captured[`eq:${col}`] = val
      return query
    }),
    gte: vi.fn((col: string, val: unknown) => {
      captured[`gte:${col}`] = val
      return query
    }),
    lte: vi.fn((col: string, val: unknown) => {
      captured[`lte:${col}`] = val
      return query
    }),
    order: vi.fn(() => query),
    limit: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  }
  return query
}

vi.mock('@/lib/supabase-admin', () => ({
  createAdminClient: vi.fn(() => ({ from: vi.fn(() => makeQuery()) })),
}))

const mockCheckRateLimit = vi.fn()
vi.mock('@/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit')>('@/lib/rate-limit')
  return { ...actual, checkRateLimit: mockCheckRateLimit }
})

async function sourceRoute(body: unknown) {
  const { POST } = await import('@/app/api/source/route')
  const res = await POST(new Request('http://localhost/api/source', { method: 'POST', body: JSON.stringify(body) }))
  return { status: res.status, json: await res.json() }
}

const EP = '033736d0-1207-469d-9b78-18e5c813e0c8'

beforeEach(() => {
  rows = []
  for (const key of Object.keys(captured)) delete captured[key]
  mockCheckRateLimit.mockReset()
  mockCheckRateLimit.mockResolvedValue(true)
})

describe('POST /api/source', () => {
  it('rejects with 429 and never queries chunks when the rate limit is exceeded', async () => {
    mockCheckRateLimit.mockResolvedValue(false)
    const { status } = await sourceRoute({ episodeId: EP, startSeconds: 60 })
    expect(status).toBe(429)
    expect(captured['eq:episode_id']).toBeUndefined()
  })

  it('uses a source-prefixed rate-limit key on a looser tier than /api/ask', async () => {
    await sourceRoute({ episodeId: EP, startSeconds: 60 })
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ key: expect.stringMatching(/^source:/), perMinute: 20, perDay: 300 })
    )
  })

  it('rejects a request without an episodeId or a numeric startSeconds', async () => {
    expect((await sourceRoute({ startSeconds: 100 })).status).toBe(400)
    expect((await sourceRoute({ episodeId: EP })).status).toBe(400)
    expect((await sourceRoute({ episodeId: EP, startSeconds: 'abc' })).status).toBe(400)
  })

  it('queries a bounded window around the cited moment, clamped at zero', async () => {
    await sourceRoute({ episodeId: EP, startSeconds: 60 })
    expect(captured['eq:episode_id']).toBe(EP)
    // 60 - 180 would be negative; the archive starts at 0.
    expect(captured['gte:start_seconds']).toBe(0)
    expect(captured['lte:start_seconds']).toBe(360)
  })

  it('splits multi-speaker chunks into turns so each line is attributed to who actually spoke', async () => {
    rows = [
      {
        start_timestamp: '00:03:00',
        start_seconds: 180,
        primary_speaker: 'Ada Chen Rekhi',
        content:
          'Lenny Rachitsky (00:03:00): what is a curiosity loop?\n\nAda Chen Rekhi (00:04:08): it is how you gather advice fast',
      },
    ]
    const { json } = await sourceRoute({ episodeId: EP, startSeconds: 248 })
    expect(json.lines).toHaveLength(2)
    expect(json.lines[0]).toMatchObject({ speaker: 'Lenny Rachitsky', timestamp: '00:03:00', isCited: false })
    expect(json.lines[1]).toMatchObject({ speaker: 'Ada Chen Rekhi', timestamp: '00:04:08', isCited: true })
  })

  it('de-duplicates the turn that overlapping chunks share', async () => {
    const shared = 'Ada Chen Rekhi (00:04:08): the shared turn'
    rows = [
      {
        start_timestamp: '00:03:00',
        start_seconds: 180,
        primary_speaker: 'Ada Chen Rekhi',
        content: `Lenny Rachitsky (00:03:00): question\n\n${shared}`,
      },
      {
        start_timestamp: '00:04:08',
        start_seconds: 248,
        primary_speaker: 'Ada Chen Rekhi',
        content: `${shared}\n\nAda Chen Rekhi (00:05:00): and then more`,
      },
    ]
    const { json } = await sourceRoute({ episodeId: EP, startSeconds: 248 })
    const timestamps = json.lines.map((l: { timestamp: string }) => l.timestamp)
    expect(timestamps).toEqual(['00:03:00', '00:04:08', '00:05:00'])
  })

  it('returns turn text verbatim rather than a truncated excerpt', async () => {
    const full = 'a'.repeat(600)
    rows = [
      {
        start_timestamp: '00:04:00',
        start_seconds: 240,
        primary_speaker: 'Ada Chen Rekhi',
        content: `Ada Chen Rekhi (00:04:00): ${full}`,
      },
    ]
    const { json } = await sourceRoute({ episodeId: EP, startSeconds: 240 })
    expect(json.lines[0].text).toBe(full)
  })
})

describe('POST /api/source exactness and validation', () => {
  const content = 'Lenny Rachitsky (00:04:08): short ask\n\nAda Chen Rekhi (00:04:08): the answer\n\nLenny Rachitsky (00:05:00): ok'
  beforeEach(() => {
    rows = [{ start_timestamp: '00:04:08', start_seconds: 248, primary_speaker: 'Ada Chen Rekhi', content }]
  })

  it('marks the named speaker, not whoever else shares that timestamp', async () => {
    const { json } = await sourceRoute({ episodeId: EP, startSeconds: 248, speaker: 'Ada Chen Rekhi' })
    const cited = json.lines.filter((l: { isCited: boolean }) => l.isCited)
    expect(cited).toHaveLength(1)
    expect(cited[0].speaker).toBe('Ada Chen Rekhi')
  })

  it('returns 404 rather than highlighting the wrong person when that speaker has no turn there', async () => {
    expect((await sourceRoute({ episodeId: EP, startSeconds: 300, speaker: 'Ada Chen Rekhi' })).status).toBe(404)
  })

  it.each([['null', null], ['array', []], ['string', 'x'], ['non-uuid', { episodeId: 'x', startSeconds: 1 }], ['object id', { episodeId: {}, startSeconds: 1 }],
    ['negative', { episodeId: EP, startSeconds: -1 }], ['fractional', { episodeId: EP, startSeconds: 1.5 }], ['huge', { episodeId: EP, startSeconds: 1e9 }],
    ['bad speaker', { episodeId: EP, startSeconds: 1, speaker: 5 }]])('returns 400 for %s', async (_n, body) => {
    expect((await sourceRoute(body)).status).toBe(400)
  })

  it('returns 400 for bad JSON', async () => {
    const { POST } = await import('@/app/api/source/route')
    expect((await POST(new Request('http://localhost', { method: 'POST', body: '{no' }))).status).toBe(400)
  })
})

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { embedQuery, embedQueries, ProviderBusyError } from '@/lib/embeddings'

const ok = (n: number) => ({ ok: true, status: 200, json: async () => ({ data: Array.from({ length: n }, (_, i) => ({ embedding: [i] })) }) })

describe('live query embedding', () => {
  beforeEach(() => void vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('does not pace back-to-back live questions at the ingestion rate', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(1)))
    const done = vi.fn()
    void (async () => { await embedQuery('one'); await embedQuery('two'); done() })()
    await vi.advanceTimersByTimeAsync(1000)
    expect(done).toHaveBeenCalled()
  })
  it('sends several search queries in ONE provider request', async () => {
    const f = vi.fn(async () => ok(3)); vi.stubGlobal('fetch', f)
    expect(await embedQueries(['a', 'b', 'c'])).toHaveLength(3)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it.each([429, 503])('fails fast as busy on %s instead of retrying for minutes', async (status) => {
    const f = vi.fn(async () => ({ ok: false, status, text: async () => '' })); vi.stubGlobal('fetch', f)
    await expect(embedQueries(['a'])).rejects.toBeInstanceOf(ProviderBusyError)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('gives up on a hung provider within 9 seconds', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted'))))))
    const p = expect(embedQueries(['a'])).rejects.toBeInstanceOf(ProviderBusyError)
    await vi.advanceTimersByTimeAsync(9000)
    await p
  })
  it('rejects a short or malformed provider response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(1)))
    await expect(embedQueries(['a', 'b'])).rejects.toThrow()
  })
})

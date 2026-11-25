import { describe, it, expect, vi } from 'vitest'

const createClient = vi.fn()
vi.mock('@supabase/supabase-js', () => ({ createClient }))

describe('database calls', () => {
  it('always carry a time limit, and keep a caller\'s own one', async () => {
    const { createAdminClient } = await import('@/lib/supabase-admin')
    createAdminClient()
    const inner = vi.fn(async () => new Response())
    vi.stubGlobal('fetch', inner)
    const timed = createClient.mock.calls[0][2].global.fetch as typeof fetch
    await timed('http://x')
    const calls = inner.mock.calls as unknown as [string, RequestInit][]
    expect(calls[0][1].signal).toBeInstanceOf(AbortSignal)
    const own = new AbortController().signal
    await timed('http://x', { signal: own })
    expect(calls[1][1].signal).toBe(own)
    vi.unstubAllGlobals()
  })
})

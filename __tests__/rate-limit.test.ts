import { describe, it, expect, vi } from 'vitest'
import { getClientIp, isWithinRateLimit, checkRateLimit } from '@/lib/rate-limit'
import type { SupabaseAdminClient } from '@/lib/supabase-admin'

function makeFakeSupabase(opts: {
  minuteCount?: number
  dayCount?: number
  minuteError?: unknown
  dayError?: unknown
  insertError?: unknown
}) {
  const insert = vi.fn().mockResolvedValue({ error: opts.insertError ?? null })
  let selectCalls = 0

  const from = vi.fn(() => ({
    delete: () => ({ eq: () => ({ lt: () => Promise.resolve({ error: null }) }) }),
    select: () => ({
      eq: () => ({
        gte: () => {
          selectCalls += 1
          return selectCalls === 1
            ? Promise.resolve({ count: opts.minuteCount ?? 0, error: opts.minuteError ?? null })
            : Promise.resolve({ count: opts.dayCount ?? 0, error: opts.dayError ?? null })
        },
      }),
    }),
    insert,
  }))

  return { from, insert } as unknown as SupabaseAdminClient
}

describe('getClientIp', () => {
  it('takes the first IP from a comma-separated x-forwarded-for header', () => {
    const req = new Request('http://localhost', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } })
    expect(getClientIp(req)).toBe('1.2.3.4')
  })

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const req = new Request('http://localhost', { headers: { 'x-real-ip': '9.9.9.9' } })
    expect(getClientIp(req)).toBe('9.9.9.9')
  })

  it('falls back to "unknown" when neither header is present', () => {
    const req = new Request('http://localhost')
    expect(getClientIp(req)).toBe('unknown')
  })
})

describe('isWithinRateLimit', () => {
  it('allows a request under both the per-minute and per-day limits', () => {
    expect(isWithinRateLimit(0, 0)).toBe(true)
    expect(isWithinRateLimit(2, 19)).toBe(true)
  })

  it('rejects a request at or over the per-minute limit', () => {
    expect(isWithinRateLimit(3, 0)).toBe(false)
    expect(isWithinRateLimit(4, 0)).toBe(false)
  })

  it('rejects a request at or over the per-day limit, even if the per-minute count is low', () => {
    expect(isWithinRateLimit(0, 20)).toBe(false)
    expect(isWithinRateLimit(1, 25)).toBe(false)
  })
})

describe('checkRateLimit', () => {
  it('allows and records a hit when under both limits', async () => {
    const supabase = makeFakeSupabase({ minuteCount: 0, dayCount: 0 })
    await expect(checkRateLimit(supabase, '1.2.3.4')).resolves.toBe(true)
    expect((supabase as unknown as { insert: ReturnType<typeof vi.fn> }).insert).toHaveBeenCalledWith({ ip: '1.2.3.4' })
  })

  it('rejects without recording a hit when over the limit', async () => {
    const supabase = makeFakeSupabase({ minuteCount: 3, dayCount: 0 })
    await expect(checkRateLimit(supabase, '1.2.3.4')).resolves.toBe(false)
    expect((supabase as unknown as { insert: ReturnType<typeof vi.fn> }).insert).not.toHaveBeenCalled()
  })

  it('fails closed (rejects) when the count query errors, instead of treating an unreadable count as zero', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = makeFakeSupabase({ minuteError: { code: '42P01', message: 'relation "rate_limit_hits" does not exist' } })

    await expect(checkRateLimit(supabase, '1.2.3.4')).resolves.toBe(false)
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('fails closed (rejects) when recording the hit fails, even though the counts were under the limit', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = makeFakeSupabase({ minuteCount: 0, dayCount: 0, insertError: { message: 'insert failed' } })

    await expect(checkRateLimit(supabase, '1.2.3.4')).resolves.toBe(false)
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('honors a custom perMinute/perDay tier instead of the default /api/ask limits', async () => {
    // Under the default 3/min limit but still allowed here under a looser tier.
    const supabase = makeFakeSupabase({ minuteCount: 5, dayCount: 5 })
    await expect(checkRateLimit(supabase, '1.2.3.4', { perMinute: 20, perDay: 300 })).resolves.toBe(true)
  })

  it('records the hit under a prefixed key when one is given, not the raw IP', async () => {
    const supabase = makeFakeSupabase({ minuteCount: 0, dayCount: 0 })
    await checkRateLimit(supabase, '1.2.3.4', { key: 'source:1.2.3.4' })
    expect((supabase as unknown as { insert: ReturnType<typeof vi.fn> }).insert).toHaveBeenCalledWith({ ip: 'source:1.2.3.4' })
  })
})

import { describe, it, expect } from 'vitest'
import { getClientIp, isWithinRateLimit } from '@/lib/rate-limit'

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

import type { SupabaseAdminClient } from './supabase-admin'

// Per-IP throttle on /api/ask, since every allowed question costs real money
// (a Voyage embedding call plus up to two Claude calls). Strict on purpose —
// this is a small side project, not a high-traffic product, so cost control
// wins over accommodating a very high-volume single user.
const PER_MINUTE_LIMIT = 3
const PER_DAY_LIMIT = 20

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * 60 * 1000

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  const forwardedIp = forwarded?.split(',')[0]?.trim()
  if (forwardedIp) return forwardedIp

  const real = req.headers.get('x-real-ip')?.trim()
  if (real) return real

  return 'unknown'
}

// Pure decision logic, kept separate from the Supabase I/O below so it's
// directly unit-testable — mirrors eval/scoring.ts's pure-logic-vs-live-runner
// split elsewhere in this codebase.
export function isWithinRateLimit(minuteCount: number, dayCount: number): boolean {
  return minuteCount < PER_MINUTE_LIMIT && dayCount < PER_DAY_LIMIT
}

// Returns true if the request is allowed (and records it as a hit), false if
// the caller should be rejected. Requires supabase/004_add_rate_limits.sql.
// Fails CLOSED (rejects) on any Supabase error reading or recording a hit —
// the Supabase client returns { data: null, error } rather than throwing, so
// an unread error must never be treated as "0 hits, allow": that's exactly
// how this silently disabled rate limiting in production once already, when
// the table didn't exist yet but nothing surfaced it.
export async function checkRateLimit(supabase: SupabaseAdminClient, ip: string): Promise<boolean> {
  const nowMs = Date.now()
  const minuteAgoIso = new Date(nowMs - MINUTE_MS).toISOString()
  const dayAgoIso = new Date(nowMs - DAY_MS).toISOString()

  await supabase.from('rate_limit_hits').delete().eq('ip', ip).lt('created_at', dayAgoIso)

  const [minuteResult, dayResult] = await Promise.all([
    supabase.from('rate_limit_hits').select('*', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', minuteAgoIso),
    supabase.from('rate_limit_hits').select('*', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', dayAgoIso),
  ])

  if (minuteResult.error || dayResult.error) {
    console.error('Rate limit check failed:', minuteResult.error ?? dayResult.error)
    return false
  }

  if (!isWithinRateLimit(minuteResult.count ?? 0, dayResult.count ?? 0)) return false

  const { error: insertError } = await supabase.from('rate_limit_hits').insert({ ip })
  if (insertError) {
    console.error('Rate limit hit-recording failed:', insertError)
    return false
  }

  return true
}

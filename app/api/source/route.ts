import { createAdminClient } from '@/lib/supabase-admin'
import { parseInlineTurns } from '@/lib/transcript-parser'
import { getClientIp, checkRateLimit, GENEROUS_PER_MINUTE_LIMIT, GENEROUS_PER_DAY_LIMIT } from '@/lib/rate-limit'
import { BadRequestError, parseSourceRequest } from '@/lib/request-validation'
import type { SourceRequest } from '@/lib/request-validation'
import type { SourceContextResponse, SpeakerTurn } from '@/lib/types'

// How much transcript to show either side of a cited moment. Deliberately
// bounded rather than open-ended: this endpoint is unauthenticated, and the
// transcript archive isn't ours to serve in bulk.
const WINDOW_BEFORE_SECONDS = 180
const WINDOW_AFTER_SECONDS = 300
const MAX_CHUNKS = 8
const TURNS_BEFORE = 2
const TURNS_AFTER = 5

function matchesSpeaker(turn: SpeakerTurn, speaker: string): boolean {
  return turn.speaker.toLowerCase() === speaker.trim().toLowerCase()
}

export async function POST(req: Request) {
  let input: SourceRequest
  try {
    input = await parseSourceRequest(req)
  } catch (err) {
    if (err instanceof BadRequestError) return Response.json({ error: err.message }, { status: err.status })
    return Response.json({ error: 'The request could not be read.' }, { status: 400 })
  }
  const { episodeId, startSeconds, speaker } = input

  const supabase = createAdminClient()

  // No per-request $ cost here (a plain Supabase read, no LLM/embedding
  // call), so a looser tier than /api/ask's — this only needs to bound bulk
  // scraping of the transcript archive, not control API spend.
  const clientIp = getClientIp(req)
  const allowed = await checkRateLimit(supabase, clientIp, {
    key: `source:${clientIp}`,
    perMinute: GENEROUS_PER_MINUTE_LIMIT,
    perDay: GENEROUS_PER_DAY_LIMIT,
  })
  if (!allowed) {
    return Response.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
  }

  const { data, error } = await supabase
    .from('chunks')
    .select('content')
    .eq('episode_id', episodeId)
    .gte('start_seconds', Math.max(0, startSeconds - WINDOW_BEFORE_SECONDS))
    .lte('start_seconds', startSeconds + WINDOW_AFTER_SECONDS)
    .order('start_seconds', { ascending: true })
    .limit(MAX_CHUNKS)

  if (error) {
    return Response.json({ error: 'Could not load transcript context' }, { status: 500 })
  }

  // Chunks are multi-speaker and deliberately overlap by a turn, so split them
  // back into turns and drop the repeats. Two people can share a timestamp, so
  // a turn is identified by time, speaker and text together.
  const turns = new Map<string, SpeakerTurn>()
  for (const row of (data ?? []) as { content: string }[]) {
    for (const turn of parseInlineTurns(row.content)) {
      turns.set(`${turn.startSeconds}|${turn.speaker}|${turn.text}`, turn)
    }
  }
  const ordered = [...turns.values()].sort((a, b) => a.startSeconds - b.startSeconds)

  const citedIndex = ordered.findIndex(
    (turn) => turn.startSeconds === startSeconds && (speaker === undefined || matchesSpeaker(turn, speaker))
  )
  // Highlighting a neighbour instead would put words in the wrong mouth.
  if (citedIndex === -1) {
    return Response.json({ error: 'That passage could not be found.' }, { status: 404 })
  }

  const from = Math.max(0, citedIndex - TURNS_BEFORE)
  const lines = ordered.slice(from, citedIndex + TURNS_AFTER + 1).map((turn, i) => ({
    timestamp: turn.startTimestamp,
    speaker: turn.speaker,
    text: turn.text,
    isCited: from + i === citedIndex,
  }))

  return Response.json({ lines } satisfies SourceContextResponse)
}

import { createAdminClient } from '@/lib/supabase-admin'
import { parseInlineTurns } from '@/lib/transcript-parser'
import type { SourceContextLine, SourceContextResponse } from '@/lib/types'

// How much transcript to show either side of a cited moment. Deliberately
// bounded rather than open-ended: this endpoint is unauthenticated, and the
// transcript archive isn't ours to serve in bulk.
const WINDOW_BEFORE_SECONDS = 180
const WINDOW_AFTER_SECONDS = 300
const MAX_LINES = 8
const TURNS_BEFORE = 2
const TURNS_AFTER = 5

function toSeconds(timestamp: string): number {
  const parts = timestamp.split(':').map(Number)
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1]
}

interface ChunkRow {
  start_timestamp: string
  start_seconds: number
  primary_speaker: string
  content: string
}

export async function POST(req: Request) {
  const { episodeId, startSeconds } = (await req.json()) as { episodeId?: string; startSeconds?: number }

  if (!episodeId || typeof startSeconds !== 'number' || !Number.isFinite(startSeconds)) {
    return Response.json({ error: 'episodeId and startSeconds are required' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('chunks')
    .select('start_timestamp, start_seconds, primary_speaker, content')
    .eq('episode_id', episodeId)
    .gte('start_seconds', Math.max(0, startSeconds - WINDOW_BEFORE_SECONDS))
    .lte('start_seconds', startSeconds + WINDOW_AFTER_SECONDS)
    .order('start_seconds', { ascending: true })
    .limit(MAX_LINES)

  if (error) {
    return Response.json({ error: 'Could not load transcript context' }, { status: 500 })
  }

  const rows = (data ?? []) as ChunkRow[]

  // Chunks are multi-speaker and deliberately overlap by a turn, so rendering
  // them raw would attribute the opening words to the wrong person and repeat
  // text across cards. Split them back into speaker turns and de-duplicate.
  const byTimestamp = new Map<string, SourceContextLine>()
  for (const row of rows) {
    for (const turn of parseInlineTurns(row.content)) {
      if (!byTimestamp.has(turn.startTimestamp)) {
        byTimestamp.set(turn.startTimestamp, {
          timestamp: turn.startTimestamp,
          speaker: turn.speaker,
          text: turn.text,
          isCited: false,
        })
      }
    }
  }

  const ordered = [...byTimestamp.values()].sort(
    (a, b) => toSeconds(a.timestamp) - toSeconds(b.timestamp)
  )

  // The cited turn is the last one starting at or before the cited moment.
  let citedIndex = ordered.findIndex((line) => toSeconds(line.timestamp) > startSeconds) - 1
  if (citedIndex < 0) citedIndex = ordered.length - 1

  const from = Math.max(0, citedIndex - TURNS_BEFORE)
  const lines = ordered
    .slice(from, citedIndex + TURNS_AFTER + 1)
    .map((line, i) => ({ ...line, isCited: from + i === citedIndex }))

  return Response.json({ lines } satisfies SourceContextResponse)
}

import type { SpeakerTurn, Chunk } from './types'

// Speaker header lines look like "Name (00:04:08):" or, for a continuation
// of the same speaker's turn, just "(00:04:41):" with no name. Some files use
// "(MM:SS)" instead of "(HH:MM:SS)" throughout — both are handled by treating
// the timestamp as self-describing based on its number of colon-separated parts.
const HEADER_RE = /^([^(\n]*)\((\d{1,3}(?::\d{2}){1,2})\):?\s*$/

// Strong cues: templated sponsor-read openers. Checked against the whole
// corpus, these never occur outside an actual ad read (even guest-read ads
// use the same template, e.g. "This podcast is sponsored by Google") — so
// they're trusted regardless of who's speaking or where in the episode,
// which is what lets this catch mid-roll ads too, not just the cold open.
const STRONG_AD_CUE_PATTERNS = [
  /this episode is (?:brought|sponsored)/i,
  /this podcast is sponsored/i,
  /\.com\/friends\/lenny/i,
]

// Weak cues: shorter phrases that DO occur in genuine guest anecdotes
// ("promo code", "sponsored by" used conversationally) — verified against
// the corpus. Only trusted when the host is speaking, early in the episode,
// where an actual sponsor read is overwhelmingly more likely than a guest
// story.
const WEAK_AD_CUE_PATTERNS = [/brought to you by/i, /sponsored by/i, /\bpromo code\b/i, /\bdiscount code\b/i]

// Pre-roll sponsor reads cluster in the first few minutes of an episode.
const AD_POSITION_THRESHOLD_SECONDS = 900

const CHUNK_TARGET_CHARS = 1600 // ~300-500 tokens
const CHUNK_OVERLAP_TURNS = 1

function timestampToSeconds(timestamp: string): number {
  const parts = timestamp.split(':').map(Number)
  if (parts.length === 3) {
    const [h, m, s] = parts
    return h * 3600 + m * 60 + s
  }
  const [m, s] = parts
  return m * 60 + s
}

function secondsToTimestamp(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

// Inside a stored chunk, speaker labels are inline rather than on their own
// line ("Ada Chen Rekhi (00:04:08): text..."), so HEADER_RE — which is
// anchored to a whole line — can't read them back. This splits a chunk's
// content into the speaker turns it was assembled from, for displaying a
// chunk as a readable transcript rather than one undifferentiated block.
const INLINE_HEADER_RE = /([A-Z][^()\n]{0,40}?)\s\((\d{1,3}(?::\d{2}){1,2})\):\s*/g

export function parseInlineTurns(content: string): SpeakerTurn[] {
  const turns: SpeakerTurn[] = []
  const matches = [...content.matchAll(INLINE_HEADER_RE)]

  matches.forEach((match, i) => {
    const textStart = match.index + match[0].length
    const textEnd = i + 1 < matches.length ? matches[i + 1].index : content.length
    const text = content.slice(textStart, textEnd).trim()
    if (!text) return
    turns.push({
      speaker: match[1].trim(),
      startTimestamp: match[2],
      startSeconds: timestampToSeconds(match[2]),
      text,
    })
  })

  return turns
}

export function isHost(speaker: string): boolean {
  return /lenny/i.test(speaker)
}

// Pseudo-speaker labels found in the corpus that aren't an actual guest:
// "Advertisement"/"Audio"/"Narrator" tag a sponsor read, a played clip, or
// voice-over narration, and generic "Speaker N" labels are anonymized
// voices — none are an identifiable person worth citing as "the guest" at
// the episode level.
export function isRealGuest(speaker: string): boolean {
  const normalized = speaker.trim().toLowerCase()
  if (isHost(speaker)) return false
  if (normalized === 'advertisement' || normalized === 'audio' || normalized === 'narrator') return false
  if (/^speaker\s*\d+$/.test(normalized)) return false
  return true
}

export function parseTranscript(text: string): SpeakerTurn[] {
  const turns: SpeakerTurn[] = []
  let currentSpeaker: string | null = null
  let currentSeconds = 0
  let buffer: string[] = []

  function flush() {
    const content = buffer.join(' ').trim()
    if (currentSpeaker && content) {
      turns.push({
        speaker: currentSpeaker,
        startSeconds: currentSeconds,
        startTimestamp: secondsToTimestamp(currentSeconds),
        text: content,
      })
    }
    buffer = []
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const match = line.match(HEADER_RE)
    if (match) {
      flush()
      const name = match[1].trim()
      if (name) currentSpeaker = name
      currentSeconds = timestampToSeconds(match[2])
      continue
    }
    if (line.length > 0) {
      buffer.push(line)
    }
  }
  flush()

  return turns
}

export function isAdSegment(turn: SpeakerTurn): boolean {
  if (turn.speaker.trim().toLowerCase() === 'advertisement') return true
  if (STRONG_AD_CUE_PATTERNS.some((pattern) => pattern.test(turn.text))) return true
  if (turn.startSeconds >= AD_POSITION_THRESHOLD_SECONDS) return false
  if (!isHost(turn.speaker)) return false
  return WEAK_AD_CUE_PATTERNS.some((pattern) => pattern.test(turn.text))
}

// A sponsor cue phrase typically appears once, on the first turn of a
// multi-turn ad read — the read then continues across several more turns by
// the same speaker with no cue phrase in them (usually Lenny, but a couple
// of episodes have a guest co-host read the ad instead). Flagging
// isAdSegment() alone misses those continuation turns, so once a turn is
// flagged, treat subsequent turns by that same speaker (uninterrupted by
// anyone else) as part of the same ad block too.
function markAdTurns(turns: SpeakerTurn[]): boolean[] {
  const flags = turns.map(isAdSegment)
  for (let i = 0; i < turns.length; i++) {
    if (!flags[i]) continue
    let j = i + 1
    while (j < turns.length && turns[j].speaker === turns[i].speaker) {
      flags[j] = true
      j++
    }
  }
  return flags
}

export function chunkTurns(turns: SpeakerTurn[]): Chunk[] {
  const adFlags = markAdTurns(turns)
  const contentTurns = turns.filter((_, i) => !adFlags[i])
  const chunks: Chunk[] = []

  let windowStart = 0
  let chunkIndex = 0

  while (windowStart < contentTurns.length) {
    let charCount = 0
    let windowEnd = windowStart

    while (windowEnd < contentTurns.length) {
      const turnText = formatTurn(contentTurns[windowEnd])
      if (charCount > 0 && charCount + turnText.length > CHUNK_TARGET_CHARS) break
      charCount += turnText.length
      windowEnd++
    }
    // Always include at least one turn, even if it alone exceeds the target size.
    if (windowEnd === windowStart) windowEnd = windowStart + 1

    const windowTurns = contentTurns.slice(windowStart, windowEnd)
    const speakerNames = [...new Set(windowTurns.map((t) => t.speaker))]
    const speakerCharCounts = new Map<string, number>()
    for (const t of windowTurns) {
      speakerCharCounts.set(t.speaker, (speakerCharCounts.get(t.speaker) ?? 0) + t.text.length)
    }
    const primarySpeaker = [...speakerCharCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]

    chunks.push({
      chunkIndex: chunkIndex++,
      primarySpeaker,
      speakerNames,
      startTimestamp: windowTurns[0].startTimestamp,
      startSeconds: windowTurns[0].startSeconds,
      content: windowTurns.map(formatTurn).join('\n\n'),
    })

    if (windowEnd >= contentTurns.length) break
    windowStart = Math.max(windowEnd - CHUNK_OVERLAP_TURNS, windowStart + 1)
  }

  return chunks
}

function formatTurn(turn: SpeakerTurn): string {
  return `${turn.speaker} (${turn.startTimestamp}): ${turn.text}`
}

import type { RetrievedChunk } from './retrieval'
import type { Citation } from './types'

const CITATION_TAG_RE = /\[([^,[\]]+),\s*(\d{1,2}:\d{2}(?::\d{2})?)\]/g

// Excerpts are labelled to the model as HH:MM:SS, but it sometimes emits
// MM:SS. Two-part timestamps are read as MM:SS, matching how the transcripts
// themselves are written.
function toSeconds(timestamp: string): number | null {
  const parts = timestamp.split(':').map(Number)
  if (parts.some(Number.isNaN)) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

function speaks(chunk: RetrievedChunk, guestName: string): boolean {
  return chunk.speakerNames.some((s) => s.toLowerCase() === guestName.toLowerCase())
}

const EXCERPT_CHARS = 300

// A chunk usually opens with the host's question before the guest answers, so
// slicing from character 0 puts Lenny's words under the guest's name. Start at
// the cited guest's own turn instead — preferring the exact cited moment, then
// their first turn in the chunk, then falling back to the chunk start.
function excerptFor(chunk: RetrievedChunk, guestName: string, timestamp: string): string {
  const atCitedTurn = chunk.content.indexOf(`${guestName} (${timestamp})`)
  const start = atCitedTurn !== -1 ? atCitedTurn : chunk.content.indexOf(`${guestName} (`)
  return chunk.content.slice(start === -1 ? 0 : start, (start === -1 ? 0 : start) + EXCERPT_CHARS)
}

interface ChunkMatch {
  chunk: RetrievedChunk
  startSeconds: number
  timestampVerified: boolean
}

// Resolving a [Guest, timestamp] tag to the chunk it actually came from, in
// descending order of confidence. Matching on guest name alone (the last
// case) is enough to prove the guest was really retrieved — the original
// hallucination guard — but not that the timestamp points anywhere real, so
// those are flagged rather than trusted with a transcript position.
function findSourceChunk(chunks: RetrievedChunk[], guestName: string, timestamp: string): ChunkMatch | null {
  const citedSeconds = toSeconds(timestamp)

  // 1. The tag reproduces an excerpt's own header timestamp.
  if (citedSeconds !== null) {
    const exact = chunks.find((c) => speaks(c, guestName) && toSeconds(c.startTimestamp) === citedSeconds)
    if (exact) return { chunk: exact, startSeconds: exact.startSeconds, timestampVerified: true }
  }

  // 2. The tag points at a speaker turn inside a chunk — chunk text keeps
  //    inline "Name (HH:MM:SS):" labels, so the timestamp is verifiable there.
  const inline = chunks.find((c) => speaks(c, guestName) && c.content.includes(timestamp))
  if (inline) {
    return { chunk: inline, startSeconds: citedSeconds ?? inline.startSeconds, timestampVerified: true }
  }

  // 3. Guest was retrieved, timestamp is unaccounted for.
  const byName = chunks.find((c) => speaks(c, guestName))
  if (byName) return { chunk: byName, startSeconds: byName.startSeconds, timestampVerified: false }

  return null
}

// Defense against fabricated citations (from hallucination or prompt
// injection): only keep a [Guest, timestamp] tag the model emitted if that
// guest actually appears among the chunks that were really retrieved. A tag
// naming a guest never in the retrieved set is dropped rather than shown.
export function extractValidatedCitations(answerText: string, chunks: RetrievedChunk[]): Citation[] {
  const citations: Citation[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null

  CITATION_TAG_RE.lastIndex = 0
  while ((match = CITATION_TAG_RE.exec(answerText)) !== null) {
    const guestName = match[1].trim()
    const timestamp = match[2]
    const key = `${guestName.toLowerCase()}|${timestamp}`
    if (seen.has(key)) continue

    const found = findSourceChunk(chunks, guestName, timestamp)
    if (!found) continue

    seen.add(key)
    citations.push({
      guestName,
      timestamp,
      excerpt: excerptFor(found.chunk, guestName, timestamp),
      episodeId: found.chunk.episodeId,
      startSeconds: found.startSeconds,
      timestampVerified: found.timestampVerified,
    })
  }

  return citations
}

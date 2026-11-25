import { citationKey, parseAnswer, timestampToSeconds } from './citation-tags'
import type { CitationRef } from './citation-tags'
import type { RetrievedChunk } from './retrieval'
import { parseInlineTurns } from './transcript-parser'
import type { Citation, SpeakerTurn } from './types'

const EXCERPT_CHARS = 300

function sameSpeaker(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function speaks(chunk: RetrievedChunk, guestName: string): boolean {
  return chunk.speakerNames.some((s) => sameSpeaker(s, guestName))
}

function excerptOf(turn: SpeakerTurn): string {
  return `${turn.speaker} (${turn.startTimestamp}): ${turn.text}`.slice(0, EXCERPT_CHARS)
}

// A citation is verified only when that exact speaker has a turn starting at
// that exact timestamp. A chunk's own header is not enough (it is often the
// host's question), and neither is the timestamp appearing somewhere in text.
// Matching the guest by name alone still proves they were retrieved, but the
// result is flagged so the UI never opens a transcript on it.
function resolve(ref: CitationRef, chunks: RetrievedChunk[]): Citation | null {
  const seconds = timestampToSeconds(ref.timestamp)
  const matches = chunks.flatMap((chunk) =>
    parseInlineTurns(chunk.content)
      .filter((t) => t.startSeconds === seconds && sameSpeaker(t.speaker, ref.guestName))
      .map((turn) => ({ chunk, turn }))
  )
  // Returning guests can have a turn at the same second in two episodes; a
  // tag doesn't say which, so don't vouch for either.
  const oneEpisode = new Set(matches.map((m) => m.chunk.episodeId)).size === 1
  if (oneEpisode) {
    const { chunk, turn } = matches[0]
    return {
      guestName: turn.speaker,
      timestamp: turn.startTimestamp,
      excerpt: excerptOf(turn),
      episodeId: chunk.episodeId,
      startSeconds: turn.startSeconds,
      timestampVerified: true,
    }
  }

  const byName = chunks.find((c) => speaks(c, ref.guestName))
  if (!byName) return null
  const firstTurn = parseInlineTurns(byName.content).find((t) => sameSpeaker(t.speaker, ref.guestName))
  return {
    guestName: ref.guestName,
    timestamp: ref.timestamp,
    excerpt: firstTurn ? excerptOf(firstTurn) : byName.content.slice(0, EXCERPT_CHARS),
    episodeId: byName.episodeId,
    startSeconds: firstTurn?.startSeconds ?? byName.startSeconds,
    timestampVerified: false,
  }
}

function citationRefs(answerText: string): CitationRef[] {
  return parseAnswer(answerText).flatMap((p) => (p.type === 'citations' ? p.refs : []))
}

// Defense against fabricated citations (from hallucination or prompt
// injection): a tag naming a guest never in the retrieved set is dropped.
export function extractValidatedCitations(answerText: string, chunks: RetrievedChunk[]): Citation[] {
  const byKey = new Map<string, Citation>()
  for (const ref of citationRefs(answerText)) {
    const key = citationKey(ref)
    if (byKey.has(key)) continue
    const citation = resolve(ref, chunks)
    if (citation) byKey.set(key, citation)
  }
  return [...byKey.values()]
}

const MIN_QUOTE_WORDS = 4

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export interface AnswerSupport {
  droppedCitations: number
  unsupportedQuotes: string[]
}

// Deterministic checks the model can't talk its way past: every bracketed
// citation must be readable and name a retrieved guest, and every quotation
// of four words or more must occur in the words of a speaker cited in the
// same paragraph (any retrieved turn when the paragraph cites nobody).
export function checkAnswerSupport(answerText: string, chunks: RetrievedChunk[]): AnswerSupport {
  const turns = chunks.flatMap((c) => parseInlineTurns(c.content))
  const droppedCitations =
    parseAnswer(answerText).filter((p) => p.type === 'unreadable').length +
    citationRefs(answerText).filter((ref) => !chunks.some((c) => speaks(c, ref.guestName))).length

  const unsupportedQuotes: string[] = []
  for (const paragraph of answerText.split(/\n\s*\n|\n(?=\s*(?:[-*]|\d+\.)\s)/)) {
    const cited = citationRefs(paragraph).map((r) => r.guestName)
    const spoken = normalize(
      turns
        .filter((t) => cited.length === 0 || cited.some((name) => sameSpeaker(name, t.speaker)))
        .map((t) => t.text)
        .join(' ')
    )
    for (const match of paragraph.matchAll(/["“]([^"“”]+)["”]/g)) {
      const fragments = match[1].split(/\.{3}|…|\[[^\]]*\]/).map(normalize)
      if (fragments.join(' ').split(' ').length < MIN_QUOTE_WORDS) continue
      if (!fragments.every((f) => ` ${spoken} `.includes(f ? ` ${f} ` : ''))) unsupportedQuotes.push(match[1])
    }
  }
  return { droppedCitations, unsupportedQuotes }
}

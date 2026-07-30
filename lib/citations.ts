import type { RetrievedChunk } from './retrieval'
import type { Citation } from './types'

const CITATION_TAG_RE = /\[([^,[\]]+),\s*(\d{1,2}:\d{2}(?::\d{2})?)\]/g

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

    const sourceChunk = chunks.find((c) => c.speakerNames.some((s) => s.toLowerCase() === guestName.toLowerCase()))
    if (!sourceChunk) continue

    seen.add(key)
    citations.push({
      guestName,
      timestamp,
      excerpt: sourceChunk.content.slice(0, 300),
    })
  }

  return citations
}

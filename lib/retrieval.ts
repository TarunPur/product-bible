import { createAdminClient } from './supabase-admin'
import { embedQuery } from './embeddings'

const MATCH_COUNT = 10

// PLACEHOLDER threshold, still not properly calibrated — but no longer a
// blind guess. Measured directly against live data: pure gibberish text
// ("asdkjfhaslkdjfh qwerty nonsense") scored 0.44-0.46 cosine similarity
// against this corpus with voyage-3.5, not near zero as first assumed —
// voyage-3.5's embedding space has a fairly high baseline similarity floor
// for this domain. 0.3 let that gibberish query straight through to the LLM
// in a real test. Raised to sit above the measured noise floor; still needs
// real calibration against the human-verified golden test set
// (scripts/generate-golden-set.ts) once that exists (blocked on the
// Anthropic key) — this doesn't yet establish where genuinely relevant
// queries score, only where irrelevant ones do.
const LOW_CONFIDENCE_SIMILARITY_THRESHOLD = 0.5

export interface RetrievedChunk {
  id: string
  episodeId: string
  primarySpeaker: string
  speakerNames: string[]
  startTimestamp: string
  startSeconds: number
  content: string
  similarity: number
}

interface MatchChunksRow {
  id: string
  episode_id: string
  primary_speaker: string
  speaker_names: string[]
  start_timestamp: string
  start_seconds: number
  content: string
  similarity: number
}

export interface RetrievalResult {
  chunks: RetrievedChunk[]
  topSimilarity: number
  passesConfidenceGate: boolean
}

export async function retrieveChunks(question: string): Promise<RetrievalResult> {
  const embedding = await embedQuery(question)
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('match_chunks', {
    query_embedding: embedding,
    match_count: MATCH_COUNT,
  })
  if (error) throw new Error(`Vector search failed: ${error.message}`)

  const rows = (data ?? []) as MatchChunksRow[]
  const chunks: RetrievedChunk[] = rows.map((row) => ({
    id: row.id,
    episodeId: row.episode_id,
    primarySpeaker: row.primary_speaker,
    speakerNames: row.speaker_names,
    startTimestamp: row.start_timestamp,
    startSeconds: row.start_seconds,
    content: row.content,
    similarity: row.similarity,
  }))

  const topSimilarity = chunks[0]?.similarity ?? 0

  return {
    chunks,
    topSimilarity,
    passesConfidenceGate: topSimilarity >= LOW_CONFIDENCE_SIMILARITY_THRESHOLD,
  }
}

// Per the spec: if multiple guests answer differently, present each
// perspective separately rather than blending them into one voice. This
// groups retrieved chunks by guest so the synthesis prompt can detect that
// case and react to it.
export function groupChunksByGuest(chunks: RetrievedChunk[]): Map<string, RetrievedChunk[]> {
  const groups = new Map<string, RetrievedChunk[]>()
  for (const chunk of chunks) {
    const existing = groups.get(chunk.primarySpeaker)
    if (existing) {
      existing.push(chunk)
    } else {
      groups.set(chunk.primarySpeaker, [chunk])
    }
  }
  return groups
}

export function hasMultipleGuestPerspectives(chunks: RetrievedChunk[]): boolean {
  return groupChunksByGuest(chunks).size > 1
}

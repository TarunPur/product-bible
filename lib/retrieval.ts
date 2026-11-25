import { createAdminClient } from './supabase-admin'
import type { SupabaseAdminClient } from './supabase-admin'
import exampleRetrievals from './example-retrievals.json'
import { embedQueries } from './embeddings'

const MATCHES_PER_QUERY = 10
const MAX_CHUNKS = 12
const SEARCH_TIMEOUT_MS = 8_000

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

type ExampleRetrievals = Record<string, { id: string; similarity: number }[]>

function toChunk(row: MatchChunksRow): RetrievedChunk {
  return {
    id: row.id,
    episodeId: row.episode_id,
    primarySpeaker: row.primary_speaker,
    speakerNames: row.speaker_names,
    startTimestamp: row.start_timestamp,
    startSeconds: row.start_seconds,
    content: row.content,
    similarity: row.similarity,
  }
}

export interface RetrievalResult {
  chunks: RetrievedChunk[]
  topSimilarity: number
  // Whether there is anything worth showing the answering model. Similarity
  // scores for real and off-topic questions overlap (measured: off-topic 0.466
  // vs on-topic 0.426), so relevance itself is judged by the model reading the
  // passages (see the STATUS protocol in lib/llm.ts), not by a score cutoff.
  passesConfidenceGate: boolean
}

// Round-robin across queries so no single phrasing crowds out the others,
// then best similarity first. Each chunk keeps its best score.
export function mergeResults(lists: RetrievedChunk[][], limit: number): RetrievedChunk[] {
  const picked = new Map<string, RetrievedChunk>()
  const longest = Math.max(0, ...lists.map((l) => l.length))
  for (let rank = 0; rank < longest; rank++) {
    for (const list of lists) {
      const chunk = list[rank]
      if (chunk && !picked.has(chunk.id) && picked.size < limit) picked.set(chunk.id, chunk)
    }
  }
  for (const chunk of lists.flat()) {
    const current = picked.get(chunk.id)
    if (current && chunk.similarity > current.similarity) picked.set(chunk.id, chunk)
  }
  return [...picked.values()].sort((a, b) => b.similarity - a.similarity)
}

async function searchByEmbedding(supabase: SupabaseAdminClient, embedding: number[]): Promise<RetrievedChunk[]> {
  const { data, error } = await supabase
    .rpc('match_chunks', { query_embedding: embedding, match_count: MATCHES_PER_QUERY })
    .abortSignal(AbortSignal.timeout(SEARCH_TIMEOUT_MS))
  if (error) throw new Error(`Vector search failed: ${error.message}`)

  return ((data ?? []) as MatchChunksRow[]).map(toChunk)
}

export async function retrieveByEmbeddings(embeddings: number[][]): Promise<RetrievalResult> {
  const supabase = createAdminClient()
  const lists = await Promise.all(embeddings.map((e) => searchByEmbedding(supabase, e)))
  const chunks = mergeResults(lists, MAX_CHUNKS)
  return { chunks, topSimilarity: chunks[0]?.similarity ?? 0, passesConfidenceGate: chunks.length > 0 }
}

export async function retrieveChunks(searchQueries: string[]): Promise<RetrievalResult> {
  return retrieveByEmbeddings(await embedQueries(searchQueries))
}

// The archive is fixed, so the homepage examples always retrieve the same
// passages. Their ids are stored (npm run examples:precompute) so a click on
// one doesn't spend the embedding provider's shared 3-requests-a-minute
// allowance. Answers are still written live. Returns null when the question
// isn't an example or any stored passage is gone, so the live path takes over.
export async function retrieveExample(question: string): Promise<RetrievalResult | null> {
  const stored = Object.hasOwn(exampleRetrievals, question) ? (exampleRetrievals as ExampleRetrievals)[question] : undefined
  if (!stored) return null
  const { data, error } = await createAdminClient()
    .from('chunks')
    .select('id, episode_id, primary_speaker, speaker_names, start_timestamp, start_seconds, content')
    .in('id', stored.map((s) => s.id))
    .abortSignal(AbortSignal.timeout(SEARCH_TIMEOUT_MS))
  if (error || !data || data.length !== stored.length) return null
  const similarity = new Map(stored.map((s) => [s.id, s.similarity]))
  const chunks = (data as Omit<MatchChunksRow, 'similarity'>[])
    .map((row) => toChunk({ ...row, similarity: similarity.get(row.id) ?? 0 }))
    .sort((a, b) => b.similarity - a.similarity)
  return { chunks, topSimilarity: chunks[0].similarity, passesConfidenceGate: true }
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

/**
 * Ingest all transcript files into Supabase: parse -> chunk -> embed -> upsert.
 *
 * Usage:
 *   npm run ingest            # skips episodes already ingested
 *   npm run ingest -- --force # re-ingests every file, replacing existing chunks
 *
 * Requires TRANSCRIPT_ARCHIVE_DIR, NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, and VOYAGE_API_KEY in .env.local.
 */

import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { loadEnvFile } from '../lib/load-env'

loadEnvFile()

import { createAdminClient } from '../lib/supabase-admin'
import { parseTranscript, chunkTurns, isRealGuest } from '../lib/transcript-parser'
import { embedDocuments } from '../lib/embeddings'

const FORCE = process.argv.includes('--force')
const CHUNK_INSERT_BATCH_SIZE = 25

interface ChunkRow {
  episode_id: string
  chunk_index: number
  primary_speaker: string
  speaker_names: string[]
  start_timestamp: string
  start_seconds: number
  content: string
  embedding: number[]
}

// Inserting all of an episode's chunks (often 100+, each with a 1024-dim
// vector needing an HNSW index update) in one statement got slower as the
// chunks table grew past tens of thousands of rows, eventually exceeding
// Supabase's statement timeout. Smaller batches keep each statement fast
// regardless of table size.
async function insertChunksInBatches(supabase: ReturnType<typeof createAdminClient>, rows: ChunkRow[]) {
  for (let i = 0; i < rows.length; i += CHUNK_INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + CHUNK_INSERT_BATCH_SIZE)
    const { error } = await supabase.from('chunks').insert(batch)
    if (error) throw new Error(error.message)
  }
}

async function main() {
  const archiveDir = process.env.TRANSCRIPT_ARCHIVE_DIR
  if (!archiveDir) throw new Error('TRANSCRIPT_ARCHIVE_DIR is not set in .env.local')

  const supabase = createAdminClient()
  const files = readdirSync(archiveDir).filter((f) => f.endsWith('.txt'))
  console.log(`Found ${files.length} transcript files in ${archiveDir}`)

  let ingested = 0
  let skipped = 0
  let failed = 0

  for (const [index, file] of files.entries()) {
    const label = `${new Date().toISOString()} [${index + 1}/${files.length}] ${file}`
    try {
      const text = readFileSync(join(archiveDir, file), 'utf-8')
      const turns = parseTranscript(text)

      if (turns.length === 0) {
        console.warn(`${label}: SKIPPED - parser produced zero turns (unrecognized transcript format)`)
        skipped++
        continue
      }

      const guestNames = [...new Set(turns.map((t) => t.speaker))].filter(isRealGuest)
      if (guestNames.length === 0) {
        console.warn(`${label}: SKIPPED - no non-host speaker detected`)
        skipped++
        continue
      }

      const { data: existing } = await supabase
        .from('episodes')
        .select('id')
        .eq('source_filename', file)
        .maybeSingle()

      if (existing && !FORCE) {
        const { count } = await supabase
          .from('chunks')
          .select('id', { count: 'exact', head: true })
          .eq('episode_id', existing.id)
        if (count && count > 0) {
          console.log(`${label}: already ingested (${count} chunks), skipping`)
          skipped++
          continue
        }
      }

      const chunks = chunkTurns(turns)
      if (chunks.length === 0) {
        console.warn(`${label}: SKIPPED - zero chunks after ad filtering`)
        skipped++
        continue
      }

      const embeddings = await embedDocuments(
        chunks.map((c) => c.content),
        (done, total) => console.log(`  embedding batch progress: ${done}/${total} chunks`)
      )

      let episodeId: string
      if (existing) {
        episodeId = existing.id
        await supabase.from('chunks').delete().eq('episode_id', episodeId)
        await supabase.from('episodes').update({ guest_names: guestNames }).eq('id', episodeId)
      } else {
        const { data: inserted, error } = await supabase
          .from('episodes')
          .insert({ guest_names: guestNames, source_filename: file })
          .select('id')
          .single()
        if (error || !inserted) throw new Error(error?.message ?? 'episode insert failed')
        episodeId = inserted.id
      }

      const rows = chunks.map((chunk, i) => ({
        episode_id: episodeId,
        chunk_index: chunk.chunkIndex,
        primary_speaker: chunk.primarySpeaker,
        speaker_names: chunk.speakerNames,
        start_timestamp: chunk.startTimestamp,
        start_seconds: chunk.startSeconds,
        content: chunk.content,
        embedding: embeddings[i],
      }))

      await insertChunksInBatches(supabase, rows)

      console.log(`${label}: ingested ${chunks.length} chunks (guests: ${guestNames.join(', ')})`)
      ingested++
    } catch (err) {
      console.error(`${label}: FAILED - ${err instanceof Error ? err.message : String(err)}`)
      failed++
    }
  }

  console.log(`\nDone. Ingested: ${ingested}, skipped: ${skipped}, failed: ${failed}`)
}

main()

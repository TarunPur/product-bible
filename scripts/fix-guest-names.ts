/**
 * One-off cleanup: re-derive guest_names for every already-ingested episode
 * using the current isRealGuest() rules, and patch any row that drifted from
 * an older version of that logic. Does not touch chunks/embeddings — just
 * re-parses the source file (fast, no API calls) and compares.
 *
 * Usage: npm run fix-guest-names
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { loadEnvFile } from '../lib/load-env'

loadEnvFile()

import { createAdminClient } from '../lib/supabase-admin'
import { parseTranscript, isRealGuest } from '../lib/transcript-parser'

async function main() {
  const archiveDir = process.env.TRANSCRIPT_ARCHIVE_DIR
  if (!archiveDir) throw new Error('TRANSCRIPT_ARCHIVE_DIR is not set in .env.local')

  const supabase = createAdminClient()
  const { data: episodes, error } = await supabase.from('episodes').select('id, source_filename, guest_names')
  if (error || !episodes) throw new Error(error?.message ?? 'failed to fetch episodes')

  let fixed = 0
  for (const episode of episodes) {
    const text = readFileSync(join(archiveDir, episode.source_filename), 'utf-8')
    const turns = parseTranscript(text)
    const correctNames = [...new Set(turns.map((t) => t.speaker))].filter(isRealGuest)

    const current = [...episode.guest_names].sort()
    const correct = [...correctNames].sort()
    const isSame = current.length === correct.length && current.every((n, i) => n === correct[i])

    if (!isSame) {
      await supabase.from('episodes').update({ guest_names: correctNames }).eq('id', episode.id)
      console.log(`Fixed ${episode.source_filename}: ${JSON.stringify(episode.guest_names)} -> ${JSON.stringify(correctNames)}`)
      fixed++
    }
  }

  console.log(`\nDone. Checked ${episodes.length} episodes, fixed ${fixed}.`)
}

main()

/**
 * Stores which passages each homepage example retrieves, using the same
 * planning and search as a live question. Re-run if the examples, the planner
 * or the archive change. Usage: npm run examples:precompute
 */

import { writeFileSync } from 'fs'
import { join } from 'path'
import { loadEnvFile } from '../lib/load-env'

loadEnvFile()

import { EXAMPLE_QUESTIONS } from '../lib/example-questions'
import { planAndRetrieveAll } from '../eval/pipeline'

async function main() {
  const results = await planAndRetrieveAll(EXAMPLE_QUESTIONS)
  const out = Object.fromEntries(
    EXAMPLE_QUESTIONS.map((question, i) => {
      if (results[i].plan.searchQueries.length < 4) throw new Error(`Planning fell back for: ${question}`)
      return [question, results[i].retrieval.chunks.map((c) => ({ id: c.id, similarity: Number(c.similarity.toFixed(4)) }))]
    })
  )
  writeFileSync(join(__dirname, '../lib/example-retrievals.json'), JSON.stringify(out, null, 1) + '\n')
  console.log(Object.entries(out).map(([q, c]) => `${c.length} ${c[0].similarity} ${q}`).join('\n'))
}

main()

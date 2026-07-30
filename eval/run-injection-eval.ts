/**
 * Runs the golden set's 'adversarial' (prompt-injection) items through the
 * REAL production pipeline as it actually behaves today. lib/moderation.ts
 * only BLOCKS on profanity — injection attempts are merely flagged for
 * audit and still proceed to retrieval/synthesis (see app/api/ask/route.ts).
 * This measures what actually happens next: does the confidence gate happen
 * to filter the question out before it ever reaches Claude, and if not,
 * does the generated answer actually resist the injected instruction —
 * something no earlier eval script checked.
 *
 * Usage: npm run eval:injection
 * Requires ANTHROPIC_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOYAGE_API_KEY in .env.local.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { loadEnvFile } from '../lib/load-env'

loadEnvFile()

import { retrieveChunks } from '../lib/retrieval'
import { createSynthesisStream } from '../lib/llm'
import { containsInjectionAttempt, containsProfanity } from '../lib/moderation'
import { gradeInjectionResistance } from './llm-grading'
import type { GoldenSetItem } from './types'

const GOLDEN_SET_PATH = join(__dirname, '../golden-set/golden-set.json')
const RESULTS_DIR = join(__dirname, 'results')

interface InjectionEvalResult {
  id: string
  question: string
  flaggedByModeration: boolean
  blockedByProfanityFilter: boolean
  topSimilarity: number
  passesConfidenceGate: boolean
  reachedSynthesis: boolean
  generatedAnswer?: string
  resisted?: boolean
  reasoning?: string
}

async function main() {
  const allItems: GoldenSetItem[] = JSON.parse(readFileSync(GOLDEN_SET_PATH, 'utf-8'))
  const items = allItems.filter((item) => item.category === 'adversarial')

  console.log(
    `Running ${items.length} adversarial items through the real pipeline ` +
      `(profanity filter -> retrieval -> confidence gate -> synthesis -> resistance grade)...\n`
  )

  const results: InjectionEvalResult[] = []

  for (const [i, item] of items.entries()) {
    const blockedByProfanityFilter = containsProfanity(item.question)
    const flaggedByModeration = containsInjectionAttempt(item.question)

    if (blockedByProfanityFilter) {
      results.push({
        id: item.id,
        question: item.question,
        flaggedByModeration,
        blockedByProfanityFilter,
        topSimilarity: 0,
        passesConfidenceGate: false,
        reachedSynthesis: false,
      })
      console.log(`[${i + 1}/${items.length}] BLOCKED (profanity filter)  ${item.question}`)
      continue
    }

    const retrieval = await retrieveChunks(item.question)

    if (!retrieval.passesConfidenceGate) {
      results.push({
        id: item.id,
        question: item.question,
        flaggedByModeration,
        blockedByProfanityFilter,
        topSimilarity: retrieval.topSimilarity,
        passesConfidenceGate: false,
        reachedSynthesis: false,
      })
      console.log(
        `[${i + 1}/${items.length}] GATED OFF (confidence gate, similarity=${retrieval.topSimilarity.toFixed(3)})  ${item.question}`
      )
      continue
    }

    const stream = createSynthesisStream(item.question, retrieval.chunks, [])
    const answer = await stream.finalText()
    const { resisted, reasoning } = await gradeInjectionResistance(item.question, answer)

    results.push({
      id: item.id,
      question: item.question,
      flaggedByModeration,
      blockedByProfanityFilter,
      topSimilarity: retrieval.topSimilarity,
      passesConfidenceGate: true,
      reachedSynthesis: true,
      generatedAnswer: answer,
      resisted,
      reasoning,
    })
    console.log(
      `[${i + 1}/${items.length}] ${resisted ? 'RESISTED' : 'COMPROMISED'}  ${item.question}\n` +
        `    flagged_by_regex=${flaggedByModeration}  reasoning=${reasoning}`
    )
  }

  const blockedByProfanity = results.filter((r) => r.blockedByProfanityFilter).length
  const gatedOff = results.filter((r) => !r.reachedSynthesis && !r.blockedByProfanityFilter).length
  const reachedSynthesis = results.filter((r) => r.reachedSynthesis)
  const resisted = reachedSynthesis.filter((r) => r.resisted).length
  const compromised = reachedSynthesis.filter((r) => r.resisted === false).length

  console.log('\n--- Summary ---')
  console.log(`Total adversarial items: ${results.length}`)
  console.log(`Blocked by profanity filter (never reached retrieval): ${blockedByProfanity}`)
  console.log(`Gated off by confidence gate (never reached the LLM): ${gatedOff}`)
  console.log(`Reached synthesis (moderation flagged but did not block): ${reachedSynthesis.length}`)
  console.log(`  of which RESISTED the injection: ${resisted}`)
  console.log(`  of which COMPROMISED (complied with the injection): ${compromised}`)
  console.log(
    `Regex-flagged by containsInjectionAttempt: ${results.filter((r) => r.flaggedByModeration).length}/${results.length} ` +
      `(flag only — does not block, see app/api/ask/route.ts)`
  )

  mkdirSync(RESULTS_DIR, { recursive: true })
  const outPath = join(RESULTS_DIR, `injection-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(outPath, JSON.stringify(results, null, 2))
  console.log(`\nFull results written to ${outPath}`)
}

main()

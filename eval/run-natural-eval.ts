/**
 * Naturally worded questions (not copied from transcripts) plus off-topic
 * ones, through planning, retrieval and the answering model. Measures how many
 * answerable questions get an answer and how many off-topic ones slip through.
 * Costs Claude calls: roughly $0.015 per question.
 *
 * Usage: npm run eval:natural -- dev|holdout
 * The holdout is meant to be run once, after tuning is finished.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { loadEnvFile } from '../lib/load-env'

loadEnvFile()

import { checkAnswerSupport, extractValidatedCitations } from '../lib/citations'
import { generateAnswer, planAndRetrieveAll } from './pipeline'

async function main() {
  const set = process.argv[2] === 'holdout' ? 'holdout' : 'dev'
  const data = JSON.parse(readFileSync(join(__dirname, `../golden-set/natural-${set}.json`), 'utf-8')) as {
    answerable: string[]
    offTopic: string[]
  }
  const questions = [...data.answerable, ...data.offTopic]
  const retrieved = await planAndRetrieveAll(questions)
  const rows: { set: string; status: string; stop: string | null }[] = []
  for (const [i, question] of questions.entries()) {
    const { plan, retrieval } = retrieved[i]
    const started = Date.now()
    const g = await generateAnswer(plan.standaloneQuestion, retrieval.chunks)
    const citations = extractValidatedCitations(g.answer, retrieval.chunks)
    const support = checkAnswerSupport(g.answer, retrieval.chunks)
    const row = {
      set: i < data.answerable.length ? 'answerable' : 'offTopic',
      question,
      rawTop: Number(retrieval.topSimilarity.toFixed(3)),
      status: g.status,
      stop: g.stopReason,
      tokens: g.outputTokens,
      chars: g.answer.length,
      verified: citations.filter((c) => c.timestampVerified).length,
      unverified: citations.filter((c) => !c.timestampVerified).length,
      dropped: support.droppedCitations,
      badQuotes: support.unsupportedQuotes,
      ms: Date.now() - started,
      queries: plan.searchQueries,
      answer: g.answer,
    }
    rows.push(row)
    console.log(row.set.padEnd(10), row.status.padEnd(7), row.rawTop, row.stop, `${row.tokens}tok`, `v${row.verified}/u${row.unverified}/d${row.dropped}/q${row.badQuotes.length}`, question)
  }
  const answered = (kind: string) => rows.filter((r) => r.set === kind && r.status !== 'NONE').length
  console.log(`\n${set}: answerable answered ${answered('answerable')}/${data.answerable.length}; off-topic answered ${answered('offTopic')}/${data.offTopic.length}; truncated ${rows.filter((r) => r.stop !== 'end_turn').length}`)
  mkdirSync(join(__dirname, 'results'), { recursive: true })
  writeFileSync(join(__dirname, `results/natural-${set}-${Date.now()}.json`), JSON.stringify(rows, null, 2))
}

main()

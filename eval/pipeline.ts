// Runs the same steps as app/api/ask/route.ts so evals measure what visitors
// get, plus pacing: the embedding provider's free tier allows 3 requests a
// minute, and the live path fails fast instead of waiting.

import { embedQueries, ProviderBusyError } from '../lib/embeddings'
import { createSynthesisStream } from '../lib/llm'
import { planQuery } from '../lib/query-plan'
import type { QueryPlan } from '../lib/query-plan'
import { retrieveByEmbeddings } from '../lib/retrieval'
import type { RetrievalResult, RetrievedChunk } from '../lib/retrieval'
import { StatusGate } from '../lib/status-gate'
import type { AnswerStatus } from '../lib/status-gate'
import type { ConversationTurn } from '../lib/types'

const PACE_MS = 21_000
const MAX_BUSY_RETRIES = 4
const QUERIES_PER_REQUEST = 100

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function embedPaced(texts: string[], attempt = 1): Promise<number[][]> {
  try {
    return await embedQueries(texts)
  } catch (err) {
    if (!(err instanceof ProviderBusyError) || attempt > MAX_BUSY_RETRIES) throw err
    await sleep(PACE_MS)
    return embedPaced(texts, attempt + 1)
  }
}

export interface PlannedRetrieval {
  plan: QueryPlan
  retrieval: RetrievalResult
}

// Plans every question, then embeds all their queries in as few provider
// requests as possible (125 questions is about 5 requests, not 125).
export async function planAndRetrieveAll(questions: string[]): Promise<PlannedRetrieval[]> {
  const plans: QueryPlan[] = []
  for (let i = 0; i < questions.length; i += 8) {
    plans.push(...(await Promise.all(questions.slice(i, i + 8).map((q) => planQuery(q, [])))))
  }
  const texts = plans.flatMap((p) => p.searchQueries)
  const vectors: number[][] = []
  for (let i = 0; i < texts.length; i += QUERIES_PER_REQUEST) {
    if (i > 0) await sleep(PACE_MS)
    vectors.push(...(await embedPaced(texts.slice(i, i + QUERIES_PER_REQUEST))))
  }
  const out: PlannedRetrieval[] = []
  let cursor = 0
  for (const plan of plans) {
    const mine = vectors.slice(cursor, (cursor += plan.searchQueries.length))
    out.push({ plan, retrieval: await retrieveByEmbeddings(mine) })
  }
  return out
}

export async function planAndRetrieve(question: string, history: ConversationTurn[] = []): Promise<PlannedRetrieval> {
  const plan = await planQuery(question, history)
  return { plan, retrieval: await retrieveByEmbeddings(await embedPaced(plan.searchQueries)) }
}

export interface GeneratedAnswer {
  status: AnswerStatus
  answer: string
  stopReason: string | null
  outputTokens: number
}

export async function generateAnswer(question: string, chunks: RetrievedChunk[]): Promise<GeneratedAnswer> {
  const gate = new StatusGate()
  let answer = ''
  const stream = createSynthesisStream(question, chunks)
  stream.on('text', (delta) => {
    answer += gate.push(delta)
  })
  const message = await stream.finalMessage()
  answer += gate.finish()
  return { status: gate.status ?? 'PARTIAL', answer, stopReason: message.stop_reason, outputTokens: message.usage.output_tokens }
}

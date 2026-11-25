import { createAdminClient } from '@/lib/supabase-admin'
import type { SupabaseAdminClient } from '@/lib/supabase-admin'
import { containsProfanity, containsInjectionAttempt, PROFANITY_REFUSAL_MESSAGE } from '@/lib/moderation'
import { getClientIp, checkRateLimit } from '@/lib/rate-limit'
import { retrieveChunks, retrieveExample } from '@/lib/retrieval'
import { planQuery } from '@/lib/query-plan'
import { ProviderBusyError } from '@/lib/embeddings'
import { createSynthesisStream, gradeGroundedness } from '@/lib/llm'
import { StatusGate } from '@/lib/status-gate'
import { checkAnswerSupport, disclaimsCoverage, extractValidatedCitations } from '@/lib/citations'
import { BadRequestError, parseAskRequest } from '@/lib/request-validation'
import type { AskRequest, AskStreamEvent, Citation, ConfidenceBand } from '@/lib/types'

export const maxDuration = 60

const NO_RESULTS_MESSAGE = 'Responses do not exist for this question in the podcast archive.'
const RATE_LIMIT_MESSAGE = "You've asked a lot of questions in a short time. Please wait a bit before asking more."
const BUSY_MESSAGE = 'Playbook is busy right now. Please try again in about 30 seconds.'
const ERROR_MESSAGE = 'Something went wrong. Please try again.'
const INCOMPLETE_MESSAGE = 'This answer stopped before it was finished, so treat it as partial. Please try again.'
const LOW_CONFIDENCE_DISCLAIMER =
  'Response is driven at the best from the conversation, but there may be a slighter variation in the actual response from the speaker.'
const PARTIAL_DISCLAIMER = 'The archive covers only part of this question.'
const UNCHECKED_DISCLAIMER =
  'Some of this answer could not be matched to a transcript passage. Check the sources before relying on it.'

const HIGH_CONFIDENCE_THRESHOLD = 80

// Regex-flagged questions get a stricter bar before an answer is shown
// without a disclaimer. Not a hard block — containsInjectionAttempt() has
// known false positives in this podcast's own domain (e.g. "pretend you're
// a PM" interview-prep questions), so refusing outright would reject
// legitimate users. Eval data showed correctly-resisted answers to real
// adversarial questions still average ~98 groundedness, so this bar stays
// reachable for genuine answers while making it harder for a
// weakly-grounded, injection-influenced answer to slip through unhedged.
const HIGH_CONFIDENCE_THRESHOLD_FLAGGED = 92

function eventToLine(event: AskStreamEvent): string {
  return JSON.stringify(event) + '\n'
}

function singleEventStream(event: AskStreamEvent): Response {
  return new Response(eventToLine(event), { headers: { 'Content-Type': 'application/x-ndjson' } })
}

// null when unflagged; otherwise which check tripped, so query_logs rows are
// distinguishable for audit without inspecting the answer text.
type FlagReason = 'profanity' | 'injection_attempt' | null

// Logging must never cost a reader their answer.
async function logQuery(
  supabase: SupabaseAdminClient,
  sessionId: string,
  question: string,
  answer: string,
  confidenceBand: ConfidenceBand,
  citations: Citation[],
  flagReason: FlagReason
) {
  try {
    const { error } = await supabase.from('query_logs').insert({
      session_id: sessionId,
      question,
      answer,
      confidence_band: confidenceBand,
      citations,
      flagged: flagReason !== null,
      flag_reason: flagReason,
    })
    if (error) console.error('Query log insert failed:', error.message)
  } catch (err) {
    console.error('Query log insert threw:', err instanceof Error ? err.name : 'unknown error')
  }
}

interface Verdict {
  band: ConfidenceBand
  disclaimer?: string
}

function assess(
  partial: boolean,
  groundedness: number,
  threshold: number,
  citations: Citation[],
  supportOk: boolean,
  termsOk: boolean
): Verdict {
  if (!supportOk || citations.length === 0 || citations.some((c) => !c.timestampVerified)) {
    return { band: 'low', disclaimer: UNCHECKED_DISCLAIMER }
  }
  if (partial) return { band: 'low', disclaimer: PARTIAL_DISCLAIMER }
  // After the partial check: a reply declining part of a question naturally
  // names things the passages don't.
  if (!termsOk) return { band: 'low', disclaimer: UNCHECKED_DISCLAIMER }
  if (groundedness < threshold) return { band: 'low', disclaimer: LOW_CONFIDENCE_DISCLAIMER }
  return { band: 'high' }
}

async function safeGroundedness(...args: Parameters<typeof gradeGroundedness>): Promise<number> {
  try {
    return await gradeGroundedness(...args)
  } catch (err) {
    console.error('Groundedness grading failed:', err instanceof Error ? err.name : 'unknown error')
    return 0
  }
}

export async function POST(req: Request) {
  let body: Required<AskRequest>
  try {
    body = await parseAskRequest(req)
  } catch (err) {
    if (err instanceof BadRequestError) return Response.json({ error: err.message }, { status: err.status })
    return Response.json({ error: 'The request could not be read.' }, { status: 400 })
  }
  const { question, sessionId, recentTurns } = body

  const supabase = createAdminClient()

  // Cheapest possible check, first — blocks a flood before it can reach
  // moderation, retrieval, or any paid API call.
  const allowed = await checkRateLimit(supabase, getClientIp(req))
  if (!allowed) {
    return singleEventStream({ type: 'blocked', message: RATE_LIMIT_MESSAGE })
  }

  // Fast moderation short-circuit — no retrieval, no LLM call.
  if (containsProfanity(question)) {
    await logQuery(supabase, sessionId, question, PROFANITY_REFUSAL_MESSAGE, 'none', [], 'profanity')
    return singleEventStream({ type: 'blocked', message: PROFANITY_REFUSAL_MESSAGE })
  }

  // Not blocked outright — structural framing in lib/llm.ts and the checks in
  // lib/citations.ts are the primary defense. This flags the log row for audit
  // and raises the groundedness bar below.
  const injectionAttempted = containsInjectionAttempt(question)
  const flagReason: FlagReason = injectionAttempted ? 'injection_attempt' : null

  // Stops paid generation when the reader leaves, however the runtime tells us.
  const abort = new AbortController()
  req.signal.addEventListener('abort', () => abort.abort(), { once: true })

  async function run(send: (event: AskStreamEvent) => void): Promise<void> {
    const example = await retrieveExample(question)
    const plan = example ? null : await planQuery(question, recentTurns)
    const standalone = plan?.standaloneQuestion ?? question
    const interpretedAs = standalone !== question ? standalone : undefined
    if (abort.signal.aborted) return

    const retrieval = example ?? (await retrieveChunks(plan?.searchQueries ?? [question]))
    if (abort.signal.aborted) return

    const refuse = async () => {
      await logQuery(supabase, sessionId, question, NO_RESULTS_MESSAGE, 'none', [], flagReason)
      send({ type: 'none', message: NO_RESULTS_MESSAGE, interpretedAs })
    }
    if (!retrieval.passesConfidenceGate) return refuse()

    const gate = new StatusGate()
    let answer = ''
    const emit = (text: string) => {
      if (!text) return
      answer += text
      send({ type: 'token', text })
    }

    const synthesis = createSynthesisStream(standalone, retrieval.chunks, abort.signal)
    synthesis.on('text', (delta: string) => emit(gate.push(delta)))
    const message = await synthesis.finalMessage()
    emit(gate.finish())

    const citations = extractValidatedCitations(answer, retrieval.chunks)
    if (message.stop_reason !== 'end_turn') {
      console.error('Synthesis stopped early:', message.stop_reason)
      if (message.stop_reason === 'refusal' && !answer.trim()) return refuse()
      await logQuery(supabase, sessionId, question, `${answer}\n\n[incomplete: ${message.stop_reason}]`, 'low', citations, flagReason)
      return send({ type: 'incomplete', message: INCOMPLETE_MESSAGE, citations })
    }
    if (gate.status === 'NONE' || !answer.trim()) return refuse()

    const support = checkAnswerSupport(answer, retrieval.chunks, standalone)
    const supportOk =
      support.droppedCitations === 0 &&
      support.emptyCitations === 0 &&
      support.unsupportedQuotes.length === 0 &&
      support.uncitedGuests.length === 0
    const groundedness = await safeGroundedness(standalone, retrieval.chunks, answer)
    const threshold = injectionAttempted ? HIGH_CONFIDENCE_THRESHOLD_FLAGGED : HIGH_CONFIDENCE_THRESHOLD
    const partial = gate.status === 'PARTIAL' || disclaimsCoverage(answer)
    const { band, disclaimer } = assess(partial, groundedness, threshold, citations, supportOk, support.unknownTerms.length === 0)

    await logQuery(supabase, sessionId, question, disclaimer ? `${answer}\n\n${disclaimer}` : answer, band, citations, flagReason)
    send({ type: 'done', citations, confidenceBand: band, disclaimer, interpretedAs })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AskStreamEvent) => {
        if (!abort.signal.aborted) controller.enqueue(encoder.encode(eventToLine(event)))
      }
      try {
        await run(send)
      } catch (err) {
        if (!abort.signal.aborted) {
          console.error('Ask pipeline error:', err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error')
          send({ type: 'error', message: err instanceof ProviderBusyError ? BUSY_MESSAGE : ERROR_MESSAGE })
        }
      } finally {
        if (!abort.signal.aborted) controller.close()
      }
    },
    cancel() {
      abort.abort()
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' },
  })
}

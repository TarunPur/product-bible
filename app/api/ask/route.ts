import { createAdminClient } from '@/lib/supabase-admin'
import { containsProfanity, containsInjectionAttempt, PROFANITY_REFUSAL_MESSAGE } from '@/lib/moderation'
import { retrieveChunks } from '@/lib/retrieval'
import { createSynthesisStream, gradeGroundedness } from '@/lib/llm'
import { extractValidatedCitations } from '@/lib/citations'
import type { AskRequest, AskStreamEvent, Citation, ConfidenceBand } from '@/lib/types'

const NO_RESULTS_MESSAGE = 'Responses do not exist for this question in the podcast archive.'
const LOW_CONFIDENCE_DISCLAIMER =
  'Response is driven at the best from the conversation, but there may be a slighter variation in the actual response from the speaker.'

// Still a placeholder pending golden-set calibration — see the note in lib/retrieval.ts.
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

function encodeEvent(event: AskStreamEvent): Uint8Array {
  return new TextEncoder().encode(eventToLine(event))
}

function singleEventStream(event: AskStreamEvent): Response {
  return new Response(eventToLine(event), { headers: { 'Content-Type': 'application/x-ndjson' } })
}

type SupabaseAdminClient = ReturnType<typeof createAdminClient>

async function logQuery(
  supabase: SupabaseAdminClient,
  sessionId: string,
  question: string,
  answer: string,
  confidenceBand: ConfidenceBand,
  citations: Citation[],
  flagged: boolean
) {
  await supabase.from('query_logs').insert({
    session_id: sessionId,
    question,
    answer,
    confidence_band: confidenceBand,
    citations,
    flagged,
  })
}

export async function POST(req: Request) {
  const body = (await req.json()) as AskRequest
  const { question, sessionId, recentTurns = [] } = body

  if (!question?.trim() || !sessionId) {
    return new Response(JSON.stringify({ error: 'question and sessionId are required' }), { status: 400 })
  }

  const supabase = createAdminClient()

  // Fast moderation short-circuit — no retrieval, no LLM call.
  if (containsProfanity(question)) {
    await logQuery(supabase, sessionId, question, PROFANITY_REFUSAL_MESSAGE, 'none', [], true)
    return singleEventStream({ type: 'blocked', message: PROFANITY_REFUSAL_MESSAGE })
  }

  // Not blocked outright — structural framing in lib/llm.ts and the citation
  // validation in lib/citations.ts are the primary defense. This flags the
  // log row for audit and raises the groundedness bar below before an
  // answer is shown without a disclaimer.
  const injectionAttempted = containsInjectionAttempt(question)

  // Pre-generation confidence gate (fast, retrieval-similarity based, no
  // LLM call) — see lib/retrieval.ts for why this is a separate signal from
  // the post-generation groundedness grade below.
  const retrieval = await retrieveChunks(question)
  if (!retrieval.passesConfidenceGate) {
    await logQuery(supabase, sessionId, question, NO_RESULTS_MESSAGE, 'none', [], injectionAttempted)
    return singleEventStream({ type: 'none', message: NO_RESULTS_MESSAGE })
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const anthropicStream = createSynthesisStream(question, retrieval.chunks, recentTurns)
        anthropicStream.on('text', (delta: string) => {
          controller.enqueue(encodeEvent({ type: 'token', text: delta }))
        })
        const finalText = await anthropicStream.finalText()

        const citations = extractValidatedCitations(finalText, retrieval.chunks)
        const groundedness = await gradeGroundedness(question, retrieval.chunks, finalText)
        const requiredThreshold = injectionAttempted ? HIGH_CONFIDENCE_THRESHOLD_FLAGGED : HIGH_CONFIDENCE_THRESHOLD
        const confidenceBand: ConfidenceBand = groundedness >= requiredThreshold ? 'high' : 'low'
        const disclaimer = confidenceBand === 'low' ? LOW_CONFIDENCE_DISCLAIMER : undefined
        const loggedAnswer = disclaimer ? `${finalText}\n\n${disclaimer}` : finalText

        await logQuery(supabase, sessionId, question, loggedAnswer, confidenceBand, citations, injectionAttempted)

        controller.enqueue(encodeEvent({ type: 'done', citations, confidenceBand, disclaimer }))
        controller.close()
      } catch (err) {
        controller.enqueue(encodeEvent({ type: 'error', message: err instanceof Error ? err.message : 'Something went wrong.' }))
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } })
}

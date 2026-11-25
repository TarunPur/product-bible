import type { AskRequest, ConversationTurn } from './types'

export const MAX_QUESTION_CHARS = 500
const MAX_BODY_CHARS = 64_000
const MAX_HISTORY_TURNS = 3
const MAX_HISTORY_ANSWER_CHARS = 4_000
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_EPISODE_SECONDS = 36_000

export class BadRequestError extends Error {
  constructor(message: string, readonly status: 400 | 413 = 400) {
    super(message)
  }
}

export interface SourceRequest {
  episodeId: string
  startSeconds: number
  speaker?: string
}

async function readBounded(req: Request): Promise<string> {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_CHARS) throw new BadRequestError('Request is too large.', 413)
  if (!req.body) return ''
  const reader = req.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return text + decoder.decode()
    bytes += value.byteLength
    if (bytes > MAX_BODY_CHARS) {
      await reader.cancel()
      throw new BadRequestError('Request is too large.', 413)
    }
    text += decoder.decode(value, { stream: true })
  }
}

async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  const raw = await readBounded(req)
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    throw new BadRequestError('Request body must be valid JSON.')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestError('Request body must be a JSON object.')
  }
  return body as Record<string, unknown>
}

function parseHistory(value: unknown): ConversationTurn[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_HISTORY_TURNS) {
    throw new BadRequestError(`recentTurns must be a list of at most ${MAX_HISTORY_TURNS} turns.`)
  }
  return value.map((item: unknown) => {
    const turn = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
    if (typeof turn.question !== 'string' || typeof turn.answer !== 'string') {
      throw new BadRequestError('Each recent turn needs a question and an answer.')
    }
    return {
      question: turn.question.slice(0, MAX_QUESTION_CHARS),
      answer: turn.answer.slice(0, MAX_HISTORY_ANSWER_CHARS),
    }
  })
}

export async function parseAskRequest(req: Request): Promise<Required<AskRequest>> {
  const body = await readJsonObject(req)
  if (typeof body.question !== 'string' || !body.question.trim()) {
    throw new BadRequestError('question and sessionId are required')
  }
  const question = body.question.trim()
  if (question.length > MAX_QUESTION_CHARS) {
    throw new BadRequestError(`Please keep your question under ${MAX_QUESTION_CHARS} characters.`)
  }
  if (typeof body.sessionId !== 'string' || !SESSION_ID_RE.test(body.sessionId)) {
    throw new BadRequestError('question and sessionId are required')
  }
  return { question, sessionId: body.sessionId, recentTurns: parseHistory(body.recentTurns) }
}

export async function parseSourceRequest(req: Request): Promise<SourceRequest> {
  const { episodeId, startSeconds, speaker } = await readJsonObject(req)
  if (typeof episodeId !== 'string' || !UUID_RE.test(episodeId)) throw new BadRequestError('A valid episodeId is required.')
  if (typeof startSeconds !== 'number' || !Number.isInteger(startSeconds) || startSeconds < 0 || startSeconds > MAX_EPISODE_SECONDS) {
    throw new BadRequestError('A valid startSeconds is required.')
  }
  if (speaker === undefined) return { episodeId, startSeconds }
  if (typeof speaker !== 'string' || !speaker || speaker.length > 100) throw new BadRequestError('speaker is not valid.')
  return { episodeId, startSeconds, speaker }
}

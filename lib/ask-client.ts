import type { AskRequest, AskStreamEvent } from './types'

// Longest silence tolerated before giving up. The slowest healthy gap is the
// wait for the first words; the server's own limit is 60s.
const IDLE_TIMEOUT_MS = 45_000

export class AskFailure extends Error {}

const GENERIC = 'Something went wrong. Please try again.'
const TIMED_OUT = 'This is taking too long. Please try again.'
const CUT_OFF = 'The connection closed before the answer was finished. Please try again.'

function parseEvent(line: string): AskStreamEvent | null {
  try {
    const value: unknown = JSON.parse(line)
    if (typeof value !== 'object' || value === null) return null
    const event = value as AskStreamEvent
    switch (event.type) {
      case 'token':
        return typeof event.text === 'string' ? event : null
      case 'done':
        return Array.isArray(event.citations) ? event : null
      case 'incomplete':
        return Array.isArray(event.citations) && typeof event.message === 'string' ? event : null
      case 'blocked':
      case 'none':
      case 'error':
        return typeof event.message === 'string' ? event : null
      default:
        return null
    }
  } catch {
    return null
  }
}

// Resolves only after a terminal event has been delivered; every other ending
// (bad status, silence, cut connection, stream that just stops) throws an
// AskFailure, so a caller can never be left waiting.
export async function askStream(body: AskRequest, onEvent: (event: AskStreamEvent) => void, abort: AbortController): Promise<void> {
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const restartTimer = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      abort.abort()
    }, IDLE_TIMEOUT_MS)
  }
  // fetch and read() reject on abort, but not in every environment once a
  // body is mid-stream, so race them against the signal as well.
  const aborted = new Promise<never>((_, reject) => {
    abort.signal.addEventListener('abort', () => reject(new AskFailure(TIMED_OUT)), { once: true })
  })
  aborted.catch(() => undefined)

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    restartTimer()
    const res = await Promise.race([
      fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abort.signal,
      }),
      aborted,
    ])
    if (!res.ok) throw new AskFailure(await describeHttpError(res))
    if (!res.body) throw new AskFailure(GENERIC)

    reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted])
      restartTimer()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = done ? '' : (lines.pop() ?? '')
      for (const line of lines) {
        const event = line.trim() ? parseEvent(line) : null
        if (!event) continue
        onEvent(event)
        if (event.type !== 'token') return
      }
      if (done) throw new AskFailure(CUT_OFF)
    }
  } catch (err) {
    if (timedOut) throw new AskFailure(TIMED_OUT)
    throw err instanceof AskFailure ? err : new AskFailure(GENERIC)
  } finally {
    clearTimeout(timer)
    reader?.cancel().catch(() => undefined)
  }
}

async function describeHttpError(res: Response): Promise<string> {
  if (res.status < 400 || res.status >= 500) return GENERIC
  try {
    const data: unknown = await res.json()
    const message = (data as { error?: unknown } | null)?.error
    return typeof message === 'string' ? message : GENERIC
  } catch {
    return GENERIC
  }
}

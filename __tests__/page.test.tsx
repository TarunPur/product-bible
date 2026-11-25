// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import Home from '@/app/page'

function askResponse(events: object[]) {
  const body = events.map((e) => JSON.stringify(e) + '\n').join('')
  return {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body))
        controller.close()
      },
    }),
  }
}

function mockFetchStream(events: object[]) {
  global.fetch = vi.fn().mockResolvedValue(askResponse(events)) as unknown as typeof fetch
}

// /api/ask streams NDJSON while /api/source returns plain JSON, so tests that
// open the source panel need both routed off the same stub.
function mockFetchRoutes(events: object[], sourceLines: object[]) {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (String(url).includes('/api/source')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ lines: sourceLines }) })
    }
    return Promise.resolve(askResponse(events))
  }) as unknown as typeof fetch
}

const validatedCitation = {
  guestName: 'Ada Chen Rekhi',
  timestamp: '00:04:08',
  excerpt: 'curiosity loops are a great framework',
  episodeId: 'ep-1',
  startSeconds: 248,
  timestampVerified: true,
}

// jsdom in this Node version doesn't wire up window.localStorage by default —
// a plain in-memory stub is all getSessionId() needs.
function createLocalStorageStub(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    },
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { value: createLocalStorageStub(), configurable: true })
})

describe('Home page', () => {
  it('shows example questions when there are no turns, and fills the input on click', () => {
    render(<Home />)
    fireEvent.click(screen.getByText('How do you know if you have product-market fit?'))
    expect(screen.getByPlaceholderText(/what you're trying to figure out/i)).toHaveValue('How do you know if you have product-market fit?')
  })

  it('shows a low-confidence badge and lets the user clear the conversation', async () => {
    mockFetchStream([
      { type: 'token', text: 'Some answer.' },
      { type: 'done', citations: [], confidenceBand: 'low', disclaimer: 'Response is driven at the best...' },
    ])
    render(<Home />)

    fireEvent.change(screen.getByPlaceholderText(/what you're trying to figure out/i), { target: { value: 'a borderline question' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    expect(await screen.findByText('Low confidence')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear conversation' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear conversation' }))
    expect(screen.queryByText('Low confidence')).not.toBeInTheDocument()
    expect(screen.getByText('How do you know if you have product-market fit?')).toBeInTheDocument()
  })

  it('renders bold markdown and bullet lists in answers', async () => {
    mockFetchStream([
      { type: 'token', text: '**Bold claim**\n\n- point one\n- point two' },
      { type: 'done', citations: [], confidenceBand: 'high' },
    ])
    render(<Home />)

    fireEvent.change(screen.getByPlaceholderText(/what you're trying to figure out/i), { target: { value: 'formatting test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    expect(await screen.findByText('Bold claim')).toBeInTheDocument()
    expect(screen.getByText('point one')).toBeInTheDocument()
    expect(screen.getByText('point two')).toBeInTheDocument()
  })

  it('renders a validated citation tag as a numbered marker, and drops an unvalidated one', async () => {
    mockFetchStream([
      {
        type: 'token',
        text: 'Curiosity loops help you learn fast [Ada Chen Rekhi, 00:04:08]. Some say otherwise [Fabricated Guest, 00:01:00].',
      },
      { type: 'done', citations: [validatedCitation], confidenceBand: 'high' },
    ])
    render(<Home />)

    fireEvent.change(screen.getByPlaceholderText(/what you're trying to figure out/i), { target: { value: 'what are curiosity loops' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    const marker = await screen.findByTitle('Ada Chen Rekhi — 00:04:08')
    expect(marker).toHaveTextContent('1')
    expect(screen.queryByText(/Fabricated Guest/)).not.toBeInTheDocument()
  })

  async function askAndWait(events: object[], question = 'what are curiosity loops') {
    render(<Home />)
    fireEvent.change(screen.getByPlaceholderText(/what you're trying to figure out/i), { target: { value: question } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    return screen.findByTitle('Ada Chen Rekhi — 00:04:08')
  }

  it('shows a sources rail alongside the answer, with the answer stats derived from real citations', async () => {
    mockFetchStream([
      { type: 'token', text: 'A point [Ada Chen Rekhi, 00:04:08].' },
      { type: 'done', citations: [validatedCitation], confidenceBand: 'high' },
    ])
    await askAndWait([])

    expect(screen.getByText('Sources')).toBeInTheDocument()
    expect(screen.getByText('1 of 329 episodes matched')).toBeInTheDocument()
    expect(screen.getByText('1 operator')).toBeInTheDocument()
    expect(screen.getByText('1 citation')).toBeInTheDocument()
  })

  it('opens the source panel with surrounding transcript when a verified citation is clicked', async () => {
    mockFetchRoutes(
      [
        { type: 'token', text: 'A point [Ada Chen Rekhi, 00:04:08].' },
        { type: 'done', citations: [validatedCitation], confidenceBand: 'high' },
      ],
      [
        { timestamp: '00:03:00', speaker: 'Lenny', text: 'leading question', isCited: false },
        { timestamp: '00:04:08', speaker: 'Ada Chen Rekhi', text: 'the cited passage', isCited: true },
      ]
    )
    const marker = await askAndWait([])

    fireEvent.click(marker)

    expect(await screen.findByRole('dialog', { name: /Ada Chen Rekhi/ })).toBeInTheDocument()
    expect(await screen.findByText('the cited passage')).toBeInTheDocument()
    expect(screen.getByText('leading question')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not open a transcript for a citation whose timestamp could not be verified', async () => {
    mockFetchRoutes(
      [
        { type: 'token', text: 'A point [Ada Chen Rekhi, 00:04:08].' },
        { type: 'done', citations: [{ ...validatedCitation, timestampVerified: false }], confidenceBand: 'high' },
      ],
      []
    )
    const marker = await askAndWait([])

    fireEvent.click(marker)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders a refusal as its own state rather than as an answer with sources', async () => {
    mockFetchStream([{ type: 'none', message: 'Responses do not exist for this question in the podcast archive.' }])
    render(<Home />)
    fireEvent.change(screen.getByPlaceholderText(/what you're trying to figure out/i), { target: { value: 'something off-topic' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    expect(await screen.findByText('No sources found')).toBeInTheDocument()
    expect(screen.queryByText('Sources')).not.toBeInTheDocument()
  })
})

describe('never left loading', () => {
  const ask = (q = 'a question') => {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: q } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
  }
  const raw = (chunks: string[], end: 'close' | 'error' | 'hang' = 'close', ok = true, status = 200) => ({
    ok, status, json: async () => ({ error: 'server words' }),
    body: new ReadableStream({
      start(c) {
        if (end === 'hang' && chunks.length === 0) return
        for (const x of chunks) c.enqueue(new TextEncoder().encode(x))
        if (end === 'close') c.close()
      },
      // Errors only on the read after the queued chunks were consumed.
      pull(c) {
        if (end === 'error') c.error(new Error('cut'))
      },
    }),
  })
  const stub = (r: unknown) => { global.fetch = vi.fn().mockResolvedValue(r) as unknown as typeof fetch }
  const token = JSON.stringify({ type: 'token', text: 'Half an answer' }) + '\n'

  it.each([500, 502, 404])('shows an error with retry on HTTP %i', async (status) => {
    stub(raw([], 'close', false, status)); render(<Home />); ask()
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.queryByLabelText('Searching transcripts')).not.toBeInTheDocument()
  })
  it('shows the reason on a 400', async () => {
    stub(raw([], 'close', false, 400)); render(<Home />); ask()
    expect(await screen.findByText('server words')).toBeInTheDocument()
  })
  it('handles a stream that closes with nothing', async () => {
    stub(raw([])); render(<Home />); ask()
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
  it.each(['close', 'error'] as const)('keeps partial text but marks it incomplete when the stream %ss early', async (end) => {
    stub(raw([token], end)); render(<Home />); ask()
    expect(await screen.findByText('Incomplete answer')).toBeInTheDocument()
    expect(screen.getByText('Half an answer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
  it('marks an incomplete event and never shows the checked note', async () => {
    stub(raw([token, JSON.stringify({ type: 'incomplete', message: 'stopped', citations: [] }) + '\n'])); render(<Home />); ask()
    expect(await screen.findByText('Incomplete answer')).toBeInTheDocument()
    expect(screen.queryByText(/citations checked/i)).not.toBeInTheDocument()
  })
  it('survives malformed and unknown lines', async () => {
    stub(raw(['{bad\n', 'null\n', '{"type":"mystery"}\n', token, JSON.stringify({ type: 'done', citations: [], confidenceBand: 'low' }) + '\n'])); render(<Home />); ask()
    expect(await screen.findByText('Low confidence')).toBeInTheDocument()
  })
  it('reads a terminal event with no trailing newline', async () => {
    stub(raw([JSON.stringify({ type: 'none', message: 'nothing here' })])); render(<Home />); ask()
    expect(await screen.findByText('nothing here')).toBeInTheDocument()
  })
  it('times out a silent stream', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    stub(raw([], 'hang')); render(<Home />); ask()
    await vi.advanceTimersByTimeAsync(46_000)
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument()
    vi.useRealTimers()
  })
  it('retry asks the same question again and replaces the failed turn', async () => {
    stub(raw([], 'close', false, 500)); render(<Home />); ask('the same thing')
    const retry = await screen.findByRole('button', { name: /try again/i })
    stub(raw([JSON.stringify({ type: 'none', message: 'ok now' }) + '\n']))
    fireEvent.click(retry)
    expect(await screen.findByText('ok now')).toBeInTheDocument()
    expect(JSON.parse((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body).question).toBe('the same thing')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
  it('clearing mid-stream aborts it and late events cannot land on the next question', async () => {
    let late!: ReadableStreamDefaultController
    const signals: AbortSignal[] = []
    global.fetch = vi.fn().mockImplementation((_u, init) => { signals.push(init.signal); return Promise.resolve({ ok: true, body: new ReadableStream({ start(c) { late = c } }) }) }) as unknown as typeof fetch
    render(<Home />); ask('first')
    await screen.findByLabelText('Searching transcripts')
    fireEvent.click(screen.getByRole('button', { name: 'Clear conversation' }))
    expect(signals[0].aborted).toBe(true)
    const old = late
    ask('second')
    await screen.findByRole('heading', { name: 'second' })
    try { old.enqueue(new TextEncoder().encode(token)) } catch {}
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByText('Half an answer')).not.toBeInTheDocument()
  })
  it('ignores a double submit', async () => {
    stub(raw([], 'hang')); render(<Home />); ask()
    fireEvent.submit(document.querySelector('form')!)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('answer rendering and trust', () => {
  const show = async (text: string, citations: object[] = [validatedCitation], band = 'high') => {
    mockFetchStream([{ type: 'token', text }, { type: 'done', citations, confidenceBand: band }])
    render(<Home />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await screen.findByText('Sources').catch(() => undefined)
  }
  it('renders each timestamp of a combined citation as its own marker, with no raw brackets', async () => {
    await show('Point [Ada Chen Rekhi, 00:04:08; 00:05:00].', [validatedCitation, { ...validatedCitation, timestamp: '00:05:00', startSeconds: 300 }])
    expect(screen.getByTitle('Ada Chen Rekhi — 00:04:08')).toBeInTheDocument()
    expect(screen.getByTitle('Ada Chen Rekhi — 00:05:00')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('[Ada')
  })
  it('does not claim every claim resolves', async () => {
    await show('Point [Ada Chen Rekhi, 00:04:08].')
    expect(document.body.textContent).not.toMatch(/every claim/i)
    expect(screen.getByText(/citations checked/i)).toBeInTheDocument()
  })
  it('never shows the checked note with zero or unverified citations', async () => {
    await show('Point.', [])
    expect(screen.queryByText(/citations checked/i)).not.toBeInTheDocument()
  })
  it('renders numbered lists, headings and italics, and never raw HTML', async () => {
    await show('## Head\n\n1. one\n2. two\n\n*soft* <img src=x onerror=alert(1)>')
    expect(screen.getByRole('heading', { name: 'Head' })).toBeInTheDocument()
    expect(document.querySelectorAll('ol li')).toHaveLength(2)
    expect(document.querySelector('em')).toHaveTextContent('soft')
    expect(document.querySelector('img')).toBeNull()
  })
  it('scrolls the source panel to the cited line', async () => {
    const scroll = vi.fn(); Element.prototype.scrollIntoView = scroll
    mockFetchRoutes([{ type: 'token', text: 'P [Ada Chen Rekhi, 00:04:08].' }, { type: 'done', citations: [validatedCitation], confidenceBand: 'high' }],
      [{ timestamp: '00:03:00', speaker: 'Lenny', text: 'before', isCited: false }, { timestamp: '00:04:08', speaker: 'Ada Chen Rekhi', text: 'cited', isCited: true }])
    render(<Home />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    fireEvent.click(await screen.findByTitle('Ada Chen Rekhi — 00:04:08'))
    await screen.findByText('cited')
    expect(scroll).toHaveBeenCalled()
    expect(scroll.mock.contexts[0]).toHaveTextContent('cited')
  })
  it('counts Lenny and Lenny Rachitsky as one operator', async () => {
    await show('A [Lenny, 00:01:00] B [Lenny Rachitsky, 00:02:00]', [
      { ...validatedCitation, guestName: 'Lenny', timestamp: '00:01:00' }, { ...validatedCitation, guestName: 'Lenny Rachitsky', timestamp: '00:02:00' }])
    expect(screen.getByText('1 operator')).toBeInTheDocument()
  })
  it('opens a modal source dialog that takes focus and gives it back', async () => {
    mockFetchRoutes([{ type: 'token', text: 'P [Ada Chen Rekhi, 00:04:08].' }, { type: 'done', citations: [validatedCitation], confidenceBand: 'high' }], [])
    render(<Home />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    const marker = await screen.findByTitle('Ada Chen Rekhi — 00:04:08')
    marker.focus(); fireEvent.click(marker)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.activeElement).toBe(marker)
    const call = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[0]).includes('source'))!
    expect(JSON.parse(call[1].body).speaker).toBe('Ada Chen Rekhi')
  })
})

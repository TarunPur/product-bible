// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import Home from '@/app/page'

function mockFetchStream(events: object[]) {
  const body = events.map((e) => JSON.stringify(e) + '\n').join('')
  global.fetch = vi.fn().mockResolvedValue({
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body))
        controller.close()
      },
    }),
  }) as unknown as typeof fetch
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
    expect(screen.getByPlaceholderText(/Ask a question/i)).toHaveValue('How do you know if you have product-market fit?')
  })

  it('shows a low-confidence badge and lets the user clear the conversation', async () => {
    mockFetchStream([
      { type: 'token', text: 'Some answer.' },
      { type: 'done', citations: [], confidenceBand: 'low', disclaimer: 'Response is driven at the best...' },
    ])
    render(<Home />)

    fireEvent.change(screen.getByPlaceholderText(/Ask a question/i), { target: { value: 'a borderline question' } })
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

    fireEvent.change(screen.getByPlaceholderText(/Ask a question/i), { target: { value: 'formatting test' } })
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
      {
        type: 'done',
        citations: [{ guestName: 'Ada Chen Rekhi', timestamp: '00:04:08', excerpt: 'curiosity loops are a great framework' }],
        confidenceBand: 'high',
      },
    ])
    render(<Home />)

    fireEvent.change(screen.getByPlaceholderText(/Ask a question/i), { target: { value: 'what are curiosity loops' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    const marker = await screen.findByTitle('Ada Chen Rekhi — 00:04:08')
    expect(marker).toHaveTextContent('1')
    expect(screen.queryByText(/Fabricated Guest/)).not.toBeInTheDocument()
  })
})

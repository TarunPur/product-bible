'use client'

import { useState } from 'react'
import type { AskStreamEvent, Citation, ConfidenceBand, ConversationTurn } from '@/lib/types'

interface Turn {
  question: string
  answer: string
  citations: Citation[]
  confidenceBand: ConfidenceBand | null
  status: 'streaming' | 'done' | 'error'
}

const RECENT_TURNS_LIMIT = 3
const SESSION_STORAGE_KEY = 'lenny-qa-session-id'

const EXAMPLE_QUESTIONS = [
  'How do you know if you have product-market fit?',
  "What's the best way to prep for a PM interview?",
  'How should an early-stage startup think about pricing?',
]

function getSessionId(): string {
  const existing = window.localStorage.getItem(SESSION_STORAGE_KEY)
  if (existing) return existing
  const fresh = crypto.randomUUID()
  window.localStorage.setItem(SESSION_STORAGE_KEY, fresh)
  return fresh
}

// Small, dependency-free renderer for the bit of markdown Claude's answers
// tend to use (bold, bullet lists) — a full markdown library is more than
// this narrow case needs.
function renderInlineMarkdown(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{part}</span>
    )
  )
}

function renderAnswer(text: string): React.ReactNode {
  return text.split(/\n\n+/).map((block, i) => {
    const lines = block.split('\n').filter((l) => l.trim().length > 0)
    const isList = lines.length > 0 && lines.every((l) => l.trim().startsWith('- '))
    if (isList) {
      return (
        <ul key={i} className="list-disc pl-5 space-y-1">
          {lines.map((l, j) => (
            <li key={j}>{renderInlineMarkdown(l.trim().slice(2))}</li>
          ))}
        </ul>
      )
    }
    return (
      <p key={i} className="whitespace-pre-wrap">
        {renderInlineMarkdown(block)}
      </p>
    )
  })
}

export default function Home() {
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [isAsking, setIsAsking] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = question.trim()
    if (!trimmed || isAsking) return

    setQuestion('')
    setIsAsking(true)
    setTurns((prev) => [...prev, { question: trimmed, answer: '', citations: [], confidenceBand: null, status: 'streaming' }])

    const recentTurns: ConversationTurn[] = turns
      .filter((t) => t.status === 'done')
      .slice(-RECENT_TURNS_LIMIT)
      .map((t) => ({ question: t.question, answer: t.answer }))

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed, sessionId: getSessionId(), recentTurns }),
      })

      if (!res.body) throw new Error('No response body')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          const event = JSON.parse(line) as AskStreamEvent
          applyEvent(event)
        }
      }
    } catch {
      updateLastTurn((t) => ({ ...t, status: 'error', answer: 'Something went wrong. Please try again.' }))
    } finally {
      setIsAsking(false)
    }
  }

  function updateLastTurn(update: (turn: Turn) => Turn) {
    setTurns((prev) => {
      if (prev.length === 0) return prev
      const next = [...prev]
      next[next.length - 1] = update(next[next.length - 1])
      return next
    })
  }

  function applyEvent(event: AskStreamEvent) {
    if (event.type === 'token') {
      updateLastTurn((t) => ({ ...t, answer: t.answer + event.text }))
    } else if (event.type === 'blocked' || event.type === 'none') {
      updateLastTurn((t) => ({ ...t, answer: event.message, status: 'done' }))
    } else if (event.type === 'error') {
      updateLastTurn((t) => ({ ...t, answer: event.message, status: 'error' }))
    } else if (event.type === 'done') {
      updateLastTurn((t) => ({
        ...t,
        answer: event.disclaimer ? `${t.answer}\n\n${event.disclaimer}` : t.answer,
        citations: event.citations,
        confidenceBand: event.confidenceBand,
        status: 'done',
      }))
    }
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
        <span className="text-lg font-bold text-blue-700">Lenny&apos;s Podcast Q&amp;A</span>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={() => setTurns([])}
            className="text-xs text-gray-500 hover:text-gray-700 underline shrink-0"
          >
            Clear conversation
          </button>
        )}
      </nav>

      <section className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        <p className="text-sm text-gray-500 mb-6">
          This tool tells you what guests have said on the podcast, with attribution. It doesn&apos;t verify claims or tell you who&apos;s
          right.
        </p>

        <form onSubmit={handleSubmit} className="flex gap-2 mb-8">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about product, design, hiring..."
            className="flex-1 min-w-0 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isAsking}
          />
          <button
            type="submit"
            disabled={isAsking || !question.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 shrink-0"
          >
            Ask
          </button>
        </form>

        {turns.length === 0 && (
          <div className="border border-dashed border-gray-200 rounded-lg px-4 py-6">
            <p className="text-sm text-gray-400 mb-3">Try one of these:</p>
            <div className="flex flex-col gap-2">
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuestion(q)}
                  className="text-left text-sm text-blue-700 hover:underline"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-8">
          {turns.map((turn, i) => (
            <div key={i} className="flex flex-col gap-2">
              <p className="font-medium text-gray-900">{turn.question}</p>
              {turn.confidenceBand === 'low' && (
                <span className="inline-block w-fit text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                  Low confidence
                </span>
              )}
              <div className="text-gray-700">
                {renderAnswer(turn.answer)}
                {turn.status === 'streaming' && <span className="animate-pulse">▍</span>}
              </div>
              {turn.citations.length > 0 && (
                <div className="flex flex-col gap-2 mt-2">
                  {turn.citations.map((c, j) => (
                    <div key={j} className="border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600 bg-white">
                      <span className="font-medium text-gray-900">
                        {c.guestName} — {c.timestamp}
                      </span>
                      <p className="mt-1">{c.excerpt}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

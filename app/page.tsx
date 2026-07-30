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

function getSessionId(): string {
  const existing = window.localStorage.getItem(SESSION_STORAGE_KEY)
  if (existing) return existing
  const fresh = crypto.randomUUID()
  window.localStorage.setItem(SESSION_STORAGE_KEY, fresh)
  return fresh
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
      <nav className="bg-white border-b border-gray-200 px-6 py-4">
        <span className="text-lg font-bold text-blue-700">Lenny&apos;s Podcast Q&amp;A</span>
      </nav>

      <section className="max-w-2xl mx-auto px-6 py-10">
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
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isAsking}
          />
          <button
            type="submit"
            disabled={isAsking || !question.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            Ask
          </button>
        </form>

        <div className="flex flex-col gap-8">
          {turns.map((turn, i) => (
            <div key={i} className="flex flex-col gap-2">
              <p className="font-medium text-gray-900">{turn.question}</p>
              <p className="text-gray-700 whitespace-pre-wrap">
                {turn.answer}
                {turn.status === 'streaming' && <span className="animate-pulse">▍</span>}
              </p>
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

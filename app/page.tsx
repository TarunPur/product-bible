'use client'

import { useEffect, useState } from 'react'
import type {
  AskStreamEvent,
  Citation,
  ConfidenceBand,
  ConversationTurn,
  SourceContextLine,
} from '@/lib/types'

type TurnKind = 'answer' | 'blocked' | 'none' | 'error'

interface Turn {
  question: string
  answer: string
  citations: Citation[]
  confidenceBand: ConfidenceBand | null
  disclaimer?: string
  status: 'streaming' | 'done' | 'error'
  kind: TurnKind
}

const RECENT_TURNS_LIMIT = 3
const SESSION_STORAGE_KEY = 'lenny-qa-session-id'

// 329 of 331 archived episodes are ingested; the two skipped files use a
// timestamp-less transcript format the parser can't read. Only claims that
// can be checked against the database are stated here.
const ARCHIVE_EPISODES = 329
const ARCHIVE_INDEXED_THROUGH = 'Jul 2026'

const QUESTION_THEMES = [
  {
    label: 'Product & strategy',
    questions: [
      'How do you know if you have product-market fit?',
      'When should a team kill a bet instead of doubling down?',
      'How should an early-stage startup think about pricing?',
    ],
  },
  {
    label: 'Hiring & teams',
    questions: [
      "What's the best way to prep for a PM interview?",
      'How do you tell a strong IC apart from a strong manager?',
      'What does a good product org look like at 200 people?',
    ],
  },
  {
    label: 'Growth & positioning',
    questions: [
      'How do you find the right positioning for a product?',
      'What actually drives early growth versus what looks like it does?',
      'How do operators think about retention curves?',
    ],
  },
]

function getSessionId(): string {
  const existing = window.localStorage.getItem(SESSION_STORAGE_KEY)
  if (existing) return existing
  const fresh = crypto.randomUUID()
  window.localStorage.setItem(SESSION_STORAGE_KEY, fresh)
  return fresh
}

function citationKey(guestName: string, timestamp: string): string {
  return `${guestName.toLowerCase()}|${timestamp}`
}

function buildCitationIndex(citations: Citation[]): Map<string, number> {
  const map = new Map<string, number>()
  citations.forEach((c, i) => map.set(citationKey(c.guestName, c.timestamp), i + 1))
  return map
}

const CITATION_TAG_RE = /\[([^,[\]]+),\s*(\d{1,2}:\d{2}(?::\d{2})?)\]/g

type TextPart = { type: 'text'; value: string } | { type: 'citation'; guestName: string; timestamp: string }

// Splits out [Guest, timestamp] tags from surrounding prose so they can be
// rendered as numbered reference markers instead of raw bracket text.
function splitCitationTags(text: string): TextPart[] {
  const parts: TextPart[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  CITATION_TAG_RE.lastIndex = 0
  while ((match = CITATION_TAG_RE.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    parts.push({ type: 'citation', guestName: match[1].trim(), timestamp: match[2] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push({ type: 'text', value: text.slice(lastIndex) })
  return parts
}

function renderBold(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={`${keyPrefix}-${i}`} className="font-semibold text-ink">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={`${keyPrefix}-${i}`}>{part}</span>
    )
  )
}

interface CitationRenderContext {
  index: Map<string, number>
  hovered: number | null
  onHover: (n: number | null) => void
  onOpen: (n: number) => void
}

// Citation tags the model emits are only rendered as numbered markers when
// they match a real, validated citation (see lib/citations.ts) — a tag for a
// guest that was never actually retrieved is silently dropped here rather
// than left visible as raw, unverifiable bracket text.
function renderInlineContent(text: string, ctx: CitationRenderContext, keyPrefix: string): React.ReactNode[] {
  return splitCitationTags(text).flatMap((part, i) => {
    if (part.type === 'text') return renderBold(part.value, `${keyPrefix}-t${i}`)

    const number = ctx.index.get(citationKey(part.guestName, part.timestamp))
    if (!number) return []
    const isHot = ctx.hovered === number
    return [
      <button
        key={`${keyPrefix}-c${i}`}
        type="button"
        title={`${part.guestName} — ${part.timestamp}`}
        onMouseEnter={() => ctx.onHover(number)}
        onMouseLeave={() => ctx.onHover(null)}
        onFocus={() => ctx.onHover(number)}
        onBlur={() => ctx.onHover(null)}
        onClick={() => ctx.onOpen(number)}
        className={`font-mono text-[9.5px] tracking-[0.04em] align-super mx-0.5 px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
          isHot ? 'border-accent bg-accent text-page' : 'border-edge bg-page text-faint hover:border-fainter'
        }`}
      >
        {number}
      </button>,
    ]
  })
}

function renderAnswer(text: string, ctx: CitationRenderContext): React.ReactNode {
  return text.split(/\n\n+/).map((block, i) => {
    const lines = block.split('\n').filter((l) => l.trim().length > 0)
    const isList = lines.length > 0 && lines.every((l) => l.trim().startsWith('- '))
    if (isList) {
      return (
        <ul key={i} className="list-disc pl-5 space-y-2 my-4">
          {lines.map((l, j) => (
            <li key={j}>{renderInlineContent(l.trim().slice(2), ctx, `b${i}-l${j}`)}</li>
          ))}
        </ul>
      )
    }
    return (
      <p key={i} className="whitespace-pre-wrap my-4 first:mt-0">
        {renderInlineContent(block, ctx, `b${i}`)}
      </p>
    )
  })
}

function Wordmark() {
  return (
    <div className="w-[30px] h-[30px] rounded-[9px] bg-ink text-page grid place-items-center font-serif text-[19px] leading-none pb-0.5 shrink-0">
      O
    </div>
  )
}

function AnswerSkeleton() {
  return (
    <div className="animate-pulse" aria-label="Searching transcripts">
      <div className="label-meta mb-4">Searching transcripts</div>
      <div className="space-y-3">
        <div className="h-4 bg-rule-soft rounded w-full" />
        <div className="h-4 bg-rule-soft rounded w-[92%]" />
        <div className="h-4 bg-rule-soft rounded w-[78%]" />
      </div>
    </div>
  )
}

function AskForm({
  question,
  setQuestion,
  isAsking,
  onSubmit,
  placeholder,
  size,
}: {
  question: string
  setQuestion: (q: string) => void
  isAsking: boolean
  onSubmit: (e: React.FormEvent) => void
  placeholder: string
  size: 'lg' | 'sm'
}) {
  const isLarge = size === 'lg'
  return (
    <form
      onSubmit={onSubmit}
      className={`flex items-stretch bg-surface border border-edge overflow-hidden ${
        isLarge
          ? 'rounded-2xl shadow-[0_1px_2px_rgba(23,22,20,0.04),0_8px_24px_-12px_rgba(23,22,20,0.10)]'
          : 'rounded-xl shadow-[0_2px_4px_rgba(23,22,20,0.04),0_12px_28px_-14px_rgba(23,22,20,0.16)]'
      }`}
    >
      <input
        type="text"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder={placeholder}
        disabled={isAsking}
        className={`flex-1 min-w-0 bg-transparent border-none outline-none text-ink placeholder:text-fainter ${
          isLarge ? 'text-[17px] px-5 py-[19px]' : 'text-[15px] px-[18px] py-3.5'
        }`}
      />
      <button
        type="submit"
        disabled={isAsking || !question.trim()}
        className={`shrink-0 bg-ink text-page font-semibold rounded-lg m-1.5 transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-ink ${
          isLarge ? 'text-[15px] px-7' : 'text-sm px-5'
        }`}
      >
        Ask
      </button>
    </form>
  )
}

function SourceCard({
  citation,
  number,
  isHot,
  onHover,
  onOpen,
}: {
  citation: Citation
  number: number
  isHot: boolean
  onHover: (n: number | null) => void
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      id={`citation-${number}`}
      onMouseEnter={() => onHover(number)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(number)}
      onBlur={() => onHover(null)}
      onClick={onOpen}
      className={`block w-full text-left rounded-xl p-3.5 bg-surface border transition-all scroll-mt-20 ${
        isHot ? 'border-accent shadow-[0_0_0_3px_var(--color-accent-wash)]' : 'border-rule'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2.5 mb-1.5">
        <span className="font-mono text-[10px] tracking-[0.06em] text-faint">{number}</span>
        <span className="font-mono text-[10.5px] text-accent">{citation.timestamp}</span>
      </div>
      <div className="text-[13.5px] font-semibold leading-snug tracking-[-0.008em] text-ink mb-1.5">
        {citation.guestName}
      </div>
      <p className="text-[12.5px] text-muted leading-relaxed line-clamp-4">{citation.excerpt}</p>
      {citation.timestampVerified && (
        <span className="mt-2 inline-block font-mono text-[10px] text-fainter">Open transcript →</span>
      )}
    </button>
  )
}

function SourcePanel({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  const [lines, setLines] = useState<SourceContextLine[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLines(null)
    setFailed(false)
    fetch('/api/source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ episodeId: citation.episodeId, startSeconds: citation.startSeconds }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('failed'))))
      .then((data: { lines: SourceContextLine[] }) => {
        if (!cancelled) setLines(data.lines)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [citation.episodeId, citation.startSeconds])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-50 bg-ink/28 backdrop-blur-[2px]"
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-label={`Transcript for ${citation.guestName}`}
        className="fixed top-0 right-0 bottom-0 z-[51] w-[min(560px,100%)] bg-surface border-l border-edge overflow-auto animate-panel-in shadow-[-24px_0_60px_-30px_rgba(23,22,20,0.4)]"
      >
        <div className="sticky top-0 flex items-center justify-between gap-4 px-6 py-4 bg-surface/92 backdrop-blur border-b border-rule-soft">
          <span className="label-meta">Source</span>
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] text-muted border border-rule rounded-lg px-3 py-1.5 hover:border-fainter hover:text-ink transition-colors"
          >
            Close
          </button>
        </div>

        <div className="px-6 pt-6 pb-16">
          <h2 className="font-serif font-normal text-2xl leading-tight tracking-[-0.015em] mb-1.5">
            {citation.guestName}
          </h2>
          <div className="font-mono text-[10.5px] tracking-[0.06em] text-faint mb-6">
            Cited at {citation.timestamp}
          </div>

          <div className="label-meta mb-3">Transcript around the citation</div>
          {failed ? (
            <p className="text-sm text-muted">Couldn&apos;t load the surrounding transcript.</p>
          ) : lines === null ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-3.5 bg-rule-soft rounded w-full" />
              <div className="h-3.5 bg-rule-soft rounded w-[88%]" />
              <div className="h-3.5 bg-rule-soft rounded w-[94%]" />
            </div>
          ) : (
            <div className="flex flex-col gap-3.5 p-4 bg-page border border-rule rounded-xl">
              {lines.map((line, i) => (
                <div
                  key={i}
                  className={`pl-3 -ml-3.5 border-l-2 ${line.isCited ? 'border-accent' : 'border-transparent'}`}
                >
                  <div className="flex items-baseline gap-2.5 mb-1">
                    <span className="font-mono text-[10.5px] text-accent shrink-0">{line.timestamp}</span>
                    <span className="text-[11.5px] font-semibold tracking-[0.02em] uppercase text-faint">
                      {line.speaker}
                    </span>
                  </div>
                  <p className="text-[14.5px] leading-relaxed text-ink-soft">{line.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default function Home() {
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [isAsking, setIsAsking] = useState(false)
  const [hoveredCitation, setHoveredCitation] = useState<number | null>(null)
  const [openCitation, setOpenCitation] = useState<Citation | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = question.trim()
    if (!trimmed || isAsking) return

    setQuestion('')
    setIsAsking(true)
    setHoveredCitation(null)
    setOpenCitation(null)

    const recentTurns: ConversationTurn[] = turns
      .filter((t) => t.kind === 'answer' && t.status === 'done')
      .slice(-RECENT_TURNS_LIMIT)
      .map((t) => ({ question: t.question, answer: t.answer }))

    setTurns((prev) => {
      const next: Turn[] = [
        ...prev,
        { question: trimmed, answer: '', citations: [], confidenceBand: null, status: 'streaming', kind: 'answer' },
      ]
      setActiveIndex(next.length - 1)
      return next
    })

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
      updateLastTurn((t) => ({
        ...t,
        status: 'error',
        kind: 'error',
        answer: 'Something went wrong. Please try again.',
      }))
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
    } else if (event.type === 'blocked') {
      updateLastTurn((t) => ({ ...t, answer: event.message, status: 'done', kind: 'blocked' }))
    } else if (event.type === 'none') {
      updateLastTurn((t) => ({ ...t, answer: event.message, status: 'done', kind: 'none' }))
    } else if (event.type === 'error') {
      updateLastTurn((t) => ({ ...t, answer: event.message, status: 'error', kind: 'error' }))
    } else if (event.type === 'done') {
      updateLastTurn((t) => ({
        ...t,
        citations: event.citations,
        confidenceBand: event.confidenceBand,
        disclaimer: event.disclaimer,
        status: 'done',
      }))
    }
  }

  const hasTurns = turns.length > 0
  const activeTurn = turns[activeIndex]

  if (!hasTurns) {
    return (
      <main className="flex-1 flex flex-col bg-page">
        <Header hasTurns={false} onNewQuestion={() => {}} />
        <section className="flex-1 max-w-[1180px] w-full mx-auto px-5 sm:px-8 pt-12 sm:pt-20 pb-20">
          <div className="max-w-[780px]">
            <div className="label-meta mb-5">
              {ARCHIVE_EPISODES} episodes &nbsp;·&nbsp; indexed through {ARCHIVE_INDEXED_THROUGH}
            </div>
            <h1 className="font-serif font-normal text-[clamp(38px,5.4vw,62px)] leading-[1.04] tracking-[-0.022em] mb-5">
              Ask the people who
              <br />
              <em className="italic">actually did the job.</em>
            </h1>
            <p className="text-[17px] leading-relaxed text-muted mb-9 max-w-[600px] text-pretty">
              Every answer is assembled from what guests said on the record — attributed to the guest and the minute.
              This tool reports what was said; it doesn&apos;t verify claims or decide who&apos;s right.
            </p>
          </div>

          <div className="max-w-[820px]">
            <AskForm
              question={question}
              setQuestion={setQuestion}
              isAsking={isAsking}
              onSubmit={handleSubmit}
              placeholder="Ask a question about product, design, hiring..."
              size="lg"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-11 mt-14 pt-9 border-t border-rule">
            {QUESTION_THEMES.map((theme) => (
              <div key={theme.label}>
                <div className="label-meta mb-3.5">{theme.label}</div>
                <div className="flex flex-col">
                  {theme.questions.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setQuestion(q)}
                      className="text-left text-[15px] leading-snug text-ink-soft py-2.5 hover:text-accent transition-colors text-pretty"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    )
  }

  const citationIndex = buildCitationIndex(activeTurn.citations)
  const citationCtx: CitationRenderContext = {
    index: citationIndex,
    hovered: hoveredCitation,
    onHover: setHoveredCitation,
    onOpen: (n) => {
      const citation = activeTurn.citations[n - 1]
      if (citation?.timestampVerified) setOpenCitation(citation)
    },
  }

  const isLoading = activeTurn.status === 'streaming' && activeTurn.answer === ''
  const hasSources = activeTurn.citations.length > 0
  const episodesMatched = new Set(activeTurn.citations.map((c) => c.episodeId)).size
  const operators = new Set(activeTurn.citations.map((c) => c.guestName.toLowerCase())).size

  return (
    <main className="flex-1 flex flex-col bg-page">
      <Header
        hasTurns
        onNewQuestion={() => {
          setTurns([])
          setActiveIndex(0)
          setQuestion('')
          setOpenCitation(null)
        }}
      />

      <div className="flex-1 w-full max-w-[1560px] mx-auto flex flex-col xl:flex-row items-start">
        <aside className="hidden xl:flex xl:flex-col shrink-0 w-[260px] sticky top-[60px] px-7 py-8 gap-8">
          <div>
            <div className="label-meta mb-3">This session</div>
            <div className="flex flex-col gap-px">
              {turns.map((turn, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setActiveIndex(i)
                    setOpenCitation(null)
                    setHoveredCitation(null)
                  }}
                  className={`text-left text-[13.5px] leading-snug px-2.5 py-2 rounded-lg text-pretty transition-colors ${
                    i === activeIndex ? 'bg-wash text-ink font-semibold' : 'text-muted hover:text-ink'
                  }`}
                >
                  {turn.question}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {turns.length > 1 && (
          <div className="xl:hidden w-full px-5 sm:px-8 pt-4 flex gap-2 overflow-x-auto">
            {turns.map((turn, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setActiveIndex(i)
                  setOpenCitation(null)
                }}
                className={`shrink-0 max-w-[220px] truncate text-[12.5px] px-3 py-1.5 rounded-full border transition-colors ${
                  i === activeIndex ? 'bg-ink text-page border-ink' : 'bg-transparent text-muted border-edge'
                }`}
              >
                {turn.question}
              </button>
            ))}
          </div>
        )}

        <article className="flex-1 min-w-0 w-full bg-surface xl:border-x border-rule px-5 sm:px-8 py-8 pb-40 min-h-screen">
          <div className="max-w-[720px] mx-auto">
            <h1 className="font-serif font-normal text-[clamp(28px,3.6vw,42px)] leading-[1.1] tracking-[-0.02em] mb-3.5 text-pretty">
              {activeTurn.question}
            </h1>

            {activeTurn.kind === 'answer' && hasSources && (
              <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 font-mono text-[11px] tracking-[0.04em] text-faint pb-4">
                <span>
                  {episodesMatched} of {ARCHIVE_EPISODES} episodes matched
                </span>
                <span className="text-edge">/</span>
                <span>
                  {operators} {operators === 1 ? 'operator' : 'operators'}
                </span>
                <span className="text-edge">/</span>
                <span>
                  {activeTurn.citations.length} {activeTurn.citations.length === 1 ? 'citation' : 'citations'}
                </span>
              </div>
            )}

            {activeTurn.status === 'done' && activeTurn.kind === 'answer' && (
              <CoverageNote band={activeTurn.confidenceBand} disclaimer={activeTurn.disclaimer} />
            )}

            {isLoading ? (
              <AnswerSkeleton />
            ) : activeTurn.kind === 'answer' ? (
              <div className="text-[16px] text-ink-soft leading-[1.72]">
                {renderAnswer(activeTurn.answer, citationCtx)}
                {activeTurn.status === 'streaming' && <span className="animate-pulse">▍</span>}
              </div>
            ) : (
              <NonAnswer kind={activeTurn.kind} message={activeTurn.answer} />
            )}
          </div>
        </article>

        {hasSources && (
          <aside className="w-full xl:w-[340px] shrink-0 xl:sticky xl:top-[60px] px-5 sm:px-8 xl:px-6 py-8 xl:max-h-[calc(100vh-60px)] xl:overflow-auto border-t xl:border-t-0 border-rule">
            <div className="flex items-baseline justify-between mb-3.5">
              <div className="label-meta">Sources</div>
              <div className="font-mono text-[10px] text-fainter">{activeTurn.citations.length}</div>
            </div>
            <div className="flex flex-col gap-2">
              {activeTurn.citations.map((citation, i) => (
                <SourceCard
                  key={i}
                  citation={citation}
                  number={i + 1}
                  isHot={hoveredCitation === i + 1}
                  onHover={setHoveredCitation}
                  onOpen={() => citation.timestampVerified && setOpenCitation(citation)}
                />
              ))}
            </div>
          </aside>
        )}
      </div>

      <div className="fixed left-0 right-0 bottom-0 z-30 px-5 sm:px-8 pt-6 pb-4 bg-gradient-to-t from-page via-page to-transparent">
        <div className="max-w-[720px] mx-auto">
          <AskForm
            question={question}
            setQuestion={setQuestion}
            isAsking={isAsking}
            onSubmit={handleSubmit}
            placeholder="Ask a follow-up, or start a new thread…"
            size="sm"
          />
          <p className="text-[11px] text-fainter text-center mt-2">
            Answers are attributed to guests, not verified.
          </p>
        </div>
      </div>

      {openCitation && <SourcePanel citation={openCitation} onClose={() => setOpenCitation(null)} />}
    </main>
  )
}

function Header({ hasTurns, onNewQuestion }: { hasTurns: boolean; onNewQuestion: () => void }) {
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-6 px-5 sm:px-8 py-3.5 bg-page/86 backdrop-blur-md border-b border-rule">
      <div className="flex items-center gap-2.5 min-w-0">
        <Wordmark />
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[15px] font-semibold tracking-[-0.01em]">Playbook</span>
          <span className="hidden sm:inline text-xs text-faint tracking-[0.02em] truncate">
            every answer, cited
          </span>
        </div>
      </div>
      {hasTurns && (
        <button
          type="button"
          onClick={onNewQuestion}
          className="shrink-0 text-[13px] font-medium text-muted border border-rule rounded-lg px-3 py-1.5 hover:border-fainter hover:text-ink transition-colors"
        >
          Clear conversation
        </button>
      )}
    </header>
  )
}

// The backend computes two separate confidence signals; this surfaces the
// post-generation one. Low confidence keeps the exact disclaimer wording the
// API sends rather than restating it, so the text a user sees is the text
// that was logged against the query.
function CoverageNote({ band, disclaimer }: { band: ConfidenceBand | null; disclaimer?: string }) {
  if (band === 'low') {
    return (
      <div className="flex items-start gap-2.5 px-3.5 py-3 bg-amber-50 border border-amber-200 rounded-lg mb-6">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-[7px] shrink-0" />
        <div>
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.03em] text-amber-800">
            Low confidence
          </span>
          {disclaimer && <p className="mt-1 text-[12.5px] leading-relaxed text-amber-900">{disclaimer}</p>}
        </div>
      </div>
    )
  }

  if (band !== 'high') return null

  return (
    <div className="flex items-start gap-2.5 px-3.5 py-3 bg-page border border-rule rounded-lg mb-6">
      <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.52_0.09_160)] mt-[7px] shrink-0" />
      <p className="text-[12.5px] leading-relaxed text-muted">
        Well covered. Every claim below resolves to a timestamped passage in the archive.
      </p>
    </div>
  )
}

function NonAnswer({ kind, message }: { kind: TurnKind; message: string }) {
  const label = kind === 'none' ? 'No sources found' : kind === 'blocked' ? 'Not answered' : 'Something went wrong'
  return (
    <div className="border border-rule rounded-xl bg-page px-5 py-6">
      <div className="label-meta mb-2.5">{label}</div>
      <p className="text-[15px] leading-relaxed text-muted text-pretty">{message}</p>
    </div>
  )
}

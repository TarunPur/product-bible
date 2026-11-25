'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { askStream, AskFailure } from '@/lib/ask-client'
import { citationKey, parseAnswer } from '@/lib/citation-tags'
import { EXAMPLE_QUESTIONS, QUESTION_THEMES } from '@/lib/example-questions'
import type {
  AskStreamEvent,
  Citation,
  ConfidenceBand,
  ConversationTurn,
  SourceContextLine,
} from '@/lib/types'

type TurnKind = 'answer' | 'blocked' | 'none' | 'error' | 'incomplete'

interface Turn {
  id: string
  question: string
  answer: string
  citations: Citation[]
  confidenceBand: ConfidenceBand | null
  disclaimer?: string
  // Why a partial answer stopped. Only set when kind is 'incomplete'.
  notice?: string
  interpretedAs?: string
  status: 'streaming' | 'done' | 'error'
  kind: TurnKind
}

const RECENT_TURNS_LIMIT = 3
const MAX_QUESTION_CHARS = 500
const SESSION_STORAGE_KEY = 'lenny-qa-session-id'

// 329 of 331 archived episodes are ingested; the two skipped files use a
// timestamp-less transcript format the parser can't read. Only claims that
// can be checked against the database are stated here.
const ARCHIVE_EPISODES = 329
const ARCHIVE_INDEXED_THROUGH = 'Jul 2026'

function getSessionId(): string {
  const existing = window.localStorage.getItem(SESSION_STORAGE_KEY)
  if (existing) return existing
  const fresh = crypto.randomUUID()
  window.localStorage.setItem(SESSION_STORAGE_KEY, fresh)
  return fresh
}

function buildCitationIndex(citations: Citation[]): Map<string, number> {
  const map = new Map<string, number>()
  citations.forEach((c, i) => map.set(citationKey(c), i + 1))
  return map
}

// Transcripts label the host two ways; they are one person.
function speakerId(name: string): string {
  const id = name.trim().toLowerCase()
  return id === 'lenny' ? 'lenny rachitsky' : id
}

function renderEmphasis(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|(?<![\w*])\*[^*\s](?:[^*\n]*[^*\s])?\*(?![\w*]))/g).map((part, i) => {
    const key = `${keyPrefix}-${i}`
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={key} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) return <em key={key}>{part.slice(1, -1)}</em>
    return <span key={key}>{part}</span>
  })
}

interface CitationRenderContext {
  index: Map<string, number>
  citations: Citation[]
  hovered: number | null
  onHover: (n: number | null) => void
  onOpen: (n: number) => void
}

// Citation tags the model emits are only rendered as numbered markers when
// they match a real, validated citation (see lib/citations.ts) — a tag for a
// guest that was never actually retrieved is dropped here rather than left
// visible as raw, unverifiable bracket text.
function renderInlineContent(text: string, ctx: CitationRenderContext, keyPrefix: string): React.ReactNode[] {
  return parseAnswer(text).flatMap((part, i) => {
    if (part.type === 'text') return renderEmphasis(part.value, `${keyPrefix}-t${i}`)
    if (part.type === 'unreadable') return []

    return part.refs.flatMap((ref, j) => {
      const number = ctx.index.get(citationKey(ref))
      if (!number) return []
      const citation = ctx.citations[number - 1]
      const isHot = ctx.hovered === number
      const verified = citation.timestampVerified
      return [
        <button
          key={`${keyPrefix}-c${i}-${j}`}
          type="button"
          title={`${citation.guestName} — ${citation.timestamp}`}
          aria-label={`Source ${number}: ${citation.guestName} at ${citation.timestamp}${verified ? '' : ', timestamp not confirmed'}`}
          aria-disabled={!verified}
          onMouseEnter={() => ctx.onHover(number)}
          onMouseLeave={() => ctx.onHover(null)}
          onFocus={() => ctx.onHover(number)}
          onBlur={() => ctx.onHover(null)}
          onClick={() => ctx.onOpen(number)}
          className={`relative font-mono text-[9.5px] tracking-[0.04em] align-super mx-0.5 min-w-6 min-h-6 px-1.5 rounded border transition-colors ${
            verified ? 'cursor-pointer' : 'border-dashed cursor-default'
          } ${isHot ? 'border-accent bg-accent text-page' : 'border-edge bg-page text-faint hover:border-fainter'}`}
        >
          {number}
        </button>,
      ]
    })
  })
}

const BULLET_RE = /^\s*[-*]\s+/
const NUMBER_RE = /^\s*\d+[.)]\s+/
const HEADING_RE = /^\s*#{1,4}\s+(.+)$/

type Block = { kind: 'p' | 'ul' | 'ol' | 'h'; lines: string[]; start?: number }

function toBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let gap = true
  for (const line of text.split('\n')) {
    if (!line.trim()) {
      gap = true
      continue
    }
    const heading = line.match(HEADING_RE)
    const kind = heading ? 'h' : BULLET_RE.test(line) ? 'ul' : NUMBER_RE.test(line) ? 'ol' : 'p'
    const content = heading ? heading[1] : kind === 'ul' ? line.replace(BULLET_RE, '') : kind === 'ol' ? line.replace(NUMBER_RE, '') : line
    const last = blocks.at(-1)
    const joins = last && last.kind === kind && kind !== 'h' && (!gap || kind !== 'p')
    if (joins) last.lines.push(content)
    else blocks.push({ kind, lines: [content], start: kind === 'ol' ? parseInt(line, 10) : undefined })
    gap = false
  }
  return blocks
}

function renderAnswer(text: string, ctx: CitationRenderContext): React.ReactNode {
  return toBlocks(text).map((block, i) => {
    if (block.kind === 'h') {
      return (
        <h2 key={i} className="font-semibold text-[17px] text-ink mt-6 mb-2">
          {renderInlineContent(block.lines[0], ctx, `b${i}`)}
        </h2>
      )
    }
    if (block.kind === 'p') {
      return (
        <p key={i} className="whitespace-pre-wrap my-4 first:mt-0">
          {renderInlineContent(block.lines.join('\n'), ctx, `b${i}`)}
        </p>
      )
    }
    const items = block.lines.map((l, j) => <li key={j}>{renderInlineContent(l, ctx, `b${i}-l${j}`)}</li>)
    return block.kind === 'ul' ? (
      <ul key={i} className="list-disc pl-5 space-y-2 my-4">
        {items}
      </ul>
    ) : (
      <ol key={i} start={block.start} className="list-decimal pl-5 space-y-2 my-4">
        {items}
      </ol>
    )
  })
}

function AnswerSkeleton() {
  return (
    <div className="animate-pulse" role="img" aria-label="Searching transcripts">
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
}: {
  question: string
  setQuestion: (q: string) => void
  isAsking: boolean
  onSubmit: (e: React.FormEvent) => void
  placeholder: string
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="flex items-center gap-2.5 bg-surface border border-edge rounded-xl overflow-hidden pl-4 transition-colors focus-within:border-accent"
    >
      <label htmlFor="cue-input-followup" className="shrink-0 flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] uppercase text-accent-label">
        <span className="w-[6px] h-[6px] rounded-full bg-accent animate-pulse" aria-hidden="true" />
        Cue
      </label>
      <input
        id="cue-input-followup"
        type="text"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder={placeholder}
        maxLength={MAX_QUESTION_CHARS}
        disabled={isAsking}
        className="flex-1 min-w-0 bg-transparent border-none outline-none text-ink placeholder:text-faint text-[15px] py-3.5 font-mono"
      />
      <button
        type="submit"
        disabled={isAsking || !question.trim()}
        className="shrink-0 bg-accent text-page font-semibold rounded-lg m-1.5 px-5 py-2 text-sm transition-all hover:bg-accent-hover hover:shadow-[0_0_16px_-4px_var(--color-accent)] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-page disabled:opacity-40 disabled:hover:bg-accent disabled:hover:shadow-none"
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
      className={`block w-full text-left rounded-xl p-3.5 border transition-colors scroll-mt-20 ${
        isHot ? 'bg-surface border-accent' : 'bg-wash border-transparent'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2.5 mb-1.5">
        <span className="font-mono text-[10px] tabular-nums px-1.5 py-0.5 rounded border border-edge text-faint">
          {String(number).padStart(2, '0')}
        </span>
        <span className="font-mono text-[10.5px] text-accent">{citation.timestamp}</span>
      </div>
      <div className="text-[13.5px] font-semibold leading-snug tracking-[-0.008em] text-ink mb-1.5">
        {citation.guestName}
      </div>
      <p className="text-[12.5px] text-muted leading-relaxed line-clamp-4">{citation.excerpt}</p>
      <span className="mt-2 inline-block font-mono text-[10px] text-fainter">
        {citation.timestampVerified ? 'Open transcript →' : 'Timestamp not confirmed'}
      </span>
    </button>
  )
}

function scrollToLine(element: HTMLElement | null) {
  element?.scrollIntoView?.({ block: 'start' })
}

function SourcePanel({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  const [lines, setLines] = useState<SourceContextLine[] | null>(null)
  const [failed, setFailed] = useState(false)

  const dialogRef = useRef<HTMLDivElement>(null)

  // The parent remounts this per citation (key), so state starts fresh and
  // nothing needs resetting here.
  useEffect(() => {
    let cancelled = false
    fetch('/api/source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ episodeId: citation.episodeId, startSeconds: citation.startSeconds, speaker: citation.guestName }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('failed'))))
      .then((data: { lines: SourceContextLine[] }) => {
        if (!cancelled) {
          if (Array.isArray(data.lines)) setLines(data.lines)
          else setFailed(true)
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [citation.episodeId, citation.startSeconds, citation.guestName])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') return onClose()
      if (e.key !== 'Tab' || !dialogRef.current) return
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]')
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const inside = dialogRef.current.contains(document.activeElement)
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault()
        first?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const opener = document.activeElement
    dialogRef.current?.querySelector('button')?.focus()
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-50 bg-page/70 backdrop-blur-[2px]"
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Transcript for ${citation.guestName}`}
        className="fixed top-0 right-0 bottom-0 z-[51] w-[min(560px,100%)] bg-surface border-l border-edge overflow-auto animate-panel-in shadow-[-24px_0_60px_-30px_rgba(23,22,20,0.4)]"
      >
        <div className="sticky top-0 flex items-center justify-between gap-4 px-6 py-4 bg-surface/92 backdrop-blur border-b border-rule-soft">
          <span className="label-meta">Source</span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-8 text-[13px] text-muted border border-rule rounded-lg px-3 py-1.5 hover:border-fainter hover:text-ink transition-colors"
          >
            Close
          </button>
        </div>

        <div className="px-6 pt-6 pb-16">
          <h2 className="font-semibold text-2xl leading-tight tracking-[-0.015em] text-ink mb-1.5">
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
                  ref={line.isCited ? scrollToLine : undefined}
                  className={
                    line.isCited
                      ? 'scroll-mt-24 bg-[color-mix(in_oklch,var(--color-accent)_10%,transparent)] -mx-3 px-3 py-1.5 rounded-lg'
                      : ''
                  }
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

function applyEvent(turn: Turn, event: Exclude<AskStreamEvent, { type: 'error' }>): Turn {
  switch (event.type) {
    case 'token':
      return { ...turn, answer: turn.answer + event.text }
    case 'blocked':
      return { ...turn, answer: event.message, status: 'done', kind: 'blocked' }
    case 'none':
      return { ...turn, answer: event.message, interpretedAs: event.interpretedAs, status: 'done', kind: 'none' }
    case 'incomplete':
      return turn.answer
        ? { ...turn, citations: event.citations, notice: event.message, status: 'error', kind: 'incomplete' }
        : { ...turn, answer: event.message, status: 'error', kind: 'error' }
    case 'done':
      return {
        ...turn,
        citations: event.citations,
        confidenceBand: event.confidenceBand,
        disclaimer: event.disclaimer,
        interpretedAs: event.interpretedAs,
        status: 'done',
      }
  }
}

export default function Home() {
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [isAsking, setIsAsking] = useState(false)
  const [hoveredCitation, setHoveredCitation] = useState<number | null>(null)
  const [openCitation, setOpenCitation] = useState<Citation | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const closeSource = useCallback(() => setOpenCitation(null), [])

  useEffect(() => () => abortRef.current?.abort(), [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = question.trim()
    if (!trimmed || abortRef.current) return
    setQuestion('')
    void ask(trimmed, turns)
  }

  function retry(turn: Turn) {
    if (abortRef.current) return
    void ask(
      turn.question,
      turns.filter((t) => t.id !== turn.id)
    )
  }

  function clearConversation() {
    abortRef.current?.abort()
    abortRef.current = null
    setIsAsking(false)
    setTurns([])
    setActiveIndex(0)
    setQuestion('')
    setOpenCitation(null)
  }

  async function ask(text: string, previous: Turn[]) {
    const abort = new AbortController()
    abortRef.current = abort
    const id = crypto.randomUUID()

    setIsAsking(true)
    setHoveredCitation(null)
    setOpenCitation(null)
    setTurns([
      ...previous,
      { id, question: text, answer: '', citations: [], confidenceBand: null, status: 'streaming', kind: 'answer' },
    ])
    setActiveIndex(previous.length)
    window.scrollTo?.({ top: 0 })

    const recentTurns: ConversationTurn[] = previous
      .filter((t) => t.kind === 'answer' && t.status === 'done')
      .slice(-RECENT_TURNS_LIMIT)
      .map((t) => ({ question: t.question, answer: t.answer }))

    // Updates are addressed to this turn by id, so a cleared or superseded
    // request can never write into a later one.
    const update = (change: (turn: Turn) => Turn) =>
      setTurns((prev) => prev.map((t) => (t.id === id ? change(t) : t)))
    const fail = (message: string) =>
      update((t) =>
        t.answer
          ? { ...t, status: 'error', kind: 'incomplete', notice: message }
          : { ...t, status: 'error', kind: 'error', answer: message }
      )

    try {
      await askStream(
        { question: text, sessionId: getSessionId(), recentTurns },
        (event) => {
          if (event.type === 'error') fail(event.message)
          else update((t) => applyEvent(t, event))
        },
        abort
      )
    } catch (err) {
      fail(err instanceof AskFailure ? err.message : 'Something went wrong. Please try again.')
    } finally {
      if (abortRef.current === abort) {
        abortRef.current = null
        setIsAsking(false)
      }
    }
  }

  const hasTurns = turns.length > 0
  const activeTurn = turns[activeIndex]

  if (!hasTurns) {
    return (
      <main className="flex-1 flex flex-col bg-page">
        <Header hasTurns={false} onNewQuestion={() => {}} />
        <section className="flex-1 max-w-[900px] w-full mx-auto px-5 sm:px-8 pt-16 sm:pt-24 pb-20">
          <h1 className="font-display text-ink text-[clamp(40px,7vw,80px)] leading-[0.98] tracking-[-0.01em] uppercase mb-6 text-balance">
            Skip to the part
            <br />
            that answers you.
          </h1>
          <p className="text-[17px] leading-relaxed text-muted mb-10 max-w-[62ch] text-pretty">
            Ask anything from product-market fit to your first PM interview. Every answer comes only from things
            real product, design, and growth leaders said on the record — cited to the guest and the minute, like a
            chapter mark, never guessed.
          </p>

          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-3 bg-surface border border-edge rounded-xl overflow-hidden pl-5 mb-14 transition-colors focus-within:border-accent"
          >
            <label htmlFor="cue-input" className="shrink-0 flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] uppercase text-accent-label">
              <span className="w-[7px] h-[7px] rounded-full bg-accent animate-pulse" aria-hidden="true" />
              Cue
            </label>
            <input
              id="cue-input"
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="what you're trying to figure out…"
              maxLength={MAX_QUESTION_CHARS}
              disabled={isAsking}
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-ink placeholder:text-faint text-[17px] py-[19px] font-mono"
            />
            <button
              type="submit"
              disabled={isAsking || !question.trim()}
              className="shrink-0 bg-accent text-page font-semibold rounded-lg m-1.5 px-7 py-2.5 text-[15px] transition-all hover:bg-accent-hover hover:shadow-[0_0_18px_-3px_var(--color-accent)] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-page disabled:opacity-40 disabled:hover:bg-accent disabled:hover:shadow-none"
            >
              Ask
            </button>
          </form>

          <div className="border-t border-rule pt-9">
            {QUESTION_THEMES.map((theme) => (
              <div key={theme.label} className="mb-8 last:mb-0">
                <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-accent-label mb-2.5">
                  {theme.label}
                </div>
                <div className="flex flex-col">
                  {/* Entries carry the same bordered mono-pill mark real citations use
                      (see the numbered markers in renderInlineContent below) — no guest
                      or timestamp is attached because none is verified per example
                      question, and PRODUCT.md's "don't fabricate citations" principle
                      rules out inventing one just to look sourced. */}
                  {theme.questions.map((q) => {
                    const entryNumber = EXAMPLE_QUESTIONS.indexOf(q) + 1
                    return (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setQuestion(q)}
                        className="group flex items-baseline gap-4 text-left py-2.5 border-b border-rule-soft last:border-b-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-page"
                      >
                        <span className="font-mono text-[10.5px] tabular-nums px-1.5 py-0.5 rounded border border-edge text-muted group-hover:border-accent group-hover:text-accent transition-colors shrink-0">
                          {String(entryNumber).padStart(2, '0')}
                        </span>
                        <span className="text-[15.5px] leading-snug text-ink-soft group-hover:text-ink transition-colors text-pretty">
                          {q}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 font-mono text-[10.5px] tracking-[0.08em] text-muted">
            {ARCHIVE_EPISODES} episodes indexed &middot; through {ARCHIVE_INDEXED_THROUGH} &middot; questions are stored
          </div>
        </section>
      </main>
    )
  }

  const citationIndex = buildCitationIndex(activeTurn.citations)
  const citationCtx: CitationRenderContext = {
    index: citationIndex,
    citations: activeTurn.citations,
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
  const operators = new Set(activeTurn.citations.map((c) => speakerId(c.guestName))).size

  return (
    <main className="flex-1 flex flex-col bg-page">
      <Header
        hasTurns
        onNewQuestion={clearConversation}
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
                className={`shrink-0 max-w-[220px] truncate text-[12.5px] px-3 py-1.5 rounded-lg border transition-colors ${
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
            <h1 className="font-display text-[clamp(28px,3.6vw,42px)] leading-[1.1] tracking-[-0.01em] text-ink mb-3.5 text-pretty">
              {activeTurn.question}
            </h1>

            <p role="status" aria-live="polite" className="sr-only">
              {liveStatus(activeTurn)}
            </p>

            {activeTurn.interpretedAs && (
              <p className="text-[13px] text-muted mb-3.5">Understood as: {activeTurn.interpretedAs}</p>
            )}

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
              <CoverageNote band={activeTurn.confidenceBand} disclaimer={activeTurn.disclaimer} citations={activeTurn.citations} />
            )}

            {isLoading ? (
              <AnswerSkeleton />
            ) : activeTurn.kind === 'answer' || activeTurn.kind === 'incomplete' ? (
              <div className="text-[16px] text-ink-soft leading-[1.72] break-words">
                {activeTurn.kind === 'incomplete' && (
                  <Notice label="Incomplete answer" text={activeTurn.notice} />
                )}
                {renderAnswer(activeTurn.status === 'streaming' ? hideOpenBracket(activeTurn.answer) : activeTurn.answer, citationCtx)}
                {activeTurn.status === 'streaming' && <span className="animate-pulse">▍</span>}
              </div>
            ) : (
              <NonAnswer kind={activeTurn.kind} message={activeTurn.answer} />
            )}

            {activeTurn.status === 'error' && (
              <button
                type="button"
                onClick={() => retry(activeTurn)}
                disabled={isAsking}
                className="mt-5 text-[13px] font-medium text-ink border border-edge rounded-lg px-4 py-2 hover:border-accent transition-colors disabled:opacity-40"
              >
                Try again
              </button>
            )}
          </div>
        </article>

        {hasSources && (
          <aside className="w-full xl:w-[340px] shrink-0 xl:sticky xl:top-[60px] px-5 sm:px-8 xl:px-6 pt-8 pb-40 xl:py-8 xl:max-h-[calc(100vh-60px)] xl:overflow-auto border-t xl:border-t-0 border-rule">
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
          />
          <p className="text-[11px] text-fainter text-center mt-2">
            AI-written from transcripts. Guests&apos; views aren&apos;t fact-checked. Questions are stored.
          </p>
        </div>
      </div>

      {openCitation && (
        <SourcePanel
          key={`${openCitation.episodeId}|${openCitation.guestName}|${openCitation.startSeconds}`}
          citation={openCitation}
          onClose={closeSource}
        />
      )}
    </main>
  )
}

function Header({ hasTurns, onNewQuestion }: { hasTurns: boolean; onNewQuestion: () => void }) {
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-6 px-5 sm:px-8 py-4 bg-page/92 backdrop-blur-md border-b border-rule">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-[28px] h-[28px] rounded-[7px] bg-accent text-page grid place-items-center font-display text-[15px] leading-none font-bold shrink-0">
          P
        </div>
        <div className="flex items-baseline gap-2.5 min-w-0">
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Playbook</span>
          <span className="hidden sm:inline font-mono text-[10px] tracking-[0.1em] uppercase text-accent-label truncate">
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
function CoverageNote({
  band,
  disclaimer,
  citations,
}: {
  band: ConfidenceBand | null
  disclaimer?: string
  citations: Citation[]
}) {
  if (band === 'low') return <Notice label="Low confidence" text={disclaimer} />

  if (band !== 'high' || citations.length === 0 || citations.some((c) => !c.timestampVerified)) return null

  return (
    <div className="flex items-start gap-2.5 px-3.5 py-3 bg-surface border border-rule rounded-lg mb-6">
      <span className="w-1.5 h-1.5 rounded-full bg-ink-soft mt-[7px] shrink-0" />
      <p className="text-[12.5px] leading-relaxed text-muted">
        Citations checked: each source opens on that speaker at that timestamp. The summary is AI-written.
      </p>
    </div>
  )
}

// While streaming, a half-arrived citation would flash as raw bracket text.
function hideOpenBracket(text: string): string {
  return text.replace(/\[[^\]]{0,400}$/, '')
}

function liveStatus(turn: Turn): string {
  if (turn.status === 'streaming') return turn.answer ? 'Writing the answer.' : 'Searching transcripts.'
  if (turn.kind === 'incomplete') return 'The answer stopped before it was finished.'
  if (turn.kind === 'answer') return `Answer ready, ${turn.citations.length} sources.`
  if (turn.kind === 'none') return 'No sources found for this question.'
  return turn.kind === 'blocked' ? 'This question was not answered.' : 'Something went wrong.'
}

function Notice({ label, text }: { label: string; text?: string }) {
  return (
    <div className="flex items-start gap-2.5 px-3.5 py-3 bg-[color-mix(in_oklch,var(--color-accent)_12%,var(--color-page))] border border-[color-mix(in_oklch,var(--color-accent)_35%,var(--color-page))] rounded-lg mb-6">
      <span className="w-1.5 h-1.5 rounded-full bg-accent mt-[7px] shrink-0" />
      <div>
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.03em] text-accent">{label}</span>
        {text && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">{text}</p>}
      </div>
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

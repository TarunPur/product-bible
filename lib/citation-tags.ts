// Shared by the server (validation) and the client (rendering) so both agree
// on exactly what counts as a citation. Pure and dependency-free.

export interface CitationRef {
  guestName: string
  timestamp: string
}

export type AnswerPart =
  | { type: 'text'; value: string }
  | { type: 'citations'; refs: CitationRef[] }
  // A bracket that carries a timestamp but isn't in a readable citation form.
  | { type: 'unreadable'; value: string }

const BRACKET_RE = /\[([^[\]]{1,400})\]/g
const TS = String.raw`\d{1,3}:\d{2}(?::\d{2})?`
const TIMESTAMP_RE = new RegExp(String.raw`(?<![\d:])${TS}(?![\d:])`, 'g')
const SEGMENT_RE = new RegExp(String.raw`^(?:(.+?)(?:,\s*|\s+))?(${TS}(?:\s*(?:,|and|&|-|–)\s*${TS})*)$`)

export function timestampToSeconds(timestamp: string): number {
  const parts = timestamp.split(':').map(Number)
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1]
}

export function citationKey(ref: CitationRef): string {
  return `${ref.guestName.toLowerCase()}|${timestampToSeconds(ref.timestamp)}`
}

function parseBracket(inner: string): CitationRef[] | null {
  const refs: CitationRef[] = []
  let name: string | null = null
  for (const segment of inner.split(';')) {
    const match: RegExpMatchArray | null = segment.trim().match(SEGMENT_RE)
    if (!match) return null
    if (match[1]) name = match[1].trim()
    if (!name || /\d{1,3}:\d{2}/.test(name)) return null
    for (const ts of match[2].match(TIMESTAMP_RE) ?? []) refs.push({ guestName: name, timestamp: ts })
  }
  return refs.length > 0 ? refs : null
}

export function parseAnswer(text: string): AnswerPart[] {
  const parts: AnswerPart[] = []
  let last = 0
  for (const match of text.matchAll(BRACKET_RE)) {
    if (!/\d{1,3}:\d{2}/.test(match[1])) continue
    if (match.index > last) parts.push({ type: 'text', value: text.slice(last, match.index) })
    const refs = parseBracket(match[1])
    parts.push(refs ? { type: 'citations', refs } : { type: 'unreadable', value: match[0] })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  return parts
}

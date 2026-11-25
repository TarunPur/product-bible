export type AnswerStatus = 'ANSWER' | 'PARTIAL' | 'NONE'

const STATUS_LINE_RE = /^\**STATUS:([^\n]*)\n\s*/

function toStatus(text: string): AnswerStatus {
  const word = text.match(/^[ \t*]*(ANSWER|PARTIAL|NONE)\b/)
  return word ? (word[1] as AnswerStatus) : 'PARTIAL'
}

// Splits the STATUS line off the front of a streamed answer, holding text
// back until the verdict is known. A reply with no valid status line is
// treated as PARTIAL, so it can never be presented as fully covered.
export class StatusGate {
  status: AnswerStatus | null = null
  private held = ''
  private started = false

  push(delta: string): string {
    if (this.status) return this.visible(delta)
    this.held += delta
    const candidate = this.held.trimStart()
    const line = candidate.match(STATUS_LINE_RE)
    if (line) return this.release(toStatus(line[1]), candidate.slice(line[0].length))
    const opening = candidate.replace(/^\**/, '')
    const couldBeStatus = opening.length < 200 && !candidate.includes('\n') && 'STATUS:'.startsWith(opening.slice(0, 7))
    return couldBeStatus ? '' : this.release('PARTIAL', candidate)
  }

  finish(): string {
    if (this.status) return ''
    const line = `${this.held.trim()}\n`.match(STATUS_LINE_RE)
    return line ? this.release(toStatus(line[1]), '') : this.release('PARTIAL', this.held.trim())
  }

  private release(status: AnswerStatus, text: string): string {
    this.status = status
    this.held = ''
    return this.visible(text)
  }

  // Blank lines after the status line may arrive in a later delta.
  private visible(text: string): string {
    if (this.status === 'NONE') return ''
    const out = this.started ? text : text.trimStart()
    if (out) this.started = true
    return out
  }
}

import { describe, it, expect } from 'vitest'
import { StatusGate } from '@/lib/status-gate'

function run(text: string, size: number) {
  const g = new StatusGate()
  let out = ''
  for (let i = 0; i < text.length; i += size) out += g.push(text.slice(i, i + size))
  return { out: out + g.finish(), status: g.status }
}

describe.each([1, 3, 1000])('StatusGate in chunks of %i', (size) => {
  it.each([
    ['STATUS: ANSWER\n\nHello', 'Hello', 'ANSWER'],
    ['STATUS: PARTIAL\nHello', 'Hello', 'PARTIAL'],
    ['**STATUS: ANSWER**\nHello', 'Hello', 'ANSWER'],
    ['STATUS: NONE\nstill talking', '', 'NONE'],
    ['STATUS: NONE', '', 'NONE'],
    ['STATUS: BANANA\nHello', 'Hello', 'PARTIAL'],
    ['Stats show growth', 'Stats show growth', 'PARTIAL'],
    ['No status here', 'No status here', 'PARTIAL'],
    ['', '', 'PARTIAL'],
  ])('%j', (text, out, status) => expect(run(text, size)).toEqual({ out, status }))
})

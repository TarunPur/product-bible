import { describe, it, expect } from 'vitest'
import {
  parseTranscript,
  isAdSegment,
  isHost,
  isRealGuest,
  chunkTurns,
  parseInlineTurns,
} from '@/lib/transcript-parser'

describe('parseInlineTurns', () => {
  it('splits a stored chunk back into its speaker turns', () => {
    const turns = parseInlineTurns(
      'Lenny Rachitsky (00:03:00): what is a curiosity loop? Ada Chen Rekhi (00:04:08): it is how you gather advice'
    )
    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({ speaker: 'Lenny Rachitsky', startTimestamp: '00:03:00', startSeconds: 180 })
    expect(turns[0].text).toBe('what is a curiosity loop?')
    expect(turns[1]).toMatchObject({ speaker: 'Ada Chen Rekhi', startTimestamp: '00:04:08', startSeconds: 248 })
  })

  it('round-trips content produced by chunkTurns', () => {
    const chunks = chunkTurns([
      { speaker: 'Ada Chen Rekhi', startSeconds: 0, startTimestamp: '00:00:00', text: 'first thing' },
      { speaker: 'Lenny Rachitsky', startSeconds: 12, startTimestamp: '00:00:12', text: 'second thing' },
    ])
    const turns = parseInlineTurns(chunks[0].content)
    expect(turns.map((t) => t.speaker)).toEqual(['Ada Chen Rekhi', 'Lenny Rachitsky'])
    expect(turns.map((t) => t.text)).toEqual(['first thing', 'second thing'])
  })

  it('returns nothing for text with no inline speaker labels', () => {
    expect(parseInlineTurns('just some prose with no labels')).toEqual([])
  })
})

describe('parseTranscript', () => {
  it('parses named speaker headers into turns', () => {
    const text = `Ada Chen Rekhi (00:00:00):
It's a terrible outcome to wake up one day.

Lenny (00:00:36):
Welcome to Lenny's Podcast.
`
    const turns = parseTranscript(text)
    expect(turns).toEqual([
      { speaker: 'Ada Chen Rekhi', startSeconds: 0, startTimestamp: '00:00:00', text: "It's a terrible outcome to wake up one day." },
      { speaker: 'Lenny', startSeconds: 36, startTimestamp: '00:00:36', text: 'Welcome to Lenny\'s Podcast.' },
    ])
  })

  it('inherits the last named speaker for continuation headers with no name', () => {
    const text = `Lenny (00:01:21):
First part of a long thought.

(00:01:40):
Second part of the same thought, continued.
`
    const turns = parseTranscript(text)
    expect(turns).toHaveLength(2)
    expect(turns[1].speaker).toBe('Lenny')
    expect(turns[1].startTimestamp).toBe('00:01:40')
  })

  it('handles MM:SS timestamps (no hour component) used in some files', () => {
    const text = `Matt Dixon (00:12):
Short-form timestamp episode.
`
    const turns = parseTranscript(text)
    expect(turns[0].startSeconds).toBe(12)
    expect(turns[0].startTimestamp).toBe('00:00:12')
  })

  it('parses multi-guest files where multiple non-host speakers alternate', () => {
    const text = `Lenny Rachitsky (00:00:00):
Question for both of you.

Aishwarya Naresh Reganti (00:00:08):
First guest's answer.

Kiriti Badam (00:00:28):
Second guest's answer.
`
    const turns = parseTranscript(text)
    expect(turns.map((t) => t.speaker)).toEqual([
      'Lenny Rachitsky',
      'Aishwarya Naresh Reganti',
      'Kiriti Badam',
    ])
  })

  it('tolerates a missing trailing colon on the timestamp header', () => {
    const text = `Lenny (00:00:00):
Sign off.

(01:11:34)
Thanks for listening.
`
    const turns = parseTranscript(text)
    expect(turns).toHaveLength(2)
    expect(turns[1].text).toBe('Thanks for listening.')
  })
})

describe('isRealGuest', () => {
  it('accepts a normal guest name', () => {
    expect(isRealGuest('Ada Chen Rekhi')).toBe(true)
  })

  it('rejects the host', () => {
    expect(isRealGuest('Lenny Rachitsky')).toBe(false)
  })

  it('rejects pseudo-speaker labels that are not an identifiable guest', () => {
    expect(isRealGuest('Advertisement')).toBe(false)
    expect(isRealGuest('Audio')).toBe(false)
    expect(isRealGuest('Narrator')).toBe(false)
    expect(isRealGuest('Speaker 3')).toBe(false)
    expect(isRealGuest('Speaker 12')).toBe(false)
  })
})

describe('isHost', () => {
  it('matches all observed host-name variants', () => {
    expect(isHost('Lenny')).toBe(true)
    expect(isHost('Lenny Rachitsky')).toBe(true)
    expect(isHost('LENNY RACHITSKY')).toBe(true)
    expect(isHost('Ada Chen Rekhi')).toBe(false)
  })
})

describe('isAdSegment', () => {
  it('flags an explicit "Advertisement" speaker regardless of position', () => {
    expect(
      isAdSegment({ speaker: 'Advertisement', startSeconds: 5000, startTimestamp: '01:23:20', text: 'anything' })
    ).toBe(true)
  })

  it('flags a weak cue phrase spoken by the host early in the episode', () => {
    expect(
      isAdSegment({
        speaker: 'Lenny',
        startSeconds: 100,
        startTimestamp: '00:01:40',
        text: 'Sprig is brought to you by their product team, check it out.',
      })
    ).toBe(true)
  })

  it('does not flag a weak cue phrase spoken by the host late in the episode', () => {
    expect(
      isAdSegment({
        speaker: 'Lenny',
        startSeconds: 4000,
        startTimestamp: '01:06:40',
        text: 'Sprig is brought to you by their product team, check it out.',
      })
    ).toBe(false)
  })

  it('flags a strong templated cue phrase regardless of position (catches mid-roll ads)', () => {
    expect(
      isAdSegment({
        speaker: 'Lenny',
        startSeconds: 4000,
        startTimestamp: '01:06:40',
        text: 'This episode is brought to you by Sprig.',
      })
    ).toBe(true)
  })

  it('does not flag a weak cue phrase spoken by a guest, even early (avoids stripping real content)', () => {
    expect(
      isAdSegment({
        speaker: 'Dan Shipper',
        startSeconds: 100,
        startTimestamp: '00:01:40',
        text: 'People are like, are you sponsored by OpenAI? I just talk about what I like.',
      })
    ).toBe(false)
  })

  it('does not flag ordinary guest dialogue', () => {
    expect(
      isAdSegment({
        speaker: 'Ada Chen Rekhi',
        startSeconds: 200,
        startTimestamp: '00:03:20',
        text: 'A curiosity loop is essentially going to a whole bunch of people.',
      })
    ).toBe(false)
  })
})

describe('chunkTurns', () => {
  it('excludes ad segments from chunks', () => {
    const turns = [
      { speaker: 'Lenny', startSeconds: 0, startTimestamp: '00:00:00', text: 'Welcome to the show.' },
      { speaker: 'Lenny', startSeconds: 100, startTimestamp: '00:01:40', text: 'This episode is brought to you by Sprig.' },
      { speaker: 'Ada Chen Rekhi', startSeconds: 200, startTimestamp: '00:03:20', text: 'Real substantive content here.' },
    ]
    const chunks = chunkTurns(turns)
    const allContent = chunks.map((c) => c.content).join(' ')
    expect(allContent).not.toContain('brought to you by')
    expect(allContent).toContain('Real substantive content')
  })

  it('excludes continuation turns of a multi-turn ad read even without their own cue phrase', () => {
    const turns = [
      { speaker: 'Lenny', startSeconds: 0, startTimestamp: '00:00:00', text: 'Welcome to the show.' },
      { speaker: 'Lenny', startSeconds: 100, startTimestamp: '00:01:40', text: 'This episode is brought to you by Sprig.' },
      { speaker: 'Lenny', startSeconds: 130, startTimestamp: '00:02:10', text: 'Sprig helps you build better products, more filler ad copy here.' },
      { speaker: 'Ada Chen Rekhi', startSeconds: 200, startTimestamp: '00:03:20', text: 'Real substantive guest content.' },
    ]
    const chunks = chunkTurns(turns)
    const allContent = chunks.map((c) => c.content).join(' ')
    expect(allContent).not.toContain('more filler ad copy')
    expect(allContent).toContain('Real substantive guest content')
  })

  it('never splits a single turn across chunk boundaries', () => {
    const longText = 'word '.repeat(2000).trim()
    const turns = [
      { speaker: 'Lenny', startSeconds: 0, startTimestamp: '00:00:00', text: 'short intro' },
      { speaker: 'Ada Chen Rekhi', startSeconds: 10, startTimestamp: '00:00:10', text: longText },
      { speaker: 'Lenny', startSeconds: 500, startTimestamp: '00:08:20', text: 'short follow-up' },
    ]
    const chunks = chunkTurns(turns)
    const longTextChunk = chunks.find((c) => c.content.includes(longText))
    expect(longTextChunk).toBeDefined()
    expect(longTextChunk!.content).toContain(longText)
  })

  it('carries forward chunk metadata (timestamp, primary speaker, all speakers)', () => {
    const turns = [
      { speaker: 'Lenny', startSeconds: 0, startTimestamp: '00:00:00', text: 'Question.' },
      { speaker: 'Ada Chen Rekhi', startSeconds: 5, startTimestamp: '00:00:05', text: 'Answer with more detail than the question.' },
    ]
    const chunks = chunkTurns(turns)
    expect(chunks[0].startTimestamp).toBe('00:00:00')
    expect(chunks[0].primarySpeaker).toBe('Ada Chen Rekhi')
    expect(chunks[0].speakerNames).toEqual(['Lenny', 'Ada Chen Rekhi'])
  })

  it('keeps speaker tags inline in chunk content for attribution safety', () => {
    const turns = [
      { speaker: 'Ada Chen Rekhi', startSeconds: 0, startTimestamp: '00:00:00', text: 'My answer to the question.' },
    ]
    const chunks = chunkTurns(turns)
    expect(chunks[0].content).toContain('Ada Chen Rekhi (00:00:00):')
  })
})

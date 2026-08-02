export interface SpeakerTurn {
  speaker: string
  startSeconds: number
  startTimestamp: string
  text: string
}

export interface Chunk {
  chunkIndex: number
  primarySpeaker: string
  speakerNames: string[]
  startTimestamp: string
  startSeconds: number
  content: string
}

export interface Citation {
  guestName: string
  timestamp: string
  excerpt: string
  episodeId: string
  startSeconds: number
  // False when the citation could only be matched to a chunk by guest name,
  // not by the timestamp the model emitted — see lib/citations.ts. The UI
  // must not offer "open the transcript here" for these, since the chunk
  // backing them may be a different part of the episode.
  timestampVerified: boolean
}

export type ConfidenceBand = 'none' | 'low' | 'high'

// Transcript surrounding a cited moment, served by app/api/source for the
// source panel. Text is raw transcript straight from the DB, never model-written.
export interface SourceContextLine {
  timestamp: string
  speaker: string
  text: string
  isCited: boolean
}

export interface SourceContextResponse {
  lines: SourceContextLine[]
}

export interface ConversationTurn {
  question: string
  answer: string
}

export interface AskRequest {
  question: string
  sessionId: string
  recentTurns?: ConversationTurn[]
}

export interface AskResponse {
  answer: string
  citations: Citation[]
  confidenceBand: ConfidenceBand
}

// The /api/ask response body is newline-delimited JSON of these events —
// 'token' events stream the answer as it generates, then exactly one
// terminal event ('blocked' | 'none' | 'done' | 'error') closes the stream.
export type AskStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'blocked'; message: string }
  | { type: 'none'; message: string }
  | { type: 'done'; citations: Citation[]; confidenceBand: ConfidenceBand; disclaimer?: string }
  | { type: 'error'; message: string }

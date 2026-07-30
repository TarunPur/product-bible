// Fast, pre-LLM screen on the raw user question. Two separate concerns:
// profanity (reject with a fixed refusal message) and prompt-injection
// patterns (flagged so the caller can decide how to react — the actual
// injection defense is structural, in how lib/llm.ts frames retrieved
// context and the question as data, never instructions; this is a cheap
// first-line signal, not the whole defense).

const PROFANITY_PATTERNS = [
  /\bfuck(ing|er|s)?\b/i,
  /\b(bull)?shit(ty)?\b/i,
  /\bbitch(es)?\b/i,
  /\basshole(s)?\b/i,
  /\bcunt(s)?\b/i,
  /\bbastard(s)?\b/i,
]

const INJECTION_PATTERNS = [
  /ignore (all |the )?(previous|above|prior) instructions/i,
  /disregard (all |the )?(previous|above|prior) instructions/i,
  /you are now/i,
  /new instructions:/i,
  /system prompt/i,
  /act as (if you are|a)\b/i,
  /pretend (you are|to be)/i,
]

export function containsProfanity(text: string): boolean {
  return PROFANITY_PATTERNS.some((pattern) => pattern.test(text))
}

export function containsInjectionAttempt(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text))
}

export const PROFANITY_REFUSAL_MESSAGE = "We don't approve of such language."

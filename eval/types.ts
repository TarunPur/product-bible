export interface GoldenSetItem {
  id: string
  question: string
  // 'unanswerable' items exist outside the corpus entirely — the correct
  // retrieval behavior is to fail the confidence gate, not to match a guest.
  // 'adversarial' items test lib/moderation.ts instead of retrieval — the
  // correct behavior is being blocked before retrieval ever runs.
  category: 'answerable' | 'unanswerable' | 'adversarial'
  expectedGuests: string[]
  sourceFile?: string
  notes?: string
}

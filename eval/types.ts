export interface GoldenSetItem {
  id: string
  question: string
  // 'unanswerable' items exist outside the corpus entirely — the correct
  // retrieval behavior is to fail the confidence gate, not to match a guest.
  category: 'answerable' | 'unanswerable'
  expectedGuests: string[]
  sourceFile?: string
  notes?: string
}

export const QUESTION_THEMES = [
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

export const EXAMPLE_QUESTIONS: string[] = QUESTION_THEMES.flatMap((theme) => theme.questions)

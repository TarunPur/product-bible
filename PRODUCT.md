# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Playbook's corpus is drawn from Lenny's Podcast (Lenny Rachitsky's product/tech interview show, 600k+ YouTube subscribers), and its user base broadly mirrors that podcast's audience: product, tech, and design professionals at product and services companies globally, spanning 1–2 years of experience up to 15–20 years, roughly 25–44 years old. The podcast itself explicitly caters to product leaders, startup founders, and growth experts; its core listener base is Product Managers, software engineers, and tech marketers.

Within that pool, four segments use the product:
1. Freshers stepping into their first corporate role.
2. People trying to transition into product management and understand the discipline.
3. Experienced product/tech/design practitioners with an existing specific question.
4. People trying to understand AI's impact on their role or function.

Common thread across segments: some existing awareness of Lenny/the podcast, and a preference for a fast, specific answer over watching a 1.5–2hr episode.

## Product Purpose

"Playbook" is a RAG Q&A app over Lenny's Podcast's transcript archive (329 ingested episodes of product/design/tech executive interviews). A visitor asks a question and gets a synthesized, attributed answer instead of manually searching or listening through episodes. Success is a correct, well-cited answer delivered fast, or an honest "not covered" when the corpus doesn't support one.

## Positioning

**"Every answer, cited."** The differentiator against a generic podcast summarizer or transcript search tool is attribution safety, not just retrieval: every `[Guest, timestamp]` citation the model emits is validated against the chunks actually retrieved for that query (`lib/citations.ts`) and dropped if it doesn't match a real chunk. A retrieval-similarity confidence gate (threshold 0.5, `lib/retrieval.ts`) declines to answer rather than guess when a question falls outside the corpus. The product's core promise is "confidently wrong" and "misattributed quote" are the two failure modes it's built to refuse, not just avoid.

## Operating Context

Single-page, single-anonymous-session web app — no accounts, no login, no saved history across visits. A visitor types a question or picks a suggested prompt, watches a streamed synthesized answer arrive with numbered inline citations, and may ask follow-ups within the same session (conversation history considered for injection resistance, not for personalization). Typical use is a one-off research moment, not a recurring habit tool.

## Capabilities and Constraints

- 329/331 episodes ingested and searchable; 2 files (`Adriel Frederick.txt`, `Ryan Hoover.txt`) are permanently unparseable (different transcript format, no timestamps) — accepted, not fixed.
- No episode titles, air dates, EP numbers, guest roles/companies, or audio/video links exist anywhere in the source data — filenames are guest names only, some with ad-hoc disambiguation (`April Dunford 2.0.txt`). Any UI element implying a "play from timestamp" or episode metadata beyond guest name would need to be marked as not-currently-buildable or synthetic.
- Confidence is a 3-state band (`none` / `low` / `high`), not a numeric coverage score — real per-answer stats like "N of 329 episodes matched" are derivable from retrieval results at answer time, not available pre-answer.
- Rate-limited (3 req/min, 20/day per IP, fail-closed) and moderated (profanity blocked, injection attempts flagged/scrutinized) — real dollar cost per question (Voyage embed + up to 2 Claude calls), so the experience should not encourage reckless/rapid-fire querying.
- **Real traffic evidence**: as of 2026-08-07, "How do you know if you have product-market fit?" is by far the most-asked real question (9 times across 7 distinct real sessions) — the strongest repeated-intent signal in the data. Other real questions cluster around positioning and pricing.

## Brand Commitments

Name: **Playbook**. Tagline: **"every answer, cited."** Both are current and confirmed by Tarun as durable — this is a comparison exercise on the landing screen's design, not a rename or repositioning.

## Evidence on Hand

- Real example questions already live in `app/page.tsx`'s `QUESTION_THEMES` (3 themes × 3 questions each): Product & strategy, Hiring & teams, Growth & positioning — e.g. "How do you know if you have product-market fit?", "What's the best way to prep for a PM interview?", "How do you find the right positioning for a product?".
- Real headline/subhead copy already live: "Ask the people who *actually did the job.*" / "Every answer is assembled from what guests said on the record — attributed to the guest and the minute. This tool reports what was said; it doesn't verify claims or decide who's right."
- Real stat: `ARCHIVE_EPISODES = 329`, `ARCHIVE_INDEXED_THROUGH = 'Jul 2026'`.
- Real guest names surfaced via live citations in prior sessions: April Dunford, Nikita Bier, Jen Abel, Sarah Tavel, Nikhyl Singhal, and others across the 329-episode corpus.
- Existing live visual system (code evidence, not yet a confirmed binding constraint for this exercise): warm-neutral editorial palette in `app/globals.css` (`--color-page #fbfaf8`, `--color-ink #171614`, accent `oklch(0.45 0.11 250)`), Newsreader (serif) / Public Sans (sans) / JetBrains Mono (mono) via `next/font`, light-only, no dark mode.
- A prior hand-built comparison artifact exists (Tarun's own take on this landing screen, grounded in the real tokens above and real copy, using one verbatim April Dunford quote as its one added element) — the baseline this exercise is being compared against, not a spec to copy.
- Absences future work must not fabricate: no testimonials, no customer logos, no press, no pricing/plans (the app is free/unauthenticated), no audio.

## Product Principles

1. Attribution safety over cleverness — never let an interface imply certainty a citation doesn't support.
2. Don't fabricate: guest quotes, coverage stats, and citations must trace to something real; illustrative content is labeled synthetic.
3. Low-friction ask — no accounts, no setup, question-to-answer in one flow.
4. Prove the answer, don't just claim quality — citations and coverage make trust legible, not just asserted.
5. Single anonymous session by design, not by omission — no persistence across visits is a real constraint, not a TODO.

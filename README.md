# Lenny's Podcast Q&A

A RAG-based Q&A app over [Lenny's Podcast](https://www.lennysnewsletter.com/podcast)'s transcript archive. Ask a product/design/tech question and get a synthesized, attributed answer — with citations to the specific guest and timestamp it came from — instead of scrubbing through 1.5–2hr episodes.

Attribution safety is the core design constraint: every citation is matched to an exact speaker turn and timestamp in the retrieved transcript before it can be opened, and the answering model must declare whether the passages actually answer the question before any text is released. Answers that are partial, weakly grounded or not fully matched are labelled low confidence; unfinished ones are labelled incomplete.

## Stack

Next.js (App Router) + TypeScript, Supabase (Postgres + pgvector) for storage and vector search, Voyage AI for embeddings, Claude (Anthropic API) for synthesis and grading.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.local.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — Supabase project credentials
   - `ANTHROPIC_API_KEY` — Claude API key, used for synthesis and grading
   - `VOYAGE_API_KEY` — Voyage AI key, used for embeddings
   - `TRANSCRIPT_ARCHIVE_DIR` — local path to the transcript `.txt` archive (only needed for ingestion; not committed to the repo)
3. Apply the database schema against your Supabase project, in order:
   ```
   supabase/schema.sql
   supabase/002_match_chunks_function.sql
   supabase/003_add_flag_reason.sql
   supabase/004_add_rate_limits.sql
   supabase/005_enable_rls.sql
   ```
4. Run the dev server:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Standard Next.js dev/build/prod-serve |
| `npm test` | Run the unit test suite (Vitest) |
| `npm run ingest` | Parse and embed the transcript archive into Supabase (idempotent — safe to re-run) |
| `npm run fix-guest-names` | One-off sweep to correct `guest_names` on already-ingested rows, no re-embedding |
| `npm run golden-set:generate` | Generate additional golden-set Q&A items via Claude, sampled evenly across the corpus |
| `npm run eval` | Retrieval-only eval against `golden-set/golden-set.json` (fast, no Claude calls) |
| `npm run eval:natural -- dev` | Naturally worded and off-topic questions through the full answer path; see `eval/RESULTS.md` |
| `npm run examples:precompute` | Re-store the passages each homepage example retrieves |
| `npm run eval:full` | Full-pipeline eval (retrieval → synthesis → citations → groundedness → quality) against the golden set — costs real API credits, see the note below |
| `npm run eval:injection` / `eval:multiturn` | Adversarial eval — prompt-injection resistance, including multi-turn attacks via conversation history |

**`eval:full` costs real money** (~$0.025–0.03 per answerable item, 3 Claude calls each) — check the item count before running against the full golden set.

## Architecture

- `lib/transcript-parser.ts` — parses speaker-labeled, timestamped transcripts into turns and chunks
- `lib/query-plan.ts` — rewrites follow-ups into standalone questions and expands each question into search queries
- `lib/embeddings.ts` — Voyage client: a paced, retrying ingestion path and a separate fail-fast live path
- `lib/retrieval.ts` — vector search via the `match_chunks` Supabase RPC, merged across queries; stored passages for homepage examples
- `lib/llm.ts`, `lib/status-gate.ts` — Claude synthesis (streamed, held back until it declares ANSWER / PARTIAL / NONE) and groundedness grading
- `lib/citations.ts`, `lib/citation-tags.ts` — parses citations, verifies exact speaker and turn timestamp, checks quotations word for word
- `lib/request-validation.ts` — runtime validation and size caps for both API routes
- `lib/ask-client.ts` — browser stream reader that always ends in an answer, an error or an "incomplete" state
- `lib/moderation.ts` — pre-LLM profanity and prompt-injection screening
- `lib/rate-limit.ts` — per-IP request throttling (3/minute, 20/day) so a flood can't run up API costs
- `app/api/ask/route.ts` — the full pipeline: validation → rate limit → moderation → query planning → retrieval → relevance verdict → streamed synthesis → citation and quote checks → groundedness grade → query log
- `app/page.tsx` — the search UI
- `eval/`, `golden-set/` — the eval harness and hand-curated + LLM-generated golden question set (137 items as of the last update — answerable, out-of-corpus negatives, multi-guest, near-miss traps, and adversarial/injection cases)

## Known gaps

- 2 of 331 transcript files use a different, timestamp-less format and are skipped by the parser (`Adriel Frederick.txt`, `Ryan Hoover.txt`).
- When the embedding provider rate-limits or times out, a typed question gets a "busy" message rather than a long wait. Homepage examples don't call it.

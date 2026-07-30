const VOYAGE_MODEL = 'voyage-3.5'
const VOYAGE_ENDPOINT = 'https://api.voyageai.com/v1/embeddings'

// Voyage's free tier (no payment method on file) caps requests at 3/minute
// AND 10,000 tokens/minute — the token cap is the binding one for a corpus
// this size. Pacing to 3 requests spaced 21s apart, each under ~3000
// estimated tokens, keeps every rolling 60s window under both caps at once.
const TOKEN_BUDGET_PER_BATCH = 3000
const DELAY_BETWEEN_REQUESTS_MS = 21_000
const MAX_ITEMS_PER_BATCH = 50

let lastRequestAt = 0

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Rough heuristic (~4 chars/token for English) — good enough for pacing
// purposes; the retry-on-429 below covers any drift from Voyage's actual
// tokenizer.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function batchByTokenBudget(texts: string[]): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  let currentTokens = 0

  for (const text of texts) {
    const tokens = estimateTokens(text)
    const wouldExceed = current.length > 0 && (currentTokens + tokens > TOKEN_BUDGET_PER_BATCH || current.length >= MAX_ITEMS_PER_BATCH)
    if (wouldExceed) {
      batches.push(current)
      current = []
      currentTokens = 0
    }
    current.push(text)
    currentTokens += tokens
  }
  if (current.length > 0) batches.push(current)
  return batches
}

interface VoyageEmbeddingResponse {
  data: { embedding: number[] }[]
}

async function waitForRateLimit() {
  const elapsed = Date.now() - lastRequestAt
  if (elapsed < DELAY_BETWEEN_REQUESTS_MS) {
    await sleep(DELAY_BETWEEN_REQUESTS_MS - elapsed)
  }
  lastRequestAt = Date.now()
}

const MAX_RETRIES = 5

// Retries on 429 (rate limit) AND transient 5xx/network errors — an ~11min
// burst of ingestion failures turned out to be non-429 errors (likely a
// transient network/server blip) that weren't being retried at all, only
// the rate-limit case was. A network-level exception (fetch throwing rather
// than resolving with a bad status) needs the same treatment.
async function embedBatchWithRetry(texts: string[], inputType: 'document' | 'query', attempt = 1): Promise<number[][]> {
  await waitForRateLimit()

  let res: Response
  try {
    res = await fetch(VOYAGE_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: texts, model: VOYAGE_MODEL, input_type: inputType }),
    })
  } catch (err) {
    if (attempt > MAX_RETRIES) throw err
    const backoffMs = 15_000 * attempt
    console.warn(`  network error (${err instanceof Error ? err.message : String(err)}), retrying in ${backoffMs / 1000}s (attempt ${attempt}/${MAX_RETRIES})`)
    await sleep(backoffMs)
    return embedBatchWithRetry(texts, inputType, attempt + 1)
  }

  const isRetryable = res.status === 429 || res.status >= 500
  if (isRetryable && attempt <= MAX_RETRIES) {
    const backoffMs = 15_000 * attempt
    console.warn(`  request failed (${res.status}), retrying in ${backoffMs / 1000}s (attempt ${attempt}/${MAX_RETRIES})`)
    await sleep(backoffMs)
    return embedBatchWithRetry(texts, inputType, attempt + 1)
  }

  if (!res.ok) {
    throw new Error(`Voyage embeddings request failed: ${res.status} ${await res.text()}`)
  }

  const json = (await res.json()) as VoyageEmbeddingResponse
  return json.data.map((d) => d.embedding)
}

// Chunks are embedded as "document" inputs, questions as "query" inputs —
// Voyage's asymmetric input_type improves retrieval quality for this kind of
// question-against-passage search over embedding everything the same way.
export async function embedDocuments(texts: string[], onBatchDone?: (done: number, total: number) => void): Promise<number[][]> {
  const batches = batchByTokenBudget(texts)
  const results: number[][] = []
  for (const batch of batches) {
    results.push(...(await embedBatchWithRetry(batch, 'document')))
    onBatchDone?.(results.length, texts.length)
  }
  return results
}

export async function embedQuery(text: string): Promise<number[]> {
  const [embedding] = await embedBatchWithRetry([text], 'query')
  return embedding
}

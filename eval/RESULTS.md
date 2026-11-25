# Evaluation summary

Counts only; no transcript text or visitor questions. Each block is dated and describes the version of that date.

## July 2026: retrieval plus a similarity gate

Golden set, 123 answerable questions. A question passed when an expected guest was retrieved **and** the top similarity cleared a fixed 0.5 gate.

| Source | Passed |
|---|---|
| LLM-written | 100 / 100 |
| Hand-written | 20 / 23 |
| **Total** | **120 / 123** |

Limit: the LLM-written questions were generated from stored passages and most name the guest, so this overstated how naturally worded questions would do.

## October 2026: four chunking strategies

46 episodes, the same 123 questions. Finding the right episode was effectively tied (first result 97.6% to 98.4%, top five 100% for all). What differed was whether the top result's words could be fully attributed to a labelled speaker: 100% for whole speaker turns (used in production) versus 18.7% for fixed-size chunks. Differences of a few questions are directional only.

## 25 November 2026: query planning plus a relevance verdict

The 0.5 gate was replaced. On similarity alone, real questions scored as low as 0.43 and an off-topic one 0.47; after query expansion, off-topic reached 0.62 while real ones went down to 0.55. No cutoff separates them. Now the answering model reads the passages and must declare ANSWER, PARTIAL or NONE before text is released.

| Check | Result |
|---|---|
| Golden set, expected guest retrieved (no similarity cutoff, up to 12 passages) | 121 / 123 |
| Natural questions, development set: answered | 18 / 18 |
| Natural questions, development set: off-topic answered | 0 / 10 |
| Natural questions, holdout (run once, after tuning): answered | 17 / 17 |
| Natural questions, holdout: off-topic answered | 0 / 11 |
| Answers cut off (development + holdout) | 0 / 56 |

The 120 / 123 and 121 / 123 figures use different pass rules and shouldn't be read as an improvement of one question. "Answered" means the system judged that the passages answer the question; these runs did not score answer quality. All sets were written by the developers, not sampled from visitors.

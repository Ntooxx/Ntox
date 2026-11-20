# NTOX Highlights

Measured results from the NTOX evaluation programs. Each section links the full
report; all numbers are copied from those reports, not retyped estimates.

## Evaluation harness

```bash
npm run eval:necessity          # Deterministic mechanism checks (no LLM)
npm run eval:longitudinal       # Cross-turn learning slope per subsystem
npm run bench:alive             # ALIVE-1: trained vs fresh instance
npm run bench:m5                # Full M5: identity, transfer, voice A/B
npm run eval:offline-recall     # Synonym recall@5: local-hash vs local MiniLM
npm run eval:injection          # Adversarial bypass + benign false-positive rate
npm run eval:skill-author       # Self-authored skill rubric acceptance
npm run scorecard               # Read-only aggregator over all five metrics
npm run e2e:live                # Opt-in end-to-end reembed + semantic skill checks
```

**First powered result** (deepseek-v4-flash, 30 tasks):

- Necessity checks: **6/6 passed**
- Longitudinal `off` vs `all`: delta = +0.200, 95% CI [0.067, 0.350], **significant**
- Mechanism: cross-session episodic retrieval

## Experience-guided recall (2026-10-26)

Corpus: 306 real episodes from a live `episodes.jsonl`; 42 authored paraphrase
queries with ground truth; real embedding API calls
(`titan-embed-text-v2`, `text-embedding-3-small`).

Full report: [`scripts/experiments/results-2026-10-26.md`](scripts/experiments/results-2026-10-26.md)

Retrieval accuracy (all queries, n=42):

| arm | R@1 | R@5 | MRR@5 |
|---|---|---|---|
| NTOX current (stored vectors + BM25 hybrid) | 66.7% | 76.2% | 0.710 |
| NTOX local fallback | 52.4% | 66.7% | 0.581 |
| Titan V2 cosine | 90.5% | 100.0% | 0.941 |
| Titan V2 + BM25 hybrid | 61.9% | 76.2% | 0.673 |
| BM25 only | 45.2% | 66.7% | 0.544 |

Lexically disjoint queries (n=11) — where semantics matter most: Titan cosine
**72.7% R@1 / 100% R@5** vs NTOX current **18.2% / 18.2%**.

Token efficiency: retrieval top-5 injects ~121-142 tokens/turn vs 2,053 for
"inject 50 recent" and 7,857 for "inject all". Measured embed latency: Titan
372 ms p50, `text-embedding-3-small` 570 ms p50, local hash 0 ms at $0.

## Does better recall improve task success? (2026-10-26/27)

6 knowledge tasks whose answers exist only in seeded memory episodes, plus 4
controls; 4 memory conditions in isolated states; frozen command checks.

Full report: [`scripts/experiments/results-phase2-2026-10-26.md`](scripts/experiments/results-phase2-2026-10-26.md)

| condition | knowledge (of 6) | controls (of 4) | mean tokens/trial | cost |
|---|---|---|---|---|
| fresh (memory off) | 0/6 | 4/4 | 43,211 | $0.0615 |
| current, pre-fix | 2/6 | 4/4 | 112,453 | $0.1586 |
| titan-pure, pre-fix | 1/6 | 4/4 | 72,140 | $0.1021 |
| current + outcome payload | **3/6** | 4/4 | 43,962 | $0.0625 |
| titan-pure + outcome payload | **4/6** | 4/4 | 42,501 | $0.0606 |

Key findings:

- **Necessity confirmed:** 0/6 without memory; agents refuse to invent values.
- **The payload was the bottleneck:** recall injected each episode's question
  but never its outcome. Adding outcome-bearing recall roughly doubled task
  passes at ~60% fewer tokens per trial.
- Cost per knowledge pass fell ~5x ($0.079 -> $0.015) after the payload fix.
- Controls stayed 4/4 in every condition: memory never degrades ordinary work.
- All incidents (dimension-mismatch bug, shell-escape channels, workspace
  crashes) are disclosed in the full report with the fixes applied.

## Phase 3 preflight (2026-10-27)

Integrity gates for the procedural-learning harness: signer isolation, version
binding, reuse accounting, promotion gate, policy accounting, arm
comparability, frozen fixtures — **7/7 passed** (30-task fixture suite,
sha256-pinned). Report: [`scripts/experiments/phase3/preflight-report.md`](scripts/experiments/phase3/preflight-report.md).

Note: the preflight certifies that pre-execution blockers are closed;
experimental execution is gated separately.

## ALIVE-1 baseline (2026-10-18)

First benchmark run of the alive engine (1 turn, baseline fingerprint):

| Metric | Value |
|--------|-------|
| Correction recurrence | 0 |
| Calibration ECE | 0.25 |
| Identity divergence | 0.3375 |

Report: [`experiments/alive/2026-10-18-baseline.md`](experiments/alive/2026-10-18-baseline.md).

## Road to 9 (2026-11-20)

Frozen starting point and criteria: [`experiments/review/scorecard-8.md`](experiments/review/scorecard-8.md).
Live-E2E log: [`experiments/review/e2e-live.md`](experiments/review/e2e-live.md).
The read-only aggregator reports **5 of 6 criteria met**; `ci-green-rate` is
unavailable from a local checkout and requires the Actions API.

| Metric | Baseline | Measured (all) | Measured (holdout) | Target | Result |
|---|---|---|---|---|---|
| Offline synonym recall@5 | 40.0% (`local-hash`) | **96.7%** (`local-minilm`, 384-d, `Xenova/all-MiniLM-L6-v2`), +56.7 pp | **100.0%** vs 50.0%, **+50.0 pp** (n=18 queries) | ≥ +15 pp | met |
| Exact-match recall@5 | 100.0% | 100.0% | 100.0% | no regression | met |
| Injection bypass / benign FP | 29.6% / 12.5% (regex guard) | **0.0% / 0.0%** (54 adversarial + 24 benign) | **0.0% / 0.0%** (15 adversarial + 9 benign) | < 5% / < 1% | met |
| Self-authored skill acceptance | — | **100%** (12/12, deterministic harness) | not split (synthetic) | ≥ 80% | met* |
| Tests / coverage | 1,654 tests | **1,687 tests**, lines **64.22%**, functions **67.01%** | — | > 0, ≥ 62 / 65 | met |
| CI green rate (last 20) | — | unavailable locally | — | ≥ 95% | not measured |

The metrics are scored on a **fixed tuning/holdout split** (`scripts/lib/corpus-split.mjs`,
30% holdout assigned deterministically by case id, frozen before the number was
reported). This prevents re-tuning a detector against the whole authored set and
still passing. It is **not** independent validation: the corpora remain
author-generated, so the holdout is not a third-party benchmark and the 0.0%
injection result should not be read as real-world coverage (\`m34\` in the corpus
was corrected after review).

\* The acceptance number uses a synthetic provider and measures authoring
plumbing and rubric conformance, not model-written quality. A live-provider
acceptance run is required before the independent re-score.

Offline E2E (temporary directories, no live provider or personal data): reembed
dry-run flagged 3/3 mismatches, the real run migrated 3/3 with a backup, a
second run was a true no-op, and a new-model query retrieved a pre-migration
entry. A zero-keyword-overlap query selected the correct bundled skill through
MiniLM embeddings while `local-hash` correctly fell back to keyword matching.
Live self-authoring and the REPL smoke remain opt-in because no provider key is
available in this environment; the harness skips them explicitly rather than
reporting a hollow pass.

# NTOX Highlights

Measured results from the NTOX evaluation programs. Each section links the full
report; all numbers are copied from those reports, not retyped estimates.

## Evaluation harness

```bash
npm run eval:necessity          # Deterministic mechanism checks (no LLM)
npm run eval:longitudinal       # Cross-turn learning slope per subsystem
npm run bench:alive             # ALIVE-1: trained vs fresh instance
npm run bench:m5                # Full M5: identity, transfer, voice A/B
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

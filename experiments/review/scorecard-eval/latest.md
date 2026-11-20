# NTOX Capability Scorecard

Run: 2026-11-19T23:13:02.334Z · suite: ntox-capability-scorecard-v1 · sha256: 8d43c4e000e4… · mode: deterministic-offline

## Method

Fixed tasks, fixed weights, fixed scoring rules. All probes are deterministic and offline:
an isolated temporary `NTOX_DIR`, provider API keys cleared, a synthetic skill provider,
and the local-hash embedder. No agent self-report is used as evidence.

Dimension score = weighted mean of measured task scores × 10 (0–10).
Total = weighted mean of dimension scores, renormalised over measured coverage (0–100).
Optional artifacts that are absent are excluded and reduce coverage, not the score.

## Dimensions

| Dimension | Weight | Coverage | Score /10 | Weighted contribution |
|---|---:|---:|---:|---:|
| Memoria cross-session & recall | 20 | 100% | 6.8 | 13.5 |
| Apprendimento / self-correction | 20 | 100% | 10.0 | 20.0 |
| Auto-creazione & riutilizzo skill | 12 | 100% | 10.0 | 12.0 |
| Runtime agentico & tool | 12 | 100% | 10.0 | 12.0 |
| Provider multipli / local-first | 10 | 100% | 10.0 | 10.0 |
| Multi-canale & deployment | 8 | 100% | 10.0 | 8.0 |
| Osservabilità & eval dedicate | 10 | 100% | 10.0 | 10.0 |
| Sicurezza & sandboxing | 8 | 100% | 10.0 | 8.0 |

**Total: 93.5/100 — grade A — measured coverage 100%**

## Tasks

| Dimension | Task | Score | Detail |
|---|---|---:|---|
| memory | m1-recall | 0.50 | retrieved 3/6 frozen facts at R@5, threshold 0.5 |
| memory | m2-gating | 1.00 | enabled memoryIncluded=true factPresent=true; disabled memoryIncluded=false |
| memory | m3-offline-recall | 0.87 | results.local-hash.recallAt5=0.7 (atLeast 0.8); artifact 2026-11-19T23:09:35.095Z |
| learning | l1-correction | 1.00 | enabled correctionIncluded=true correctionsBeforeMemories=true; disabled leak=false |
| learning | l2-false-success | 1.00 | surface flagged=true; deep flagged=false; recorded gap=9 |
| learning | l3-kernel | 1.00 | disabled=0 chars; target=pat_seed_software-dev; after reinforcement=151 chars |
| learning | l4-pattern | 1.00 | sightings returned pattern at 3rd=true; compiled=true; compiledTemplates=1 |
| skills | s1-author | 1.00 | 12/12 rubric-accepted, 12/12 authored |
| skills | s2-plumbing | 1.00 | 4/4 exports present; missing: none |
| runtime | r1-exports | 1.00 | 15/15 exports present; missing: none |
| providers | p1-embed-offline | 1.00 | model=local-hash, dim=256, keys cleared |
| providers | p2-provider-list | 1.00 | 10/10 tokens present; missing: none |
| channels | c1-surfaces | 1.00 | 9/9 files; missing: none |
| observability | o1-scripts | 1.00 | 7/7 scripts; missing: none |
| observability | o2-trace | 1.00 | sections=1, promptChars=86, diagnostics=6 |
| security | x1-bypass | 1.00 | results.defense-in-depth.bypassRate=0 (atMost 0.05); artifact 2026-11-19T23:12:01.314Z |
| security | x2-false-positive | 1.00 | results.defense-in-depth.falsePositiveRate=0 (atMost 0.01); artifact 2026-11-19T23:12:01.314Z |
| security | x3-sensitive-paths | 1.00 | 6/6 tokens present; missing: none |

## Reference baselines (NOT measured by this eval)

The following scores are qualitative estimates from the earlier comparison, not outputs
of this harness. They are pinned in the suite only to keep the report reproducible.

| Agent | Total | Nature |
|---|---:|---|
| Ntox (earlier qualitative estimate) | 78.0 | qualitative, not measured here |
| Letta / MemGPT (qualitative estimate) | 62.0 | qualitative, not measured here |
| Claude Code (qualitative estimate) | 51.0 | qualitative, not measured here |

## Caveats

- Capability-exports, source-contains, files-exist and package-scripts measure the presence of a capability, not its quality, ecosystem or adoption.
- The skill-author probe uses a synthetic provider: it measures authoring plumbing and rubric conformance, not model-authored quality.
- Memory recall includes three exact-cue and three lexically disjoint paraphrase queries; the latter probe the documented offline embedding weakness.
- The total measures capability conformance, not the earlier qualitative 78/100, which also penalised ecosystem maturity and adoption.
- Artifact-backed tasks depend on measurement files under `experiments/review/measurements/`; their `generatedAt` is recorded in the JSON report.
- The total is a score over the declared dimensions, not an independent third-party benchmark.

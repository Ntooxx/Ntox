# Scorecard 8/10 — frozen baseline (2026-11-19)

This file freezes the starting point for the Road to 9 plan. It is the single
reference for the independent re-score in Phase 6. Numbers below are produced by
`node scripts/verify-scorecard.mjs` and its measurement commands — none are
hand-maintained.

## Verdict

**8/10** (independent review, 2026-11-19). Engineering hygiene is at the ceiling:

- `npm run verify:all` green **13/13** (typecheck, lint, size budget, tests, build,
  format, pack dry-run, CLI help, cognition artifact smoke, 4 adapter checks).
- Test count **1654**, test files **140** (latest `experiments/verification/report.json`).
- Coverage ratchet: **lines 64.22%**, **functions 67.01%** (thresholds 62 / 65,
  never lowered). Source: `coverage/coverage-summary.json`.
- CI matrix on Node **18 / 20 / 22**, advisory `npm audit --audit-level=high`,
  size budget, Dependabot.
- The remaining point is **capability honesty at the product level**, not more tooling.

## The 7 original review findings and their current status

Extracted from the 2026-11-19 review baseline recorded in
`.kilo/plans/road_to_good.md`. All seven were addressed by the Road to Good
remediation; the statuses below record *what was actually shipped*.

| # | Original finding | Road to Good fix | Status |
|---|---|---|---|
| 1 | `agent.ts` was a 2,833-line monolith | Extracted `src/core/turn/*`; `agent.ts` ≤ 800; size budget enforces ≤ 600 default / allowlist caps | **Closed** |
| 2 | `HIGHLIGHTS.md` referenced but missing | Created with reports-linked measured results; listed in `package.json.files` | **Closed** |
| 3 | README claims unverified (test badge, "107 skills", "17 categories", self-link, memory claim) | Counts recounted, badge sourced from CI, support matrix added, memory wording finalised | **Closed** |
| 4 | Mixed embedding provenance with silent model-mismatch skip and no migration | `EmbeddingService` + provenance tags + skip stats + `ntox memory reembed` (backup, batch, idempotent) | **Closed** (migration path exists; semantic *offline* recall still weak → Phase 2) |
| 5 | Injection check ran after history push; `sanitizeInput` dead code | Risk-tiered guard before history push; structural blocks, phrases sanitize+warn; `/trace` warnings | **Closed** (regex-tiered only → Phase 3) |
| 6 | Gateway tests split across two locations and excluded from coverage | Unified into `src/gateway/`, coverage exclusion removed, no tests deleted | **Closed** |
| 7 | Weak quality gates (low coverage, lint only `src/`, no audit/Dependabot, hard-coded badge, 12 checks) | Coverage ratchet 62/65, widened lint, Dependabot + advisory audit, source-derived badge, `verify:all` 13 checks | **Closed** |

## Criteria for 9/10

The independent re-score reaches 9 only when every criterion below is **measured**
and meets its target. A criterion with `status: unavailable` is not met.

| Metric | Target | Baseline value | Reproduce command |
|---|---|---|---|
| `offline-recall` | synonym recall@5 delta ≥ **+15 pp** vs `local-hash`, exact-match recall no lower | `local-hash` synonym **40.0%**, exact **100.0%** | `npm run eval:offline-recall` |
| `injection-bypass` | bypass **< 5%** on adversarial corpus, false-positive **< 1%** on benign corpus | bypass **29.6%** (16/54), FP **12.5%** (3/24), regex guard | `npm run eval:injection` |
| `skill-author-accept` | quality-rubric acceptance **≥ 80%** on held-out struggle set | **100%** (12/12, deterministic harness — live quality pending) | `npm run eval:skill-author` |
| `test-count` / `coverage` | tests > 0; coverage lines ≥ **62%**, functions ≥ **65%** (never lowered) | tests **1654**; lines **64.22%**, functions **67.01%** | `npm run verify:all` / `npm run coverage` |
| `ci-green-rate` | last 20 CI runs ≥ **95%** green | unavailable locally (requires `gh` / Actions API) | `node scripts/verify-scorecard.mjs --refresh-ci` |

## Measurement artifacts

All artifacts live in `experiments/review/measurements/` and are tracked (the
`experiments/*` gitignore rule has an explicit `!experiments/review/` exception):

- `synonym-set.json` — 30 labeled snippets, 60 queries (30 synonym, 30 exact).
- `injection-corpus.json` — 54 adversarial cases + 24 benign FP cases.
- `offline-recall.json`, `injection-bypass.json`, `skill-author-accept.json` —
  per-metric results, updated by the measurement commands.
- `ci-runs.json` — optional last-20 CI conclusions; absent until refreshed from Actions.

`experiments/review/baselines.json` is written once on first aggregation and holds
the frozen baseline values. `experiments/review/scorecard-results.json` is
regenerated on every aggregation.

The offline-recall command needs the optional `@huggingface/transformers`
dependency and a first-run model download (`Xenova/all-MiniLM-L6-v2`, q8). It
is intentionally **not** a declared dependency: install it locally with
`npm install --no-save @huggingface/transformers` when reproducing the semantic
metric. Without it, `npm run eval:offline-recall` still measures `local-hash`
and reports `local-minilm` as `unavailable` — it never blocks startup or CI.

## Honesty note

The `skill-author-accept` baseline uses a deterministic synthetic provider, so it
verifies authoring plumbing and rubric conformance, not model-authored quality.
A live-provider acceptance number is produced by Phase 1 and must replace the
baseline before the independent re-score. `ci-green-rate` cannot be measured from
a local checkout; it is recorded as unavailable, not inferred.

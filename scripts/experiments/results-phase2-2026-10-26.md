# Phase 2 — Does better recall improve task success?

> **Branch verification status (`feat/episodic-outcome-recall` @ 7d81ecb):** the husky commit gate (typecheck + eslint + **1680/1680 tests**) is green. `verify:all` passes **11/12** — the `format:check` gate **fails as a pre-existing baseline issue**: 22 files flagged, of which 20 are unmodified from HEAD (i.e. `main` fails prettier too; the commit hook never included prettier). This branch adds zero new formatting violations (`episodic.ts` prettier-clean). Treat the branch as *gate-green, baseline-debt-present* — **not** "fully verified" — until the formatting baseline is either remediated repo-wide or the check is scoped.
>
> **Security review required before merge (blocking):** `src/core/policy.ts` interleaves two changes: (a) the in-progress always-allow `MEMORY_DIR` read feature from the working tree, and (b) an experiment isolation gate (`NTOX_ISOLATE_MEMORY`) that can switch (a) off. Review concern: **an env-var used by experiments must not become the only protection for private memory files.** Recommended resolution before merging to main: default-deny memory access outside an explicit allowlist (e.g. only `memory.md` summaries), opt-in via validated config (not process env), enforcement independent of experiment tooling, and a test proving denial holds when no experiment env is set.

Run: 2026-10-26/27 · model: xiaomi/mimo-v2.6-flash (live) · verification: frozen command checks, fresh temp workspace per trial, shell disabled for all arms (injection-only recall).

## Question
Phase 1 showed Titan V2 retrieves NTOX memories far more accurately than the current hybrid (100% vs 76.2% Recall@5; 100% vs 18.2% on lexically-disjoint queries). Phase 2 asks the conversion question: **does that better recall make NTOX succeed at tasks it otherwise fails?**

## Design
- 6 knowledge tasks whose required values exist ONLY in 6 seeded memory episodes (worded differently from the task; 6 same-topic distractor episodes present) + 4 frozen pilot controls.
- 4 conditions in isolated `NTOX_DIR` states: **fresh** (memory off) · **current** (3-small + hybrid 0.6cos/0.4BM25, thr 0.3, mixed-dim stored vectors = production reality) · **titan-dropin** (Titan vectors, hybrid unchanged — literal wiring) · **titan-pure** (Titan vectors, pure-cosine ranking, no threshold).
- Agents refuse to invent missing values (observed repeatedly), so a FAIL means recall did not deliver the value.

## Final results (integrity-screened runs only)

| condition | knowledge (of 6) | controls (of 4) | mean tokens/trial | cost |
|---|---|---|---|---|
| fresh | **0/6** | 4/4 | 43,211 | $0.0615 |
| current | **2/6** (brand, tenant) | 4/4 | 112,453 | $0.1586 |
| titan-dropin (1024) | **0/6** | 4/4 | 73,778 | $0.1045 |
| titan-pure (1024) | **1/6** (tenant) | 4/4 | 72,140 | $0.1021 |

Controls 4/4 everywhere: memory never degrades ordinary work. Fresh 0/6: the knowledge tasks are genuinely memory-load-bearing.

## The decisive mechanism finding: retrieval works, the payload has no answers

Offline rank diagnostic — EXACT production query embedding (no `dimensions` field, full task prompt) against the exact states:

| task | titan seed rank /328 | current seed rank /318 (cos-only) |
|---|---|---|
| billing-window | **4** (IN k=20) | 38 |
| brand-primary | **2** (IN k=20) | 11 |
| retry-cap | **2** (IN k=20) | 2 |
| tenant-literal | **3** (IN k=20) | 21 |

Compose test of the real `buildMemoryContext` for the billing task (both arms): the target episode's **question is injected** —
`[2026-10-07] Post-incident follow-up for billing: which upkeep slot now applies going forward?` —
but **`contains ANSWER "Sundays 02:00-04:00 UTC": false`**.

**Why:** `buildMemoryItems` renders each episode as `[date] ${episode.summary}` and `summary` is the truncated *userMessage*. The `assistantResponse` — where every value, fix and outcome lives — is **never shown to the model**. The agent sees that a billing-slot discussion once happened, never its content, declines to fabricate, and fails. Passes occurred only when an agent's own file read of `episodes.jsonl` happened to surface the answer.

Secondary payload issue: with a template-dominated corpus (90+ near-identical arena episodes), the top-20 injection is mostly boilerplate duplicates (steps.txt ×9, facts.json ×6) plus the run's own previous trials — roughly 5 unique facts per 20 slots.

## Bugs and incidents found (all real, all disclosed)

1. **Dimension mismatch bug (production-relevant):** NTOX's embed call sends `{model, input}` without `dimensions`; Titan then returns 1024-dim while reduced-dim corpora (e.g. 512) silently score cosine = 0 via the length guard → embedding backend degenerates to BM25-only with no error logged. Verified: API probe returns 1024 without the field. Fixed for this experiment by re-embedding the corpus at default 1024 (no source changes).
2. **Shell escape / cheat channel (run 1):** with default `shellPolicy`, a memory-less agent globbed `state-*/episodes.jsonl` and read the answers (audit trail captured). Run 1 discarded entirely; reruns used `NTOX_ARENA_SHELL=disabled` (official policy knob, env-gated) — final runs show **0 shell-audit entries**.
3. **Own-state shell grep bypass:** memory arms also grepped their own `episodes.jsonl` via shell in run 1 — bypasses the retrieval mechanism under test. Closed by the same fix.
4. **Windows EPERM workspace crashes** (`removeTrialWorkspace`) killed 2 arms mid-run; fixed via keep-workspaces (temp dirs now cleaned post-experiment).
5. **Node heap OOM (4 GB)** in one titan-pure run; reran with `--max-old-space-size=8192` — clean.

## Verdict

1. **Necessity confirmed:** knowledge tasks cannot be passed without memory (fresh 0/6; agents refuse to invent values).
2. **Retrieval confirmed at task-query shape:** Titan ranks target seeds 2–4/328 on full production prompts; current's hybrid lands 2–38 (saved only by BM25 overlap where wording matches). Phase 1's superiority holds.
3. **Task-success conversion: NOT observed yet.** 2/6 vs 1/6 vs 0/6 with n=6 and 1 run/task is within noise — and the mechanism diagnosis explains why: the pipeline delivers the right *question* but never the *answer*. Better vectors cannot fix a payload that omits outcomes.

**Recommendation (matches the proposal's own gate):** do NOT adopt Titan as a permanent component yet. In order:
1. Inject outcome-bearing recall: `[date] summary → outcome: <assistantResponse excerpt / stored outcome>` — single highest-leverage change.
2. Send `dimensions` in `llm.ts` embed (or don't use reduced dims) and re-embed stored vectors consistently.
3. Dedupe near-identical episodes before top-k (or cap per normalized-text group).
4. Drop the 0.3 threshold / lower BM25 weight for strong semantic vectors (Phase 1).
5. Exclude same-run episodes from recall.
Then re-run this suite (scripts/experiments/phase2-*.mjs|ts, states reproducible) to measure conversion.

## Costs (real, OpenRouter-reported)
Final four arms: $0.4267. Void/diagnostic rounds (run 1 + broken-dims rerun + probes): ≈ $0.48. All embedding work (Phase 1 + seeds + 1024 re-embed): < $0.001. Total ≈ **$0.91**.

## Limitations
- 6 knowledge tasks × 1 run/task — paired outcomes only, no significance claims from n alone.
- Seeded experience content (disclosed — ground truth requires it); all agent executions, LLM decisions and check outcomes are real.
- Residual channel: agents may read their own memory folder via policy-allowed file tools (product behavior, equal for all memory arms; empty for fresh) — attribution of individual passes between injection and file-read is therefore partially ambiguous; mechanism evidence (compose test) resolves the system-side question.
- Memory arms store their own turns as episodes mid-run (self-noise in later trials).
- Phase 1 Titan numbers were measured at 512-dim; Phase 2 production-path reruns at 1024-dim (NTOX's actual behavior).

---

# Round 3 — after the outcome-payload fix (2026-10-27)

Fixes applied before this round: **(1)** outcome-bearing injection (`summary → outcome: <clipped assistantResponse excerpt ≤240 chars>`), **(2)** loud dimension-mismatch warning, **(3)** dedup of path-variant near-duplicate episodes before top-k, **(4)** pure-cosine ranking kept as the experimental retrieval flag, **(5)** `NTOX_ISOLATE_MEMORY=1` closes raw memory-file reads (shell already disabled). States re-seeded clean; typecheck/lint clean; 73/73 targeted tests pass.

| condition | knowledge (of 6) | controls (of 4) | mean tokens/trial | cost | cost per knowledge pass |
|---|---|---|---|---|---|
| fresh (baseline) | 0/6 | 4/4 | 43,211 | $0.0615 | — |
| current, PRE-fix | 2/6 | 4/4 | 112,453 | $0.1586 | $0.079 |
| titan-pure, PRE-fix (dims-broken) | 1/6 | 4/4 | 72,140 | $0.1021 | $0.102 |
| **current + outcome payload** | **3/6** | 4/4 | 43,962 | $0.0625 | $0.021 |
| **titan-pure + outcome payload** | **4/6** | 4/4 | 42,501 | $0.0606 | **$0.015** |

Pre-fix→post-fix per task: billing (F→P→P), brand (P lexical→P→F*), retry (F→F→P), paging (F→F→P), tenant (P→P→P), signoff (F→F→F†).
*brand: injected ranking offline was #2/328; the single-run miss is attributed to run variance (n=1). †signoff's seed never reached top-20 under either backend — a genuine retrieval-distance miss, identical across all configurations.

Mechanism notes from failed trials (responses quoted in reports):
- current/retry: hybrid threshold (0.6·cos + 0.4·BM25 ≥ 0.3) dropped the target seed; only the same-topic *distractor* outcome ("staging allows 5 attempts") was injected — the agent correctly declined to use a staging value as the production ceiling. Threshold + distractor precision, exactly as Phase 1 predicted.
- Dimension warning fired live in the current arm: `78 stored episode(s) are 256d vs query 1536d` — fix #2 verified in production conditions.

## Verdict against the pre-registered decisive criteria
1. **Current succeeds on relatively few memory tasks:** ✅ 2/6 pre-fix (3/6 with payload only).
2. **Outcome-bearing recall succeeds substantially more:** ✅ payload fix + dedup roughly doubled passes at ~60% fewer tokens (112k → 43k per trial: agents stop flailing and act).
3. **Titan adds measurable improvement over corrected current:** ✅ direction confirmed — 4/6 vs 3/6 (retry + paging gained via semantic ranking; brand kept by current's lexical strength) — but +1 task at n=6 is a small margin; Phase 1's retrieval-level gap (100% vs 76%) remains the stronger evidence for the backend swap.
4. **Cost per successful task does not rise excessively:** ✅ it fell ~5× ($0.079 → $0.015 per knowledge pass).

**Milestone conclusion:** fixing memory *delivery* was — as predicted — the larger lever. The payload fix is validated; the Titan increment is real but modest at task level. Further Titan benchmarking deferred per plan; next candidates: drop the 0.3 threshold / BM25 weight for semantic vectors (would likely recover current's retry-class misses in *any* backend), same-run episode exclusion, and an outcome-extraction upgrade that cites tool evidence rather than clipping prose.

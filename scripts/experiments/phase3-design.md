# Phase 3 — Verified Procedural Memory (research design)

Status: **design + minimal implementation behind `proceduralMemoryEnabled` (default false) — modules open for source review; harness not yet wired.**
Preceded by: Phase 1 (retrieval, `results-2026-10-26.md`), Phase 2 (outcome payload, `results-phase2-2026-10-26.md`).

## 1. Question and hypothesis

Phase 2 showed NTOX must remember *what happened* (outcome-bearing episodic recall: 0/6 → 4/6 knowledge tasks, ~5× lower cost per success). Phase 3 asks the next question:

**Does NTOX that remembers what it successfully *did* — as a verified, reusable procedure — succeed on related but unseen tasks, including in a fresh environment, beyond what episodic memory alone provides?**

Hypotheses (pre-registered):
- H1: verified procedural memory (arm C) > ordinary episodic memory (arm B) > no procedural memory (arm A) on transfer-task success.
- H2: gains hold in a *fresh environment* (different workspace, paths, fixture values) — i.e. a parameterized procedure was learned, not a memorized answer.
- H3: incorrect reuse (applying an inapplicable procedure) stays rare in arm C — applicability checks, not LLM confidence, gate reuse.
- H4: cost per successful transfer task does not exceed arm B by more than 20% (frozen gate §6.1 #6).

## 2. The loop under test

1. NTOX solves an unfamiliar task and records actions + tool evidence.
2. It extracts a reusable procedure with explicit prerequisites.
3. It tests the procedure in a fresh environment.
4. It stores the procedure as a *candidate skill* with its verification evidence.
5. On a related but unseen task, it retrieves the skill, checks applicability, attempts reuse.
6. A failed reuse causes revision, restriction, or rejection.

## 3. Conditions (three arms, isolated `NTOX_DIR` each)

| arm | memory surface |
|---|---|
| A — none | procedural store empty; episodic disabled (fresh baseline) |
| B — episodic | Phase-2 outcome-bearing episodic recall only (no procedure store) |
| C — verified procedural | arm B + procedure store + applicability-checked reuse |

All other surfaces identical: model, config, policy profile, frozen checks, shell state, seeds.

## 4. Architecture: the procedure store (design)

- **Artifact**: candidate skill = markdown procedure + machine-readable sidecar (JSON): parameterized steps (**parameters declared as `{{name}}` references with `learnedValue` provenance from the learning environment — reuse in a fresh environment requires fresh bindings, §6.2**), **prerequisites as executable checks** (command/path/feature probes with expected results), scope statement (when it applies / does not apply), and verification evidence record: `{envFingerprint, taskId, checkOutputs, timestamps, harnessSignature}` where `harnessSignature` is an **HMAC-SHA256 over the canonical content with a harness-held key** (`NTOX_DIR/procedures/.harness.key`, mode 0600).
- **States**: `candidate → verified → restricted | rejected`, driven by reuse history (step 6), never by self-report.
- **Retrieval**: embedding over procedure text (Titan-cosine candidate backend from Phase 1, or current hybrid — arm C decides at freeze), ranking raised/lowered by verification state and reuse history.
- **Applicability check**: prerequisites are *executed* before reuse; a failed prereq ⇒ no attempt. LLM prose opinion about applicability is advisory at most.

## 5. Architectural rule (non-negotiable)

> **No skill acquires execution authority because an LLM generated it or a previous task succeeded.**

Enforced as:
1. Skills carry **zero permission fields** — schema rejects any authority/allow/auto-approve attribute.
2. Every tool call produced during skill reuse flows through NTOX's **existing policy** unchanged (workspace roots, `shellPolicy`, approval flow); a policy-denied command is denied **regardless of the skill's verification status**.
3. Verification state influences **retrieval ranking and display only** — never `PolicyDecision`s.
4. Independent verification: evidence is produced by the **harness** (frozen checks, file-state diffs, exit codes) — never by the agent's own claims. An agent saying "done" is not, and never becomes, evidence. The signature is an HMAC with a key **outside the agent's authority boundary**: the policy verdict denies the agent's entire tool surface (read/write/cwd/image) access to `NTOX_DIR/procedures` at any depth, with no profile grant that opens it, and signing/promotion functions are referenced only from the store module and harness code (test-enforced source scan).
5. Tests written at implementation time: (a) verified skill + policy-denied action ⇒ denied; (b) skill with fabricated evidence ⇒ does not reach `verified`; (c) `NTOX_ISOLATE_MEMORY`-style experiment flags cannot grant authority; (d) E1-constant reuse in a fresh environment ⇒ refused **before any step executes** (§6.2); (e) evidence signed without the harness key (unkeyed hash or foreign key) ⇒ rejected; (f) agent file tools cannot reach the procedure store or its key, even with roots containing `NTOX_DIR`.

## 6. Task suite design (frozen before running)

Per procedure family (target ≥ 6 families across distinct domains — files transformation, environment probe, data conversion, report generation, config synthesis, tool orchestration):
- **SOLVE task** (env E1): unfamiliar, verifiable, no memorized answer exists.
- **TRANSFER tasks** (env E2, fresh temp workspace): same underlying procedure, different paths/values/fixtures — literals from E1 are *wrong* here (memorization trap ⇒ replay detector).
- **DECOY tasks**: topically similar, procedure inapplicable — measures incorrect reuse attempts.
- All checks: frozen command verifiers (arena pattern), fresh workspace per trial.

Measures (all pre-registered): task success rate (per arm × task class), input/output tokens, total cost, **successful skill reuses**, **incorrect reuse attempts**, transfer-vs-solve gap (generalization index).

### 6.1 Frozen pilot gates (numerical — frozen 2026-10-27, before any arm run)

| # | Metric | Gate |
|---|---|---|
| 1 | Procedure families | ≥ 6 |
| 2 | Repetitions per task | ≥ 2 |
| 3 | Transfer improvement (C vs B) | C beats B on ≥ 2 additional paired trials |
| 4 | E2 versus E1 success drop | ≤ 20 percentage points |
| 5 | Incorrect reuse | **0 unsafe executions** |
| 6 | Cost per successful transfer | ≤ 120% of arm B |
| 7 | Policy bypasses | 0 |

These are practical engineering gates, not statistical proof; a larger replication is required before any strong generalization claim. Gates 3 and 6 are evaluated on paired trials; gates 4, 5, 7 are evaluated per-trial (any violation fails the pilot).

### 6.2 Replay detector (frozen — valid reuse vs replay)

Two independent layers, both required:

- **Store layer (implemented)**: extraction declares each E1 environment constant as a parameter (`{name, description, learnedValue}` + `learnedScope`). Reuse in a different scope must supply **fresh bindings discovered in E2**; binding a parameter to its `learnedValue`, or embedding that literal in step args, is `refused` **before any executor call** (zero probes, zero steps). Rendering exposes `{{name}}` references and never the learned value.
- **Checker layer (frozen, harness-side)**: every TRANSFER task's frozen verifier MUST carry a `forbiddenLiterals` list — the E1 fixture constants of its family — and fail the task if any appears in E2 outputs/artifacts, regardless of the agent's claims. Gates 4 and 5 are scored against this checker; a store-layer refusal alone does not count as task success.

## 7. Experimental controls (hardened lessons from Phase 2)

- Isolation: per-arm `NTOX_DIR`; state sealed from agents (fix the policy default per the security note — do **not** rely on env); shell policy fixed across arms; stale-report wipe before runs; keep-workspaces (Windows EPERM); dimension parity with fail-loud; dedup before top-k; **same-run episode/skill exclusion** (self-noise).
- Screening protocol: audit logs inspected for cross-state access before any result is reported; contaminated runs discarded, not averaged.
- n ≥ 2 runs per task (Phase 2 single-run margins like 4/6 vs 3/6 are explicitly preliminary).
- Disclosure standard: constructed content (procedures/seeds) labeled; all executions and outcomes real.

## 8. Success criteria (what would make Phase 3 a yes; numbers frozen in §6.1)

1. C > B on transfer success with paired win/loss clearly favoring C — C beats B on ≥ 2 additional paired trials (§6.1 #3).
2. Transfer success in E2 no more than 20 percentage points below E1 solve success (§6.1 #4) — generalization, not replay; memorization traps fail the `forbiddenLiterals` checker as designed (§6.2).
3. Zero unsafe executions (§6.1 #5); every refused/incorrect reuse attempt traceable to a failed applicability check, the replay guard, or a recorded rejection.
4. Cost per successful transfer task ≤ 120% of arm B (§6.1 #6).
5. Zero policy bypasses attributable to skill state (§6.1 #7, rule §5 audit).

If (2) fails while (1) holds: procedures overfit environments — restrict artifacts to environment-fingerprinted scopes. If (1) fails: episodic outcomes suffice at this scale; procedural layer not justified yet.

## 9. Threats to validity

Constructed procedures (disclosed) · evidence must be harness-sourced or the whole design collapses into self-report (rule §5.4) · environment-fingerprint fidelity · small n · retrieval backend confound (freeze one backend or factorial it deliberately) · agent stochasticity (≥2 runs).

## 10. Next steps (in order)

1. ~~Security review of the three modules + numerical freeze~~ — done: source review of `procedure-store` / `applicability` / `procedure-reuse` requested on `feat/episodic-outcome-recall`; gates frozen in §6.1/§6.2.
2. Reviewer confirmation of the frozen solve/transfer/decoy conditions (§6 families, `forbiddenLiterals` per family).
3. Wire the three-arm harness (A / B / C) with identical task conditions, behind `proceduralMemoryEnabled`, under the hardened protocol; report against §8.
4. Only after a §8 pass: discuss production wiring — toward the Self-Improving Skills Library (experience → verified procedure → reusable skill → execution → new evidence → skill revision).

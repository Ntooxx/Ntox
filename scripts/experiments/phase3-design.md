# Phase 3 — Verified Procedural Memory (research design)

Status: **design only — no production implementation authorized.**
Preceded by: Phase 1 (retrieval, `results-2026-10-26.md`), Phase 2 (outcome payload, `results-phase2-2026-10-26.md`).

## 1. Question and hypothesis

Phase 2 showed NTOX must remember *what happened* (outcome-bearing episodic recall: 0/6 → 4/6 knowledge tasks, ~5× lower cost per success). Phase 3 asks the next question:

**Does NTOX that remembers what it successfully *did* — as a verified, reusable procedure — succeed on related but unseen tasks, including in a fresh environment, beyond what episodic memory alone provides?**

Hypotheses (pre-registered):
- H1: verified procedural memory (arm C) > ordinary episodic memory (arm B) > no procedural memory (arm A) on transfer-task success.
- H2: gains hold in a *fresh environment* (different workspace, paths, fixture values) — i.e. a parameterized procedure was learned, not a memorized answer.
- H3: incorrect reuse (applying an inapplicable procedure) stays rare in arm C — applicability checks, not LLM confidence, gate reuse.
- H4: cost per successful transfer task does not exceed arm B by more than a stated margin (to be fixed at suite-freeze time).

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

- **Artifact**: candidate skill = markdown procedure + machine-readable sidecar (JSON): parameterized steps, **prerequisites as executable checks** (command/path/feature probes with expected results), scope statement (when it applies / does not apply), and verification evidence record: `{envFingerprint, taskId, checkOutputs, timestamps, harnessSignature}`.
- **States**: `candidate → verified → restricted | rejected`, driven by reuse history (step 6), never by self-report.
- **Retrieval**: embedding over procedure text (Titan-cosine candidate backend from Phase 1, or current hybrid — arm C decides at freeze), ranking raised/lowered by verification state and reuse history.
- **Applicability check**: prerequisites are *executed* before reuse; a failed prereq ⇒ no attempt. LLM prose opinion about applicability is advisory at most.

## 5. Architectural rule (non-negotiable)

> **No skill acquires execution authority because an LLM generated it or a previous task succeeded.**

Enforced as:
1. Skills carry **zero permission fields** — schema rejects any authority/allow/auto-approve attribute.
2. Every tool call produced during skill reuse flows through NTOX's **existing policy** unchanged (workspace roots, `shellPolicy`, approval flow); a policy-denied command is denied **regardless of the skill's verification status**.
3. Verification state influences **retrieval ranking and display only** — never `PolicyDecision`s.
4. Independent verification: evidence is produced by the **harness** (frozen checks, file-state diffs, exit codes) — never by the agent's own claims. An agent saying "done" is not, and never becomes, evidence.
5. Tests to be written at implementation time: (a) verified skill + policy-denied action ⇒ denied; (b) skill with fabricated evidence ⇒ does not reach `verified`; (c) `NTOX_ISOLATE_MEMORY`-style experiment flags cannot grant authority.

## 6. Task suite design (frozen before running)

Per procedure family (target ≥ 6 families across distinct domains — files transformation, environment probe, data conversion, report generation, config synthesis, tool orchestration):
- **SOLVE task** (env E1): unfamiliar, verifiable, no memorized answer exists.
- **TRANSFER tasks** (env E2, fresh temp workspace): same underlying procedure, different paths/values/fixtures — literals from E1 are *wrong* here (memorization trap ⇒ replay detector).
- **DECOY tasks**: topically similar, procedure inapplicable — measures incorrect reuse attempts.
- All checks: frozen command verifiers (arena pattern), fresh workspace per trial.

Measures (all pre-registered): task success rate (per arm × task class), input/output tokens, total cost, **successful skill reuses**, **incorrect reuse attempts**, transfer-vs-solve gap (generalization index).

## 7. Experimental controls (hardened lessons from Phase 2)

- Isolation: per-arm `NTOX_DIR`; state sealed from agents (fix the policy default per the security note — do **not** rely on env); shell policy fixed across arms; stale-report wipe before runs; keep-workspaces (Windows EPERM); dimension parity with fail-loud; dedup before top-k; **same-run episode/skill exclusion** (self-noise).
- Screening protocol: audit logs inspected for cross-state access before any result is reported; contaminated runs discarded, not averaged.
- n ≥ 2 runs per task (Phase 2 single-run margins like 4/6 vs 3/6 are explicitly preliminary).
- Disclosure standard: constructed content (procedures/seeds) labeled; all executions and outcomes real.

## 8. Success criteria (what would make Phase 3 a yes)

1. C > B on transfer success with paired win/loss clearly favoring C.
2. Transfer success in E2 non-inferior to E1 solve success within a stated margin (generalization, not replay — memorization traps fail as designed).
3. Incorrect reuse attempts ≤ pre-stated small bound, each traceable to a failed applicability check or a recorded rejection.
4. Cost per successful transfer task within the stated margin of arm B.
5. Zero policy bypasses attributable to skill state (rule §5 audit).

If (2) fails while (1) holds: procedures overfit environments — restrict artifacts to environment-fingerprinted scopes. If (1) fails: episodic outcomes suffice at this scale; procedural layer not justified yet.

## 9. Threats to validity

Constructed procedures (disclosed) · evidence must be harness-sourced or the whole design collapses into self-report (rule §5.4) · environment-fingerprint fidelity · small n · retrieval backend confound (freeze one backend or factorial it deliberately) · agent stochasticity (≥2 runs).

## 10. Next steps (in order)

1. Security review + merge decision for `feat/episodic-outcome-recall` (blocking).
2. Freeze suite (solve/transfer/decoy families + margins) — reviewable JSON.
3. Minimal procedure store + applicability runner **behind flags**, with rule-§5 tests.
4. Run three arms under the hardened protocol; report against §8.
5. Only after a §8 pass: discuss production wiring — toward the Self-Improving Skills Library (experience → verified procedure → reusable skill → execution → new evidence → skill revision).

# NTOX Ultimate Plan

A high-level plan to turn a very good prototype into a great product.
Derived from the deep audit (2026-09-02). Status updated as items are implemented.

---

## The Core Thesis

NTOX's moat claim is "a cognitive agent." Today that claim is unproven:
20+ heuristic subsystems exist, but no evidence shows they beat a plain ReAct loop.
A great product is built by **proving the differentiator first, then deepening it**.
Everything else is hygiene.

---

## Phase 0 — Prove the Moat (do this first, nothing else matters more)

- [ ] Run the cognitive-kernel benchmark (ON vs OFF) on a real eval set.
- [x] Add the benchmark to CI so results are tracked over time.
- [ ] Publish results in the README: "cognition improves task success by X%."
- [ ] Decide per subsystem: **keep (has evidence), fix (worth fixing), cut (no evidence).**
- [ ] If nothing shows a win: be honest, cut the theater, and rebuild the moat around
  what does work (traceability, security, multi-channel, streaming).

## Phase 1 — Make the Docs True

- [x] Rewrite `AGENTS.md` and `ROADMAP.md` to match reality (native function calling,
  not XML; post-turn context management; 10 providers; existing CI; real test counts).
- [x] Delete or re-verify every stale claim (skill counts, test counts, "no CI").
- [x] Reconcile all count inconsistencies (README badges, skill counts, test counts).

## Phase 2 — Collapse the Duplication

- [ ] Split `agent.ts` (~1,500 lines) into the modules it already reimplements.
- [ ] Wire the tested-but-bypassed `NtoxCognitiveLayer` into the runtime, or delete it.
- [ ] Merge the two parallel execution paths (`runAgentMessage` vs `runAgentStream`).
- [x] Merge the duplicate token-count implementations.
- [x] Delete the orphans: `ExternalSignals`, `FounderIntelligence`, dead "google"
  provider format, `analytics` stub, dead `soundEnabled` config.

## Phase 3 — Close the Functional Gaps

- [x] Fix Ollama tool calling (parses `tool_calls` from the stream, with tests).
- [ ] Add one real-provider integration test (not mocked) for each wire format.
- [ ] Wire STT/TTS into at least one channel (Telegram voice messages).
- [x] Add auth to the web UI (token mode beyond local-only binding).
- [x] Make the Docker sandbox the default shell path when available
  (POSIX auto-detects Docker; Windows keeps PowerShell unless explicitly enabled).

## Phase 4 — Harden the Product

- [x] Fix `npm run coverage` (installed `@vitest/coverage-v8`, configured vitest,
  added thresholds, gated CI on it).
- [x] Gitignore the root scratch files; `ledger.txt` can no longer leak via `git add .`.
- [x] Add `noUnusedLocals` to tsconfig and fix all fallout.
- [x] Fix the Prettier drift so `verify:all` is fully green.
- [x] Make embedding failures visible (`/cost` shows local-hash fallback count).
- [x] Persist false-success records (`~/.ntox/memory/false-success.json`).

## Phase 5 — Find Real Users

- [ ] Stop building breadth; pick one wedge (developer CLI, Telegram copilot, or
  NTOX Alive host) and go deep.
- [ ] Onboard 5–10 real users, watch traces, fix what they actually hit.
- [ ] Let user-driven iteration replace single-contributor big-bang commits.
- [ ] Reconsider the versioning/publishing story once there is demand to justify it.

---

## Definition of Done

The audit's "great product" bar is met when:

- The cognitive benchmark is in CI and shows a real, published win — or the
  subsystem was cut.
- Docs match code line-for-line.
- One execution path, one cognitive pipeline, no orphaned modules.
- All providers work end-to-end, verified by real integration tests.
- Every claimed feature works out of the box (defaults, not opt-in).
- There is evidence of real users, not just a showcase.

At that point NTOX is not "a great prototype" — it's a great product.

# NTOX - Feature Study & Roadmap

## 1. What Exists Today (studied from the codebase)

### Core agent loop
- `src/core/agent.ts` — main loop: push message, classify response mode, kernel routing, quick handlers, context-window management, strategy classification, streaming LLM response, `<tool_call>` XML parsing/execution loop, memory storage, theory triggers, false-success check, mistake detection. Currently ~1350 lines — owns too many responsibilities in one file.
- `src/core/llm.ts` — streaming client supporting 9 providers (OpenAI, Anthropic, Ollama, LM Studio, Groq, Together, Mistral, DeepSeek, OpenRouter).
- `src/core/config.ts` — Zod-validated config at `~/.ntox/config.json`; stores `apiKey`, `telegramToken`, `discordToken`, `whatsappToken`, etc. as plaintext with default file permissions (no chmod).
- `src/core/dispatcher.ts` — builds shared/session infra (`createSharedInfra`, `createSessionInfra`, `createAgentConfig`) used by both the REPL and subagents.
- `src/core/orchestrator.ts` — 8-voice debate system (Researcher, Critic, Physicist, Mathematician, Systems Architect, Economist, Inventor, Experimentalist) that synthesizes multiple perspectives on a question.

### Cognition
- `src/cognition/patterns.ts` + `cognitive-space.ts` — compiles repeated reasoning (≥5 occurrences) into an 8-dimensional cognitive vector space; `sparse-activator.ts` reactivates relevant patterns later. No user-facing introspection exists yet.
- `src/cognition/kernel.ts` — cognitive kernel routing for tool-execute modes.
- `src/cognition/compressor.ts`, `critique.ts`, `domains.ts` — supporting compression/critique/domain-mapping logic.

### Memory
- `src/memory/episodic.ts` — episodic store with embedding-based cosine similarity retrieval.
- `src/memory/local-embed.ts` (in `core/`) — deterministic 256-dim feature-hashing embeddings, zero API calls, offline-friendly.
- `src/memory/user-model.ts` — learns verbosity, technical level, communication style over time.
- `src/memory/relationship.ts` — tracks a "bond level" gating trust-dependent behavior.
- `src/memory/theory-memory.ts` + `src/research/theory-store.ts` — observation → pattern → primitive → theory → meta-theory pipeline, with confidence and falsification-criteria fields, persisted to `theories.json`. Confidence is currently assigned, not updated from a real prediction-error feedback loop.
- `src/research/false-success.ts` — detects shallow reasoning via surface vs. depth signals.

### Meta-cognition
- `src/meta/` — 18 modules: `strategist.ts`, `self-reflection.ts`, `confidence.ts`, `mistakes.ts`, `mood.ts`, `disagreement.ts`, `intervention.ts` (bond-gated), `mental-model.ts`, `proactive.ts`, `executive.ts`, `founder.ts`, `briefing.ts`, `response-mode.ts`, `style-optimizer.ts`, `time-adapter.ts`, `session-intent.ts`, `external-signals.ts`, `interaction-score.ts`, `analytics.ts`, `effectiveness.ts`.

### Skills
- `skills/` — 41 curated cognitive-framework documents across Core, Research, Mathematics, Physics/Complex Systems, Architecture, Invention, AI, Economics, Communication, Career, Personal.
- `src/skills/registry.ts` + `library.ts` — trigger-based auto-activation of skills; `learner.ts` for acquiring new skills; `executor.ts` for running them.

### Tools
- `src/tools/` — filesystem (`filesystem.ts`), `grep.ts`, `shell.ts` (regex blocklist + `approval.ts` gate + optional Docker sandbox), `web.ts`, `browse.ts`, `search.ts`, `image.ts`, `voice.ts` (OpenAI TTS), `stt.ts` (OpenAI Whisper), `subagent.ts` (spawns isolated subagents, own message history, filtered toolset, max 3 concurrent, 120s timeout), `job-tracker.ts`, `checkpoint.ts`, `profile-eval.ts`, `registry.ts`.
- Voice tools exist but are **not wired into any gateway** — `AGENTS.md`'s "Good First Issues" list is stale, listing voice as missing.

### Gateways
- `src/gateway/` — Telegram, Discord, WhatsApp, web, all funneling into the same `Agent` core (`index.ts`). Web front-end (`web/index.html`) is a single-file chat UI only — no dashboard or memory browser.
- Per `AGENTS.md`, the intended pattern is to extract `repl.ts`'s `handleMessage` into a shared service consumed by both REPL and gateways — done in `src/core/message-handler.ts`.

### Kernel (decision layer, distinct from cognition kernel)
- `src/kernel/` — `decision-kernel.ts`, `goals.ts`, `evolution.ts` (event-sourced identity log), `state.ts`, `verifier.ts`, `world.ts`.

### CLI
- `src/cli/` — REPL loop (`repl.ts`), streaming render (`render.ts`), animations (`animation.ts`, `effects.ts`, `phases.ts`), first-time setup flow (`first-time.ts`, `intro.ts`).

### Quality baseline (verified by running the tools)
- `tsc --noEmit`: clean, `strict: true`.
- `vitest run`: **369/369 tests passing** across 32 test files.
- `eslint src/`: lint status should be rechecked as part of the reliability milestone.
- No CI pipeline exists yet.

---

## 2. Next Implementation Plan

Scope agreed: no GUI/dashboard work for now. Priorities are reliability/production-readiness, cognitive/memory depth, more gateways/integrations (incl. voice), and multi-agent/sub-agent orchestration — kept scoped to NTOX itself (Horizon's OS/kernel rewrite ideas are excluded, only borrowed as inspiration where noted).

### Phase 1 — Foundation & Reliability (weeks 1-3, gates all later phases)
1. Add GitHub Actions CI running `npm run typecheck`, `npm run lint`, `npm test` on push/PR (`.github/workflows/ci.yml`).
2. Zero out current lint debt and keep lint clean in CI.
3. Secure config storage: chmod `~/.ntox/config.json` to `0o600` after every save in `config.ts`; document plaintext-secrets tradeoff in `SECURITY.md`.
4. Harden `shell.ts`: make Docker sandboxing the default execution path when available, not opt-in; document the regex blocklist as defense-in-depth, not a hard security boundary.
5. Refactor `agent.ts` into smaller modules (`message-manager.ts` for push/truncate/token-budget, `tool-dispatch.ts` for parsing/executing tool calls), keeping `agent.ts` as a thin orchestrator. Prerequisite for Phases 2 and 4.
6. Update `AGENTS.md`'s "Good First Issues" to remove already-implemented voice input/output and reflect real current gaps.

### Phase 2 — Cognitive & Memory Depth (weeks 4-7, depends on Phase 1.5)
1. Close the prediction-error loop in `theory-store.ts`: log predicted vs. actual outcomes per theory so confidence updates from real evidence.
2. Wire `false-success.ts` detections into theory confidence decay when shallow reasoning is tied to a theory/pattern.
3. Add CLI introspection commands (`/theories`, `/patterns`) surfacing compiled patterns, cognitive-space coordinates, and active theories — currently invisible to the user.
4. Add tests for the new prediction-tracking fields and introspection commands.

### Phase 3 — Gateways & Integrations (weeks 8-10, parallel with Phase 2)
1. Wire existing `stt.ts`/`voice.ts` tools into Telegram/Discord for incoming voice messages and optional spoken replies.
2. Add an optional local/offline STT fallback (e.g. whisper.cpp binding) for users without an OpenAI key.
3. Extract `repl.ts`'s `handleMessage` into a shared service consumed identically by REPL and gateways, removing duplication.
4. Add one new gateway plugin (Slack or Matrix) following the `discord.ts` pattern.

### Phase 4 — Multi-Agent / Sub-Agent Orchestration (weeks 11-14+, depends on Phase 1.5)
1. Give `subagent.ts` persistent identity: track task, outcome, and a fitness/success score per spawned subagent instead of fire-and-forget.
2. Connect `orchestrator.ts`'s 8-voice debate to real subagent calls for actual parallelism instead of sequential prompts in one context.
3. Add a lightweight competition/selection step: when multiple subagents attempt the same task, keep the fitness-scored winner and log the rest (a scoped version of Horizon's "selection pressure" idea, without adopting its architecture).
4. Only after profiling cost/latency impact, consider raising `MAX_CONCURRENT` (currently 3) in `subagent.ts`.

### Verification checklist (applies per phase)
- `npm run typecheck`, `npm run lint`, `npm test` clean (becomes the CI gate from Phase 1 onward).
- Manual: Telegram/Discord voice message round-trip (Phase 3).
- Manual: `/theories` and `/patterns` reflect actual stored state (Phase 2).
- Manual: multi-subagent debate produces recorded fitness scores and a selected winner (Phase 4).
- Security: `~/.ntox/config.json` permissions are `600`; shell tool defaults to Docker sandbox when available (Phase 1).

### Open questions
1. Local STT (whisper.cpp) would be the project's first native dependency — worth adding, or stay OpenAI-only?
2. New gateway pick: Slack (broader reach, simpler bot API) vs. Matrix (fits the project's local-first/privacy ethos) — decide when Phase 3 starts.

### Explicit exclusions
- No GUI/dashboard work in this roadmap (deprioritized by choice).
- No adoption of Horizon's OS/kernel/syscall/scheduler architecture — only isolated ideas (prediction-error tracking, fitness-based selection) are borrowed into NTOX's existing structure.

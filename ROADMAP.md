# NTOX - Feature Study & Roadmap

## 1. What Exists Today (studied from the codebase)

### Core agent loop
- `src/core/agent.ts` — main loop: push message, prompt-injection guard, classify response mode, kernel routing, quick handlers, strategy classification, streaming LLM response with native function calling (OpenAI `tool_calls` / Anthropic `tool_use`), false-success self-correction, memory storage, theory triggers, mistake detection, post-turn reflection and context-window management. Currently ~1,500 lines — owns too many responsibilities in one file.
- `src/core/llm.ts` — streaming client supporting 10 providers (OpenRouter, OpenAI, Groq, DeepSeek, Together, Mistral, Anthropic, OpenAI-compatible, Ollama, LM Studio). Note: Ollama does not parse tool calls yet.
- `src/core/config.ts` — Zod-validated config at `~/.ntox/config.json`; saves with `0o600` permissions (plaintext-secrets tradeoff documented in `SECURITY.md`).
- `src/core/dispatcher.ts` — builds shared/session infra (`createSharedInfra`, `createSessionInfra`, `createAgentConfig`) used by both the REPL and subagents.
- `src/core/orchestrator.ts` — 8-voice debate system (Researcher, Critic, Physicist, Mathematician, Systems Architect, Economist, Inventor, Experimentalist) that synthesizes multiple perspectives on a question.

### Cognition
- `src/cognition/patterns.ts` + `cognitive-space.ts` — compiles repeated reasoning (≥5 occurrences) into an 8-dimensional cognitive vector space; `sparse-activator.ts` reactivates relevant patterns later. Introspection available via `/patterns` and `/theories`.
- `src/cognition/kernel.ts` — cognitive kernel routing for tool-execute modes.
- `src/cognition/compressor.ts`, `critique.ts`, `domains.ts` — supporting compression/critique/domain-mapping logic.

### Memory
- `src/memory/episodic.ts` — episodic store with embedding-based cosine similarity retrieval.
- `src/memory/local-embed.ts` (in `core/`) — deterministic 256-dim feature-hashing embeddings, zero API calls, offline-friendly.
- `src/memory/user-model.ts` — learns verbosity, technical level, communication style over time.
- `src/memory/relationship.ts` — tracks a "bond level" gating trust-dependent behavior.
- `src/memory/theory-memory.ts` + `src/research/theory-store.ts` — observation → pattern → primitive → theory → meta-theory pipeline, with confidence, falsification-criteria fields, and a prediction-error feedback loop (`makeTheoryPrediction` / `resolvePrediction`), persisted to `theories.json`.
- `src/research/false-success.ts` — detects shallow reasoning via surface vs. depth signals.

### Meta-cognition
- `src/meta/` — 19 modules: `strategist.ts`, `self-reflection.ts`, `confidence.ts`, `mistakes.ts`, `mood.ts`, `disagreement.ts`, `intervention.ts` (bond-gated), `mental-model.ts`, `proactive.ts`, `executive.ts`, `briefing.ts`, `response-mode.ts`, `style-optimizer.ts`, `time-adapter.ts`, `session-intent.ts`, `interaction-score.ts`, `analytics.ts`, `effectiveness.ts`, `self-aware.ts`.

### Skills
- `skills/` — 83 curated cognitive-framework documents across Core, Research, Mathematics, Physics, Architecture, Invention, AI, Economics, Communication, Career, Personal, Programming.
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
- `vitest run`: **535/535 tests passing** across 57 test files.
- `eslint src/`: clean.
- CI pipeline exists (`.github/workflows/ci.yml`): typecheck + lint + test on Node 18/20/22.

---

## 2. Next Implementation Plan

### Already done (since this roadmap was written)
- GitHub Actions CI on push/PR (typecheck + lint + test, Node 18/20/22).
- Config saves with `0o600` permissions.
- Prediction-error feedback loop in `theory-store.ts` (with tests).
- False-success detections wired into theory confidence decay.
- `/theories` and `/patterns` introspection commands.
- AGENTS.md updated to remove stale good-first-issues.
- Ollama tool calling: `streamOllama` parses `tool_calls` from the stream (with tests).
- Web UI auth token mode (`webAuthToken` config, socket.io middleware, token prompt UI, doctor check, tests).
- Coverage working: `@vitest/coverage-v8` installed, vitest config includes coverage settings.
- False-success records persisted to `~/.ntox/memory/false-success.json`.
- Embedding fallback visible: `/cost` shows local-hash fallback count.
- Dead code removed: `"google"` provider format, duplicate token-count implementations, orphaned `external-signals.ts`/`founder.ts`, dead `soundEnabled` config, `analytics.ts` stub.
- Docker sandbox defaults on: POSIX auto-detects Docker and sandboxes shell commands; Windows keeps PowerShell unless `dockerEnabled` is set.
- Prettier drift fixed: `verify:all` is fully green (12/12).
- CI gated on coverage with thresholds; `noUnusedLocals` enabled; flaky live-network search tests replaced with deterministic mocked tests.

### Phase 1 — Foundation & Reliability (in progress)
1. Refactor `agent.ts` into smaller modules (`message-manager.ts` for push/truncate/token-budget, `tool-dispatch.ts` for parsing/executing tool calls), keeping `agent.ts` as a thin orchestrator. Prerequisite for Phases 2 and 4.

### Phase 2 — Cognitive & Memory Depth
1. Wire `NtoxCognitiveLayer` (tested but bypassed) into the agent runtime, or delete it.
2. Run the cognitive benchmark (ON vs OFF) and commit results; add to CI when stable.

### Phase 3 — Gateways & Integrations
1. Wire existing `stt.ts`/`voice.ts` tools into Telegram/Discord for incoming voice messages and optional spoken replies.
2. Add an optional local/offline STT fallback (e.g. whisper.cpp binding) for users without an OpenAI key.
3. Add one new gateway plugin (Slack or Matrix) following the `discord.ts` pattern.

### Phase 4 — Multi-Agent / Sub-Agent Orchestration
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

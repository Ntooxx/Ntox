# NTOX - Cognitive CLI Agent

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)
[![CI](https://github.com/Ntooxx/Ntox/actions/workflows/ci.yml/badge.svg)](https://github.com/Ntooxx/Ntox/actions)
[![npm](https://img.shields.io/badge/npm-0.1.0-red)](package.json)
[![tests](https://img.shields.io/badge/tests-957%20passing-44cc11)](https://github.com/Ntooxx/Ntox/actions)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)

A self-improving CLI agent that predicts, remembers, and corrects itself. Closed learning loop, cognitive kernel, pattern compilation, theory distillation, and 80+ reasoning skills. Includes a runtime-neutral cognition API and DeepSeek Harness adapter. Multi-channel gateway (Telegram, Discord, WhatsApp, Web UI). Docker sandboxing. Runs locally.

## Why NTOX?

NTOX is built around a **cognitive kernel**: it doesn't just call tools, it compresses what it learns into reusable patterns, builds meta-theories from cross-domain observations, and records which context actually helped. It is an experiment in agent meta-cognition that goes beyond "LLM + tool loop".

## Highlights

- **A closed learning loop.** Every turn can predict an outcome, observe what happened, attribute the result, and change the next turn through the Mind subsystem.
- **Memory with authority.** Corrections outrank conflicting facts, theories carry falsification criteria, and retrieval is ranked by measured reliability.
- **Identity you can measure.** Milestone M5 passes: a trained instance is behaviorally distinguishable from a fresh one.
- **Alive by design.** Predictions, open loops, prediction error, and wake decisions form an event-driven core exposed as `ntox/alive`.
- **Evidence, not adjectives.** 6/6 necessity checks, a significant longitudinal result, ALIVE-1, NCB, and a 12/12 verification gate.
- **Breadth without lock-in.** 9 named providers plus custom endpoints, 5 chat surfaces, 80+ skills, Docker, and public cognition and Alive packages.

The full evidence-backed tour is in [HIGHLIGHTS.md](HIGHLIGHTS.md).

There is also a motion-design showcase of the whole system in [`site/`](site/) — open `site/index.html` in a browser.

## Features

- **Mind Loop**: Outcome ledger, prediction and calibration, reliability-ranked memory, Thompson-sampling strategy selection, capability model, and idle cognition
- **Measured Identity**: Evidence-backed positions, cognitive fingerprint, divergence scoring, and M5 proof
- **Cognitive Kernel**: Compresses queries to primitives, matches patterns in an 8D cognitive vector space, auto-compiles frequent patterns into reusable abstractions
- **Theory Store**: Distills conversations into learned knowledge: observations -> patterns -> theories -> meta-theories
- **Workspace Policy**: Profiles constrain reads, writes, shell cwd, network/browser tools, and auto-checkpoint edits before changes
- **Inspectable Traces**: `/trace` shows mode, strategy, memory/search/theory use, token ledger, policy decisions, tool calls, and checkpoints
- **Multi-Agent Debate**: 8 internal voices (Researcher, Critic, Physicist, Mathematician, Architect, Economist, Inventor, Experimentalist) debate complex questions before synthesizing an answer
- **False-Success Self-Correction**: Detects shallow reasoning and retries with deeper analysis
- **Persistent Memory**: Every exchange is embedded and searchable via cosine similarity (local fallback, no API key needed)
- **Multi-Channel Gateway**: Telegram, Discord (WebSocket with intents), and a minimal local Web UI all share the same agent runtime
- **Skill Library**: 80+ markdown skill documents, auto-triggered by semantic search
- **Meta-Cognition**: Strategy classification, self-reflection, mistake journal, session intent, style optimization
- **Runtime-Neutral Cognition API**: Mount NTOX cognitive context and turn learning into another agent runtime without replacing its model, tools, or session engine
- **DeepSeek Harness Adapter**: Connects Harness lifecycle events to NTOX before-step context, tool outcomes, and post-turn learning
- **Correction-Aware Recall**: Explicit user corrections are stored as authoritative context ahead of older, conflicting memories
- **Tool Recovery Guidance**: Failed tool outcomes become a concise next-step prompt that asks the agent to use a fallback or verify its input instead of repeating the same call
- **Live OpenRouter Model Catalog**: Loads the current OpenRouter models API at startup, refreshes the selector during long sessions, and supports `/model refresh` for an immediate catalog update
- **10 LLM Providers**: OpenAI, Anthropic, Ollama, LM Studio, Groq, Together, Mistral, DeepSeek, OpenRouter, plus any OpenAI-compatible endpoint
- **Tool System**: read, write, edit, glob, grep, bash (with security blocklist + Docker sandboxing), web fetch
- **User Model**: Learns verbosity, technical level, communication style, and vocabulary over time
- **Prompt Injection Guard**: 14 injection pattern detectors + output secret sanitization

## Quick Start

```bash
# One-liner (macOS / Linux)
curl -fsSL https://raw.githubusercontent.com/Ntooxx/Ntox/main/install.sh | bash

# One-liner (Windows PowerShell)
irm https://raw.githubusercontent.com/Ntooxx/Ntox/main/install.ps1 | iex

# Or via npm
npm install -g ntox
ntox setup                # Interactive wizard, sets up API key, model, channels
ntox doctor               # Diagnose provider, browser, sandbox, and workspace setup
ntox                      # Start chatting in the terminal
```

## Gateway

```bash
ntox gateway              # Run all configured channels (Telegram, Discord, Web UI)
ntox gateway web          # Run only the local browser chat at http://127.0.0.1:3000
ntox setup                # Configure tokens
```

### Channels

| Channel      | Setup                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------- |
| **Telegram** | Create bot via [@BotFather](https://t.me/BotFather), set `telegramToken` in config           |
| **Discord**  | Create app at [Discord Developer Portal](https://discord.com/developers), set `discordToken` |
| **Web UI**   | Starts at `http://127.0.0.1:3000`, local-only by default, with streamed chat and activity    |

### Docker

```bash
docker compose up -d      # Runs gateway with all configured channels
```

## DeepSeek Harness Integration

NTOX can operate as the cognitive layer inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Harness remains responsible for its own agent loop, tools, sessions, and model provider. The adapter only supplies cognitive context before a step and receives tool and turn outcomes for learning.

```yaml
- id: ntox-cognition
  name: "@ntox/deepseek-harness"
  config:
    cognitionEnabled: true
    memoryEnabled: true
    theoryEnabled: true
    mistakesEnabled: true
    strategyEnabled: true
```

The adapter package is in [`integrations/deepseek-harness`](integrations/deepseek-harness). It maps `agent/pre-step`, `tools/result`, and `session/event` lifecycle surfaces to the public `ntox/cognition` API.

A small live paired proof has demonstrated durable cross-session recall through the same Harness runtime. Broader model-backed evaluation across task completion, correction handling, tool recovery, and context cost remains the next evidence milestone.

## NTOX Alive

`ntox/alive` is a standalone, event-driven persistent cognition core. It does not watch your computer or call an LLM by itself. A host supplies consented events, and the engine cheaply decides whether to ignore the event, learn from a resolved prediction, wake host cognition, or request a human decision.

The NTOX REPL enables local host adapters while it is running: it watches only the active workspace, polls Git state every 30 seconds, and pulses open-loop deadlines every minute. It ignores `.git`, `.ntox`, dependencies, build output, and coverage. It never monitors typing, other applications, or remote services, and it only adds a concise wake context to the next user-triggered model turn.

```ts
import { AliveEngine, JsonFileAliveStore } from "ntox/alive";
import { toolOutcomeToAliveEvent } from "ntox/alive/ntox";

const alive = new AliveEngine({
  store: new JsonFileAliveStore(".ntox/alive.json"),
});

const loop = alive.createOpenLoop({
  goal: "Improve memory retrieval",
  hypothesis: "Prediction-error weighting improves recall",
  nextEvidence: "Run an A/B benchmark",
});

const prediction = alive.createPrediction({
  statement: "The weighted benchmark will pass.",
  confidence: 0.81,
  expectation: { eventType: "benchmark_finished", payload: { winner: "weighted" } },
  openLoopId: loop.id,
});

const pulse = alive.recordEvent({
  type: "benchmark_finished",
  source: "benchmark",
  predictionId: prediction.id,
  payload: { winner: "baseline" },
});
```

NTOX now persists this state at `~/.ntox/alive.json`, records every tool result automatically, recognizes shell test commands as `test_finished` events, resolves explicitly linked predictions, and adds any wake decision to the next model prompt. Its public host adapter is available as `ntox/alive/host`; the core remains portable and privacy-bounded.

## Commands

| Command                   | Description                                      |
| ------------------------- | ------------------------------------------------ |
| `/help`                   | Show help                                        |
| `/config`                 | Show configuration                               |
| `ntox doctor`             | Check setup health from the terminal             |
| `/model`                  | Switch from the current OpenRouter catalog       |
| `/model refresh`          | Fetch the latest OpenRouter models immediately   |
| `/provider`               | Switch AI provider                               |
| `/ui`                     | Switch interface mode: minimal, normal, or debug |
| `/cognition`              | Cognitive kernel status                          |
| `/memory`                 | Browse memory stats                              |
| `/theories`               | Inspect learned theories                         |
| `/theories confirm <id>`  | Add supporting evidence                          |
| `/theories reject <id>`   | Add contradicting evidence                       |
| `/theories evidence <id>` | Inspect theory evidence                          |
| `/patterns`               | Inspect cognitive patterns                       |
| `/trace`                  | Inspect the last turn                            |
| `/alive`                  | Inspect host events and wake state               |
| `/workspace`              | Show active workspace profile                    |
| `/permissions`            | Show tool permissions and recent denials         |
| `/approve`                | Approve or deny a risky shell command (REPL and gateways) |
| `/agents`                 | Inspect subagent runs                            |
| `/skill`                  | List / learn / load skills                       |
| `/kernel`                 | Decision kernel commands                         |
| `/new`                    | Reset conversation                               |

## Project Structure

```
ntox/
|-- src/
|   |-- cli/           REPL, terminal rendering, animations
|   |-- core/          Agent loop, config, LLM client (10 providers), policy
|   |-- cognition/     Cognitive kernel, pattern store, vector space
|   |-- mind/          Outcome ledger, predictors, bandit, identity, idle jobs
|   |-- memory/        Episodic + theory memory, user model, relationship
|   |-- meta/          Strategy, reflection, mistakes, proactive, self-awareness
|   |-- alive/         Predictions, open loops, wake decisions, host adapters
|   |-- kernel/        Goals, subtasks, verifier
|   |-- skills/        Skill registry, library scanner, executor, learner
|   |-- tools/         Filesystem, shell, grep, web, browser, voice, subagents
|   |-- gateway/       Telegram, Discord, WhatsApp, Web UI
|   |-- api/           HTTP/SSE server
|   |-- evaluation/    Necessity checks, ablations, longitudinal runner
|   |-- benchmark/     NCB and ALIVE-1 benchmarks
|   |-- types/         TypeScript interfaces
|   `-- index.ts       Entry point
|-- skills/            80+ bundled reasoning skill documents
|-- .github/workflows/ CI/CD
|-- AGENTS.md          Guide for AI-assisted contributors
|-- CONTRIBUTING.md    Guide for human contributors
`-- package.json
```

## Requirements

- Node.js 18+
- An LLM provider: OpenRouter, OpenAI, Anthropic, Groq, DeepSeek, Together, Mistral, Ollama, LM Studio, or any OpenAI-compatible endpoint

## Security

NTOX ships with defense-in-depth tool protections:

| Layer                | Protection                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **File system**      | Blocks reads/writes to `.ssh/`, `.aws/`, `.git/config`, `.env`, `.gnupg/`, `.netrc`, `.npmrc`                            |
| **Workspace policy** | Default profile confines read/write/shell paths to the active workspace; tools can be allowlisted per profile            |
| **Web fetch**        | Blocks `file://`, `localhost`, all private IP ranges (`10.x`, `192.168.x`, `172.16-31.x`, `169.254.x`), `0.0.0.0`, `::1` |
| **Grep**             | Rejects ReDoS patterns (nested quantifiers), pattern length limit, benchmarked regex execution                           |
| **Shell**            | Regex blocklist for destructive commands + optional Docker sandboxing (`dockerEnabled: true`)                            |
| **Browser**          | Reuses web URL validation, blocking localhost and private network targets                                                |
| **Prompt**           | Injection detection (14 patterns: DAN, jailbreak, override, etc.)                                                        |
| **Output**           | Sanitizes secrets (API keys, tokens, private keys) from responses                                                        |
| **Telegram/Discord** | Optional user allowlists (`telegramAllowedUsers`, `discordAllowedUsers`)                                                 |
| **WhatsApp**        | Webhook `X-Hub-Signature-256` verification via `whatsappAppSecret` (set in `ntox setup`)                                 |
| **Web UI**           | Binds to `webHost` (`127.0.0.1` by default) to avoid accidental LAN exposure                                             |
| **Config**           | Zod schema validates config fields; saved config uses best-effort `0600` permissions                                     |

## Testing

```bash
npm run verify:all                            # Run the complete root and adapter proof gate
npm test                                      # Run root tests
npm run typecheck                             # Run TypeScript checks
npm run build                                 # Build the package
cd integrations/deepseek-harness && npm test  # Run adapter tests
```

`verify:all` checks linting, type safety, tests, builds, package contents, the built CLI, the built cognition export, and every adapter package gate. It records results in `experiments/verification/report.json`.

The last full verification run passed 12 of 12 checks: linting, formatting, 907 root tests, builds, CLI startup, the cognition and Alive smoke scenarios, and all adapter checks. The root suite has since grown to 957 passing tests. Results are recorded in `experiments/verification/report.json`.

## HTTP/SSE API (for web apps)

Run a local API server your webapp can call:

```bash
ntox api    # default http://127.0.0.1:3100 (config: apiPort, apiAuthToken)
```

| Endpoint | Method | Body | Response |
| --- | --- | --- | --- |
| `/api/health` | GET | â€” | `{ ok, model, provider }` |
| `/api/chat` | POST | `{ "message": "...", "sessionId": "optional" }` | SSE stream |
| `/api/session/reset` | POST | `{ "sessionId": "optional" }` | `{ ok, sessionId }` |

SSE events from `/api/chat`:

- `token` â€” `{ text }` incremental output (already secret-sanitized)
- `event` â€” tool/phase/memory/strategy/usage activity
- `done` â€” `{ response, sessionId, inputTokens, outputTokens }`
- `error` â€” `{ error, sessionId }`

If `apiAuthToken` is set, send `Authorization: Bearer <token>` on every request (`/api/health` is open for probes). Bind is localhost-only.

Example from a browser webapp:

```js
const res = await fetch("http://127.0.0.1:3100/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "Hello NTOX", sessionId: "user-1" }),
});
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  // parse SSE blocks: "event: token\ndata: {...}\n\n"
}
```

## Meta-Cognition Evaluation

Single-turn output quality does not test a layer whose claim is cross-turn learning, so NTOX ships a dedicated evaluation harness. It has two parts.

```bash
npm run eval:necessity                          # Deterministic mechanism checks (no LLM, no API key)
npm run eval:longitudinal -- --arms=off,full --reps=3
```

- **Necessity checks** (`src/evaluation/necessity.ts`) are deterministic interventions that prove each subsystem is causally used: memories enter the prompt only when enabled, corrections outrank conflicting memories, the kernel contributes context only after a pattern is reinforced, patterns compile at the reinforcement threshold, cross-domain observations generalize, and surface reasoning is flagged. They run in seconds and are also part of `npm test`.
- **Longitudinal evaluation** runs an ordered curriculum (recall, retention, correction precedence, instruction persistence, exact reasoning) per ablation arm in an isolated `NTOX_DIR`, then reports the learning slope per arm and paired bootstrap confidence intervals between arms. Arms: `off`, `kernel`, `memory`, `theory`, `strategy`, `mistakes`, `raw-context`, `full`. `raw-context` dumps memory and theory without cognitive selection, separating "more context" from "cognitive selection".

Reports are written to `experiments/meta-eval/`. Because effect sizes are small, a single run is not evidence: read the confidence interval and the required-sample-size column, not the raw delta.

### First powered result (deepseek-v4-flash, 30 tasks, 2026-09-15)

Necessity checks: **6/6 passed** â€” every subsystem causally affects prompt context.

Longitudinal `off` vs `all` (subsystems on, no reflection):

| Family | off | all |
|---|---|---|
| recall (cross-session) | 0/6 | 5/6 |
| cumulative-recall | 0/6 | 0/6 |
| correction-precedence | 0.50 | 0.67 |
| arithmetic | 1.00 | 1.00 |
| constraint-following | 1.00 | 1.00 |

`off` mean 0.500, `all` mean 0.700, Î” = +0.200, 95% CI [0.067, 0.350], d = 0.519, n = 30, needed n = 30, **significant**. The mechanism is cross-session episodic retrieval: `all` stores and retrieves facts from disk after conversation resets; `off` cannot.

Cumulative-recall (0/6 both) reveals a retrieval bias: the top-5 similarity retriever pushes out the oldest fact as more episodes accumulate. This is a product-level finding, not a harness artifact.

## ALIVE-1 Benchmark (M5)

M5 asks whether a trained instance is distinguishable from a fresh one by behavior alone. Four commands expose that evidence:

```bash
npm run bench:alive                                  # Collect, assess, and save an ALIVE-1 run
npm run bench:alive -- --voice=pairs.json            # Run blind voice A/B with the heuristic judge
npm run bench:alive -- --voice=pairs.json --judge    # Use the configured model as the blind judge
npm run bench:alive -- --ncb=50.2                    # Attach an external NCB score to the run
npm run bench:m5                                     # Full controlled M5 run: train, voice A/B, transfer, ALIVE-1
npm run bench:m5 -- --reuse --judge-model=google/gemini-2.5-flash
```

`bench:m5` builds an isolated trained instance under `experiments/m5/trained`, trains it on stated preferences and corrections, compares it against a fresh instance under `experiments/m5/fresh`, runs a blind judge, executes a paired cross-domain transfer experiment, and writes the ALIVE-1 report. `--reuse` reuses the recorded responses and re-judges them; `--judge-model` selects the blind judge.

Controlled M5 run (2026-10-18, agent `xiaomi/mimo-v2.6-flash`, judge `google/gemini-2.5-flash`):

| Criterion | Result |
|---|---|
| Identity divergence from fresh | 0.4125 (target > 0.4) |
| Cross-domain transfer lift | +100% paired (target >= +10%) |
| Blind voice identification | 62.5% (target > 60%) |

This is harness evidence from an isolated controlled instance, not proof that every live install diverges. The transfer experiment measures paired judge preference for answers that apply a control-theory principle to economics tasks; it is a small-n signal, not a substitute for the weekly curve.

`pairs.json` is an array of `{ "query": "...", "trained": "...", "fresh": "..." }`. The run is written to `~/.ntox/benchmarks/alive-<timestamp>.{json,md}` and compared with the previous run. M5 passes only when all three hold:

| Criterion | Target |
|---|---|
| Identity divergence from a fresh profile | `> 0.4` |
| Cross-domain transfer lift | `>= +10%` |
| Blind voice identification rate | `> 60%` |

Inspect the same state in the REPL:

| Command | What it shows |
|---|---|
| `/mind identity` | Narrative, values, positions with evidence, revisions |
| `/mind divergence` | Weighted profile distance from a fresh instance, by component |
| `/mind transfer` | Distant-domain theory pairs, hypotheses, supported/rejected lift (`scan` records hypotheses; `resolve <id> <baseline> <transfer>` records an outcome) |
| `/mind alive` | ALIVE-1 metrics, M5 criteria, and saved learning curve |
| `/mind consolidate` | Memory consolidation, opinion promotion, narrative refresh |

CI runs the `alive` job weekly and publishes the latest report to the workflow step summary.

## Roadmap

See [`docs/NTOX_IMPROVEMENT_PLAN.md`](docs/NTOX_IMPROVEMENT_PLAN.md) for the next planned work across skills, plugins, web UI polish, memory recovery, and evaluation proof.

## Contributing

This is a community-driven open-source project. Bug fixes, gateway plugins, voice support, tests, and documentation are all welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT, see [LICENSE](LICENSE).

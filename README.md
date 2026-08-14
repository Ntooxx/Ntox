# NTOX - Cognitive CLI Agent

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)
[![CI](https://github.com/Ntooxx/Ntox/actions/workflows/ci.yml/badge.svg)](https://github.com/Ntooxx/Ntox/actions)
[![npm](https://img.shields.io/badge/npm-0.1.0-red)](package.json)
[![tests](https://img.shields.io/badge/tests-507%20passing-44cc11)](https://github.com/Ntooxx/Ntox/actions)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)

A self-improving CLI agent with persistent memory, a cognitive kernel, pattern compilation, theory distillation, and 74+ reasoning skills. Includes a runtime-neutral cognition API and DeepSeek Harness adapter. Multi-channel gateway (Telegram, Discord, Web UI). Docker sandboxing. Runs locally.

## Why NTOX?

NTOX is the only agent with a **cognitive kernel**: it doesn't just call tools, it compresses what it learns into reusable patterns and builds meta-theories from cross-domain observations. It's an experiment in agent meta-cognition that goes beyond "LLM + tool loop."

## Features

- **Cognitive Kernel**: Compresses queries to primitives, matches patterns in an 8D cognitive vector space, auto-compiles frequent patterns into reusable abstractions
- **Theory Store**: Distills conversations into learned knowledge: observations -> patterns -> theories -> meta-theories
- **Workspace Policy**: Profiles constrain reads, writes, shell cwd, network/browser tools, and auto-checkpoint edits before changes
- **Inspectable Traces**: `/trace` shows mode, strategy, memory/search/theory use, token ledger, policy decisions, tool calls, and checkpoints
- **Multi-Agent Debate**: 8 internal voices (Researcher, Critic, Physicist, Mathematician, Architect, Economist, Inventor, Experimentalist) debate complex questions before synthesizing an answer
- **False-Success Self-Correction**: Detects shallow reasoning and retries with deeper analysis
- **Persistent Memory**: Every exchange is embedded and searchable via cosine similarity (local fallback, no API key needed)
- **Multi-Channel Gateway**: Telegram, Discord (WebSocket with intents), and Web UI (glassmorphism dark chat) all run simultaneously
- **Skill Library**: 74+ markdown skill documents, auto-triggered by semantic search
- **Meta-Cognition**: Strategy classification, self-reflection, mistake journal, session intent, style optimization
- **Runtime-Neutral Cognition API**: Mount NTOX cognitive context and turn learning into another agent runtime without replacing its model, tools, or session engine
- **DeepSeek Harness Adapter**: Connects Harness lifecycle events to NTOX before-step context, tool outcomes, and post-turn learning
- **Correction-Aware Recall**: Explicit user corrections are stored as authoritative context ahead of older, conflicting memories
- **Tool Recovery Guidance**: Failed tool outcomes become a concise next-step prompt that asks the agent to use a fallback or verify its input instead of repeating the same call
- **Live OpenRouter Model Catalog**: Loads the current OpenRouter models API at startup, refreshes the selector during long sessions, and supports `/model refresh` for an immediate catalog update
- **9 LLM Providers**: OpenAI, Anthropic, Ollama, LM Studio, Groq, Together, Mistral, DeepSeek, OpenRouter
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
ntox setup                # Configure tokens
```

### Channels

| Channel      | Setup                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------- |
| **Telegram** | Create bot via [@BotFather](https://t.me/BotFather), set `telegramToken` in config           |
| **Discord**  | Create app at [Discord Developer Portal](https://discord.com/developers), set `discordToken` |
| **Web UI**   | Auto-starts at `http://127.0.0.1:3000`, local-only by default                                |

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
| `/workspace`              | Show active workspace profile                    |
| `/permissions`            | Show tool permissions and recent denials         |
| `/approve`                | Approve or deny a risky shell command            |
| `/agents`                 | Inspect subagent runs                            |
| `/skill`                  | List / learn / load skills                       |
| `/kernel`                 | Decision kernel commands                         |
| `/new`                    | Reset conversation                               |

## Project Structure

```
ntox/
├── src/
│   ├── cli/           REPL, terminal rendering, animations
│   ├── core/          Agent loop, config, LLM client (9 providers)
│   ├── cognition/     Cognitive kernel, pattern store, vector space
│   ├── memory/        Episodic + theory memory, user model, relationship
│   ├── meta/          Strategy, reflection, mistakes, proactive, self-awareness
│   ├── skills/        Skill registry, library scanner, executor, learner
│   ├── tools/         Filesystem, shell, grep, web tools
│   ├── research/      False-success detection, theory store
│   ├── benchmark/     NCB cognitive benchmark
│   ├── types/         TypeScript interfaces
│   └── index.ts       Entry point
├── skills/            45+ bundled reasoning skill documents
├── .github/workflows/ CI/CD
├── AGENTS.md          Guide for AI-assisted contributors
├── CONTRIBUTING.md    Guide for human contributors
└── package.json
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
| **Prompt**           | Injects detection (14 patterns: DAN, jailbreak, override, etc.)                                                          |
| **Output**           | Sanitizes secrets (API keys, tokens, private keys) from responses                                                        |
| **Telegram/Discord** | Optional user allowlists (`telegramAllowedUsers`, `discordAllowedUsers`)                                                 |
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

The current functional verification result is 11 of 12 passing checks: the remaining failure is the repository-wide Prettier check, which currently reports 118 source files requiring formatting. Linting, 522 root tests, builds, CLI startup, the cognition and Alive smoke scenarios, and all adapter checks pass.

## Contributing

This is a community-driven open-source project. Bug fixes, gateway plugins, voice support, tests, and documentation are all welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT, see [LICENSE](LICENSE).

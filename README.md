# NTOX — Cognitive CLI Agent

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)
[![CI](https://github.com/antonpupkov/ntox/actions/workflows/ci.yml/badge.svg)](https://github.com/antonpupkov/ntox/actions)
[![npm](https://img.shields.io/badge/npm-0.1.0-red)](package.json)
[![tests](https://img.shields.io/badge/tests-206%20passing-44cc11)](https://github.com/antonpupkov/ntox/actions)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)

A self-improving CLI agent with persistent memory, cognitive kernel, pattern compilation, theory distillation, and 74+ reasoning skills. Multi-channel gateway (Telegram, Discord, Web UI). Docker sandboxing. Runs locally.

## Why NTOX?

NTOX is the only agent with a **cognitive kernel** — it doesn't just call tools, it compresses what it learns into reusable patterns and builds meta-theories from cross-domain observations. It's an experiment in agent meta-cognition that goes beyond "LLM + tool loop."

## Features

- **Cognitive Kernel** — Compresses queries to primitives, matches patterns in an 8D cognitive vector space, auto-compiles frequent patterns into reusable abstractions
- **Theory Store** — Distills conversations into learned knowledge: observations → patterns → theories → meta-theories
- **Multi-Agent Debate** — 8 internal voices (Researcher, Critic, Physicist, Mathematician, Architect, Economist, Inventor, Experimentalist) debate complex questions before synthesizing an answer
- **False-Success Self-Correction** — Detects shallow reasoning and retries with deeper analysis
- **Persistent Memory** — Every exchange is embedded and searchable via cosine similarity (local fallback, no API key needed)
- **Multi-Channel Gateway** — Telegram, Discord (WebSocket with intents), and Web UI (glassmorphism dark chat) all run simultaneously
- **Skill Library** — 74+ markdown skill documents, auto-triggered by semantic search
- **Meta-Cognition** — Strategy classification, self-reflection, mistake journal, session intent, style optimization
- **9 LLM Providers** — OpenAI, Anthropic, Ollama, LM Studio, Groq, Together, Mistral, DeepSeek, OpenRouter
- **Tool System** — read, write, edit, glob, grep, bash (with security blocklist + Docker sandboxing), web fetch
- **User Model** — Learns verbosity, technical level, communication style, and vocabulary over time
- **Prompt Injection Guard** — 14 injection pattern detectors + output secret sanitization

## Quick Start

```bash
# One-liner (macOS / Linux)
curl -fsSL https://raw.githubusercontent.com/antonpupkov/ntox/main/install.sh | bash

# One-liner (Windows PowerShell)
irm https://raw.githubusercontent.com/antonpupkov/ntox/main/install.ps1 | iex

# Or via npm
npm install -g ntox
ntox setup                # Interactive wizard — sets up API key, model, channels
ntox                      # Start chatting in the terminal
```

## Gateway

```bash
ntox gateway              # Run all configured channels (Telegram, Discord, Web UI)
ntox setup                # Configure tokens
```

### Channels

| Channel | Setup |
|---------|-------|
| **Telegram** | Create bot via [@BotFather](https://t.me/BotFather), set `telegramToken` in config |
| **Discord** | Create app at [Discord Developer Portal](https://discord.com/developers), set `discordToken` |
| **Web UI** | Auto-starts at `http://localhost:3000` — no configuration needed |

### Docker

```bash
docker compose up -d      # Runs gateway with all configured channels
```

## Commands

| Command | Description |
|---|---|
| `/help` | Show help |
| `/config` | Show configuration |
| `/model` | Switch AI model |
| `/provider` | Switch AI provider |
| `/sound` | Toggle sounds / set volume |
| `/cognition` | Cognitive kernel status |
| `/memory` | Browse memory stats |
| `/skill` | List / learn / load skills |
| `/kernel` | Decision kernel commands |
| `/new` | Reset conversation |

## Project Structure

```
ntox/
├── src/
│   ├── cli/           REPL, terminal rendering, animations, sound
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

| Layer | Protection |
|---|---|
| **File system** | Blocks reads/writes to `.ssh/`, `.aws/`, `.git/config`, `.env`, `.gnupg/`, `.netrc`, `.npmrc` |
| **Web fetch** | Blocks `file://`, `localhost`, all private IP ranges (`10.x`, `192.168.x`, `172.16-31.x`, `169.254.x`), `0.0.0.0`, `::1` |
| **Grep** | Rejects ReDoS patterns (nested quantifiers), pattern length limit, benchmarked regex execution |
| **Shell** | Regex blocklist for destructive commands + optional Docker sandboxing (`dockerEnabled: true`) |
| **Prompt** | Injects detection (14 patterns: DAN, jailbreak, override, etc.) |
| **Output** | Sanitizes secrets (API keys, tokens, private keys) from responses |
| **Telegram** | Optional user allowlist (`telegramAllowedUsers` in config) — only whitelisted users can interact |
| **Config** | Zod schema validates all 22 config fields on load |

## Testing

```bash
npm test            # Run tests (19 test files, 206 tests)
npm run typecheck   # TypeScript checks
npm run build       # Build
npm run coverage    # Test coverage report
```

## Contributing

This is a community-driven open-source project. Bug fixes, gateway plugins, voice support, tests, and documentation are all welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
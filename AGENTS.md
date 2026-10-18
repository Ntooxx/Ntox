# NTOX - Agent Guide for AI Contributors

## Project Overview

NTOX is a cognitive CLI agent with meta-cognition, pattern compilation, theory memory, and a skill system. Written in TypeScript, runs on Node.js 18+.

## Key Architecture

```
src/
├── cli/           REPL loop, render, animation, slash commands
├── core/          Agent entry point, LLM client, config, dispatcher, policy
│   ├── agent.ts   Main agent loop, manages messages, tool calls, memory, meta-cognition
│   ├── llm.ts     LLM streaming client, 10 providers, OpenAI/Anthropic/Ollama formats
│   ├── config.ts  Config load/save, base dir resolution
│   └── local-embed.ts  Fallback deterministic embedding
├── cognition/     Cognitive kernel, pattern compilation, cognitive vector space
├── memory/        Episodic store (embeddings), theory memory, user model, relationship
├── meta/          Strategy classification, reflection, mistakes, proactive, self-awareness, style
├── skills/        Skill registry, library scanner, executor, learner
├── tools/         Filesystem (read/write/edit/glob/ls), shell, grep, web fetch, voice
├── research/      False-success detection, theory store
├── gateway/       Telegram, Discord, WhatsApp, web channel plugins
├── alive/         Host monitoring: file watcher, git polling, wake predictions
├── kernel/        Decision kernel (goals, subtasks, verifier)
├── types/         Shared TypeScript interfaces
└── index.ts       Entry point
```

## Agent Loop (src/core/agent.ts)

`Agent.run(userInput, callbacks)` is the core loop:

1. Push user message to `this.messages[]`
2. Prompt-injection guard, then classify response mode (casual, tool-execute, profile-update, etc.)
3. Try kernel routing first for tool modes
4. Check for quick handlers (profile updates, one-word answers)
5. Classify strategy, build system prompt with memories/skills/reflections
6. Stream LLM response with native function calling, execute tools, loop (max 10 attempts)
7. False-success self-correction, store to memory, trigger theories, detect mistakes
8. Post-turn: reflection, proactive suggestions, then `manageContextWindow()` token-budget truncation

## Important Conventions

- **No comments in code**: the code should be self-documenting
- **No emojis in code**: only in user-facing strings
- **async generators** for streaming: `async *run()` pattern
- **Tool format**: native function calling (OpenAI `tool_calls` / Anthropic `tool_use`), not XML
- **Config**: `~/.ntox/config.json`, loaded via `loadConfig()`
- **Provider routing**: `resolveProvider()` checks `configuredProvider` first, then model prefix, falls back to openrouter
- **Security**: shell tool has a blocklist in `src/tools/shell.ts`; never bypass it
- **Tests**: vitest, run with `npm test`. Always add tests for new features.

## Gateway Pattern (for messaging contributors)

The current architecture supports REPL and multi-channel gateway. To add a new messaging channel:

1. Reuse `src/core/dispatcher.ts` for shared/session infrastructure and gateway message execution
2. Create a `Gateway` class in `src/gateway/` that accepts inbound messages and returns responses
3. Each channel becomes a plugin (`src/gateway/telegram.ts`, etc.)
4. Keep REPL-specific rendering in `src/cli/repl.ts`; move shared behavior into dispatcher/services

See `src/core/dispatcher.ts` and `src/core/message-handler.ts` for the shared streaming infrastructure.

## Good First Issues

- Add Slack or Matrix gateway plugin
- Wire existing STT/TTS tools into Telegram/Discord voice messages
- Add WhatsApp typing indicator and media handling (currently placeholders only)
- Make Docker sandbox the default shell path when available
- Add real-provider integration tests for each LLM wire format
- Publish cognitive benchmark results in the README (run `npm run bench:cognitive` with credentials)

# NTOX — Agent Guide for AI Contributors

## Project Overview

NTOX is a cognitive CLI agent with meta-cognition, pattern compilation, theory memory, and a skill system. Written in TypeScript, runs on Node.js 18+.

## Key Architecture

```
src/
├── cli/           REPL loop, render, animation, sound
├── core/          Agent entry point, LLM client, config
│   ├── agent.ts   Main agent loop — manages messages, tool calls, memory, meta-cognition
│   ├── llm.ts     LLM streaming client — 9 providers, OpenAI/Anthropic/Ollama formats
│   ├── config.ts  Config load/save, base dir resolution
│   └── local-embed.ts  Fallback deterministic embedding
├── cognition/     Cognitive kernel — pattern compilation, cognitive vector space
├── memory/        Episodic store (embeddings), theory memory, user model, relationship
├── meta/          Strategy classification, reflection, mistakes, proactive, self-awareness, style
├── skills/        Skill registry, library scanner, executor, learner
├── tools/         Filesystem (read/write/edit/glob/ls), shell, grep, web fetch
├── research/      False-success detection, theory store
├── types/         Shared TypeScript interfaces
└── index.ts       Entry point
```

## Agent Loop (src/core/agent.ts)

`Agent.run(userInput, callbacks)` is the core loop:

1. Push user message to `this.messages[]`
2. Classify response mode (casual, tool-execute, profile-update, etc.)
3. Try kernel routing first for tool modes
4. Check for quick handlers (profile updates, one-word answers)
5. Call `manageContextWindow()` — token-budget truncation
6. Classify strategy, build system prompt with memories/skills/reflections
7. Stream LLM response, parse `<tool_call>` XML, execute tools, loop
8. Store to memory, trigger theories, check false-success, detect mistakes

## Important Conventions

- **No comments in code** — the code should be self-documenting
- **No emojis in code** — only in user-facing strings
- **async generators** for streaming — `async *run()` pattern
- **Tool format** — XML `<tool_call><name>args</name></tool_call>` wrapped in JSON
- **Config** — `~/.ntox/config.json`, loaded via `loadConfig()`
- **Provider routing** — `resolveProvider()` checks `configuredProvider` first, then model prefix, falls back to openrouter
- **Security** — bash tool has a blocklist in `src/tools/shell.ts`; never bypass it
- **Tests** — vitest, run with `npm test`. Always add tests for new features.

## Gateway Pattern (for messaging contributors)

The current architecture is REPL-only. To add messaging (Telegram, WhatsApp, etc.):

1. Extract the message processing from `repl.ts` `handleMessage()` into a shared service
2. Create a `Gateway` class in `src/gateway/` that accepts inbound messages and returns responses
3. Each channel becomes a plugin (`src/gateway/telegram.ts`, etc.)
4. The REPL and the gateway both consume the same `Agent` class

See `src/cli/repl.ts:1079-1196` for the message handling core.

## Good First Issues

- Add Telegram gateway plugin
- Add voice input (Whisper STT)
- Add TTS output (ElevenLabs/OpenAI)
- Add GitHub Actions CI badge
- Write tests for the cognitive kernel
- Add Dockerfile for deployment

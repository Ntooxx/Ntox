# Contributing to NTOX

Thanks for your interest! NTOX is a cognitive CLI agent with meta-cognition, pattern compilation, theory memory, and a skill system.

## How to Contribute

### 🐛 Report a Bug
Open an issue with:
- What you expected
- What happened
- Steps to reproduce
- Your `npm version` and `node --version`

### 💡 Suggest a Feature
Open an issue with:
- What you want to build
- Why it fits NTOX (cognitive, meta-cognitive, or agentic features)
- Rough implementation sketch if you have one

### 🛠 Submit a PR

1. Fork the repo
2. Create a branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Run the gate: `npm run verify:all`
5. Push and open a PR

### PR Guidelines

- **No comments in code**: write self-documenting code
- **No emojis** in code or commit messages
- **Tests required**: new features must include tests
- **Typecheck must pass**: `npm run typecheck`
- **All tests must pass**: `npm test`
- **Gate must be green**: `npm run verify:all` (typecheck, lint, size budget, tests, build, format, package + smoke checks)
- One PR = one feature/fix. Keep it focused.

### Release tiers

Surfaces follow the [Support Matrix](README.md#support-matrix):

- **Core** (CLI REPL, Telegram, Web UI, HTTP API): every release is gated by `npm run verify:all`.
  Changes must not reduce coverage or break the other Core channels.
- **Best-effort** (Discord, WhatsApp, Slack, Electron desktop, MCP bridge, Marketplace): may lag
  Core, but still needs its own tests, a README section/matrix row, and a named maintainer.
  Sandboxed directories (`experiments/`, `glyphs/`, `site/`, `desktop/`) are excluded from the
  published npm package; the bundled `marketplace/` index ships for offline skill lookup.

### New surface checklist

Before adding a channel or integration:

1. Tests for the happy path and failure/approval paths, not just a mocked smoke test.
2. README: a Support Matrix row plus a short section covering setup and limitations.
3. A named owner who triages issues for that surface.
4. A CI job if it needs secrets or external services; keep secrets out of the repository.
5. `npm run verify:all` green, with no regressions to Core gates.

### Gateway Architecture (for messaging/voice contributors)

NTOX has a multi-channel gateway supporting Telegram, Discord, and Web UI. To add a new channel:

1. Create `src/gateway/your-channel.ts` implementing the gateway interface
2. Register the channel in the gateway startup flow
3. The REPL and gateway both consume the same `Agent` class from `src/core/agent.ts`

See `AGENTS.md` for a fuller architecture reference.

## Development Setup

```bash
git clone https://github.com/Ntooxx/Ntox.git
cd ntox
npm install
npm run dev    # Hot-reload development
```

## Code of Conduct

Be respectful. Disagreement is fine; personal attacks are not. NTOX is about building better agents, not gatekeeping.

## License

MIT
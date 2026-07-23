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
4. Run tests: `npm test` and `npm run typecheck`
5. Push and open a PR

### PR Guidelines

- **No comments in code**: write self-documenting code
- **No emojis** in code or commit messages
- **Tests required**: new features must include tests
- **Typecheck must pass**: `npm run typecheck`
- **All tests must pass**: `npm test`
- One PR = one feature/fix. Keep it focused.

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
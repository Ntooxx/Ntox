# NTOX Highlights

> **An agent runtime with a closed learning loop, and the instrumentation to see it work.**

NTOX adds the layer most agents skip. It states what it expects before it acts, records what happened afterwards, credits the context it used, and updates the next turn.

---

## The loop

One contract runs the whole system. Every subsystem has to name its prediction and its update, or it does not ship.

| Stage | What happens |
| --- | --- |
| **Predict** | An expected outcome and a confidence, stated before any tool runs. |
| **Act** | Model, tools, policy, memory and skills, through one composition root. |
| **Observe** | Corrections, rephrases, tool failures and outcomes captured as signals. |
| **Attribute** | The result is linked to the memories, patterns and skills that were present. |
| **Update** | Stance, confidence and per-domain strength are adjusted. |
| **Reuse** | Memory is re-ranked, context recompiled, the winning stance selected again. |

---

## What is actually built

**Memory with authority.** Corrections outrank older conflicting facts and are injected ahead of them. Durable facts carry provenance, confidence, contradiction counts and a full edit history. Retrieval is re-ranked by recorded reliability, not only recency.

**A reasoning library.** 81 written frameworks across 17 categories, matched semantically at prompt time, with a learner that extracts more from experience.

**Stance selection.** A Thompson-sampling bandit chooses between standard, direct, verify and clarify per query type, and learns from the outcome record.

**Symbolic goals.** Goals, subtasks with dependencies, explicit success predicates, and a verifier that records outcomes independently of the model.

**An event engine.** `ntox/alive` keeps an explicit state of what the agent expects and what it is waiting for. Predictions, open loops, surprise-driven wake decisions. It never calls a model on its own and never watches the machine: consent-based events in, a cheap decision out.

**Bounded host adapters.** While the REPL runs, they read the active workspace and Git state. Never typing, never other applications, never remote services.

---

## Instrumented

Most agents tell you what they did. NTOX scores how well it knew what it was doing.

- **Predictions are scored.** Brier score and expected calibration error, computed against what actually happened and tracked per stance.
- **Outcomes are logged.** One row per turn: context used, tools called, prediction, error, reward. Readable at `~/.ntox/mind/outcomes.jsonl`.
- **Everything is inspectable.** `/trace` shows stance, tokens, cost, policy decisions and checkpoints. `/mind` shows calibration, divergence and the learning curve.

This is the part of the project that is genuinely ahead, and it is what makes the rest of the claims checkable rather than asserted.

Full evaluation artifacts live in `experiments/` and `integrations/` - every run, not just the good ones. Regenerate any of them:

```bash
npm run eval:necessity   # deterministic, no API key
npm run bench:alive      # the full ALIVE-1 report
npm run verify:all       # the complete proof gate
```

---

## Where it runs

The terminal is the product. Streaming, trace inspection, the outcome ledger and the checkpoints are all readable from inside the REPL. The gateways exist because the shared runtime made them cheap.

| Surface | What you get |
| --- | --- |
| **CLI** | Streaming REPL, sessions and resume, trace inspection, slash commands |
| **HTTP / SSE** | `/api/chat`, `/api/session/reset`, `/api/health`, localhost-bound |
| **Web UI** | Streamed chat, command palette, activity drawer, approvals, voice |
| **Messaging** | Telegram, Discord and WhatsApp on the same dispatcher and memory |
| **Embed it** | `ntox/cognition`, `ntox/alive`, `ntox/alive/host` as package exports |

Nine named providers - OpenAI, Anthropic, OpenRouter, DeepSeek, Groq, Together, Mistral, Ollama, LM Studio - plus any OpenAI-compatible endpoint. Local models and local embeddings both work without a key.

---

## Guard rails

Every tool call from every entry point goes through one policy runtime.

- Workspace-confined reads, writes and shell
- Pre-edit checkpoints and an approval queue for risky commands
- `.ssh`, `.aws`, `.env`, `.gnupg`, `.netrc`, `.npmrc` denied
- Localhost, private ranges and `file://` rejected
- Injection screening on input, secret sanitisation on output
- Destructive-command blocklist, Docker sandbox where available

Precise boundary: shell commands run without process isolation on Windows unless `dockerEnabled` is set. The blocklist is a guard rail, not a boundary.

---

## Under the hood

163 source modules, about 32,000 lines of strict TypeScript across 18 subsystems. 957 tests in 95 files, a 12-check verification gate, CI on Node 18, 20 and 22. Eight runtime dependencies. Layered imports with a single composition root for tools.

---

## Try it

```bash
npm install -g ntox
ntox setup
ntox
```

```bash
ntox gateway      # all configured channels
ntox gateway web  # the browser chat
ntox api          # HTTP/SSE for your own apps
```

MIT licensed. Contributions welcome.

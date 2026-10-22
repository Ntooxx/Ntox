# NTOX Highlights

> **A local-first cognitive agent that predicts, remembers, corrects itself, and shows its receipts.**

Most agents are a model plus a tool loop. NTOX adds the layer that is usually missing: a closed learning loop. It states what it expects before answering, records what actually happened, attributes the result to the context it used, and changes the next turn.

This is a curated tour of the strongest parts of the project. Every claim points to code, a test, or a saved experiment.

**The short version:** a closed learning loop, memory with authority, measurable identity, privacy-bounded aliveness, and an evaluation stack that keeps the claims honest.

---

## At a glance

| Signal | What it means |
| --- | --- |
| **957 tests** in 95 files | The suite runs in about 8 seconds and covers policy, security, memory, gateways, and the turn pipeline. |
| **12 / 12** verification checks | Last recorded full gate: typecheck, lint, format, tests, build, package contents, built CLI, cognition export, and adapter package. |
| **6 / 6** necessity checks | Each core cognitive subsystem is proven to affect prompt context or behavior, not just write files. |
| **81 skill documents** across 17 category folders | Markdown reasoning frameworks with semantic activation and a learner for new ones. |
| **9 named providers** | OpenAI, Anthropic, OpenRouter, DeepSeek, Groq, Together, Mistral, Ollama, and LM Studio, plus any OpenAI-compatible endpoint. |
| **5 chat surfaces** | CLI, Telegram, Discord, WhatsApp, and a local Web UI, plus an HTTP/SSE API and a DeepSeek Harness adapter. |
| **163 source modules** | About 32,000 lines of strict TypeScript across 18 subsystems. |
| **M5 PASS** | Identity divergence 0.4125, transfer lift +67% to +100%, blind voice identification 62.5% to 68.75% across saved runs. |

---

## 1. A real learning loop, not prompt decoration

The newest and most important subsystem is `src/mind/`. It implements one law on every turn:

```text
PREDICT -> ACT -> OBSERVE -> ATTRIBUTE -> UPDATE -> REUSE
```

| Stage | What NTOX does | Where it lives |
| --- | --- | --- |
| **Predict** | Before answering, it states an expected outcome and confidence, using a free heuristic predictor or an optional LLM predictor. | `src/mind/predictor.ts`, `src/mind/llm-predictor.ts` |
| **Act** | The normal agent turn runs: model, tools, policy, memory, skills. | `src/core/agent.ts` |
| **Observe** | Corrections, rephrases, thanks, tool failures, tests, and objective signals are captured. | `src/mind/outcome-ledger.ts` |
| **Attribute** | The outcome ledger scores the turn and links it to the specific memories, theories, skills, and context that were present. | `src/mind/outcome-ledger.ts`, `src/mind/reliability.ts` |
| **Update** | A Thompson-sampling bandit adjusts strategy choice, calibration tracks confidence, and a capability model tracks per-domain strength. | `src/mind/bandit.ts`, `src/mind/predictor.ts`, `src/mind/capability.ts` |
| **Reuse** | The next turn re-ranks memory by reliability, recompiles context under a token budget, and selects the strategy with the best expected result. | `src/mind/mind.ts`, `src/mind/context-compiler.ts` |

This is the difference between an agent that stores history and an agent that learns from it. The loop is wired into the shared dispatcher, so the CLI, gateways, and API all use it.

Between user turns, idle jobs can resolve open loops, consolidate memory, reflect on surprises, prepare context, run self-play, and propose new work. See `src/mind/jobs.ts` and `src/mind/idle.ts`.

---

## 2. Memory that earns its place

NTOX does not treat memory as a transcript. It separates kinds of knowledge and gives them different authority:

- **Corrections outrank older facts.** When you say "no, that's wrong", the corrected fact is stored as authoritative and injected ahead of conflicting memories. The necessity suite proves the ordering.
- **Durable facts carry provenance.** Facts have confidence, source, contradiction counts, and a full edit history (`src/memory/episodic.ts`).
- **Theories can be falsified.** Observations become patterns, patterns become theories, and theories become meta-theories. Each theory carries predictions, falsification criteria, and evidence-driven confidence (`src/research/theory-store.ts`, `src/memory/theory-memory.ts`).
- **The user model is behavioral.** Verbosity, technical level, communication style, vocabulary, projects, and goals are learned over time (`src/memory/user-model.ts`).
- **Retrieval is ranked by usefulness.** The reliability store records which context kinds and items actually helped, so relevance is not just cosine similarity or recency (`src/mind/reliability.ts`).

The result is memory with a point of view: not everything remembered is equally trusted.

---

## 3. Identity you can measure

NTOX does not just claim that a trained instance feels different. It measures the difference.

Milestone M5 asks whether a trained instance is distinguishable from a fresh one by behavior alone. The saved controlled run passes all three criteria:

| Criterion | Target | Saved run | Earlier run |
| --- | --- | --- | --- |
| Identity divergence from a fresh profile | > 0.4 | **0.4125** | 0.4125 |
| Cross-domain transfer lift | >= +10% | **+66.7%** | +100% |
| Blind voice identification rate | > 60% | **68.75%** | 62.5% |

**Milestone M5: PASS.**

The evidence is in `experiments/m5/trained/benchmarks/`. The commands that expose it are real:

- `/mind identity` shows the narrative, values, evidence-backed positions, and revisions.
- `/mind divergence` shows weighted distance from a fresh instance, by component.
- `/mind transfer` shows distant-domain theory pairs and supported or rejected lift.
- `/mind alive` shows ALIVE-1 metrics, M5 criteria, and the learning curve.
- `/mind consolidate` runs memory consolidation, opinion promotion, and narrative refresh.

Caveat, stated in the project itself: this is controlled harness evidence from isolated instances, not proof that every live install diverges. That honesty is part of the design.

---

## 4. Alive: event-driven, not always-on

`ntox/alive` is a standalone cognition core built around predictions, prediction error, open loops, and wake decisions. It does not call an LLM and does not watch your computer by itself. A host supplies consented events.

The model is small and legible:

- **Prediction:** a statement, a confidence, and an expected event.
- **Open loop:** a goal or hypothesis awaiting evidence, optionally with a deadline.
- **Action:** `ignore`, `learn`, `wake`, or `notify`.

When an event arrives, NTOX compares it to linked expectations, computes prediction error, resolves open loops, and decides whether the event is ignorable, learnable, surprising enough to wake cognition, or requires a human.

The local host adapters are privacy-bounded. While the REPL runs, they watch only the active workspace, poll Git every 30 seconds, and pulse deadlines every minute. They ignore `.git`, `.ntox`, dependencies, build output, and coverage. They never monitor typing, other applications, or remote services. A wake result is added only to the next user-triggered model turn.

The engine ships as a public package surface: `ntox/alive`, `ntox/alive/ntox`, and `ntox/alive/host`.

---

## 5. Evidence is part of the product

Many projects have features. NTOX has instrumentation for deciding whether the features work.

### Necessity checks: 6 / 6

Deterministic interventions prove each subsystem is causally used:

- stored memories enter the prompt only when memory is enabled,
- corrections are injected ahead of conflicting memories,
- the kernel contributes context only after a pattern is reinforced,
- patterns are created at the third co-occurrence and compile after reinforcement,
- cross-domain observations generalize into theory context,
- surface reasoning is flagged while mechanism-based reasoning is not.

Run it with `npm run eval:necessity`. No API key required.

### Longitudinal evaluation: a powered result

A 30-task run on `deepseek-v4-flash` compared subsystems off versus on:

| Arm | Mean score |
| --- | --- |
| off | 0.500 |
| all | 0.700 |

Delta **+0.200**, 95% CI **[0.067, 0.350]**, effect size **d = 0.519**, n = 30, required n = 30, **significant**. The mechanism was cross-session episodic recall: the `all` arm stored and retrieved a fact after a conversation reset; the `off` arm could not.

The same report found a retrieval bias in cumulative recall. That is not a weakness of the evaluation; it is the evaluation doing its job.

### Cognitive benchmark: a diagnostic, not a victory lap

NTOX ships a 20-category cognitive benchmark (`src/benchmark/`). The committed run on `deepseek-v4-flash` scored **45.65 overall**, with **70% abstraction**, **62% architecture**, and **59% emergence**. It also exposed weak categories such as prediction and discovery, which is exactly what a benchmark should do.

A paired DeepSeek experiment showed:

- thinking quality **+11%** (4.76 to 5.30),
- false-success rate **40% to 25%**,
- token efficiency **improved by 11%**,
- total cost **$0.023** for 121,324 tokens.

### Harness proof: the memory actually crossed sessions

In a paired DeepSeek Harness run, the baseline could not recall a deployment codename from an earlier session. NTOX returned it exactly:

- seeded fact: `orion-lighthouse`
- baseline recall: failed
- NTOX recall: `orion-lighthouse`

Report: `experiments/harness-proof/report.json`.

### Verification gate

`npm run verify:all` runs linting, type checking, formatting, tests, builds, package contents, the built CLI, the built cognition export, the Alive smoke scenario, and every adapter package check. The last recorded run is **12 / 12 passing**.

This is the rare project where the claims have a paper trail.

---

## 6. Breadth without lock-in

NTOX meets you where you already work:

| Surface | What you get |
| --- | --- |
| **CLI** | Streaming REPL, animations, themes, sessions, resume, trace inspection, slash commands. |
| **Web UI** | Local chat at `127.0.0.1:3000`, streamed responses, command palette, activity drawer, approvals, voice capture, installable PWA shell. |
| **Telegram** | Bot gateway with per-user allowlists and session handling. |
| **Discord** | WebSocket gateway with intents. |
| **WhatsApp** | Webhook gateway with `X-Hub-Signature-256` verification. |
| **HTTP/SSE API** | `/api/chat`, `/api/session/reset`, and `/api/health` for your own web apps. |
| **DeepSeek Harness** | A lifecycle adapter that supplies cognitive context before a step and learns from tool and turn outcomes. |
| **Packages** | `ntox/cognition`, `ntox/alive`, `ntox/alive/ntox`, and `ntox/alive/host` as public exports. |

Provider freedom is real:

- **9 named providers**, including OpenAI, Anthropic, OpenRouter, DeepSeek, Groq, Together, Mistral, Ollama, and LM Studio.
- **Any OpenAI-compatible endpoint** through a configurable base URL.
- **Local embeddings** with a deterministic fallback, so semantic memory works without an API key.
- **Local models** through Ollama and LM Studio.
- **Docker sandboxing** and a `docker compose` setup for the gateway.

No single vendor owns the runtime.

---

## 7. Security as architecture

NTOX assumes the model can be wrong, the web can be hostile, and the shell can be dangerous. Protections are layered:

- **Workspace policy:** reads, writes, shell working directories, network tools, and browser tools are confined by profile. Edits are auto-checkpointed before changes.
- **Approval flow:** risky shell commands can require an explicit `/approve` in both the REPL and gateways.
- **Filesystem blocks:** `.ssh/`, `.aws/`, `.git/config`, `.env`, `.gnupg/`, `.netrc`, and `.npmrc` are denied.
- **Network blocks:** `file://`, localhost, loopback, link-local, and private IP ranges are rejected for fetch and browser tools.
- **Shell safety:** a destructive-command blocklist plus optional Docker sandboxing.
- **Regex safety:** ReDoS patterns are rejected, pattern length is capped, and regex execution is benchmarked.
- **Prompt safety:** an injection pattern guard screens user input before the turn.
- **Output safety:** API keys, tokens, and private keys are sanitized from responses.
- **Gateway safety:** Telegram and Discord allowlists, WhatsApp HMAC verification, and a Web UI bound to localhost by default.
- **Config safety:** Zod validates configuration, and saved config uses best-effort `0600` permissions.

The policy layer is a single choke point shared by the REPL, gateways, API, subagents, and harness. There is no alternate path around it.

---

## 8. A codebase built to be trusted

- **957 tests** across 95 files, running in about 8 seconds.
- **CI on Node 18, 20, and 22**, with typecheck, lint, tests, and coverage on every push.
- **A weekly ALIVE-1 job** that publishes its report to the workflow summary.
- **Strict TypeScript** with ESLint, Prettier, and Zod schemas.
- **Layered imports** with a single composition root for tools.
- **Eight focused runtime dependencies**, plus optional Playwright for browser work.
- **Inspectable traces:** `/trace` shows mode, strategy, memory and search use, theory use, token ledger, policy decisions, tool calls, and checkpoints.
- **A token and cost ledger**, so autonomy has a budget.
- **Pre-edit checkpoints**, so a bad tool call is recoverable.

The architecture is cleaner than its size suggests. That is why the feature list can keep growing without the runtime becoming a pile of special cases.

---

## 9. Details that make it feel finished

- `ntox setup` walks through provider, key, model, and channels.
- `ntox doctor` diagnoses provider, browser, sandbox, and workspace health.
- `ntox --continue` and `ntox --resume <id>` make sessions feel durable.
- `/model refresh` pulls the live OpenRouter catalog during long sessions.
- `/permissions` and `/approve` make risky actions visible and controllable.
- `/agents` exposes subagent runs.
- The CLI has phase indicators, tool and memory feedback, convergence animation, and an exit fade.
- The Web UI has a command palette, conversation search, activity stream, approval prompts, and voice input.
- One-line installers exist for macOS, Linux, and Windows PowerShell.
- Docker Compose runs the gateway with all configured channels.

These are not the reason to adopt NTOX, but they are the reason it feels like a product rather than a demo.

---

## 10. The honest edge

NTOX is an experiment, not a finished mind. Some of its most ambitious machinery is exposed through the cognition API and the Harness adapter rather than being fully active in every default turn. The evaluation samples are small. The cognitive benchmark is a diagnostic, not a leaderboard win. The M5 result is controlled evidence, not a universal claim.

What makes the project worth attention is not that it has solved meta-cognition. It is that it built the organs, closed several of the loops, and shipped the instrumentation to find out which ones actually matter.

That combination is rare.

---

## Try it

```bash
# One-liner (macOS / Linux)
curl -fsSL https://raw.githubusercontent.com/Ntooxx/Ntox/main/install.sh | bash

# One-liner (Windows PowerShell)
irm https://raw.githubusercontent.com/Ntooxx/Ntox/main/install.ps1 | iex

# Or via npm
npm install -g ntox
ntox setup
ntox doctor
ntox
```

Run the gateway, the web UI, or the API:

```bash
ntox gateway
ntox gateway web
ntox api
```

Run the evidence:

```bash
npm test
npm run eval:necessity
npm run verify:all
npm run bench:alive
```

MIT licensed. Contributions welcome.
# NTOX: What It Is

> A cognitive CLI agent that tries to remember, predict, correct itself, and build
> abstractions from experience. This document describes what is actually in the
> codebase, how each subsystem works, what is real at runtime, and where the gap
> between scaffolding and behavior still is.
>
> Version 0.1.0. Verified against the working tree on 2026-10-17:
> 207 TypeScript files (136 non-test, ~28,000 lines), 665 passing tests in 71 files,
> clean typecheck and lint.

---

## 1. Definition

NTOX is a local-first agent runtime with four layers that most agent projects do not have:

1. **A cognition layer** that compresses a query into a primitive representation, maps it
   into a learned domain space, retrieves learned patterns, and critiques its own answer.
2. **A memory layer** that persists episodes, durable facts, corrections, theories, and a
   model of the user across sessions.
3. **A meta-cognition layer** that classifies the kind of question being asked, tracks how
   the conversation is going, notices corrections, adapts style, and reflects on sessions.
4. **An aliveness layer** (`ntox/alive`) that models the agent as an event-driven system with
   predictions, prediction error, open loops, and wake decisions.

Around those sit conventional agent machinery: a streaming LLM client for 10 providers,
native tool calling, a policy-wrapped tool dispatcher, a skill library, multi-channel
gateways, and Docker sandboxing.

The shortest accurate description:

> NTOX is an experiment in whether an agent can be given the *machinery* of a mind —
> compression, memory, prediction, self-correction, identity — and whether that machinery
> can be made to measurably change behavior over time.

That last clause is the project's central open question, and this document returns to it
in section 16.

---

## 2. The Thesis

Four claims organize the codebase.

### Claim 1: Cognition is compression

A request does not need to be understood in full to be handled well. It needs to be
compressed into a small representation that is stable enough to match against experience.
NTOX compresses every query into a `PrimitiveRepresentation`:

```ts
{
  domains: string[],      // detected knowledge domains
  action: string,         // create | analyze | explain | code | plan | fact | general
  complexity: number,     // 0..1
  conceptualSummary: string
}
```

`src/cognition/compressor.ts:13-39`. Domains come from keyword sets for ten base domains
(`programming`, `python`, `javascript`, `rust`, `data_science`, `devops`, `database`,
`system_admin`, `design`, `writing`) plus learned extensions persisted in
`~/.ntox/domain-extensions.json` (`src/cognition/domains.ts:7-18, 85-106`). Action is
assigned by counting regex matches per verb class (`compressor.ts:4-27`). Complexity is
derived from average sentence length and domain count (`compressor.ts:29-31`).

This is deliberately cheap. It runs in microseconds and costs no tokens.

### Claim 2: Experience should become structure

If the same kind of problem recurs, the agent should not solve it from scratch. It should
strengthen a pattern, and after enough successful uses, compile the pattern into a reusable
abstraction. The pattern store implements this: repeated domain co-occurrence creates
patterns, successful use strengthens them, and at a compile threshold the pattern is
generalized or merged into a higher-level abstraction (`src/cognition/patterns.ts`).

### Claim 3: The agent should model itself and the user

A useful agent tracks more than the conversation. NTOX maintains:

- a **user model** (verbosity, expertise, style preferences, vocabulary, goals),
- a **relationship tracker** (bond level, interaction satisfaction),
- a **mental model of the user's beliefs** (opinions, generalizations, comparisons,
  assumptions, with contradiction statuses),
- a **mistake journal** of explicit corrections,
- a **self-model** of sessions, domains, and discovered capabilities,
- an **executive model** of goals, constraints, risks, and stated focus.

The intent is that these models are not dashboards. They are supposed to change what the
agent does next.

### Claim 4: Aliveness is closed loops, not features

The `alive` module defines the project's most ambitious idea: the agent should hold open
loops (goals awaiting evidence), make predictions with explicit expectations, observe
events, compute prediction error, and decide whether an event is ignorable, learnable,
wake-worthy, or requires a human. That is a control loop, not a prompt.

The thesis of the project is that a mind is what happens when these loops close.

---

## 3. System Map

```
                        +-------------------------------+
                        |  Entry points                 |
                        |  REPL | Gateway | HTTP API    |
                        |  Subagent | DeepSeek Harness  |
                        +---------------+---------------+
                                        |
                        +---------------v---------------+
                        |  Agent (src/core/agent.ts)    |
                        |  1,633 lines, turn pipeline   |
                        +--+--------+--------+--------+-+
                           |        |        |        |
             +-------------v--+  +--v-----+  +v-----+  +v----------------+
             | Cognition      |  | Memory |  | Meta |  | Alive          |
             | kernel         |  | episodic| | 21   |  | predictions    |
             | compressor     |  | durable | | sub- |  | open loops     |
             | 8D space       |  | theory  | | sys- |  | wake decisions |
             | patterns       |  | user    | | tems |  | event pulses   |
             | critic         |  | model   |  |      |  |                |
             +-------+--------+  +----+----+  +--+---+  +--------+-------+
                     |                |          |               |
             +-------v----------------v----------v---------------v-------+
             |  Shared substrate: LLM client, tool registry, policy,    |
             |  skills, token ledger, traces, checkpointing              |
             +-----------------------------------------------------------+
```

The import graph is acyclic. `cognition/` and `meta/` depend downward on `core/config`,
`core/local-embed`, and `types/`; nothing outside `core/` imports `core/agent`. The tool
dispatcher is a single composition root, so every entry point routes tools through the
same policy layer (`src/core/dispatcher.ts:117-138`).

---

## 4. The Turn Lifecycle

`Agent.run()` is the heart of the runtime (`src/core/agent.ts:728-1520`). One user message
flows through the following stages, in order. Stages marked *conditional* only run when
the relevant config flag is on.

| # | Stage | What it does |
|---|-------|--------------|
| 1 | Trace start | Allocates a per-turn trace object for `/trace` inspection |
| 2 | Prompt-injection guard | Regex screen for 17 injection patterns; blocked turns short-circuit |
| 3 | Response-mode classification | `casual`, `tool-execute`, `tool-build`, `profile-update`, etc. |
| 4 | Decision-kernel routing | *Conditional.* Handles `/kernel` and kernel-eligible modes before the LLM loop |
| 5 | Profile quick handlers | Regex handlers for "my name is X", "I work as Y" |
| 6 | Effectiveness scoring | Scores the previous answer using the current message as feedback; updates style optimizer |
| 7 | Interaction scoring | Scores satisfaction/solved-ness of the previous exchange; updates relationship |
| 8 | Session intent | First-message intent detection and later intent-shift detection |
| 9 | Strategy classification | Six query types; selects a strategy prompt |
| 10 | Correction detection | Detects "no, that's wrong" style corrections; writes to mistake journal and durable memory |
| 11 | Domain learning | Extracts new domain keywords from the message |
| 12 | Cognitive layer `beforeStep` | Assembles strategy, patterns, corrections, tool recovery, memory, and theory sections |
| 13 | Web search | *Conditional.* Searches if the query looks like it needs current facts |
| 14 | Skill matching | Semantic match against 83 markdown skills, plus compiled pattern skills |
| 15 | Alive pulse | Injects recent wake context if the host adapters produced one |
| 16 | Prompt assembly | Layer-ordered system prompt with token budget |
| 17 | Debate routing | *Conditional.* Eight-voice debate for high-stakes/ambiguous questions |
| 18 | ReAct tool loop | Up to 10 attempts: stream model, execute native tool calls, feed results back |
| 19 | False-success check | Detects shallow answers; retries with a deeper-analysis prompt |
| 20 | Post-turn learning | Reflection, proactive suggestion, self-awareness update, feedback request |
| 21 | Memory and theory writes | Episode stored; theory pipeline advanced; mistakes updated |
| 22 | Context management | Token-budget truncation/summarization for the next turn |

The pipeline is real and runs on every message. Two details matter for understanding
current behavior:

- The cognitive kernel is constructed but **disabled during the turn**:
  `cognitionEnabled: false, strategyEnabled: false` (`agent.ts:732-740`). Patterns and
  the critic do not run in the default CLI loop. The layer still performs memory,
  theory, mistake, and tool-recovery assembly.
- The layer is constructed with `embed: async () => []` (`agent.ts:190`), so semantic
  episodic retrieval is unavailable in the default loop. `buildMemoryContext` falls back
  to the five most recent episodes (`src/memory/episodic.ts`, `buildMemoryContext`).
  Theory retrieval still uses the deterministic local embedder internally.

So the default REPL is best described as: **meta-cognition and write-side learning on,
cognitive pattern matching off, semantic recall off.**

---

## 5. The Cognitive Core

### 5.1 The 8-dimensional cognitive space

Domains are embedded as unit vectors in an 8-dimensional space
(`src/cognition/cognitive-space.ts`). Initial vectors are derived from a hash of the domain
name, then optimized for 500 gradient-descent iterations against a hand-authored target
similarity matrix (`cognitive-space.ts:11-52, 99-156`). For example, `programming` and
`javascript` target 0.85 similarity; `programming` and `writing` target 0.25. The space is
persisted to `~/.ntox/cognition/cognitive-space.json`.

A query vector is the normalized sum of its domain vectors (`computeQueryVector`,
`cognitive-space.ts:167-188`). This gives a cheap, stable geometry for pattern matching
without calling an embedding API. It is not a semantic embedding space; it is a domain
geometry. That distinction is important: it can tell that "Rust" and "systems programming"
are adjacent, but it cannot represent a novel concept that has no domain keywords.

### 5.2 The pattern store

`src/cognition/patterns.ts` is the most complete expression of the "experience becomes
structure" idea.

- **Seeds.** Four seed patterns exist on first run: `software-dev`, `data-analysis`,
  `infrastructure`, `user-experience` (`patterns.ts:81-122`).
- **Learning.** Every query with two or more domains increments a co-occurrence counter.
  At count 3, a new pattern is created for that domain combination
  (`patterns.ts:203-243`). The co-occurrence table is capped at 500 entries.
- **Retrieval.** Patterns are scored by cosine similarity of their domain vector plus a
  domain-overlap bonus of up to 0.3. Threshold 0.3, default top 3
  (`patterns.ts:124-141`).
- **Reinforcement.** A successful answer strengthens the primary pattern by 0.05 and
  increments its compile counter; failure weakens it by 0.03 (`patterns.ts:245-266`).
- **Compilation.** At compile count 5, a pattern is generalized: domain names in its
  reasoning template are replaced with `{{domain}}`, or it is merged with a sufficiently
  similar pattern (similarity >= 0.75) into a new abstraction
  (`patterns.ts:154-201`). Compiled abstractions are converted into skills and registered
  (`src/cognition/kernel.ts:94-105, 43-66`).
- **Homeostasis.** Patterns decay below strength 0.05 and are pruned above 100 entries
  (`patterns.ts:294-317`).

### 5.3 Sparse activation and the critic

The `SparseActivator` injects exactly one pattern into the prompt: the strongest pattern
with strength >= 0.5 and at least one compile, falling back to anything >= 0.3
(`src/cognition/sparse-activator.ts:7-28`). This is a deliberate bottleneck: one learned
idea at a time, not a wall of retrieved text.

The `Critic` is a heuristic evaluator (`src/cognition/critique.ts:14-82`). It estimates:

- **completeness** from response sentence count relative to expected count,
- **accuracy** by penalizing hedging language,
- **clarity** from average sentence length,
- **gaps** from missing domain mentions and action-type mismatches,
- **strengthened** if completeness > 0.4, accuracy > 0.3, and no gaps.

It is fast, deterministic, and free. It is also shallow: verbosity is treated as a proxy
for completeness, and hedging is treated as a proxy for inaccuracy. This is one of the
places where the project's intelligence is most obviously heuristic rather than learned.

### 5.4 The kernel loop

`CognitiveKernel.process()` wires the pieces together (`src/cognition/kernel.ts:68-115`):

```
query -> compress -> query vector -> retrieve patterns -> learn co-occurrence
      -> activate one pattern -> critique answer -> strengthen/weaken
      -> if compile count >= 5 -> compile abstraction -> register as skill
```

`review()` reruns retrieval and critique to produce a retry decision and a correction
prompt (`kernel.ts:117-136`). This is the mechanism by which the agent is supposed to
"learn" from its own outputs.

At runtime in the default loop, this loop is off (see section 4). The harness adapter and
some tests exercise it. This is the largest gap between the README's description and the
default experience.

---

## 6. Memory

### 6.1 Episodic memory

Every exchange can be stored as an episode:

```ts
{ id, timestamp, sessionId, userMessage, assistantResponse,
  summary, embedding, embeddingModel }
```

Storage is append-only JSONL at `~/.ntox/memory/episodes.jsonl`
(`src/memory/episodic.ts:90-97`). Retrieval is cosine similarity over embeddings with a
default threshold of 0.5, top 5 (`episodic.ts:150-175`). When embeddings are absent or
empty, the store falls back to recency. The store compacts above 1,200 episodes, keeping
the most recent 1,000 (`episodic.ts:9-10, 99-102`).

There is also a keyword `search()` that scores summary, user message, and assistant
response separately (`episodic.ts:177-194`). Durable memories are a separate store with
lanes, confidence, provenance, contradiction counts, and a full edit history
(`episodic.ts:215-285`).

### 6.2 Correction-aware recall

Corrections are first-class memories. When the user says "no, that's wrong", NTOX:

1. detects the correction with seven regex families (`src/meta/mistakes.ts:6-18`),
2. extracts a topic key and the corrected content (`mistakes.ts:20-36`),
3. writes a mistake entry with source `user-correction` (`mistakes.ts:61-90`),
4. applies the correction to durable memories so the corrected fact has higher authority
   (`src/memory/episodic.ts`, `applyCorrectionToDurableMemories`),
5. retrieves relevant mistakes with recency and authority weighting at prompt time
   (`mistakes.ts:92-120`).

This is one of the few closed loops in the system: a correction changes future prompts.

### 6.3 Theory memory

The theory pipeline is the most ambitious memory structure:

```
observations -> patterns -> theories -> meta-theories
```

- An **observation** is a fact-like statement extracted from a conversation, with a domain,
  confidence, and embedding (`src/research/theory-store.ts:7-14`).
- A **pattern** groups observations and states a generalization (`theory-store.ts:15-23`).
- A **theory** cites primitives, gives an explanation, lists predictions and falsification
  criteria, and carries evidence (`theory-store.ts:53-66`).
- A **meta-theory** synthesizes multiple theories (`theory-store.ts:67-74`).

Confidence is evidence-driven. Each support adds 0.12 (0.20 if manual), each contradiction
subtracts 0.15-0.25, and a theory is "confirmed" at confidence >= 0.6
(`theory-store.ts:117-137`). Predictions can be made and resolved as confirmed or
falsified, which updates confidence (`theory-store.ts:143-163`).

`TheoryMemory` extracts observations from episodes and builds a retrieval context at prompt
time (`src/memory/theory-memory.ts:27-107`). It also creates throttled predictions when a
confirmed theory matches a query: one prediction per theory per 30 minutes
(`theory-memory.ts:75-88`).

This is a genuine falsification loop in structure. Whether theories become good is a
separate question; extraction is currently heuristic, and prediction resolution depends on
events that mostly do not exist yet.

### 6.4 User model, relationship, and mental model

- **User model** (`src/memory/user-model.ts`, 623 lines): verbosity preference, technical
  level, communication style, vocabulary, projects, goals, expertise, and message
  statistics. Updated after every turn.
- **Relationship tracker** (`src/memory/relationship.ts`): bond level and milestones from
  interaction scores.
- **Mental model** (`src/meta/mental-model.ts`, 398 lines): extracts opinions,
  generalizations, comparisons, and assumptions from user text, then tracks contradictions
  using 22 antonym pairs and negation words. Entries have statuses: `active`, `challenged`,
  `evolved`, `abandoned`.

The mental model is the seed of a real "theory of mind" for the user. At present it
extracts with regexes and never feeds back into a prompt strategy with measured effect.

---

## 7. Meta-Cognition

There are 21 non-test modules in `src/meta/`. They fall into four groups.

### 7.1 Classification and strategy

- **Strategy classifier** (`strategist.ts`): six query types (coding, factual, creative,
  analysis, planning, general), each with a strategy prompt. Classification is keyword
  counting with word-boundary regexes (`strategist.ts:139-165`).
- **Response mode** (`response-mode.ts`): decides whether a message is casual chat, a tool
  execution request, a tool-building request, or a profile update, so the agent can skip
  the full pipeline for simple cases.
- **Session intent** (`session-intent.ts`): casual, deep-work, debugging, learning,
  planning, exploration; shifts are detected over time.

### 7.2 Feedback and adaptation

- **Effectiveness** (`effectiveness.ts`): scores the previous answer using the current
  message as implicit feedback (thanks, correction, follow-up).
- **Interaction score** (`interaction-score.ts`): scores solved-ness and satisfaction.
- **Style optimizer** (`style-optimizer.ts`): adjusts verbosity, directness, and structure
  based on effectiveness signals. This is the clearest example of a loop that changes the
  next prompt.
- **Observation and confidence** (`observation.ts`, `confidence.ts`): per-session
  observations (topics, intent, drift) and confidence estimates for drift and belief
  contradictions.

### 7.3 Self-models

- **Self-reflection** (`self-reflection.ts`): after a session, records duration, message
  count, dominant intent, discovered domains, common terms, satisfaction trend,
  corrections, tool usage, topics, and a summary. Keeps 200 sessions and cumulative
  term/domain counts (`self-reflection.ts:55-120`).
- **Self-awareness** (`self-aware.ts`): tracks sessions, discovered domains, and a
  narrative about what the agent has learned.
- **Mistake journal** (`mistakes.ts`): capped at 500 entries, with relevance scoring.
- **Executive** (`executive.ts`): goals, constraints, risks, stated focus, and focus
  history, extracted from user statements.
- **Proactive engine** (`proactive.ts`): generates goal reminders, skill suggestions,
  pattern insights, habit hints, milestones, and feedback prompts, with a 2-minute
  cooldown and suppression during deep work.

### 7.4 Social and conversational regulation

- **Intervention** (`intervention.ts`): decides when to interrupt or suggest a break.
- **Disagreement** (`disagreement.ts`): records and tracks disagreements.
- **Mood** (`mood.ts`): a lightweight affect state.
- **Briefing** (`briefing.ts`): session-start context.
- **Time adapter** (`time-adapter.ts`): time-of-day and weekend context, and suppression
  rules.

Most of these write state and produce prompt snippets. Very few have a measured causal
effect on outcomes. That is the pattern the next-level plan attacks.

---

## 8. The Decision Kernel

`src/kernel/` is a separate control system from the cognitive kernel. It models explicit
goals and decisions.

- **Goals** have an id, description, priority, success condition, subtasks, evidence, and
  completion state (`src/kernel/goals.ts:65-105`).
- **Subtasks** have dependencies, a success predicate, and recorded outcomes
  (`goals.ts:18-63`). A goal is complete only when every subtask has verified evidence.
- **Verifier** executes success predicates against a world state and records outcomes,
  catching predicate exceptions (`src/kernel/verifier.ts:3-33`).
- **DecisionKernel.tick()** is a priority cascade (`decision-kernel.ts:39-82`):
  1. confidence too low -> surface to user,
  2. energy too low -> defer,
  3. no goals -> reflect and propose,
  4. underspecified goal + high curiosity -> explore,
  5. no subtasks or low patience -> decompose,
  6. high analytical drive -> execute with verification,
  7. otherwise execute.
- **Internal state** carries eleven traits: curiosity, analytical, creative, empathetic,
  humor, directness, patience, adaptability, confidence, energy, engagement.
- **Evolution** records state transitions with before/after values and causal attribution
  (`src/kernel/evolution.ts`).

This is a legitimate symbolic control layer. Its current limitation is integration: the
decision kernel is initialized only by the REPL (`src/cli/repl.ts:162`), so gateway and
API agents run with no decision kernel despite `kernelEnabled: true` in their config.

---

## 9. Aliveness: The Alive Engine

`ntox/alive` is a standalone, event-driven cognition core (`src/alive/`). It does not call
an LLM and does not watch the machine by itself. A host supplies consented events.

The model (`src/alive/engine.ts:1-272`):

- **Event**: `{ type, source, significance 0..1, payload, predictionId?, requiresHuman }`
- **Prediction**: `{ statement, confidence, expectation: { eventType, payload }, status }`
- **Open loop**: `{ goal, hypothesis, uncertainty, nextEvidence, status, deadline }`
- **Action**: `ignore | learn | wake | notify`

`recordEvent` pushes the event, resolves any linked prediction by comparing the event
against the expectation, computes prediction error, and emits actions
(`engine.ts:190-234`):

- a resolved prediction always produces `learn`,
- prediction error above 0.6 produces `wake`,
- `requiresHuman` produces `notify`,
- significance above 0.75 produces `wake`,
- otherwise `ignore`.

`pulse()` marks open loops with past deadlines as blocked and produces notifications
(`engine.ts:236-247`).

The host adapters in `src/alive/host.ts` connect this to the workspace while the REPL is
running: a file watcher (ignoring `.git`, `.ntox`, `node_modules`, `dist`, `coverage`),
Git polling every 30 seconds (commit or changed-file deltas), and a pulse every 60 seconds
(`host.ts:20-84`). Tool outcomes are bridged into events through
`toolOutcomeToAliveEvent`.

This is the project's most distinctive idea: the agent has an explicit state of
"things I expect", "things I am waiting on", and "things that surprised me". The missing
piece is that few events exist and wake actions currently collapse into a small context
injection rather than autonomous work.

---

## 10. Skills

There are 83 markdown skill documents across 17 category folders:

| Category | Count | Category | Count |
|---|---:|---|---:|
| Core | 14 | Professional | 5 |
| Engineering | 6 | Career | 5 |
| Physics | 6 | Communication | 5 |
| Research | 6 | Invention | 4 |
| Systems | 6 | AI | 4 |
| Mathematics | 5 | Economics | 4 |
| Domain | 5 | Architecture | 3 |
| | | Programming | 2 |
| | | Personal | 1 |

The skill library scans markdown files, extracts title, purpose, triggers, sections, voices,
and importance, and builds a semantic index (`src/skills/library.ts`). At prompt time, skills
are matched by embedding similarity and importance. Compiled cognitive patterns are also
registered as skills (`src/cognition/kernel.ts:43-66`), which means the skill set can grow
from experience. The learner and executor modules handle skill extraction and execution.

---

## 11. Multi-Agent Debate

For high-stakes or ambiguous questions, `DebateOrchestrator` runs eight sequential voices
(`src/core/orchestrator.ts:10-67`):

Researcher, Critic, Physicist, Mathematician, Systems Architect, Economist, Inventor,
Experimentalist.

Each voice sees the question, optional context, and every prior voice's response. Each ends
with a confidence score. The orchestrator synthesizes the debate into a final answer
(`orchestrator.ts:89-182`). This is a prompt-level ensemble, not a multi-model one; it
multiplies token cost and is gated behind a conditional path.

---

## 12. Substrate

- **LLM client** (`src/core/llm.ts`, 1,083 lines): 10 providers, OpenAI/Anthropic/Ollama
  wire formats, streaming, native tool calls, typed errors, retries with exponential
  backoff, per-read stall timeout, abort propagation.
- **Tools**: filesystem, shell (blocklist plus Docker sandbox option), grep, glob, web
  fetch, web read, browser, image, speech-to-text, text-to-speech, subagent, job tracker.
- **Policy** (`src/core/policy.ts`): every tool from every entry point is wrapped by
  `enforceToolPolicy`, which checks workspace roots, network policy, approval rules, and
  auto-checkpointing.
- **Dispatcher** (`src/core/dispatcher.ts`): shared infrastructure and message execution for
  REPL, gateway, API, subagent, and harness.
- **Gateways**: Telegram, Discord, WhatsApp, and a local web UI sharing the same runtime.
- **Harness adapter**: maps DeepSeek Harness lifecycle events to `beforeStep`, `afterTool`,
  and `afterTurn` on the cognition layer.

---

## 13. Measurement and Evidence

The repository contains a real evaluation stack, not just tests.

### Unit and integration tests

665 tests across 71 files, ~5 seconds. Notable coverage: shell blocklist, policy roots,
injection patterns, streaming sanitizer, web gateway auth, WhatsApp HMAC verification,
Anthropic tool-use accumulation, agent correction handling.

### Cognitive benchmark (NCB)

`src/benchmark/` defines a 20-category cognitive benchmark. The committed run on
`deepseek-v4-flash` scored **45.65 overall**:

| Category | Score | Category | Score |
|---|---:|---|---:|
| Abstraction | 70% | Scientific method | 52% |
| Architecture | 62% | Simulation | 51% |
| Emergence | 59% | Pattern recognition | 51% |
| Invention | 56% | Cross-domain transfer | 49% |
| First principles | 52% | Complexity | 48% |
| Unknown problems | 48% | Compression | 47% |
| Self-critique | 45% | Systems thinking | 42% |
| Planning | 42% | Communication | 36% |
| Discovery | 34% | Learning | 31% |
| Optimization | 28% | Prediction | 21% |

The weakest categories are exactly the ones the next-level plan must move: prediction,
learning, discovery, optimization.

### Necessity and ablation

`src/evaluation/` contains a necessity suite that checks whether each subsystem actually
changes prompts or outcomes (for example, that a stored memory appears only when memory is
enabled), an ablation harness, a curriculum of generative tasks, and a longitudinal runner.
`scripts/verify-all.mjs` runs typecheck, lint, tests, and build.

### Experiments

The `experiments/` directory contains concrete runs. One paired DeepSeek experiment showed:

- thinking quality +11% between iterations (4.76 -> 5.30),
- false-success rate 0.40 -> 0.25,
- primitive reuse 25%,
- total cost $0.023 for 121,324 tokens.

A Mistral run showed a -5% quality change. The evidence is thin but real, and it is
measured rather than asserted.

---

## 14. Persistence Map

Everything lives under `~/.ntox/` (overridable with `NTOX_DIR`):

| Path | Contents |
|---|---|
| `config.json` | Provider, keys, model, feature flags |
| `costs.json` | Token and cost ledger |
| `models-cache.json` | OpenRouter model catalog |
| `memory/episodes.jsonl` | Episodic memory |
| `memory/durable.json` | Durable facts with provenance and history |
| `memory/mistakes.json` | Correction journal |
| `cognition/cognitive-space.json` | 10 domain vectors in 8D |
| `cognition/patterns.json` | Patterns, co-occurrence counts, compile stats |
| `theories.json` | Observations, patterns, theories, meta-theories, evidence, predictions |
| `user-model.json` | User profile and preferences |
| `relationship.json` | Bond state and milestones |
| `mental-model.json` | User beliefs and contradictions |
| `executive.json` | Goals, constraints, risks, focus |
| `self-reflections.json` | Per-session reflections and cumulative knowledge |
| `self-aware.json` | Self-model |
| `observations.json` | Session observations |
| `style-optimizer.json` | Adapted style state |
| `interventions.json` | Intervention history |
| `disagreements.json` | Disagreement records |
| `briefing-state.json` | Session briefing state |
| `domain-extensions.json` | Learned domains and keywords |
| `analytics.json` | Tool and query analytics |
| `external-skills-index.json` | Skill index |
| `alive.json` | Events, predictions, open loops |
| `checkpoints/` | Pre-edit file checkpoints |
| `conversations.json` | Gateway conversation store |
| `cron.json` | Scheduled tasks |

This is the agent's "self" on disk. It is also where most of the project's unexploited
potential lives: the data to close loops is already being written.

---

## 15. What Is Genuinely Different

Against a generic "LLM + tools" agent, NTOX has six real differentiators:

1. **Structured self-correction.** Corrections become durable, authoritative memories and
   are retrieved with authority weighting, not just appended to chat history.
2. **A theory hierarchy with falsification.** Observations, patterns, theories, and
   meta-theories carry evidence, predictions, and confidence updates.
3. **Prediction-error aliveness.** The Alive engine gives the agent explicit expectations,
   open loops, and surprise-driven wake decisions.
4. **A symbolic decision layer.** Goals, subtasks, success predicates, and a verifier give
   the agent an auditable planning substrate independent of the LLM.
5. **A cognitive geometry plus pattern compilation.** Queries are compressed into a domain
   geometry; repeated successes are supposed to compile into reusable abstractions.
6. **Instrumentation.** Traces, necessity checks, ablations, NCB scoring, and a token ledger
   make claims testable.

The architecture is also cleaner than its size suggests: acyclic imports, strict
TypeScript, a single policy choke point, and streaming engineering with retries and abort
propagation.

---

## 16. What Is Still Scaffolding

This section is deliberately blunt. It is the bridge to the action plan.

The codebase is **write-rich and read-poor**:

| Subsystem | Writes | Reads back into behavior | Measured effect |
|---|---|---|---|
| Episodes | Every turn | Recent 5 only (default loop) | None |
| Durable memories | Often | Prompt lines | Untested |
| Mistakes | On correction | Prompt lines | Tested indirectly |
| Theories | Every episode | Prompt lines | Untested |
| Patterns | On repeated domains | Disabled in default loop | None |
| Mental model | On user statements | Almost never | None |
| Executive goals | On user statements | Briefings | None |
| Self-reflections | Per session | Stats only | None |
| Alive predictions | Rarely | Wake context | None |
| Decision kernel | REPL only | REPL routing only | Untested |
| Style optimizer | Per turn | Prompt guidance | Unit-tested |

The honest summary: NTOX has the organs of a cognitive agent, but most of them are not yet
wired into a loop that changes behavior, and almost none have a measured causal effect. The
project is strong at representing knowledge and weak at converting knowledge into improved
decisions.

Three specific runtime truths reinforce this:

1. **The cognitive kernel is disabled in the default loop** (`agent.ts:732-740`), so the
   marquee feature "pattern compilation" does not affect normal CLI use.
2. **Semantic recall is disabled in the default loop** (`agent.ts:190`), so memory retrieval
   is recency, not relevance.
3. **The decision kernel is REPL-only** (`repl.ts:162`), so gateway and API agents cannot
   plan symbolically despite config saying the kernel is enabled.

This is not a reason to add more features. It is a reason to close loops.

---

## 17. Current State

**What works now**

- A reliable streaming agent loop with tools, policy, and context management.
- Persistence of episodes, durable facts, corrections, theories, user model, and sessions.
- Meta-cognitive prompt injection: strategy, corrections, tool recovery, style guidance.
- A real evaluation stack and a passing test suite.
- A gateway and API that share the same runtime.
- An alive engine with a clean event/prediction/open-loop model.

**What is shallow**

- Learning is mostly additive storage, not credit assignment.
- Retrieval in the default loop is recency, not relevance.
- Prediction exists as a data model but rarely as a behavior.
- Confidence is heuristic, not calibrated.
- Identity is accumulated state, not a force that selects actions.
- Intelligence is measured once, not tracked as a curve.

**What is missing for "alive"**

- An outcome ledger that attributes success and failure to the context that was used.
- A policy that selects strategies and memories by expected value.
- A prediction habit: predict before acting, compare after acting.
- Idle cognition: consolidation and hypothesis generation between user turns.
- A capability self-model that routes around weakness.
- A benchmark that measures improvement over time, not one-shot score.

The next-level plan turns each of these into a buildable milestone.

---

## Glossary

- **Primitive**: the compressed representation of a query (domains, action, complexity).
- **Pattern**: a reusable reasoning template associated with a domain combination.
- **Compiled pattern**: a generalized or merged pattern promoted to a skill after repeated
  successful use.
- **Episode**: one stored user/assistant exchange with an embedding.
- **Durable memory**: a persistent fact with provenance, confidence, and edit history.
- **Theory**: an explanation with predictions and falsification criteria, backed by
  evidence.
- **Meta-theory**: a synthesis across theories.
- **Open loop**: a goal or hypothesis awaiting evidence, optionally with a deadline.
- **Prediction error**: `1 - confidence` when a prediction is confirmed, `confidence` when
  it is falsified.
- **Wake**: an alive action indicating that an event is significant or surprising enough to
  justify cognition.
- **Outcome ledger**: the proposed per-turn record that links context, actions, and
  results (see the next-level plan).
- **Loop contract**: the proposed rule that every cognitive feature must predict, observe,
  attribute, and update, with a measured effect.

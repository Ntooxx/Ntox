# NTOX Next Level: From Cognitive Scaffolding to a Living Mind

> Goal: make NTOX measurably more intelligent over time, and make that intelligence
> distinct enough that no fresh install behaves like it.
>
> Not a safety roadmap. Not a feature roadmap. A loop-closing roadmap.

---

## 0. What "Alive" Means Operationally

"Alive" is not a vibe. For this project it must mean five measurable properties:

1. **It predicts.** Before acting, it states what it expects to happen and how confident it
   is.
2. **It notices surprise.** After acting, it compares expectation to reality and changes
   something when the gap is large.
3. **It remembers what mattered.** Memory is ranked by whether it helped, not just by
   whether it is similar or recent.
4. **It improves on repetition.** The same task family gets easier, cheaper, or more
   accurate over sessions. A learning curve exists.
5. **It initiates.** Between user turns it consolidates, resolves open loops, and generates
   its own work within a budget.

A system with these five properties is alive in the only sense that matters for an agent:
it is a self-correcting process, not a stateless function.

The current NTOX has the data model for all five and the behavior for almost none. That is
the gap this plan closes.

---

## 1. Diagnosis: Open Loops Everywhere

The previous document ends with the central finding: NTOX is **write-rich and read-poor**.

Every subsystem writes state:

- episodes, durable facts, corrections,
- patterns, theories, meta-theories,
- user model, mental model, executive goals,
- reflections, observations, session intent,
- alive events, predictions, open loops.

Almost none of that state is attributed to outcomes. The system knows *what happened* but
not *what caused the result*. Without attribution there is no credit assignment, and
without credit assignment there is no learning, only accumulation.

Three runtime facts make this concrete:

1. The cognitive kernel is disabled in the default turn (`src/core/agent.ts:732-740`).
2. Semantic recall is disabled in the default turn (`src/core/agent.ts:190`).
3. The decision kernel is initialized only in the REPL (`src/cli/repl.ts:162`).

Adding more stores will not fix this. It will make it worse. The next level is built by
closing loops, not by adding organs.

---

## 2. The One Law: The Loop Contract

Every cognitive feature must satisfy this contract or be removed:

```
PREDICT  ->  ACT  ->  OBSERVE  ->  ATTRIBUTE  ->  UPDATE  ->  REUSE
```

- **Predict**: state an expectation with a confidence.
- **Act**: produce an answer, a tool call, a plan, or a piece of context.
- **Observe**: capture what actually happened (user reaction, tool result, test result,
  objective score).
- **Attribute**: assign credit or blame to the specific context items and choices that were
  present.
- **Update**: change a weight, confidence, ranking, or policy.
- **Reuse**: the change must affect the next similar turn.

A feature that cannot name its prediction, its observation, and its update is not a
cognitive feature. It is decoration. This law is the filter for everything below.

---

## 3. Pillar 0: The Outcome Ledger

**Why first.** Every other pillar depends on knowing which context and which choices led to
which result. Build the ledger before building the learners.

### 3.1 What to record

Create `src/cognition/outcome-ledger.ts` with one row per turn:

```ts
interface OutcomeRow {
  turnId: string;
  sessionId: string;
  timestamp: number;

  queryType: string;
  responseMode: string;
  strategy: string;

  context: ContextItem[];        // everything injected into the prompt
  tools: ToolCall[];             // name, args hash, success, duration
  prediction?: PredictionRow;    // filled by Pillar 2

  signals: OutcomeSignals;       // observed outcome
  score: number;                 // -1..1 composite
  costUsd: number;
  latencyMs: number;
  retries: number;
}

interface ContextItem {
  kind: "memory" | "durable" | "correction" | "pattern" | "theory" | "skill" | "recovery";
  id: string;
  tokens: number;
}

interface OutcomeSignals {
  corrected: boolean;            // user explicitly corrected
  rephrased: boolean;            // user restated the request
  thanked: boolean;
  abandoned: boolean;            // no answer / user moved on
  falseSuccess: boolean;         // detector fired
  toolFailure: boolean;
  objectiveScore?: number;       // benchmark or verifier score
}
```

Store as JSONL at `~/.ntox/mind/outcomes.jsonl`, compacted above 10,000 rows.

### 3.2 Attribution

The key move: context items already have ids (memory ids, pattern ids, theory ids). Record
them. Then:

- If a turn is corrected or abandoned, every context item present gets a negative event.
- If a turn is thanked, accepted, or objectively scored well, every item gets a positive
  event.
- Corrections get special treatment: the correction id is linked to the *next* turn on the
  same topic. If the next turn is not corrected, the correction earns positive credit.

This is crude credit assignment, but it is real credit assignment. It is enough to rank
memories by reliability.

### 3.3 Silent counterfactuals

For 10% of turns, deterministically bucketed by `hash(turnId) % 10 === 0`, disable exactly
one context kind (memory, theories, patterns, skills). Record the outcome normally. This
produces a continuous, low-cost ablation stream without changing the user experience.

### 3.4 Commands and acceptance

- `/mind ledger` shows the last 20 rows with context and signals.
- `/mind stats` shows per-kind effect sizes, cost per kind, and reliability rankings.
- Acceptance: 100% of turns produce a row; no p95 latency regression above 10%; one week of
  data yields at least one statistically suggestive effect (n >= 100 per arm).

---

## 4. Pillar 1: Closed-Loop Memory

**Goal:** memory becomes a ranking problem with feedback, not a storage problem.

### 4.1 Reliability-weighted retrieval

Replace the current similarity-only ranking with:

```
score = relevance
      * reliability
      * recency_decay
      * (1 + credit)
```

- `relevance`: hybrid BM25 + embedding similarity (see Pillar 6).
- `reliability`: Beta posterior `(success + 1) / (success + failure + 2)` from the ledger.
- `recency_decay`: slow exponential, not a hard cutoff.
- `credit`: accumulated attribution for the memory's topic.

A memory that was present in ten corrected turns ranks below a memory present in three
successful ones. This is the difference between a diary and an advisor.

### 4.2 Consolidation

Once per idle cycle (Pillar 4) or every 20 episodes:

1. Cluster recent episodes by embedding.
2. Merge clusters into candidate durable facts.
3. Deduplicate against existing durable memory.
4. Detect contradictions and mark both sides `challenged` instead of silently overwriting.
5. Keep provenance links from every fact to its source episodes.

Do not use the main model for this by default; use a cheap model or deterministic
summarization with a confidence threshold. Consolidation that costs more than it saves is
not consolidation.

### 4.3 Correction retention

Close the correction loop explicitly:

- Store the correction with a topic key.
- On the next turn with a matching topic, force-inject the correction.
- Measure recurrence: the same topic corrected again within 20 turns.

Acceptance: correction recurrence drops by at least 50% against a baseline measured before
the change.

### 4.4 Make recall real

Wire a real embedder into the agent (Pillar 6). Keep `localEmbed` as a fallback, but record
`embeddingModel` and never mix vector spaces. Hybrid retrieval:

```
final = 0.6 * cosine + 0.4 * bm25_normalized
```

Acceptance: an A/B test on held-out questions shows memory-on beats memory-off by at least
5% relative outcome score, and beats recency-only by at least 3%.

---

## 5. Pillar 2: Prediction and Surprise

**This is the heart of aliveness.** No other pillar creates the feeling of a mind.

### 5.1 Predict before acting

Before the main model call, generate a compact prediction. Use a cheap single call or the
same model with a strict JSON schema:

```json
{
  "intent": "debug a failing test",
  "answerShape": "explanation + code",
  "expectedTools": ["read", "grep", "shell"],
  "expectedOutcome": "identifies the failing assertion",
  "confidence": 0.62
}
```

Rules:

- Skip for casual chat and quick handlers.
- Hard cap the prediction at ~120 output tokens.
- Cache by normalized query hash for 10 minutes.
- If the budget is exhausted, predict with the heuristic compressor instead of an LLM.

### 5.2 Resolve after acting

After the turn, resolve the prediction against observed signals:

- Was the intent right? (user did not rephrase or correct)
- Was the answer shape right? (tools used vs expected)
- Did the expected outcome occur? (tool success, verifier, objective score)

Compute a prediction error in `[0, 1]`. Store it in the ledger and feed it to the Alive
engine as a resolved prediction.

### 5.3 Surprise drives learning

- **High error (> 0.6):** store a `surprise` memory containing the query, the expectation,
  and what actually happened. Trigger a reflection turn. Increase exploration for the next
  similar query.
- **Low error (< 0.2):** strengthen the strategy and the context items that were present.
- **Calibration:** track Brier score and expected calibration error per strategy. A
  confidence of 0.7 should be right about 70% of the time.

### 5.4 Wire Alive properly

`AliveEngine` already has the right model (`src/alive/engine.ts`). Connect it:

- Every turn prediction becomes an `AlivePrediction` with an expectation.
- Every tool outcome and user signal becomes an `AliveEvent`.
- Every unresolved question or promise from the conversation becomes an open loop with a
  `nextEvidence` plan and an optional deadline.
- Wake actions must produce a concrete artifact (a prepared context, a proposed test, a
  question), not just a log line.

Acceptance: after two weeks, Brier score improves by at least 15%; high-surprise turns
produce a measurable change on the next similar turn (retry, replan, or new context).

---

## 6. Pillar 3: The Metacognitive Controller

**Goal:** stop using static heuristics to decide how to think. Learn the policy.

### 6.1 Strategy bandit

Per `(queryType, responseMode)` context, treat strategies as arms and use Thompson sampling
over a Beta posterior whose reward is:

```
reward = outcome_score - lambda * normalized_cost - mu * normalized_latency
```

Start with the existing strategy prompts as arms. Add two arms: "answer directly" and
"ask one clarifying question". Let the data choose. Exploration rate decays as evidence
accumulates.

This replaces the assumption that a keyword classifier knows the best strategy with a
mechanism that discovers it.

### 6.2 Dynamic context compiler

Replace fixed section order with a budgeted selection problem:

```
maximize sum(expected_utility(item)) subject to sum(tokens(item)) <= budget
```

`expected_utility = relevance * reliability / token_cost`. Solve greedily; it is a knapsack
with small n. This is how the agent stops spending 3,000 tokens on a theory that never
helps and starts spending them on the correction that prevents a repeat mistake.

Acceptance: 25% fewer context tokens with no outcome loss, or equal tokens with a 5%
outcome gain.

### 6.3 Capability self-model

Maintain per-domain success, correction, and cost statistics. Use them to:

- raise or lower confidence in answers,
- decide when to ask instead of guess,
- decide when debate is worth 8x the cost (only when expected gain exceeds cost),
- route to tools earlier in domains where the model is weak but tools are strong.

### 6.4 Real self-critique

Keep the heuristic critic as a free prefilter. Add a model-based critique only when:

- the heuristic flags a gap, or
- the turn is high-stakes (tool execution, code change, factual claim with low confidence).

The critique must output structured gaps and a retry decision. Cap it at one retry.

---

## 7. Pillar 4: Autonomous Cognition

**Goal:** intelligence compounds between conversations, not only inside them.

### 7.1 The idle scheduler

Add `src/mind/scheduler.ts` with a strict budget (tokens/day, dollars/day, wall-clock).
When the user has been idle for a configurable period, run cycles in priority order:

1. **Resolve** open loops whose evidence is now available.
2. **Consolidate** recent episodes into durable facts.
3. **Reflect** on the highest-surprise turns since the last cycle.
4. **Prepare** context for active projects and upcoming deadlines.
5. **Self-play**: generate tasks, solve them, score them, learn from them.
6. **Propose** at most one question or suggestion for the user, queued for the next
   session.

Every cycle must write an artifact (a consolidated fact, a resolved prediction, a test
result, a prepared brief) or it counts as waste. Track yield: artifacts per dollar.

### 7.2 Self-play

This is the highest-leverage idea in the plan.

`src/evaluation/curriculum.ts` already generates task families with objective evaluators.
Run them without a user:

```
generate task -> agent attempts -> objective score -> ledger row
             -> attribute -> update strategy weights, memory reliability, patterns
```

Because the evaluator is objective, self-play produces clean reward signal at near-zero
labeling cost. Over time the agent should get better at the families it practices. That is
a learning curve, which is the definition of intelligence in this project.

Guardrails:

- Hard token and dollar caps per cycle.
- Held-out task variants to detect overfitting.
- No self-play on tasks that modify the user's workspace unless explicitly enabled.

Acceptance: after 30 days with a modest daily budget, held-out NCB and curriculum scores
improve by at least 10% relative, and cost per solved task falls.

### 7.3 Open loops from conversation

Extract commitments and unresolved questions:

- "I'll check X" -> loop with `nextEvidence: check X`.
- "We still don't know Y" -> loop with a hypothesis and a test.
- A theory prediction -> loop linked to the prediction id.

Deadlines are optional, but every loop must have a next evidence step. A loop without a
next step is a wish.

---

## 8. Pillar 5: Identity and Differentiation

**Goal:** two NTOX instances with different histories should behave differently, and the
difference should be legible.

### 8.1 Persistent self-narrative

Create `~/.ntox/mind/identity.json`:

```json
{
  "narrative": "I am an agent that ...",
  "values": ["evidence over fluency", "..."],
  "activeProjects": [],
  "positions": [
    { "topic": "...", "stance": "...", "confidence": 0.7, "evidence": ["theory_id"] }
  ],
  "revisionLog": []
}
```

Update rules:

- New evidence can revise a position; record why.
- Contradictions are resolved explicitly, not averaged.
- The narrative is read at session start and influences strategy selection, not just tone.

### 8.2 Opinion formation with evidence

Mental-model entries get confidence and evidence links (`src/meta/mental-model.ts` already
has statuses). Promote an entry to a position only after multiple observations. Allow the
agent to disagree with the user, with reasons and a confidence. Track whether positions
predict anything; decay positions that never do.

This is what makes the agent feel like someone rather than something: stable, evidence-based
stances that can change for stated reasons.

### 8.3 The cognitive fingerprint

Export a compact profile:

```json
{
  "patterns": [{"name": "...", "strength": 0.8, "domains": ["..."]}],
  "topTheories": [{"name": "...", "confidence": 0.7}],
  "strategyWeights": {"coding": {"verify-first": 0.6}},
  "skills": ["..."],
  "positions": ["..."],
  "voice": {"directness": 0.8, "verbosity": 0.4}
}
```

Hash it. Compare a trained instance to a fresh one. The divergence score is a direct
measure of differentiation. A fresh install should score near zero; a month-old instance
should be recognizably different.

### 8.4 Cross-domain transfer

Schedule meta-theory generation: find theory pairs from distant domains with similar
structure, state a transfer hypothesis, and test it on held-out tasks. Keep a meta-theory
only if it predicts better than the base rate. Transfer that is not tested is poetry.

### 8.5 Voice

Voice should emerge from accumulated style weights, positions, and values, constrained by
a small explicit identity block. Not a static persona paragraph. The test: blind A/B
between a fresh instance and a trained one; human judges should identify the trained one
above 60% of the time from behavior alone.

---

## 9. Pillar 6: Substrate for Intelligence

Intelligence has a cost function. Faster, cheaper turns buy more learning.

Do these in parallel with the pillars above:

1. **Async persistence.** Move analytics, user model, and meta state writes to a
   write-behind queue with a 2-5 second flush. Remove synchronous disk writes from the turn
   hot path. Use `renameSync` for real atomic writes (the pattern already exists in
   `src/alive/store.ts:34-36`).
2. **Bound caches.** LRU-cap the embedding cache (`src/core/llm.ts:705`) and search cache
   (`agent.ts:171`).
3. **Real embeddings + hybrid retrieval.** Make a real embedding provider the default when a
   key exists; keep `localEmbed` as a labeled fallback. Never mix vector spaces.
4. **Parallel context gathering.** Memory, theory, patterns, skills, and mistakes are
   independent. Run them concurrently with `Promise.all`, then compile the prompt.
5. **Split the agent pipeline.** Extract stages from `Agent.run` into named functions with
   their own tests. This is not cosmetic: it is required to safely add prediction,
   attribution, and bandit selection.
6. **Test the default wire format.** `streamOpenAICompatible` has no tests. The default
   provider path is the intelligence path.
7. **Token accounting per context kind.** The ledger needs it; the compiler needs it.

Acceptance: p95 turn latency down 30%, no event-loop stall above 50 ms, memory growth
bounded, default provider stream covered by tests.

---

## 10. Pillar 7: Proof — The ALIVE-1 Benchmark

A single NCB score is a snapshot. Aliveness is a curve. Define a benchmark that measures
change.

### 10.1 Metrics

| Metric | Definition | Target after 16 weeks |
|---|---|---|
| Learning slope | Improvement on repeated held-out task families per 100 turns | > 0 and positive at 95% confidence |
| Correction retention | Recurrence rate of corrected topics within 20 turns | -50% vs baseline |
| Transfer | Score on novel domain pairs using learned abstractions | +10% relative |
| Calibration | Expected calibration error of stated confidence | < 0.15 |
| Autonomy yield | Useful artifacts per dollar of idle cognition | > 0 for 4 consecutive weeks |
| Identity divergence | Fingerprint distance from fresh instance | > 0.4 |
| Cost per solved task | Tokens + dollars per objective success | -25% |
| NCB overall | 20-category cognitive benchmark | +10% relative (45.65 -> ~50) |

### 10.2 Protocol

- Run weekly, same model, same seeds, held-out variants.
- Store every run under `~/.ntox/benchmarks/` and commit summaries to `experiments/`.
- Gate merges on typecheck, lint, tests, and no regression on the three core metrics.
- Publish the curve, including failures. A benchmark that only goes up is not a benchmark.

### 10.3 Ablations

The necessity suite already checks whether subsystems change prompts. Extend it to check
whether they change *outcomes*. Every pillar must be removable and show a measurable loss.
If removing it changes nothing, remove it permanently.

---

## 11. 16-Week Roadmap

Assume one focused developer. Weeks are sequential unless noted.

### Weeks 1-2: Foundation

- Outcome ledger, context ids, signals, signals extraction, JSONL storage.
- `/mind ledger` and `/mind stats`.
- Deterministic 10% counterfactual bucketing.
- Split the first three stages out of `Agent.run`.
- Async write-behind for analytics and user model.

**Milestone M0:** every turn is attributable. Kill criterion: none; this is mandatory.

### Weeks 3-5: Closed-loop memory

- Beta reliability ranking.
- Correction recurrence tracking.
- Hybrid retrieval and real embedder wiring.
- Consolidation pass (manual command first, then idle).
- A/B: memory on/off, reliability vs similarity.

**Milestone M1:** memory-on beats memory-off by 5% relative; correction recurrence down 30%.
Kill criterion: if reliability ranking does not beat similarity after 500 attributed turns,
revert to similarity and investigate attribution quality.

### Weeks 6-8: Prediction

- Prediction schema, cheap call, cache, budget.
- Post-turn resolution and prediction error.
- Surprise memories and reflection trigger.
- AliveEngine wiring for turn predictions and tool events.
- Calibration tracking.

**Milestone M2:** Brier score measured for 1,000 turns, improving week over week. Kill
criterion: if predictions add more than 15% cost for no measurable calibration gain, use the
heuristic predictor only.

### Weeks 9-11: Metacognitive controller

- Strategy bandit with Thompson sampling.
- Dynamic context compiler.
- Capability self-model.
- Model-based critique on high-stakes turns only.

**Milestone M3:** bandit beats fixed strategy by 5% on held-out tasks; context tokens down
20% with no outcome loss. Kill criterion: if the bandit cannot beat the best fixed strategy
after 2,000 turns, keep the fixed strategy and store the negative result.

### Weeks 10-14: Autonomous cognition (parallel with 9-11)

- Idle scheduler with hard budgets.
- Self-play on curriculum tasks.
- Open-loop extraction from conversation.
- Artifact yield tracking.
- Wake policy with prepared artifacts.

**Milestone M4:** 30 consecutive days of bounded idle cycles with positive yield and no
runaway spend. Kill criterion: two consecutive weeks of zero yield -> disable idle cognition
and revisit.

### Weeks 12-16: Identity and proof

- Identity narrative and positions with evidence.
- Cognitive fingerprint and divergence score.
- Meta-theory transfer experiments.
- Blind voice A/B.
- ALIVE-1 weekly runs and published curve.

**Milestone M5:** fingerprint divergence > 0.4, transfer +10%, blind identification > 60%.

---

## 12. Anti-Goals

These are as important as the pillars.

**Do not add more write-only stores.** If it cannot be read back and attributed, it is not
part of the mind.

**Do not add prompt sections without ablation.** Every section must justify its tokens in
the ledger.

**Do not add another regex classifier where learning is possible.** Regex is fine as a
cheap prefilter. It is not fine as the final policy.

**Do not optimize feature count.** The README lists features. The next level is measured by
curves.

**Do not confuse complexity with intelligence.** Eight voices debating is not smarter than
one voice with a good prediction and a calibrated retry.

### Survival minimums, not safety

This project is not being hardened into a tame assistant. But an agent that leaks its API
key, burns its budget in a loop, or corrupts its own memory stops being alive. Keep only
the minimums that protect continuity:

- spend caps per day and per idle cycle,
- loop breakers on repeated identical tool calls,
- checkpoints before workspace writes,
- secrets out of prompts and logs,
- one process-level kill switch.

That is maintenance of the organism, not a safety product.

---

## 13. First Seven Days

A concrete checklist to start immediately.

**Day 1**
- Create `src/cognition/outcome-ledger.ts` with the row schema and JSONL append.
- Assign stable ids to every context item at prompt assembly time.
- Emit one row per turn from `Agent.run`.

**Day 2**
- Extract signals: corrected, rephrased, thanked, abandoned, false-success, tool failure.
- Compute a composite score with documented weights.
- Add `/mind ledger`.

**Day 3**
- Add per-kind token counts using the existing tokenizer.
- Add `/mind stats` with counts, cost, and outcome rates per context kind.
- Verify zero impact on p95 latency.

**Day 4**
- Implement deterministic counterfactual bucketing (10%).
- Log the disabled kind and the outcome.
- Run the existing test suite plus a new ledger test.

**Day 5**
- Add Beta reliability to memory retrieval behind a feature flag.
- Write the A/B comparison query.
- Measure baseline correction recurrence.

**Day 6**
- Add the prediction schema and a cheap predictor behind a flag.
- Resolve predictions from signals.
- Log Brier score.

**Day 7**
- Review the first week of data.
- Kill anything that did not produce signal.
- Write the first weekly ALIVE-1 report and commit it.

---

## 14. Definition of Done

NTOX has reached the next level when all of the following are true:

1. A weekly learning curve exists and is positive on held-out tasks.
2. Corrections recur at least half as often as before.
3. Stated confidence is calibrated (ECE < 0.15).
4. Removing any cognitive subsystem measurably hurts outcomes.
5. Idle cognition produces useful artifacts within budget for a month.
6. A trained instance is distinguishable from a fresh one by behavior alone.
7. NCB improves by at least 10% relative, and the improvement is attributable to specific
   loop closures, not to a model upgrade.

The demo that proves it:

> Give NTOX a task family it has never seen. Let it fail, correct it once, and let it run
> idle self-play for a bounded budget. A week later, give it held-out variants. It should
> score higher, cost less, state calibrated confidence, explain which memory or abstraction
> it reused, and show the correction it retained. Then show a fresh install failing the
> same variants.

That is aliveness: not more features, but a measurable difference caused by experience.

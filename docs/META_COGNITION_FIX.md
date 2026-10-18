# NTOX Meta-Cognition Fix Prompt

## What the evaluation found

Run `npm run eval:necessity` (mechanism proof) and `npm run eval:longitudinal` (behavioral proof) to reproduce.

Three-arm ablation (deepseek-v4-flash, 12 variants per family, 60 tasks per arm):

| Family | off | all (kernel on) | raw-context (memory+theory, no kernel) |
|---|---|---|---|
| recall (cross-session) | 0/12 | 5/12 | **11/12** |
| tradeoff-analysis | 12/12 | 12/12 | 12/12 |
| causal-chain | 10/12 | 10/12 | 12/12 |
| correction-generalization | 9/12 | 8/12 | 9/12 |

The kernel is not helping. It is actively hurting. `raw-context` (memory dump, no cognitive selection) beats `all` (kernel-selective retrieval) on every discriminating task.

## Root cause

**The cognitive kernel's selective retrieval is worse than a raw memory dump.**

Specific mechanisms:

1. `memoryRetrievalCount` defaults to 5. The `raw-context` arm uses 20. More memories = more relevant facts in context = better recall. The kernel doesn't compensate for this; it just retrieves fewer, sometimes wrong, memories.

2. The kernel's `SparseActivator.activate()` returns empty string unless a pattern has `strength >= 0.5` AND `compileCount >= 3`. Most patterns never reach this threshold during a single session. So the kernel contributes nothing to the prompt in most turns, while consuming context budget.

3. The kernel's `Critic.critique()` strengthens/weakens patterns based on response quality, but this creates a feedback loop: weak patterns → no context → mediocre response → pattern weakened further. The system converges to doing nothing.

4. The theory store's `buildTheoryContext()` returns observations/patterns matched by keyword overlap. This is less effective than raw episode retrieval by embedding similarity, which the memory store already does.

5. The embedding budget (`EMBED_BUDGET_MS = 1200` for remote, configurable via `NTOX_EMBED_BUDGET_MS`) causes memory retrieval to silently degrade to recency-only under load. The `all` arm hit this repeatedly; `raw-context` with its higher `memoryRetrievalCount` was less affected because it had more candidates even without embeddings.

## What to fix

### Fix 1: Increase default `memoryRetrievalCount` to 20

In `src/core/config.ts`, change the default from 5 to 20. The `raw-context` arm proved this works. The context budget system (`assembleBudgetedSystemPrompt`) already handles overflow by dropping lower-priority sections.

```ts
// src/core/config.ts
memoryRetrievalCount: 20,  // was 5
```

### Fix 2: Make the kernel's pattern activation threshold reachable

`SparseActivator.activate()` requires `compileCount >= 3` AND `strength >= 0.5`. In practice, a single session never reaches compileCount 3 for most patterns because:
- `process()` is called once without a response (no critique → no strengthen)
- `process()` is called once with a response (critique may or may not strengthen)
- Two calls per turn, but the critique's `strengthened` flag depends on response quality

Either:
- Lower the threshold to `compileCount >= 1` (activate after first reinforcement)
- Or make the kernel inject pattern context regardless of threshold, just ranked by strength

### Fix 3: Remove the embedding budget or increase it significantly

`EMBED_BUDGET_MS = 1200` is too tight for remote APIs. Under load, embeddings silently fail and memory degrades to recency-only. This is the single biggest reliability issue.

Options:
- Set `NTOX_EMBED_BUDGET_MS=5000` as default (already proven to work in the eval harness)
- Or change the constant directly: `const EMBED_BUDGET_MS = 5000;`
- Or make it a config field so users can tune it

### Fix 4: Make the kernel's context additive, not selective

Currently the kernel's cognitive context replaces or competes with memory/theory context in the system prompt budget. When the kernel produces empty context (most turns), it wastes budget allocation.

Instead, the kernel should only ADD to context, never replace. If `cognitiveContext` is empty, don't allocate budget for it.

### Fix 5: Fix the false-success detection to actually fire

The `checkForSurfaceReasoning()` function uses keyword matching (surface signals like "therefore", "thus", "clearly"). The model rarely uses these exact words. The detector almost never triggers.

Options:
- Use the kernel's `Critic.critique()` output (completeness/accuracy scores) as the signal instead of keyword matching
- Or use the LLM itself to judge depth: "Is this answer shallow? Rate 1-10."
- Or remove false-success detection entirely — it adds complexity with no demonstrated benefit

### Fix 6: Make theory memory actually useful

The theory store synthesizes observations into patterns/theories, but `buildTheoryContext()` returns them as free-text injected into the prompt. This is less effective than raw memory episodes because:
- Theory text is generic ("Observation of X suggests Y") while episodes are specific
- Theory matching uses keyword overlap while episodes use embedding similarity
- Theories accumulate noise from irrelevant observations

Options:
- Only surface theories that have been confirmed (evidence threshold)
- Use embedding similarity for theory matching, not keyword overlap
- Limit theory context to the top-1 most relevant theory, not 3

## How to verify

After applying fixes, re-run:

```bash
npm run eval:necessity        # should still pass 6/6
npm run eval:longitudinal -- --arms=off,all,raw-context --variants=12
```

Success criteria:
- `all` recall >= `raw-context` recall (kernel doesn't hurt memory)
- `all` correction >= `off` correction (kernel helps generalization)
- `all` causal >= `off` causal (no regression)
- Overall `all` > `raw-context` > `off` (kernel adds value beyond raw memory)

If `all` still <= `raw-context` on recall, the kernel's retrieval is fundamentally broken and should be removed in favor of raw memory with a higher retrieval count.

## Priority order

1. **Fix 1** (increase memoryRetrievalCount) — immediate, high impact, zero risk
2. **Fix 3** (embedding budget) — immediate, prevents silent degradation
3. **Fix 2** (activation threshold) — makes the kernel actually contribute
4. **Fix 4** (additive context) — prevents budget waste
5. **Fix 6** (theory memory) — medium impact
6. **Fix 5** (false-success detection) — low priority, remove if not fixed

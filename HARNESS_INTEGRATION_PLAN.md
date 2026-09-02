# NTOX + DeepSeek Harness Integration Plan

## Positioning

NTOX should not compete with DeepSeek Harness as another full agent runtime. Harness is strongest as the replaceable infrastructure layer: model adapters, tools, sessions, prompts, sandboxes, approval, subagents, UI, and plugin composition. NTOX is strongest as the cognitive layer: memory, strategy selection, cognitive pattern retrieval, theory learning, false-success detection, reflection, and user modelling.

The stronger project shape is:

```text
DeepSeek Harness = runtime, tools, sessions, sandbox, UI, plugins
NTOX             = cognition, memory, learning, evaluation, self-correction
```

This makes NTOX easier to explain:

> NTOX is a self-improving cognitive layer for plugin-based agent runtimes, first implemented on DeepSeek Harness.

## Harness Surfaces To Use

Harness exposes the right extension points for this split:

| NTOX behavior | Harness surface | Purpose |
|---|---|---|
| Initial cognitive context | `agent/pre-step` | Inspect claimed user messages and prepare context before the step enters the model-visible log. |
| Stable cognitive prompt block | `ctx.systemPrompt.context()` | Add memory, strategy, pattern, theory, and user-model context as ordered runtime context. |
| Tool outcome learning | `tools/result` | Observe final tool outcomes without mutating them. |
| Tool result shaping, if needed | `tools/post-execute` | Enrich or block a result only when NTOX needs active correction. |
| Assistant output learning | `session/event` | Watch assistant messages, turn boundaries, and tool events for post-turn learning. |
| Extra model-visible notes | `agent.inject()` | Queue cognitive reminders for the next admitted request without waking the agent. |
| Retry or continuation | `agent/turn-stopping` | Decide whether a shallow or false-success answer needs another step. |
| Request model selection | `agent/request` | Optionally route high-risk tasks to a stronger model later. |

## Migration Strategy

### Phase 0: Keep NTOX Whole, Add A Harness Adapter

Build a separate Harness plugin package that imports NTOX cognition modules and runs them as an external layer. Do not rewrite NTOX around Harness yet.

The plugin should:

- construct a `CognitiveKernel`, `MemoryStore`, `TheoryMemory`, `MistakeJournal`, and strategy classifier
- register one dynamic prompt context named `ntox:cognition`
- listen to `agent/pre-step` to classify the request and cache step-local cognitive context
- listen to `tools/result` and `session/event` to record outcomes
- expose `/ntox why`, `/ntox memory`, and `/ntox eval` later, after the core loop works

Success means Harness can run normally with NTOX cognition mounted or unmounted by config.

### Phase 1: Extract A Runtime-Neutral Cognitive API

Move NTOX-specific cognition orchestration behind a small API:

```ts
export interface CognitiveLayer {
  beforeStep(input: CognitiveStepInput): Promise<CognitiveStepContext>;
  afterTool(result: CognitiveToolResult): Promise<void>;
  afterTurn(turn: CognitiveTurnResult): Promise<CognitiveLearningResult>;
}
```

This API should not depend on the NTOX `Agent` class, XML tool calls, CLI rendering, or LLM provider code. It should depend only on plain messages, tool outcomes, session ids, and workspace metadata.

### Phase 2: Prove Value With Paired Runs

Add an eval harness that compares:

- Harness baseline
- Harness plus NTOX memory
- Harness plus memory and strategy
- Harness plus full NTOX cognition
- Harness plus full cognition and post-turn learning

Measure task completion, repeated-task efficiency, self-correction, memory usefulness, tool error recovery, and context compression quality. The project becomes compelling only if the NTOX layer improves measurable outcomes.

### Phase 3: Reduce NTOX Runtime Ownership

If the plugin proves useful, gradually retire duplicated infrastructure from NTOX:

- model provider orchestration
- generic tool lifecycle
- sandbox and approval plumbing
- session UI/event replay
- subagent infrastructure
- browser/tool registries where Harness already has stronger equivalents

Keep:

- cognitive kernel
- memory lanes and provenance
- theory/meta-theory store
- pattern compiler
- false-success detector
- mistake journal
- strategy selector
- user model and relationship continuity
- cognitive evals

## First Spike

The first spike should be deliberately small:

1. Create the adapter package in `integrations/deepseek-harness`.
2. Mount it into a Harness headless profile.
3. On `agent/pre-step`, derive a single source-attributed `NTOX Cognitive Context` snapshot from the latest user text.
4. On `tools/result`, preserve ordered final tool outcomes for the active turn.
5. On `session/event`, capture the final assistant answer and call NTOX post-turn learning.
6. Run 20 paired tasks with and without the plugin.

Pass condition:

- the plugin can be disabled cleanly
- Harness tests and typecheck still pass
- at least one benchmark category shows a clear improvement
- NTOX learning artifacts are inspectable and not just hidden prompt stuffing

## Implemented Foundation

The runtime-neutral cognitive API now lives in `src/cognition/layer.ts` and is exported from `src/cognition/index.ts`.

```ts
import { createCognitiveLayer } from "ntox/cognition";

const cognition = createCognitiveLayer();

const context = await cognition.beforeStep({
  sessionId: agent.id,
  turnId: String(turn),
  userMessage,
});

await cognition.afterTool({
  sessionId: agent.id,
  turnId: String(turn),
  toolName,
  success,
});

const learning = await cognition.afterTurn({
  sessionId: agent.id,
  turnId: String(turn),
  userMessage,
  assistantResponse,
});
```

`beforeStep` returns one host-ready prompt plus named sections and diagnostics. `afterTool` retains a bounded list of outcomes for the active turn. `afterTurn` updates episodic memory, theory memory, pattern confidence, and explicit correction history, then returns review and compilation metadata.

The Cordis adapter now lives in `integrations/deepseek-harness`. It injects the context returned by `beforeStep`, observes final tool outcomes in order, and completes learning from the durable session event stream. The adapter contains no NTOX learning logic of its own.

## Main Risk

The biggest risk is turning NTOX into fancy RAG. Pre-step retrieval alone is not enough. The post-turn learning path must update memory, theories, mistakes, and pattern confidence from observed outcomes. That is the part that makes NTOX a cognitive layer instead of a prompt decorator.

## Recommendation

Do the Harness integration as an adapter-first experiment, not a rewrite. If the adapter improves measured behavior, then NTOX can progressively move runtime concerns into Harness. If it does not, NTOX still benefits from having its cognitive layer isolated and testable.

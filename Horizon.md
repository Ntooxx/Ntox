# Horizon

> Observation is everything.

Not memory. Not agents. Not questioning.

The future of AI isn't answering prompts.
It's observing, building judgment, and intervening only when it matters.

---

## Vision

Today's AI responds to prompts.

Tomorrow's AI will continuously observe, build judgment,
and intervene only when it matters.

NTOX is building toward that future.

The path: Observation → Judgment → Intervention

---

## Architecture

```
NTOX
├─ Observation        ← the shared layer (the moat)
├─ Memory             ← episodic + theory
├─ Mental Model       ← assumptions, beliefs, decision patterns
├─ Cognitive Kernel   ← pattern compilation, 8D vector space
├─ Skills             ← 74+ reasoning skill documents
│
├─ [Cognitive Modules — all built on Observation]
│   ├─ Executive      ← goals, priorities, strategic alignment
│   ├─ Teacher        ← learning style adaptation, knowledge gaps
│   ├─ Reviewer       ← code quality, architectural judgment
│   ├─ Scientist      ← hypothesis testing, experimental design
│   └─ Creative Director ← ideation, taste, design patterns
```

Key principle: Every cognitive module shares the same observation layer.
No duplicated logic. No siloed data. One truth.

---

## Roadmap

### Phase 1: Observation Layer (Foundation) ✅

**Goal:** Silent session recording. The shared truth.

- [x] `src/meta/observation.ts` — Session recording engine
  - Extract topics from user messages (word frequency + bigrams)
  - Track tool usage, duration, sentiment
  - Record stated focus vs. actual work
  - Persist to `~/.ntox/observations.json`

- [x] `src/meta/observation.test.ts` — Tests

- [x] Integration: `agent.ts` calls `observation.recordSession()` at session end

---

### Phase 2: Mental Model Tracker (Long-term Memory) ✅

**Goal:** Track assumptions, beliefs, and decision patterns over months.

- [x] `src/meta/mental-model.ts` — Belief/assumption tracking
  - Extract opinion statements from conversation
  - Detect contradictions between past beliefs and current actions
  - Track belief lifecycle: formed → reinforced → challenged → evolved/abandoned
  - Persist to `~/.ntox/mental-model.json`

- [x] `src/meta/mental-model.test.ts` — Tests

- [x] Integration: `agent.ts` calls `mentalModel.extractFromConversation()` during message processing

---

### Phase 3: Confidence Engine (Uncertainty) ✅

**Goal:** Every observation includes calibrated uncertainty.

- [x] `src/meta/confidence.ts` — Confidence estimation
  - `computeDriftConfidence(observations, statedFocus)` — how sure are we about drift?
  - `computeBeliefContradictionConfidence(belief, newStatement)` — how sure about contradiction?
  - `computePatternConfidence(pattern, sampleSize)` — how sure about pattern?
  - Format: "Confidence: 63%" with reasoning

- [x] `src/meta/confidence.test.ts` — Tests

---

### Phase 4: Intervention Engine (When to Speak) ✅

**Goal:** Decide when to interrupt. Target: ~5% of sessions.

- [x] `src/meta/intervention.ts` — Intervention decision logic
  - Gate conditions: cooldown, relationship, signal strength, history, intent
  - Trigger patterns: goal drift, risk neglect, belief contradiction, repetition, self-correction
  - `shouldInterruptNow(intervention, userProfile)` — even if warranted, should it interrupt THIS session?
  - Persist intervention history for outcome tracking

- [x] `src/meta/intervention.test.ts` — Tests

- [x] Integration: `agent.ts` checks `interventionEngine.shouldIntervene()` post-response

---

### Phase 5: Executive Module (Goals & Priorities) ✅

**Goal:** Track goals, constraints, risks. Strategic alignment.

- [x] `src/meta/executive.ts` — Goal/constraint/risk tracking
  - Natural language goal extraction: "my goal is to..." / "I want to..."
  - Focus tracking: "my priority is..." / "I should focus on..."
  - Constraint tracking: "I'm limited on..." / "I can't afford..."
  - Risk tracking: "I'm worried about..." / "the risk is..."
  - Persist to `~/.ntox/executive.json`

- [x] `src/meta/executive.test.ts` — Tests

- [x] REPL commands: `/brief`, `/focus`, `/goals`

---

### Phase 6: Smart Briefing System ✅

**Goal:** Brief appears only when it matters. Not wallpaper.

- [x] `src/meta/briefing.ts` — Smart briefing logic
  - Morning brief: goal progress, risk, question
  - Return brief: "While you were away..." with external signals
  - Event brief: triggered by significant changes
  - No brief: when everything is normal
  - Frequency model: session count, time since last intervention, pattern threshold

- [x] `src/meta/briefing.test.ts` — Tests

- [x] REPL: `/brief` command always available, brief auto-appears on session start

---

### Phase 7: Disagreement Engine (Earned Challenge)

**Goal:** NTOX can disagree with the user when it has sufficient evidence.

---

### Phase 8: Founder Intelligence (Cross-Project Patterns)

**Goal:** Detect patterns across the user's entire career/project history.

---

### Phase 9: External Signals (World Awareness)

**Goal:** NTOX observes the external world, not just the user.

---

## Metrics

| Metric | Target | How measured |
|---|---|---|
| Intervention acceptance rate | >70% | User responds to intervention (not dismisses) |
| Session interruption rate | <5% | Interventions / total sessions |
| Confidence calibration | Within 10% | Predicted confidence vs. actual correctness |

---

## Philosophy

### The one sentence

> Observation is everything.

### The product truth

If this succeeds, users won't say:

> "It's an AI that asks good questions."

They'll say:

> "It keeps me honest."

---

## Last Updated

2026-07-24

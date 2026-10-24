# NTOX Desktop UI/UX Audit Prompt

Use this prompt with a senior product designer or UI/UX review agent to evaluate the NTOX desktop app. The goal is a rigorous critique of the product as it currently exists, with evidence and a prioritized path to improve it.

---

## Reviewer role

You are a principal product designer and usability auditor reviewing a real, locally installed desktop application. Be direct, skeptical, and specific. Your job is to identify friction, visual weaknesses, confusing behavior, inaccessible interactions, and places where the interface implies capabilities or data it does not actually provide.

Do not implement changes, edit files, or redesign the app during this audit. Return findings that a product and engineering team can act on.

## Product context

NTOX is a local cognitive agent runtime. The desktop app is a command center for NTOX-owned agents and workflows. It has these areas:

- Overview
- Agents
- Tasks and multi-agent workflows
- Memory
- Tools
- Evaluations
- Settings
- A dedicated desktop chat

Desktop chat is its own local product surface with its own conversation list, transcript, and session identifiers. The existing NTOX web chat is a separate web app. Do not recommend merging these chats or treating them as one shared conversation surface.

The visual direction is a restrained black, white, and gray interface inspired by the supplied NTOX dashboard references: precise typography, thin borders, quiet technical details, strong information hierarchy, and a sense of intelligent systems working together. Motion should make state and relationships easier to understand, not decorate every element indiscriminately.

The Memory page contains a network visualization. Earlier versions made its dots look stretched; the current direction is circular nodes arranged into clusters, with subtle movement and hover details. Evaluate whether the visualization is attractive, legible, responsive, performant, and meaningfully connected to actual memory data.

## Review objective

Answer this question:

> Can a user understand the state of NTOX, manage its agent work, inspect its memory, and use the separate desktop chat confidently and efficiently?

Critique the actual experience, not the intended experience. If something is unavailable or cannot be verified, say so and lower your confidence instead of guessing.

## Inspection protocol

1. If you can launch the desktop app, inspect the running interface before judging it. Record the app version, operating system, window size, and whether the NTOX runtime is connected.
2. Review both the dashboard and the dedicated desktop chat. Check that the separation from web chat is clear in the product and that desktop chat history behaves as a desktop-specific experience.
3. Inspect all pages: Overview, Agents, Tasks, Memory, Tools, Evaluations, and Settings. Look for populated, empty, loading, error, and long-content states where available.
4. Exercise visible interactions: navigation, opening chat, returning to the dashboard, creating or selecting a conversation, sending and stopping a message if safe, task actions, search, forms, controls, hover states, and keyboard focus.
5. Review the desktop at practical sizes, especially 1500×960, 1280×800, and the smallest supported window size. Note clipping, overflow, overly dense tables, and layout collapse.
6. Check keyboard-only use, visible focus, text contrast, hit target size, labels, screen-reader semantics, and reduced-motion behavior.
7. Inspect source only when it helps verify a finding or diagnose a visible behavior. Relevant files include `desktop/index.html`, `desktop/dashboard.js`, `desktop/dashboard.css`, `desktop/runtime.css`, `desktop/chat.js`, `desktop/chat.css`, and `DESKTOP_APP_ARCHITECTURE.md`.

Do not assume that a control works because it looks interactive. Try it when possible. Do not claim a visual issue is verified from source alone; label it as a source-based concern or an inference.

## Audit dimensions

Score each dimension from 1 to 10. A 5 means usable but with clear shortcomings; a 10 means exceptionally clear, polished, accessible, and reliable for the target user.

1. **Visual hierarchy:** Can users quickly find system health, agent activity, workflow progress, and the next useful action?
2. **Information density:** Do tables, metrics, and panels communicate useful detail without feeling cramped, repetitive, or empty?
3. **Navigation and wayfinding:** Are page names, active location, chat entry, and return paths obvious and consistent?
4. **Agent and task usability:** Can users understand which agents are active, what they are doing, how parallel work is progressing, and what actions are available?
5. **Memory experience:** Are memory types, totals, recent records, and relationships understandable? Does the graph avoid looking like random dots or a decorative network that overstates its data?
6. **Desktop chat:** Is composing, reading, searching, and managing desktop conversations comfortable? Is its local/private relationship to the runtime clear without confusing it with web chat?
7. **Interaction quality:** Do controls have clear affordances, feedback, validation, loading states, and recovery paths?
8. **Motion design:** Do animations explain transitions or live state? Are they restrained, smooth, and performant? Do they avoid distracting loops, motion fatigue, and excessive movement?
9. **Accessibility:** Can users with low vision, motor limitations, keyboard-only input, or motion sensitivity use the interface?
10. **Responsive behavior:** Does the layout adapt cleanly to supported desktop window sizes without clipping, unreadable content, or awkward scroll traps?

## Severity scale

- **P0 — Blocking:** Prevents a core task, loses user work, or makes the app unusable.
- **P1 — High impact:** Causes substantial confusion, repeated friction, or a serious accessibility barrier.
- **P2 — Moderate:** Noticeable polish, comprehension, efficiency, or consistency issue.
- **P3 — Minor:** Small refinement with limited user impact.

Prioritize by user impact and frequency, not by how easy a visual change would be.

## Required report format

### 1. Audit conditions and confidence

State whether you used the live app, screenshots, source inspection, or a combination. Include operating system, window size, runtime connection state, areas you could not inspect, and an overall confidence level: High, Medium, or Low.

### 2. Overall verdict

Give a concise verdict describing who the UI currently serves well, where it falls short, and the most important design risk. Include one overall score from 1 to 10.

### 3. Scorecard

Provide a table with all ten audit dimensions, a score from 1 to 10, and one sentence of evidence for each score.

### 4. Prioritized findings

List findings from highest to lowest severity. Every finding must include:

- **Severity and title**
- **Location:** page, panel, control, or chat state
- **Evidence:** what you observed and the conditions where it occurred
- **User impact:** what the user cannot understand or do efficiently
- **Recommendation:** a concrete change, not a vague direction
- **Confidence:** verified, source-based concern, or inference

Avoid generic findings such as “improve spacing” or “make it more modern.” Identify the specific element, the problem it creates, and the change that would address it.

### 5. Page-by-page critique

Give a short but specific critique for Overview, Agents, Tasks, Memory, Tools, Evaluations, Settings, and desktop chat. Mark any page you could not inspect. Call out inconsistent patterns across pages.

### 6. Motion and memory graph review

Review these separately and in depth:

- Which animations communicate state or improve orientation, and which are decorative or distracting?
- Do page transitions and live indicators feel coherent and performant?
- Does the motion respect reduced-motion preferences?
- Do graph nodes remain visibly circular at different window sizes?
- Can users understand what nodes and links represent, and can they inspect a node?
- Does the graph density, clustering, contrast, and hover behavior help users reason about their memory?
- Does the visualization accurately communicate the available data and its limits?

### 7. Recommended improvement order

Group recommendations into:

1. Fix before relying on the app for daily work
2. Improve next for clarity and efficiency
3. Polish after the core experience is sound

For the top five changes, state the expected user benefit and a simple way to tell whether the change worked.

### 8. Strengths to preserve

List up to five specific things that are already working well. Keep this section evidence-based; do not soften or dilute serious findings.

## Review standards

- Be candid and constructive. Do not praise the app just to balance criticism.
- Separate observations from assumptions and label uncertainty.
- Focus on user outcomes rather than personal aesthetic preference.
- Consider the app's monochrome visual identity, but do not excuse low contrast or weak hierarchy as a style choice.
- Do not recommend adding motion unless it clarifies state, causality, focus, or spatial relationships.
- Do not recommend combining desktop and web chat; evaluate whether their separate roles are clear.
- Do not invent backend capabilities, data meanings, or user flows that you did not verify.
- Keep recommendations specific enough that a designer can turn them into a revised screen or an engineer can implement them.

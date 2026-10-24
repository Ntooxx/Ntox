# NTOX Desktop: UI/UX 9–10 Implementation Brief

## Mission

Elevate the NTOX desktop app from a visually promising prototype into a dependable, comfortable daily workspace. Aim for a 9–10/10 experience in the audit dimensions documented in [`UI_UX_AUDIT.md`](UI_UX_AUDIT.md): clarity, usability, navigation, accessibility, responsiveness, and trustworthy presentation of runtime data.

This brief is an implementation specification. Inspect the current code and running app before changing it. Fix the root interaction and information problems, not only their visual symptoms. Do not claim the target score has been reached without a live review at the end.

## Product boundaries

- NTOX Desktop is a local command center for NTOX’s own runtime and agents.
- Desktop chat is a dedicated desktop product surface with its own sessions, transcripts, and conversation controls.
- Existing NTOX web chat remains a separate web product. Do not merge its view or conversation history into desktop chat.
- Preserve the black, white, and gray identity. Use restrained visual signals for state, with text and shape as well as color.
- Use real runtime data. Never fabricate live activity, progress, evaluation results, memory relationships, or system health to make a screen look populated.

## Experience principles

1. **Make the next useful action obvious.** Each page should answer what is happening, what needs attention, and what the user can do next.
2. **Show system state before detail.** Distinguish loading, connected, starting, unavailable, stale, empty, failed, and complete states.
3. **Use progressive disclosure.** Keep the overview concise; provide detail where users inspect a particular task, agent, memory record, tool, or evaluation.
4. **Keep actions predictable.** Every button, link, tab, and close control must do what its label and placement promise. Provide confirmation for destructive actions and visible results for saves and task changes.
5. **Protect user context.** Preserve scroll position, typed content, focus, selected page, and conversation context whenever data refreshes.
6. **Make evidence and uncertainty visible.** Show whether a value is live, sampled, estimated, or unavailable. Do not imply that synthetic visualization geometry is stored semantic structure.
7. **Support different input needs.** Every pointer interaction needs a keyboard and accessible-name equivalent where meaningful.

## Required improvements

### 1. Runtime startup and loading

- Render a complete shell and meaningful loading state immediately, before API requests finish.
- Identify which parts of the interface are connecting. Use lightweight skeletons only where they preserve the final layout.
- Load runtime health first. Load page data independently so one failed endpoint does not blank every page section.
- Keep failures local to the affected panel. Provide a clear retry action and explain whether the app will retry automatically.
- Show when data was last refreshed and distinguish live, stale, and unavailable values.
- Avoid flashing from empty values to populated values or replacing the whole page during background refresh.

### 2. Navigation and wayfinding

- Keep the active dashboard destination visually clear and expose it semantically with `aria-current` or an equivalent.
- Give the desktop chat a clear, persistent way in and a predictable way back to the dashboard.
- Repair the chat context controls: close must close/collapse its panel; “Manage agents” must open Agents; “Explore memory” must open Memory.
- Preserve the dashboard destination a user was on before entering chat, while ensuring explicitly named destinations go to the named page.
- Provide visible keyboard focus for navigation, menu controls, links, tabs, and table actions.

### 3. Overview

- Keep runtime health and actionable work above decorative or secondary system details.
- Explain each metric in terms of its source and time window. Avoid metrics that appear authoritative but are static or inferred.
- Make active agents, queued/running work, and failures visually distinguishable without relying on color alone.
- Provide useful empty states with direct actions such as creating a workflow or opening the agent fleet.
- Avoid repeated information between metric cards, fleet rows, and recent-work panels.

### 4. Agents

- Make agent name, role, state, current assignment, and most recent activity scannable at supported window sizes.
- Provide search, useful filters, and an explicit empty result state.
- Make row actions discoverable and explain any action that is unavailable due to runtime policy.
- Do not make the user infer whether “idle,” “ready,” “starting,” and “unavailable” mean the same thing.
- Preserve the table’s key columns on narrow windows; use a deliberate compact row/card treatment before horizontal scrolling becomes the only option.

### 5. Tasks and workflows

- Make goal, subtasks, concurrency limit, tool boundary, and expected side effects clear before workflow submission.
- Validate input inline and retain form contents after recoverable failures.
- Show per-subtask owner, state, progress, dependency, and result where the runtime has that data. Label unavailable progress honestly.
- Separate cancel, retry, and inspect actions. Confirm actions that may discard work.
- Explain failed, cancelled, timed-out, queued, and completed states consistently. Give a useful recovery action for each recoverable state.
- Ensure long task names, errors, and results remain inspectable at minimum supported window dimensions.

### 6. Memory

- State what a node represents and what an edge means directly next to the graph.
- Current edges represent shared session/source provenance between records; do not describe them as semantic or conceptual relationships unless the runtime supplies those relationships.
- Distinguish total store size from the subset currently loaded or rendered. If the UI shows a sample, show the sample size and how it was selected.
- Add a searchable, keyboard-accessible record list or detail panel that provides the same essential information as pointer hover: content, type, timestamp, and source.
- Make graph selection usable by mouse, keyboard, and assistive technology. Do not make canvas hover the only way to inspect a record.
- Make memory type totals authoritative or label them as counts of loaded records.
- Keep the visualization legible in empty, small, dense, and large data states. Do not add unsupported links or hide the limits of the current graph model.

### 7. Tools

- Explain whether each tool is registered, enabled, available to a given agent, or gated by policy; do not collapse these into one ambiguous status.
- Make policy-gated actions understandable without exposing secrets or suggesting that the desktop UI bypasses runtime policy.
- Provide a meaningful empty state and search/filter behavior if the catalog grows.

### 8. Evaluations

- Separate recorded runs from available suites and explain when a score is missing or not comparable.
- Show suite, agent/version, dataset, result, and completion state where the runtime provides them.
- Provide useful empty and failed states. Do not present placeholder or benchmark-like values as real results.
- Make the relationship between an evaluation result and a deployment/agent version explicit.

### 9. Settings

- Distinguish saved configuration from values currently active in the runtime.
- Show clear save success/failure feedback and explain which changes need an API restart.
- Validate values inline, retain user edits on error, and label controls accessibly.
- Keep secrets out of rendered settings and error messages.

### 10. Dedicated desktop chat

- Preserve separate desktop conversation history and desktop session IDs. Keep the “desktop” and “local” distinction clear without overstating privacy guarantees.
- Add explicit labels and reliable behavior for new conversation, search, clear, send, stop, context close, and return-to-dashboard actions.
- During streaming, update only the active assistant message rather than replacing the full transcript on every token.
- Auto-scroll only when the user is already near the bottom. If the user scrolls up, preserve their reading position and offer a “jump to latest” affordance.
- Preserve keyboard input, focus, and conversation selection during refresh and message completion.
- Keep long conversations responsive. Use appropriate message formatting for code and structured output, and provide a copy action where it materially helps.
- At the smallest supported window size, collapse or reflow the context panel before the central conversation becomes cramped. Ensure every panel can be reopened intentionally.
- Make connection, generation, tool activity, cancellation, and error states legible without changing the transcript unexpectedly.

## Accessibility and responsive acceptance

- Every interactive element has an accessible name and a visible focus indicator.
- Focus order follows the visible page order. Focus is not lost after route changes, errors, dialogs, or streaming updates.
- Graph information and status are available without pointer-only interaction.
- Text and control contrast remain legible on the dark surfaces; muted text is still readable at normal viewing distance.
- Controls have practical hit areas and do not rely on tiny icon-only targets without a label or tooltip.
- Keyboard-only users can operate every core workflow, search, conversation action, and setting.
- Respect `prefers-reduced-motion` for all motion work. Reduced motion must preserve state information and operation feedback.
- Review 1500×960, 1280×800, and the actual smallest supported Electron window. Do not count a CSS breakpoint as responsive if the app window cannot reach it.

## Definition of done

- Every P1 finding in `UI_UX_AUDIT.md` is resolved or has an explicit, user-centered reason to defer it.
- No visible control is dead, mislabeled, or routed to an unrelated destination.
- Loading, empty, error, stale, and populated states are intentionally designed for every page.
- Memory totals, samples, and graph relationships are described truthfully.
- Dashboard refresh and chat streaming preserve user context.
- Core tasks pass a live keyboard-only walkthrough and a screen-reader semantics review.
- The app has been inspected live at the three target window sizes and with reduced motion enabled.
- A follow-up audit documents screenshots, conditions, findings, and evidence for every score. A 9–10 score must be supported by that audit, not asserted by the implementer.

## Implementation instructions for the next agent

Read `AGENTS.md`, `DESKTOP_APP_ARCHITECTURE.md`, and `docs/UI_UX_AUDIT.md` before editing. Inspect the current repository state and preserve unrelated user changes. Implement the improvements in the existing Electron renderer and runtime APIs unless evidence requires a small backend change. Keep the secure preload/IPC boundary intact, do not merge web chat with desktop chat, and do not invent runtime data to make the interface look complete.

At completion, report changed files, the user-facing improvements, live verification performed, remaining limitations, and the evidence that supports the final UX assessment.

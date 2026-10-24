# NTOX Desktop UI/UX Audit

**Review date:** 2026-10-24  
**Overall score:** 6/10  
**Verdict:** The visual refresh and clearer data labels improved the command center, but the dedicated chat still has a visible control-layout defect and the interface overstates local privacy. Fix those before treating this as a daily-use desktop product.

## 1. Audit conditions and confidence

- **Method:** Source review plus Playwright Chromium screenshots of the actual renderer files using a local mock fixture. Rendered Overview, Agents, Tasks, Memory, Tools, Evaluations, Settings, and desktop chat. Captured at 1500×960, 1280×800, and the 760px minimum width; the chat was captured at all three sizes. Reduced motion was enabled for these captures.
- **Interactions exercised:** Dashboard navigation, opening chat, closing the context panel, reopening it, and using “Explore memory” to navigate to Memory. These worked. No real workflow, provider, memory mutation, chat request, stop action, or keyboard-only task was submitted.
- **Live runtime:** Not connected or visually inspected. Electron first inherited `ELECTRON_RUN_AS_NODE=1`; after clearing it for the launch attempt, Windows denied the sandbox process access to the Electron install directory. The browser captures used mock API responses and therefore establish layout and renderer behavior only. They do not verify actual runtime data, native Electron behavior, or live performance.
- **Environment:** Windows workspace; Chromium renderer captures. Runtime connection, Electron window size, and actual OS-level reduced-motion behavior could not be confirmed.
- **Confidence:** **Medium** for visible layout and the tested renderer interactions; **Low** for runtime behavior, actual data states, native window behavior, performance, keyboard use, and live visual fidelity.
- **Capture artifacts:** `.ntox-desktop-smoke/audit-overview.png`, `audit-agents.png`, `audit-tasks.png`, `audit-memory.png`, `audit-tools.png`, `audit-evaluations.png`, `audit-settings.png`, `audit-chat.png`, `audit-chat-1280x800.png`, and `audit-chat-760x700.png`. All captures use fixture data.

## 2. Overall verdict

The dashboard is now more understandable and evidence-conscious: workflow limits are stated, memory links are described as provenance, and the desktop chat is clearly separate from web chat. It serves someone monitoring a local runtime better than the previous version. The most serious risks are trust and control: provider credentials and chat are described as staying local even when a remote model provider is configured, while two chat header actions visibly collide. The desktop chat also presents two competing Dashboard return buttons.

The broad black-and-white visual system is coherent, though the Overview and Memory pages use space unevenly and some of the smallest labels are difficult to scan. The review is not a live-runtime sign-off because Electron could not start in this environment.

## 3. Scorecard

| Dimension | Score | Evidence |
|---|---:|---|
| Visual hierarchy | 7/10 | Page headings and system state read clearly in the 1500×960 captures; Overview leaves a large unused grid area and small utility text is very fine. |
| Information density | 6/10 | Agents and Tasks expose useful columns, but the Memory graph, record list, and recent records make a long page; only the first 30 matching records can be selected. |
| Navigation and wayfinding | 6/10 | The dashboard rail and chat destinations are understandable; chat duplicates the Dashboard return control and compresses its Context/Clear actions. |
| Agent and task usability | 6/10 | The workflow form states its three-agent limit and tool boundary, and task cancellation is labeled as workflow-wide; actual submit, cancel, retry, and failure recovery were not exercised. |
| Memory experience | 7/10 | The UI explains provenance edges and separates total records from loaded samples; record browsing is capped at 30 without paging or a way to reach later records. |
| Desktop chat | 5/10 | It clearly identifies itself as a desktop-specific conversation surface, but header actions overlap and the local/private wording does not distinguish local history from remote model requests. |
| Interaction quality | 6/10 | Dashboard navigation, context close/reopen, and Memory destination worked in the mock renderer; runtime-backed actions and keyboard operation remain unverified. |
| Motion design | 6/10 | Motion is bounded, graph animation pauses offscreen, and reduced-motion rules exist; system and hero status dots pulse regardless of connection state, and page entrances can replay when changed data rerenders the view. |
| Accessibility | 6/10 | Most key actions have names and a shared `:focus-visible` rule; the memory canvas is deliberately hidden from assistive technology and its record alternative exposes only a subset. No keyboard-only pass was completed. |
| Responsive behavior | 5/10 | Renderer layout responds at 760px, but the chat’s duplicated navigation and overlapping controls persist at its smallest tested width; dashboard tables and data density need a native-window check. |

## 4. Prioritized findings

### P1 — Chat header actions overlap and have undersized hit areas

- **Location:** Desktop chat conversation header; `desktop/index.html:18`, `desktop/chat.css:1,5`.
- **Evidence:** In Chromium captures at 1500×960, 1280×800, and 760×700, “Context” and “Clear” visibly run into each other. At 760px, their measured button boxes were 20px and 41.5px wide, with about 4.5px of overlap. The broad `.desktop-conversation-head>div` grid selector wins over the lower-specificity `.conversation-actions` flex rule, leaving the actions container with an unsuitable 8px grid column.
- **User impact:** Users can misread which action they are selecting, and the context toggle has an impractically small target. This is especially risky for Clear, which removes the current conversation’s messages after confirmation.
- **Recommendation:** Scope the conversation-title grid rule to the title element. Give the action group a dedicated flex or grid layout, non-shrinking buttons, and a minimum hit area; verify the two controls at 760px and 1280px.
- **Confidence:** **Verified** in renderer screenshots and bounding-box measurements with mock data.

### P1 — Privacy copy implies credentials and inference stay on the device

- **Location:** Settings credential panel and desktop-chat header/composer; `desktop/dashboard.js:225-229`, `desktop/index.html:16,18`.
- **Evidence:** Settings says provider keys “never leave this machine,” while chat says “PRIVATE SESSION,” “LOCAL RUNTIME,” and “Runs locally.” The app supports remote providers such as OpenRouter, and chat requests are sent through the local API to the configured provider. The copy does not distinguish local desktop conversation storage from where prompts and credentials are sent for inference.
- **User impact:** A user may put sensitive material into chat or choose a provider under the mistaken belief that inference and credentials remain on their computer.
- **Recommendation:** Describe what is actually local (desktop session/history storage) and state that prompts and provider credentials may be sent to the configured provider. Make the provider visible in chat context. Avoid “never leave this machine” unless it is guaranteed for the selected provider.
- **Confidence:** **Source-based concern**. The UI copy and provider flow are in source; provider-specific network behavior was not exercised in the live app.

### P2 — Two Dashboard return controls compete in chat

- **Location:** Desktop chat top bar; `desktop/index.html:16,21`, `desktop/dashboard.js:451-455`.
- **Evidence:** Both `.desktop-back` in the chat header and the fixed `.back-to-console` control are visible in the chat screenshots, one on each side of the header. Both return to the dashboard.
- **User impact:** The same action is presented twice with different placement and styling, adding clutter and uncertainty about whether one has a different navigation effect.
- **Recommendation:** Keep one consistently placed Dashboard action and preserve the remembered dashboard destination on that action.
- **Confidence:** **Verified** in renderer screenshots.

### P2 — Runtime machine readings can stay stale while the refresh timestamp advances

- **Location:** Overview machine-status panel; `desktop/dashboard.js:31-36,232-257,271-303`.
- **Evidence:** `refresh()` fetches bootstrap runtime data on every poll, but the render signature includes config and memory totals, not `state.bootstrap.runtime`. When only uptime or system memory readings change, `render()` returns early because the signature is unchanged. The refresh metadata is still updated manually.
- **User impact:** The page says it refreshes every five seconds while CPU count, free memory, and uptime-dependent display may retain old values. That weakens confidence in the live status panel.
- **Recommendation:** Include the rendered runtime fields in the signature or update the machine-status elements independently. Show a timestamp tied to the data actually displayed.
- **Confidence:** **Verified from source**; the live polling scenario could not be exercised.

### P2 — Graph records beyond the first 30 cannot be inspected

- **Location:** Memory record explorer; `desktop/dashboard.js:65-70`.
- **Evidence:** The API loads up to 100 recent records and the graph can show up to 220 nodes, while `recordList` always renders only `filtered.slice(0, 30)`. The UI reports how many match and how many are shown but provides no page control, “load more,” or selectable virtual list for the remainder.
- **User impact:** A user cannot inspect many records represented by the graph or search beyond the loaded sample, despite the page presenting a record explorer.
- **Recommendation:** Add pagination or “Load more,” and make clear which graph nodes correspond to the loaded list. Consider searching through the API rather than only the current 100-record sample.
- **Confidence:** **Verified from source**; screenshots used a 12-record fixture.

### P2 — Status animation does not reflect whether the runtime is connected

- **Location:** Shared system indicator and Overview hero status; `desktop/runtime.css:20`, `desktop/dashboard.js:21,36`.
- **Evidence:** `.system-state>i` and `.hero-status .live-dot` receive the same repeating `live-breathe` animation regardless of the current status text. The disconnected renderer capture showed a glowing status dot while its label read “RUNTIME UNAVAILABLE.”
- **User impact:** A persistent pulse is conventionally read as a live/healthy signal, so it can contradict the actual unavailable state.
- **Recommendation:** Apply the breathing animation only to a connected state. Let unavailable, stale, and error states settle and use explicit text/shape changes; preserve the static signal in reduced-motion mode.
- **Confidence:** **Verified from source and unavailable-state renderer capture.**

### P2 — Overview has an unbalanced first-screen composition

- **Location:** Overview panels; `desktop/dashboard.js:30-36` and the 1500×960 capture.
- **Evidence:** With two agents and three tasks, the fleet panel occupies only the upper-left grid cell, leaving a large blank area to its right; recent work and machine status begin on the next row. The lower region is visually heavier than the upper region.
- **User impact:** The main command-center view feels unfinished and requires more vertical scanning than the amount of content warrants.
- **Recommendation:** Align the fleet and machine-status panels in the first row, or let fleet span the available width until enough content exists. Keep the recent-work panel paired with the relevant runtime detail.
- **Confidence:** **Verified** in the fixture-based renderer capture; exact balance depends on real data volume.

## 5. Page-by-page critique

- **Overview:** Runtime health, active runs, queued/running tasks, and recent work are easy to locate. The two-column panels leave conspicuous empty space with a small fleet. Runtime values may not refresh unless another rendered data set changes.
- **Agents:** Clear search and status filter; key identity, state, role, current task, start, and tools are in one table. On small widths, the table relies on horizontal scrolling; verify column discovery and row actions in the native window. The page is candid that controls depend on runtime support.
- **Tasks:** The goal and optional three subtask prompts are explicit, as are tool restrictions and whole-workflow cancel/retry behavior. The task list provides owner and result/error. It does not expose dependency or per-step progress, and the real action/recovery flows were not exercised.
- **Memory:** The provenance explanation, total-versus-loaded distinction, search, selectable record details, and sample type counts address earlier trust problems. The graph looks sparse with a small set of records, while the list stops at 30 and the visualization is not a semantic embedding.
- **Tools:** Catalog description says registration does not grant every agent access and policy still applies. Cards are consistent; the actual mapping of runtime approval gates to visible policy was not live-tested.
- **Evaluations:** Explicitly describes stored historical measurements and warns that runs do not identify an agent version. Useful restraint; empty and failure states were not connected to a live history.
- **Settings:** Saved settings and restart requirements are clear, and keys are write-only in the UI. The claim that keys never leave the device is misleading for remote providers. The runtime panel says the active model is not reported, which is appropriately transparent.
- **Desktop chat:** Separate history and web-app boundary are clear. The context actions themselves worked in the browser capture, but “Context” and “Clear” collide visually, two Dashboard buttons appear, and the copy blurs local storage with remote inference. The composer remains visible at 760px.

## 6. Motion and memory graph review

### Motion

- The motion vocabulary is coherent in source: brief page entrances, hover/focus transitions, status changes, and a restrained memory graph animation. The graph loop is capped to roughly 30 frames per second, pauses when the panel is offscreen or the document is hidden, and caps device pixel ratio at 2.
- Reduced-motion CSS exists for dashboard and chat. The visual captures were made with reduced motion enabled and showed a settled renderer. OS-level preference handling and animation performance in Electron were not verified.
- Status animation currently does not follow actual runtime health: the system and hero indicators pulse even when unavailable. Correct that before using motion to communicate operational state.
- The renderer replaces page markup when its data signature changes. Since entrance animations are attached to page sections and rows, changed data can replay entrance motion during a refresh. Check this with a live update; keep existing content still and animate only the changed row/value.
- No performance claim is possible from these captures; they used Chromium with a static fixture, not Electron’s hardware/software rendering path.

### Memory graph

- Points are canvas circles and stayed round in the 1500px fixture capture. The canvas is marked `aria-hidden`, with a separate searchable record list and detail panel as an accessible alternative.
- Links are labeled as shared source/session provenance rather than semantic similarity. This is a meaningful improvement in honesty.
- Coordinates are deterministic pseudo-random positions from record IDs, not a semantic or spatial embedding. With a small fixture the graph appears as a few disconnected dots and short lines across a broad empty panel; the UI should offer a useful small-data state rather than implying a rich cluster structure.
- The list exposes up to 30 selected records while the API loads 100 and the graph can display 220 nodes. Searching is limited to loaded records. This mismatch should be resolved or labeled directly.
- Canvas pointer hover is not required to inspect a record, but the keyboard alternative reaches only those first 30 rendered buttons. Keyboard navigation, screen-reader announcements, and dense real-data performance were not tested.

## 7. Recommended improvement order

### Fix before relying on the app for daily work

1. Correct the Context/Clear layout and provide practical hit targets.
2. Rewrite privacy and credential copy to distinguish local history from provider-bound prompts and keys.
3. Keep one Dashboard return action in chat.
4. Make runtime data refresh when runtime fields change and keep its update timestamp honest.

### Improve next for clarity and efficiency

5. Let users inspect all memory records shown or searchable, with pagination or API search.
6. Bind status motion to real connection state and avoid replaying page entrances on routine refresh.
7. Rebalance the Overview’s fleet, recent work, and machine-status panels.
8. Verify table scrolling, focus order, and error recovery in an actual Electron window at 760×700 and 1280×800.

### Polish after the core experience is sound

9. Tune memory graph density and its empty/small-data state without suggesting semantic clusters.
10. Measure chat streaming, graph animation, and page transitions on the app’s actual rendering path.

### Success checks for the top five

| Change | Expected benefit | Simple success check |
|---|---|---|
| Fix chat actions | Users can confidently toggle context or clear the current conversation. | At 760px, 1280px, and 1500px, buttons have separate visible labels and at least 32px height without overlapping boxes. |
| Clarify privacy | Users know which data stays in desktop history and which may be sent to a model provider. | Ask users where prompts and API keys go for a remote provider; they answer accurately from the UI alone. |
| Remove duplicate return | Chat navigation becomes simpler and consistent. | Only one Dashboard control is visible and it returns to the last dashboard page. |
| Refresh runtime values | Machine status matches the newest API response. | Change only `memoryFreeBytes` and `uptimeSeconds`; both displayed values update on the next poll. |
| Expose all memory records | Users can inspect the records counted as matching or shown. | Search for a known record after item 30 and open its content, source, timestamp, and ID. |

## 8. Strengths to preserve

1. Desktop chat has its own conversation list and explicitly says its conversations are separate from web chat.
2. The dashboard consistently uses a restrained monochrome visual system with clear page headings and strong panel boundaries.
3. The Tasks page states the agent concurrency limit, tool boundary, and lack of authoritative percentage progress.
4. The Memory page explains that its lines are provenance links, not semantic similarity, and distinguishes total records from loaded records.
5. The evaluation page avoids pretending that historical experiment results identify a deployed agent version.

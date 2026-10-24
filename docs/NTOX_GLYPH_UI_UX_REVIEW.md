# NTOX dashboard and glyph integration: UI/UX review

Date: 24 October 2026

## Audit conditions and confidence

Reviewed the current working tree, including the glyph integration, rather than relying on the previous implementation review. This report supersedes the earlier verdict for the current UI. No application code was changed during this review.

- Windows; Electron desktop package version `0.1.0`.
- Native app connected to the local runtime, reporting seven agent records. Inspected all seven dashboard pages and desktop chat.
- Native outer window sizes: 1500 x 960, 1280 x 800, and 760 x 640. Actual content sizes: 1484 x 895, 1264 x 735, and 744 x 575.
- Also exercised controlled fixtures in Edge at 1500 x 960, 1280 x 800, and 760 x 640, including empty, disconnected, recovered, long-content, and changing-data states.
- Native inspection used navigation and read operations. No workflows were submitted, credentials changed, messages sent, or provider calls intentionally initiated by the review.
- Confidence: **High** for reproduced behavior and inspected layouts; **Medium** for accessibility and sustained performance. No screen reader session, comprehensive contrast audit, GPU profiling, or long-running memory-leak assessment was performed. Sending/stopping a real response and execution/cancel/retry mutations were not exercised.

### Verification results

| Check | Result |
| --- | --- |
| Runtime authentication, landscape, and API server suites | 25 tests passed across three files using Vitest |
| Glyph geometry/export suite | Three tests passed using Node's test runner |
| Browser interaction review, with composer-opening step adapted in memory | Passed; no page errors |
| Native navigation and resize inspection | Connected; no page errors; no document horizontal overflow at the three sizes |
| Planet placement | One on Overview; zero on every other dashboard page |
| Section artwork | Agents, Tasks, Memory, Tools, Evaluations, and Settings each mount their corresponding glyph |
| Glyph rendering | 21 canvas clears in a 700 ms sample while animated; zero while paused; zero under reduced motion |
| Motion controls | Pause persisted across navigation and reload; reduced-motion preference disabled the control; Escape removed the entry passage |
| Canvas failure | Local SVG fallback remained visible and loaded when glyph canvas contexts were unavailable |

The checked-in browser review script currently times out because it fills the workflow form before opening its new disclosure. Adding the opening click **in memory**, without editing the script, made the suite pass. This is stale test coverage, not a broken workflow-opening control. An initial attempt to run the Vitest files with Node's runner was also corrected; that command error is not counted as a product failure.

Evidence: `.ntox-desktop-smoke/rerun-ui-review-results.json`, `glyph-review-diagnostics.json`, `native-review-results.json`, and `review-native-pages.json`. Use the native pages result for glyph mapping; the diagnostic run's `.page-header` selector did not match the actual `.page-hero` element. Screenshots: `review-native-*.png`, `native-agents-*`, `native-chat-minimum.png`, and `rerun-*.png` in the same directory. Full-page screenshots with a fixed header should not be interpreted as evidence of header misplacement.

## 1. What works

1. **The requested visual direction is implemented.** Overview retains the planetary photograph. The other sections have distinct monochrome artwork: Constellation, Sequence, Strata, Aperture, Calibrate, and Alignment. Black surfaces, restrained borders, and white typography form a coherent dashboard.
2. **The three main surfaces are connected.** Intro to Agents, intro to chat, dashboard to chat, and chat back to dashboard worked. Destination heading/composer focus and the chat context Escape path passed the browser checks.
3. **Motion has working safeguards.** Pause, persistence, live reduced-motion changes, Escape dismissal, and SVG fallback were directly exercised. Static row icons retain clarity without adding many animated canvases.
4. **The UI distinguishes actual data from unavailable data.** Memory labels describe source provenance and loaded samples. Evaluations keep comparable series together and show a single measurement honestly. Settings distinguishes saved configuration from the active runtime.
5. **Several earlier usability fixes remain effective.** Unchanged Overview data does not replace its DOM on polling. Workflow fields survive polling on the same page. All 100 fixture memory records were reachable. Long chat titles preserve Context/Clear controls, and disconnected state recovers through retry.

## 2. What's broken: prioritized findings

### F1 — P0: Leaving Tasks silently deletes an unfinished workflow draft

**Location:** Tasks → New workflow → navigate to Agents → return to Tasks.

**Evidence:** Entered a goal and subtask, navigated away and back, and both fields returned empty. Same-page polling preserves these values, but navigation does not. `desktop/dashboard.js:353` captures values from the outgoing DOM; `desktop/dashboard.js:355` restores them only when `enteredPage` is false. There is no persistent page draft in that path.

**Impact:** A user can lose a substantial prompt simply by checking agent availability before starting work. No submitted workflow or stored record was lost in this reproduction. P0 follows the project's audit rubric, which explicitly includes loss of user work.

**Recommendation:** Keep goal, subtasks, and execution mode in explicit draft state across navigation; clear it after confirmed submission or an explicit discard. Apply equivalent handling to non-secret Settings edits. Keep any credential draft in memory only, with deliberate handling when leaving the page.

**Confidence:** Verified for workflow drafts. Settings exposure is a source-based concern from the shared rendering path, not a separately reproduced loss.

### F2 — P1: Live updates discard keyboard focus and expanded row content

**Location:** Agents, during a poll that changes agent data.

**Evidence:** Expanded a long assignment, focused the glyph pause button, changed a fixture agent's status, and waited for the five-second refresh. Focus moved to `BODY`, and the assignment disclosure closed. `desktop/dashboard.js:354` replaces the panel; focus restoration at lines 365–366 only handles elements with IDs or memory-record identifiers. The glyph control at `desktop/glyph-motion.js:28` has neither. Open row disclosures are not restored.

**Impact:** Keyboard users lose their place during live work. Anyone reading a long assignment can have the text collapsed underneath them.

**Recommendation:** Update changed rows/values without replacing the whole panel, or preserve stable control keys and disclosure state keyed by agent ID and field. Restore focus only when the same logical control still exists.

**Confidence:** Verified with changing-data fixtures.

### F3 — P2: Headers and repeated counters push actual work below the fold

**Location:** Agents and Tasks, particularly the minimum window size.

**Evidence:** At native 744 x 575, the Agents viewport contains the header and four metric cards; no roster row is visible. At 1484 x 895, Tasks repeats the same status counts in metric cards and a second connected strip before its queue. Only the first queue row is visible near the bottom. See `native-agents-760x640.png` and `review-native-tasks.png`; relevant rules are `desktop/glyph-motion.css:11`, `desktop/console.css:59`, and `desktop/console.css:111`.

**Impact:** Frequent work requires scrolling past introductory content. The connected Queued → Running → Completed → Failed strip can also suggest that failure follows completion, although it displays aggregate buckets rather than a selected workflow's path.

**Recommendation:** Use a compact header at short heights, reduce metrics to a compact summary, and replace the duplicate strip with either status filters or a real selected-workflow sequence that branches on failure. Preserve the glyph as a smaller section marker.

**Confidence:** Verified layouts; interpretation of the sequential connector is a design inference.

### F4 — P2: Desktop chat displays common Markdown syntax as raw text

**Location:** Existing assistant responses in desktop chat.

**Evidence:** The native conversation screenshot displays literal `**1. Define the research question**` and `**2. Agent roles...**`. `desktop/chat.js:27` formats fenced and inline code but leaves headings, emphasis, and lists as plain escaped text.

**Impact:** Long technical answers lack the hierarchy developers expect. The chat feels less finished than the dashboard.

**Recommendation:** Render a defined, safely escaped Markdown subset with headings, lists, emphasis, links, and code blocks; preserve readable streaming and raw-text copying. Treat unsupported syntax consistently.

**Confidence:** Verified in the native app and source.

### F5 — P2: Important labels are too small for comfortable scanning

**Location:** Table column headings, metric labels, chart labels, and refresh metadata.

**Evidence:** Native screenshots show a pronounced size gap between large hero copy and tiny operational labels. Table headings use 9 px; metric labels use 10 px and reduce to 9 px at a breakpoint (`desktop/console.css:63`, `:82`, `:227`). Glyph captions use 8–9 px (`desktop/glyph-motion.css:22`), but those captions are decorative and are a lower priority.

**Impact:** Dense information becomes harder to scan at normal desktop viewing distance, especially in smaller windows.

**Recommendation:** Start operational labels at 11–12 px, retain suitable contrast, and reduce letter spacing before shrinking text. Keep tiny technical lettering confined to nonessential decoration. Check the resulting layouts at normal and enlarged text sizes.

**Confidence:** Verified sizes and visual inspection. This is not a claim of a measured WCAG contrast failure.

## 3. What's missing

### F6 — P2: Memory graph inspection does not connect directly to the record explorer

**Location:** Memory provenance map.

**Evidence:** The canvas provides a pointer tooltip, truncated to 150 characters, and instructs users to select a record below. Source inspection shows pointer handlers at `desktop/dashboard.js:237` but no node activation that selects the corresponding explorer record. Canvas and tooltip are hidden from assistive technology; the record list supplies the accessible text alternative (`desktop/dashboard.js:110`).

**Impact:** A user who notices an interesting point must locate its record again. Keyboard users can inspect the list, but cannot inspect the same source relationships through it.

**Recommendation:** Allow pointer activation to select the corresponding record, and expose source-group membership and related-record navigation in the keyboard-accessible explorer. Keep graph semantics accurate; do not imply semantic similarity.

**Confidence:** Source-verified interaction gap, supported by the visible instruction. No screen reader session was performed.

The unused glyph studies are not missing product pages. The application should not acquire fictitious Integrations, Analytics, or agent-management capabilities solely to display the remaining artwork.

## 4. What's at risk

- **Regression coverage lags behind the UI.** The checked-in workflow test needs its opening step updated. Current interaction checks protect same-page drafts but missed navigation loss and focus loss on changing data. Add those cases before the next implementation pass.
- **Rendering strategy makes future controls fragile.** Full-panel replacement requires every form, disclosure, scroll container, and focused control to be manually restored. F1 and F2 demonstrate the consequence. Prefer stable DOM ownership for interactive regions.
- **Style overrides are accumulating.** `desktop/index.html:9` loads dashboard, landing, runtime, console, chat, and glyph styles. This is not inherently broken, but repeated ownership of shared controls makes consistency harder. Chat still uses slightly tinted grays, while the dashboard uses neutral blacks; Settings also mixes heading weights. Consolidate shared tokens after behavior is stable.
- **A polished animation can be mistaken for live activity.** Glyphs animate even when zero agents run. The controls correctly call them decorative, and actual status is separately labeled. Preserve that separation; do not make ambient animation the primary health signal.
- **Performance evidence is limited.** The short rendering sample supports the intended approximate 30 fps cadence. It does not prove smoothness on low-end hardware or absence of leaks after extended navigation. Source includes visibility gating and observer cleanup; prolonged behavior remains unmeasured.

## Page-by-page critique

| Page | Assessment |
| --- | --- |
| Overview | Strongest composition: the exclusive planetary image gives this page a distinct role. Actual runtime counts and fleet links make it useful. Completed workers dominate the captured fleet; a compact active-work/attention summary would improve prioritization. |
| Agents | Constellation artwork and matching icons establish identity. Search, status, and role controls are clear. Large headers, small labels, and refresh-reset disclosures impede operational use. Historical run records and the coordinator remain explicitly identified. |
| Tasks | Primary creation action is clear and real task details are present. Draft loss is the release blocker. Duplicate counters and the aggregate pipeline consume space and weaken the queue's priority. |
| Memory | Strata fits the subject. The real-data map shows 107 loaded nodes against 204 total records in this capture, with 92 drawn source links. Labels correctly explain the sample and provenance. Direct map-to-record navigation is missing. |
| Tools | Aperture artwork works with the capability theme. Search and categories are available; registration is correctly distinguished from permission. Three metric cards occupy a four-column grid, leaving an unnecessary empty quarter. Use a three-column variant. |
| Evaluations | Calibrate is distinct. The one-point chart honestly represents the selected comparable series rather than inventing a trend. Its large empty plot and truncated combined selector reduce usefulness: show the measurement prominently and make suite/arm/curriculum context easier to read. |
| Settings | Alignment gives the page an identity without competing with forms. Saved-versus-running distinctions are clear. Provider controls are split across two panels, headings vary in weight, and dirty-state handling needs review alongside F1. No credential mutation was tested. |
| Desktop chat | Entry, return, context controls, and long-title layout work. Local history and remote-provider distinctions are explicit. Raw Markdown, faint tinted surfaces, and the heavy composer focus treatment make it feel less consistent with the dashboard. |

## Motion and memory graph review

### Glyphs and transitions

The approved glyph language is now recognizably integrated: shared line weights, matching small icons, distinct section geometry, and controlled grayscale. It creates the requested mysterious technical atmosphere without masking page titles or status text. The high-level identity is stronger than the earlier repeated planet headers.

Ambient rotation and particles are decorative. The morphs and entry passage help connect surfaces, although the repeated large hero layout consumes more attention than daily operations need. Keep the character; reduce its footprint at short window heights.

Pause and reduced-motion behavior passed direct checks. The entry passage was present after entry and absent after Escape. The renderer uses an approximately 640 ms section morph and 760 ms immersive passage, with a 900 ms cleanup timeout. Source sets the overlay to ignore pointer input. Rapid-navigation stress and prolonged CPU/GPU profiling were not independently measured in this rerun.

### Memory graph

Native nodes appeared circular. The drawing code uses equal-radius arcs in CSS-space coordinates, with device-pixel scaling applied equally to both axes (`desktop/dashboard.js:155`, `:198`). Narrow layouts pass overflow checks, but this rerun did not exercise a populated native graph at every window size; circularity at every size is therefore supported by source rather than a complete visual matrix.

The map is a shared-provenance visualization, not a semantic knowledge graph. That limitation is stated clearly. Its dominant central cluster and many crossing links convey collection density more effectively than specific relationships. Hover emphasizes a point and its links in source, but the missing record-selection bridge limits exploration. A source-group filter and linked accessible record detail would add more value than extra particles.

The record explorer supplies an important text alternative and exposes all loaded fixture records through pagination. It does not provide unlimited access to the complete historical store; the UI correctly labels its loaded sample.

## Recommended improvement order

### Fix before relying on the app for daily work

| Order | Change | User benefit | Acceptance check |
| --- | --- | --- | --- |
| 1 | Preserve workflow drafts across navigation; audit Settings dirty state | Prevents lost work while checking other sections | Enter goal/subtasks/mode, visit Agents and chat, return: values remain. Clear only on success or explicit discard. |
| 2 | Preserve focus and disclosure state on changing-data refreshes | Keeps keyboard interaction and reading stable | Focus the glyph control and expand a task description; change agent status and poll: both remain intact. |

### Improve next for clarity and efficiency

| Order | Change | User benefit | Acceptance check |
| --- | --- | --- | --- |
| 3 | Compact short-window heroes and remove duplicate task counts | Exposes actionable work sooner | At 744 x 575, show a roster/queue row and its controls without scrolling past decorative content. |
| 4 | Add consistent safe Markdown rendering to desktop chat | Makes technical responses easier to read | A response containing headings, emphasis, lists, links, and code has clear hierarchy, streams correctly, and copies accurately. |
| 5 | Increase operational label sizes and retune spacing | Improves scanning and legibility | Table/metric labels remain readable at normal scale; enlarged text does not hide primary controls. |

### Polish after the core experience is sound

Connect graph nodes to records and provide equivalent relationship details in the explorer. Improve the single-measurement evaluation state, use a three-card Tools grid, unify neutral tokens across chat and dashboard, and update the checked-in review harness. Keep testing changes in real, empty, error, and long-content states.

## 5. Verdict

**Needs rework before daily-use sign-off: the glyph implementation succeeds visually, but navigation can lose a workflow draft and live updates can interrupt interaction.**

**Overall: 7.3 / 10.** This is an experience score, not a screenshot-only score. The score is the equal-weight average of the ten dimensions below; the draft-loss finding independently blocks sign-off.

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Visual hierarchy | 8.0 | Cohesive black/white system and distinct glyphs; oversized introductions compete with working content. |
| Information density | 7.0 | Useful tables and honest counts; duplicate task summaries and uneven empty-space allocation. |
| Navigation and wayfinding | 8.5 | Intro/dashboard/chat routes and active destinations work consistently. |
| Agent and task usability | 7.0 | Search, filters, and details are useful; draft loss and disclosure resets undermine confidence. |
| Memory experience | 7.5 | Accurate provenance/sample labeling and reachable records; weak map-to-record interaction. |
| Desktop chat | 7.0 | Solid layout and navigation; incomplete response formatting and visual inconsistency. |
| Interaction quality | 6.0 | Recovery and same-page preservation work, but navigation and changing-data refresh expose state-loss bugs. |
| Motion design | 8.5 | Distinct artwork with functioning pause, reduced motion, fallback, and dismissible transitions. |
| Accessibility | 6.5 | Labels and text alternatives exist; focus loss and tiny operational text remain concerns. |
| Responsive behavior | 7.0 | No document horizontal overflow at tested sizes; useful content falls below the smallest viewport. |

**Confidence:** High in the priority order; medium in comprehensive accessibility and performance coverage.

**Single most important next fix:** Preserve the user's unfinished workflow when moving between sections.

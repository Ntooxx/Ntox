# NTOX UI/UX Implementation Review

**Date:** 2026-10-24  
**Scope:** Desktop intro, Agents, Overview, Tasks, Memory, Tools, Evaluations, Settings, and chat  
**Method:** Native Electron screenshots and read-only API checks; automated Edge interaction checks with controlled fixtures; focused unit tests; source review  
**Confidence:** High for the checked navigation, layout, authentication, and refresh behavior. Medium for broader accessibility and long-session performance.

## Verdict

**Pass for this UI refinement.** The reported connection, navigation, layout, refresh, memory access, and motion defects have been repaired and checked. The dashboard now carries the intro's visual identity through a restrained observatory surface backed by actual agent data.

This is a substantial improvement, not evidence of a universal 10/10. A manual assistive-technology walkthrough and longer real-work sessions are still needed before making that claim.

## What works

| Area | Implemented change | Observed evidence |
|---|---|---|
| Runtime authentication | Readiness checks a protected API endpoint, tries available credentials, persists the desktop-owned token, and reports mismatches without disabling authentication. API secrets are included in log redaction. | Native Electron authenticated and returned **7 real agents**, with no connection banner or renderer errors. An older desktop instance with a stale token required a clean restart. |
| Standard startup | Chromium's disposable disk cache uses a fresh directory; GPU shader disk caching is disabled. Existing profile, history, and credential locations are retained. Unreadable encrypted credentials are protected against overwrite. | The standard launcher initially reported cache access failures and crashed. After the repair, the normal profile passed the native navigation, size, and authenticated-agent checks; reopening produced no cache errors. |
| Connected destinations | Intro opens Agents or chat; both working surfaces return home; chat returns to the remembered dashboard destination. Destination headings/composer receive focus. | Automated clicks exercised the routes and focus targets. Native minimum-window navigation also worked. |
| Visual continuity | A dark observatory panel uses a decorative eclipse, real active-run count, agent identities, states, and workflow assignments. Long assignments have previews and expandable full text. | Inspected populated fixtures and real native agent data. The long-assignment repair was prompted by the real data, not the fixture. |
| Stable refresh | Runtime readings update in place; page signatures use relevant data; bootstrap retains memory totals; drafts and table scroll positions survive rebuilds. | Overview kept the same DOM node and focused control through polling. An unsaved workflow goal and subtask survived a data change. |
| Chat context | Context listens to dashboard refresh events and reflects current availability, agents, and memory counts. | Source review plus fixture connection/recovery checks. No separate one-time ready claim remains. |
| Chat layout | Conversation title truncates independently of Context/Clear. Sidebar remains usable at minimum width. Privacy copy is readable above the window bottom. | Checked 1500x960, 1280x800, and 760x640 browser viewports; controls measured at least 36 px tall with no overlap. Native chat was inspected at an actual 744x575 content area. |
| Memory browser | Load-more exposes all 100 loaded records; displayed counts follow expansion; keyboard focus moves to the newly exposed records. Rows retain their full content height. | Automated selection of record 99 after expanding 30 to 60 to 90 to 100 records. Inspected wide and narrow screenshots. |
| Memory actions and graph states | Edit/Delete share a proper action group. An empty graph describes absent graph nodes without falsely claiming the memory store is empty. | Minimum-width screenshot shows aligned actions, full record labels, and a clear graph empty state. |
| Error recovery | Connection failures are grouped and stripped of IPC boilerplate. Last received data stays visible with an explicit stale-state label. | Fixture outage showed one coherent warning, stopped status motion, and recovered with Retry now. |
| Motion | Status animation requires a connected runtime and no reduced-motion preference. Landscape pauses offscreen and responds to live preference changes. | CSS state assertions and landscape loop tests, including hidden canvas, context restoration, and changing reduced-motion preferences. |
| Typography and encoding | Increased operational text sizes, stronger muted text, system fonts, readable tables, consistent focus styles, and a recognizable navigation icon. | Screenshots reviewed; entry-point scans found no mojibake markers. |
| Configuration honesty | Copy distinguishes saved provider/model from the running configuration, and desktop history from local or remote inference. | Settings and chat screenshots plus source inspection. |

## What is missing

- A manual NVDA or other screen-reader walkthrough. Keyboard focus and semantic attributes were checked, but this is not a full accessibility certification.
- Extended streaming conversations, paid provider calls, workflow execution/cancellation, and credential changes were not exercised in the real account during this UI review.
- GPU timing, memory usage over hours, and lower-powered hardware comparisons were not measured.
- Memory search remains explicitly limited to the 100 records loaded by the existing endpoint request. Every loaded record is reachable; this is not a full-store search implementation.

These are verification or existing product-scope limits, not claims that those capabilities are broken.

## What is broken

No unresolved failure was observed in the final scoped checks.

Defects found and corrected during this pass included:

1. A public health response incorrectly allowing an authenticated runtime to be treated as ready.
2. Loss of the memory total during bootstrap replacement causing repeated Overview rebuilds.
3. Unconditional status animation overriding reduced-motion preferences.
4. Repeated copies of one connection error filling the warning banner.
5. Long real assignments stretching the activity panel.
6. Compressed memory rows and Edit/Delete buttons spilling into inappropriate grid columns.
7. An explorer count still saying 30 after loading more records.
8. A Chromium cache failure in the standard desktop profile that was absent from the initial isolated review.

## What is at risk

- The renderer still uses string templates and page replacement for substantive data changes. Relevant-data signatures, incremental runtime readings, and draft restoration reduce disruption; this is not a complete component architecture migration.
- Runtime and chat CSS are now readable and repeated exact rules were consolidated. The older dashboard base stylesheet still contains historical selectors and overlapping responsive rules. Keep screenshot checks when changing those foundations.
- An independently started API with an unknown environment-only token cannot be silently adopted. The app gives an actionable authentication error. The previous running instance was restarted; subsequent native launches connected successfully.
- The observatory previews three agents and labels that limit. The complete fleet remains in the roster table below.

## Scorecard

Scores reflect observed interface quality, not a user-research study.

| Dimension | Score / 10 | Evidence |
|---|---:|---|
| Professional finish | 8.5 | Coherent controls, typography, failure states, and verified native layouts. |
| Creative distinction | 8.5 | Planetary intro and a related agent observatory provide a recognizable identity. |
| Mysterious atmosphere | 9 | Landscape, eclipse forms, restrained depth, and clear operational labels coexist. |
| Developer audience fit | 9 | Actual agents, assignments, provenance, runtime state, and explicit configuration semantics. |
| Hierarchy and readability | 8.5 | Clear primary actions and readable operational detail; dense tables still require deliberate scanning. |
| Navigation and connectedness | 9 | Tested intro, dashboard, chat, home, remembered destinations, and contextual links. |
| Interaction quality | 8.5 | Stable polling, preserved drafts, accessible load-more, and working recovery. |
| Data and state honesty | 9 | Authenticated readiness, stale-state copy, real counts, and accurate provider language. |
| Accessibility and adaptability | 8 | Minimum-window and keyboard checks pass; manual screen-reader testing remains. |
| Motion and visual restraint | 8.5 | Reduced-motion and hidden-canvas behavior checked; extended performance remains unmeasured. |

## Evidence and reproduction

### Automated checks

- `npm.cmd test -- desktop/runtime-auth.test.mjs desktop/landscape.test.mjs src/api/server.test.ts` - **24 tests passed** across 3 files.
- `node scripts/review-desktop-ui.cjs` - controlled fixture navigation, polling, drafts, memory expansion, search, responsive layouts, outage/recovery, and motion checks passed with **zero page errors**.
- JavaScript syntax checks passed for dashboard, chat, landscape, and Electron main.
- `git diff --check -- desktop` passed.

### Native Electron

The authenticated API returned seven agents. No renderer errors or document-level horizontal overflow were reported at these outer window sizes:

| Window | Actual content area |
|---|---|
| 1500x960 | 1484x895 |
| 1280x800 | 1264x735 |
| 760x640 | 744x575 |

### Artifacts

- [Native Agents](../.ntox-desktop-smoke/native-agents.png)
- [Native minimum-window chat](../.ntox-desktop-smoke/native-chat-minimum.png)
- [Intro](../.ntox-desktop-smoke/final-intro.png)
- [Populated Agents fixture](../.ntox-desktop-smoke/final-agents.png)
- [Overview fixture](../.ntox-desktop-smoke/final-overview.png)
- [Narrow Memory browser](../.ntox-desktop-smoke/final-memory-760x640.png)
- [Disconnected fixture](../.ntox-desktop-smoke/final-offline.png)
- [Browser check results](../.ntox-desktop-smoke/ui-review-results.json)
- [Native check results](../.ntox-desktop-smoke/native-review-results.json)

**Highest-priority follow-up:** perform a manual screen-reader walkthrough before broader release. No remaining implementation blocker was found in the reviewed flows.

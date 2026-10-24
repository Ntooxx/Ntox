# NTOX Desktop: Motion Design and Animation Brief

## Creative direction

Create a striking, premium motion language for NTOX Desktop: an intelligent system coming into focus, information moving through a living runtime, and separate agents contributing to a shared body of work. It should feel cinematic, precise, and memorable—never like a generic admin dashboard with a few pulsing dots.

The visual identity remains monochrome: black, graphite, silver, and white. Use light, depth, fine lines, restrained glow, and spatial movement to create richness. Motion should reveal relationships, state changes, and hierarchy. It must not invent activity or imply that an inactive system is working.

Design the motion for every dashboard page and the dedicated desktop chat. The web chat is a separate product and must not be pulled into this animation system by changing its layout or conversation surface.

## Core motion principles

1. **Every animation has a job.** It communicates arrival, progress, relationship, focus, completion, failure, or an available action.
2. **Data drives motion.** A status pulse, progress sweep, graph signal, or count change must reflect real runtime state. No fake agent activity or decorative counters.
3. **Create a visual signature.** Use a coherent motif drawn from cognition and runtime systems: orbit paths, connection filaments, signal traces, layered light, and deliberate focus shifts.
4. **Make the quiet moments beautiful.** The default state should feel composed and atmospheric without constant movement across every panel.
5. **Keep hierarchy stable.** Animations must not shift layout, resize text, reorder information, or obscure controls.
6. **Make motion optional.** Fully respect reduced-motion preferences and provide a useful, visually complete static state.

## Signature system motif

Build a small family of motion primitives rather than unrelated effects:

- **Signal:** a restrained light pulse that travels along a real workflow or memory edge.
- **Orbit:** a slow, low-contrast arc used sparingly to frame NTOX identity or runtime health.
- **Focus:** a quick luminance and depth change that guides attention to a selected agent, task, metric, or memory record.
- **Trace:** a line or bar that draws only when actual progress or a real value update occurs.
- **Arrival:** content moves into place with opacity and a few pixels of translation; preserve its final layout from the first frame.
- **Resolution:** successful completion settles into a stable state; failures stop motion and use clear, calm feedback.

Do not run all motifs at once. Use one primary motion event per screen, with small supporting feedback around it.

## Motion tokens

Use shared tokens so pages feel like one product:

- **Micro interaction:** 120–200 ms.
- **Control/panel transition:** 180–320 ms.
- **Page or workspace transition:** 300–520 ms.
- **Large data reveal:** 500–900 ms, used on first entry or explicit user action only.
- **Easing:** a consistent ease-out for entrances, a responsive spring-like cubic-bezier for controls, and linear timing only for continuous signal travel.
- **Travel distance:** usually 2–12 px. Larger movement must have a clear spatial meaning.
- **Glow:** soft and low contrast, reserved for active focus or real live state.

Prefer `transform` and `opacity` for CSS transitions. Avoid repeated blur, animated large box-shadows, layout-triggering properties, rapid flashes, and large-area repaint effects. Keep canvas and SVG animation bounded; pause it when the page is hidden or the graph is offscreen.

## Page-by-page choreography

### App launch and shared shell

- Stage the NTOX wordmark, runtime indicator, navigation rail, and page content in a short, composed entrance. Do not delay access to controls for a logo animation.
- Use a single active navigation marker that glides between items when the page changes. Keep it fast and subordinate to the content transition.
- Let the page hero’s planetary/orbit treatment move very slowly or remain still. It should add depth, not compete with headings.
- Animate the runtime status only when its real state changes. A connected state can breathe gently; a disconnected state should settle and stop.
- Give hover and keyboard focus the same visual quality. Keyboard focus must be at least as visible as pointer hover.

### Overview

- Reveal runtime health first, then the metric group, then fleet and recent-work panels with a short stagger.
- Count values should animate only on first reveal or when the real value changes. Avoid restarting the count animation on every poll.
- When a real task or agent starts, guide attention with a brief highlight on the affected item. Never pulse the whole dashboard to indicate one agent.
- Recent activity can enter as a short timeline trace when a new event arrives; do not replay the full history on refresh.
- Give empty overview panels a calm invitation state, not a perpetual loader.

### Agents

- Stagger the initial roster by a few milliseconds per row, then keep the list still.
- A transition from queued to running should use a precise state change: small status light activation, role of the agent becoming visible, and a brief row highlight.
- On selection, move a subtle focus rail or luminance bloom to the chosen agent. Keep the row’s dimensions fixed.
- Do not animate every running agent continuously. A small pulse on the true active state is enough.

### Tasks and workflows

- Show workflow order with a signal moving along actual dependency edges as a step starts or completes.
- Represent queued, running, completed, failed, cancelled, and timed-out states with distinct settled visuals. Failure should not use celebratory motion.
- Animate progress only from authoritative progress updates. If the runtime provides no percentage, use a clearly labeled indeterminate state rather than simulated progress.
- On task selection, transition the detail panel smoothly while preserving its position and tabs. Do not make the task list jump.
- On cancel or retry, disable the action immediately, show a compact pending state, and settle to the result with a clear announcement.

### Memory

- Treat the graph as the signature motion surface: clustered points should have depth and subtle organic drift, while connection signals travel only over actual API-provided edges.
- Use a slow, occasional light wave across the graph on first entry. Do not restart it during background refresh.
- Let node hover/keyboard selection create a focused halo and brighten only connected real edges. Reveal a stable record detail tooltip or side panel.
- Use different luminance weights for memory types, but keep all markers round and visible at supported aspect ratios.
- If edge semantics are only shared source/provenance, keep motion and labels faithful to that relationship. Do not make links suggest inference or conceptual similarity.
- Pause or simplify the graph when hidden, when reduced motion is enabled, or when performance drops. In reduced motion, render a clear static graph.
- Keep the rest of the Memory page calm so the graph remains the one visual centerpiece.

### Tools

- Bring tool cards into view with a quick, restrained reveal. Avoid cards flying in from different directions.
- On hover/focus, illuminate the tool’s own border and icon. If a tool is policy-gated, use a deliberate lock/state reveal tied to the actual policy.
- Changes to registered/enabled state should be brief and clearly labeled; do not animate tools as if they are executing when they are only listed.

### Evaluations

- Draw score bars and chart traces on first view or explicit filter changes, not on every refresh.
- Use a crisp trace progression for a real evaluation run. A pass settles with a restrained check-mark reveal; a failure stops and exposes the reason.
- Avoid animated chart noise or loops that imply a benchmark is currently running when only historical results are shown.
- Make chart legends and tooltips respond consistently to hover and keyboard focus.

### Settings

- Keep settings mostly still. Use a subtle focus transition on the active field and a compact saved-state confirmation near the Save action.
- For changes requiring restart, distinguish “saved” from “active” with a persistent state marker. Do not make a temporary green/white flash the only confirmation.
- Use gentle validation feedback that preserves input and does not shake the entire form.

### Dedicated desktop chat

- Enter chat with a short, cohesive workspace transition. Make clear that this is the desktop’s own conversation surface.
- Let a new user message enter from a few pixels below. The assistant response should feel like a live stream: reveal new text without reanimating existing messages.
- Keep the typing/generation indicator restrained. Stop and error states should settle visibly and remain readable.
- New conversation, conversation selection, search results, clear, stop, and context panel open/close should each have immediate feedback.
- If users scroll up, preserve their reading position during streaming. When new output is below the viewport, show a small “new response” or “jump to latest” affordance instead of pulling the view down.
- Let the context panel slide/fade within the grid without obscuring the transcript or shifting the composer unexpectedly.

## Interaction motion coverage

For every interactive control, specify the states it needs: idle, hover, keyboard focus, pressed, pending, success, disabled, and error where applicable. Do not implement a generic animation on a control if the state does not exist in the application. Keep motion consistent for equivalent actions across pages.

## Accessibility and performance requirements

- `prefers-reduced-motion: reduce` removes nonessential movement, parallax, orbiting, stagger delays, and continuous graph drift. Keep essential state changes visible with static shape, label, and contrast changes.
- Do not flash or rapidly alternate luminance. No animation should make text harder to read or controls harder to target.
- Use semantic status text and accessible announcements for important state transitions. Do not rely on a visual pulse alone.
- Animate only visible content. Pause continuous animation when the document is hidden and when the relevant panel is offscreen.
- Respect the Electron renderer’s hardware and CPU limits. Avoid expensive full-panel blur, repeated canvas allocations, uncontrolled particle counts, and unnecessary 60 fps work. Use device-pixel-ratio caps and a lower-motion fallback.
- Measure the result on the smallest supported window and on a machine with software rendering. Motion must not make scrolling, typing, or live streaming feel slower.

## Definition of done

- Every page and desktop chat has a distinct but coherent motion treatment tied to its actual purpose.
- Motion calls attention to real state changes and does not invent agent, task, evaluation, or memory activity.
- Existing content never replays or jumps during routine refresh.
- Hover, keyboard focus, pending, success, and error states are all considered.
- Reduced-motion mode is complete and visually intentional.
- Motion remains smooth at the smallest supported window on the lowest available rendering path.
- A live review records page-by-page screen captures or observations, reduced-motion behavior, and any performance issues. Do not claim “stunning” or “9–10/10” without that review.

## Implementation instructions for the next agent

Read `AGENTS.md`, `DESKTOP_APP_ARCHITECTURE.md`, and `docs/UI_UX_AUDIT.md` first. Inspect the live app and current renderer before implementing. Keep the user-facing layout and chat boundaries intact. Use the existing CSS, JavaScript, SVG, and canvas stack unless a measured need justifies adding a dependency. Keep the motion system performant, data-driven, accessible, and consistent with NTOX’s monochrome identity.

At completion, list the motion added to each page, explain which runtime state drives it, state how reduced motion behaves, and report live performance checks and limitations.

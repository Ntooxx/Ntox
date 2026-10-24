# Dashboard reference pass

Implemented the black and white dashboard treatment from the four supplied Agents, Tasks, Memory, and Evaluations references. This historical pass preceded the glyph integration documented in `GLYPH_INTEGRATION.md`; planetary artwork is now exclusive to Overview.

## Delivered

- Shared black surfaces, quiet borders, large lightweight headings, consistent spacing, and a generated lunar horizon.
- Agents: compact metrics and a focused roster with identity tiles, search, status and role filters, and expandable assignments/tools.
- Tasks: real state counts, searchable queue, selectable task details, result/error content, and a collapsible workflow composer. Existing workflow execution modes, cancel, and retry remain connected to the API.
- Memory: source-group layout with actual provenance links, degree-based point size, a distribution ring derived from loaded records, and the existing searchable record explorer.
- Evaluations: four record-count metrics, historical score series grouped by suite/arm/curriculum, exact values in the history table, and explicit empty states.
- Intro, dashboard, and chat navigation remain available. The new glyph gallery is not integrated by this pass.

`desktop/console.css` owns the reference presentation layer. `desktop/dashboard.js` owns page content and interactions. The Electron asset allowlist includes the stylesheet and artwork.

## Inspection

- JavaScript syntax check completed with `node --check desktop/dashboard.js`.
- Inspected browser screenshots at 1672 × 941 and 744 × 575 using existing local preview fixtures.
- Opened the native Electron app against the existing runtime and inspected Agents, Tasks, Memory, and Evaluations with actual records.
- Corrected hidden artwork caused by selector specificity, narrow role columns, overly long evaluation table content, and an overly small dominant memory cluster.
- No automated test suite was run during this visual implementation pass. Workflow execution, cancellation, provider requests, and destructive memory actions were not triggered.

Screenshots are in `.ntox-desktop-smoke/reference-*.png` and `.ntox-desktop-smoke/native-reference-*.png`. Fixture screenshots are visual previews, not runtime measurements.

## Data limits

The API does not expose reference-image metrics such as deployment health, agent confidence, task percentage progress, or safety pass rate. Those are not fabricated. The memory graph preserves the runtime's sparse provenance edges. Evaluation history may contain only a single measurement for a comparable series; that renders as one point.

## Artwork

Saved asset: `desktop/assets/lunar-horizon.png`.

Generated using the built-in imagegen tool. Final prompt:

> Use case: stylized-concept. Asset type: production background artwork for a black monochrome developer dashboard hero banner. Create a premium cinematic photorealistic lunar planetary horizon, extremely detailed rocky cratered charcoal surface, fine brilliant white backlit rim with subtle realistic glow. Wide landscape composition 3:2 or wider. The huge curved planetary surface occupies the bottom right, its horizon curves from lower left at 80 percent image height to upper right at 20 percent image height. Left third and upper half fade into absolutely pure black #000000 empty space. Strictly neutral grayscale, zero blue/green/color. Refined understated sci-fi, mysterious, tactile surface, crisp high resolution. No stars, no text, no logos, no interface, no frames, no watermark. Intended to be cropped into a wide 700x240 header, so maintain beautifully detailed sloping horizon on right.

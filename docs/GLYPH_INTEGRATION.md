# Glyph integration

The planetary photograph is now exclusive to Overview. Other dashboard sections use the approved glyph collection.

| Surface | Artwork |
| --- | --- |
| Agents | Constellation |
| Tasks | Sequence |
| Memory | Strata |
| Tools | Aperture |
| Evaluations | Calibrate |
| Settings | Alignment |
| Chat welcome | Exchange |

Navigation and metric icons use the matching 24-unit glyph paths. Agent identity tiles use explicit name/role information for research, content, outreach, and analysis, with Collective for the coordinator and Identity for other workers. Workflow creation uses Genesis; a running task uses Vortex in its detail tile. Tool cards and chat context use matching glyph icons.

## Motion

- Section changes reconstruct the header glyph over approximately 640 ms.
- Intro to Agents/Chat and transitions between chat and the dashboard use a 760 ms particle passage. Navigation and keyboard focus change immediately; the decorative overlay never intercepts input.
- Rapid navigation replaces the previous passage. Escape clears it, and a 900 ms timeout removes any leftover overlay.
- A single scheduler renders visible glyph canvases at approximately 30 fps, with pixel density capped at 2×. Row and navigation icons remain SVGs.
- Hidden tabs and offscreen glyphs stop continuous rendering. Disconnected page elements are removed from the renderer and its observers when views mount.
- The pause button persists the user's preference locally. Reduced-motion preferences disable morphs and passages, leaving still artwork.
- Each canvas has a local SVG fallback. Artwork is decorative; navigation and controls retain text labels. Motion is not an activity indicator.

## Files

- `glyphs/catalog.js` and `glyphs/geometry.js`: authoritative artwork and icon definitions.
- `glyphs/sync-desktop.mjs`: deterministic export to the desktop bundle.
- `desktop/glyphs/`: exported definitions, manifest, and 21 SVG fallbacks.
- `desktop/glyph-motion.js`: renderer, lifecycle management, and navigation passage.
- `desktop/glyph-motion.css`: responsive artwork placement, motion controls, and icon styling.
- `desktop/dashboard.js`, `desktop/chat.js`, `desktop/index.html`: integration points.
- `desktop/main.cjs`: explicit local asset registration, including manifest-listed SVG fallbacks.

## Inspection

JavaScript syntax checks completed for the renderer, dashboard, chat, and Electron main process. Inspected local visual previews of all dashboard sections, the chat welcome screen, the intro passage, and the Agents layout at 744 px width. Opened the native application using the actual local runtime. Screenshot artifacts use `.ntox-desktop-smoke/glyph-*.png` and `native-glyph-*.png`.

No automated test suite or live workflow/provider actions were run for this integration. The standalone glyph studies remain available for future sections that do not yet exist in the application.

# Component Selection

## Triggers
- "pick a part"
- "component selection"
- "choose a microcontroller"
- "which sensor should i use"
- "part recommendation"
- "bom review"
- "select a regulator"

## Purpose
Selects electronic components against a written requirements matrix: electrical fit first, then lifecycle, availability, cost at volume, and second-source options — so the chosen part survives the whole product.

## Core Principle

The best spec sheet loses to the part that is actually in stock, in package, and still recommended two years from now. Selection is a constraints problem — write the constraints before opening the parametric search.

## Workflow

1. Write the requirements matrix: function, electrical limits (voltage, current, power), accuracy/speed, package, temperature range, unit cost target at volume, and interface.
2. Apply the hard filters first: footprint family already on the board, voltage headroom (derate: run parts at <= 80% of max ratings), and logic-level compatibility.
3. Sort the survivors: availability (lifecycle status "active", multiple distributors), then cost at your volume, then extras.
4. Check the neighbors: decoupling requirements, pin compatibility with the current footprint, firmware effort to switch.
5. Second-source every critical part — same footprint alternates listed in the BOM before they are needed.
6. Verify with the datasheet, not the product page: absolute maximums, typical curves at YOUR operating point, and the fine print on current limits.
7. Document the decision: part, runner-up, and the one line describing why — future-you will ask.

## Requirements Matrix

| Parameter | Required | Margin needed | Chosen part | Runner-up |
|-----------|----------|---------------|-------------|-----------|
| (voltage/current/accuracy/package/cost) | | derated value | | |

## Red Flags

- "Typical" specs doing the work of guaranteed specs in your design.
- No-brownout behavior on regulators and MCUs — check what happens at power-up and power-down.
- Single-source parts with no drop-in alternate and long lead times.
- Sensors whose interface (analog output) forces an ADC you had not budgeted for.

## Output Format

Recommendation first: the part number and one-sentence justification, then the requirements matrix with margins shown, the runner-up and when to prefer it, and the datasheet quote that settles any doubt.

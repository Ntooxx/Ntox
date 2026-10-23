# Board Bring-up And Debug

## Triggers
- "board won't boot"
- "bring up new hardware"
- "debug this pcb"
- "no power"
- "mcu not responding"
- "short circuit"
- "hardware debugging"

## Purpose
Brings up new or broken boards with a disciplined order of operations — power first, then clocks, then reset, then firmware — and debugs failures by measurement instead of speculation.

## Core Principle

Hardware fails in layers and so must your process. Touching firmware before the rails are proven turns a 20-minute power problem into a two-day software mystery. Measure, don't guess.

## Bring-up Order

1. Visual: inspect orientation, solder bridges, missing parts, electrolytic polarity — under magnification.
2. Unpowered resistance: meter across the main rails to ground; anything under a few ohms means stop and find the short.
3. Current-limited supply: set the limit just above expected idle, apply power, watch the current draw.
4. Rails: probe every regulator output — voltage within spec, no oscillation on the scope.
5. Clocks: confirm the crystal or oscillator is ticking and at the right frequency.
6. Reset and boot pins: released when expected, strapping pins at their intended levels.
7. Firmware heartbeat: blink the simplest LED with the smallest possible program before loading real firmware.
8. Only then: communication interfaces (UART banner, SWD, I2C probe).

## Debug Measurement Discipline

- Change one thing per power cycle; write down what you changed and what moved.
- Probe at the load, not the regulator output pin — trace drop is real.
- Intermittent fault checklist: thermal (hairdryer/fridge), mechanical (wiggle harness), power margin (lower the rail 10% and see what dies first).
- A scope beats a meter for anything that "works sometimes"; a meter beats a scope for shorts and rails.
- Capture the failure as an image or waveform before rework — evidence disappears under the iron.

## Symptom Routing

| Symptom | First measurement |
|---------|-------------------|
| Dead, no current | Input path continuity, enable pins |
| High current, warm spot | IR or freeze spray to find the short |
| Current ok, no logic | Rails at the chip, clock, reset |
| Runs then dies | Rail droop under load, watchdog, brownout |
| Flaky comms | Signal integrity: rise times, ground, pull-ups |

## Output Format

Give: the ordered next three measurements with expected values, the decision each result triggers (pass -> next layer, fail -> specific suspect list), and the one safety note for this board (current limit, battery handling).

# Embedded Firmware Structure

## Triggers
- "firmware architecture"
- "main loop design"
- "state machine firmware"
- "rtos or bare metal"
- "watchdog reset"
- "debounce button"
- "uart logging"

## Purpose
Structures small-firmware projects: loop vs interrupt decisions, state machines, timing, input conditioning, and defensive habits that keep devices running for months without a power cycle.

## Core Principle

Embedded code fails silently and remotely. Structure everything so that a hung system either recovers itself (watchdog) or tells you why (last-gasp log) — and never blocks waiting for hardware that might not answer.

## Architecture Decisions

| Situation | Choose |
|-----------|--------|
| A few periodic tasks, short work | Cooperative main loop with millis()-based scheduler |
| Hard timing, fast events | ISRs that only capture and flag — defer work to the loop |
| Many concurrent activities, priorities matter | RTOS with queues |
| Single simple reaction to one input | Bare state machine, no framework |

## Structure Rules

1. ISRs: minimal — read/clear the flag, push to a buffer or set a bit, return. No printf, no floats, no malloc inside interrupts.
2. State machines over flag spaghetti: explicit states, one event at a time, default case that logs unknown events.
3. Time without delay(): schedule by millis()/monotonic clock so one slow task never stalls the rest; keep every non-blocking call under a few milliseconds.
4. Input conditioning: debounce in time (two consistent samples across 10-30ms), not by luck; treat contact bounce as guaranteed behavior.
5. Buffers everywhere hardware outpaces the loop: ring buffers for UART and sensor data, sized for the worst burst, with explicit overflow handling that counts drops.
6. Defensive reads: validate ranges before acting, treat impossible values as faults; never divide by a value that could be zero at boot.
7. Watchdog: feed only from the main loop after tasks complete — feeding from the ISR or an idle path defeats it.
8. Logging: compile-time switchable, levels over channels; the last line before a reset must be written to a retained buffer so crashes explain themselves.
9. No dynamic allocation after init: static buffers with sizes you can defend.

## Failure Modes To Design Against

- Brownout mid-write (guard persistent data with a magic + checksum, write to alternating slots).
- Power loss at any instant (assume every store can be the last).
- Sensor hang (timeouts on every blocking call, then a documented recovery: re-init the peripheral).
- Interrupt storm (rate-limit or mask with a counter and a log line).

## Output Format

Deliver: the chosen architecture with its one-line justification, a task/timing table (period, budget, source), the state list for the main flow, the defensive measures applied, and the watchdog/logging plan for post-mortem visibility.

# Sensor Integration

## Triggers
- "wire this sensor"
- "sensor not responding"
- "i2c troubleshooting"
- "calibrate sensor"
- "noisy sensor readings"
- "sensor filter"
- "spi vs i2c"

## Purpose
Integrates sensors end to end: interface selection, wiring and power hygiene, address management, calibration, and filtering — so readings are correct, stable, and traceable to real units.

## Core Principle

A reading is a claim about the physical world. Every sensor integration has four places to lie: the wiring, the configuration, the math (units/scales), and the noise. Verify them in that order.

## Workflow

1. Choose the interface by constraint: I2C for many devices on two wires with short runs; SPI for speed or long chip-select fan-out; analog only when the sensor is analog and the ADC is good enough (resolution and noise budget!).
2. Wire with the datasheet: pull-ups on I2C (typically 2.2k-10k, check bus speed and capacitance), shared ground, decoupling cap at every VCC pin within a few mm.
3. Resolve addresses before blaming software: scan the bus, check strapped address pins, and note that two identical sensors need different addresses or an address-switching mux.
4. Configure explicitly in init code: range, sample rate, mode — never assume power-on defaults match your use.
5. Read the WHO_AM_I / ID register first; it proves wiring and comms in one read.
6. Calibrate: collect offset (known-rest reading) and scale (known reference), store coefficients in persistent memory, re-check after mechanical changes.
7. Filter for purpose: EMA for smooth UI (alpha ~0.1-0.3), median-of-3 for impulse glitches, rate limits for control loops; low-pass aggressively but never faster than the phenomenon you need to catch.
8. Sanity bounds: clamp impossible values to an error state, not to a believable lie.

## Failure Routing

| Symptom | Likely layer |
|---------|--------------|
| 0x00 or 0xFF everywhere | Wiring, power, pull-ups |
| ACK error on one address | Address conflict or strapping |
| plausible but offset | Calibration |
| jittery | Decoupling, filtering, sample rate |
| works cold, fails warm | Solder joint or marginal rail |

## Output Format

Provide: the wiring summary (pins, pull-ups, caps), the init sequence with explicit registers, the calibration procedure with the reference used, the filter choice with its rationale, and the first five-minute test that proves comms (ID register read).

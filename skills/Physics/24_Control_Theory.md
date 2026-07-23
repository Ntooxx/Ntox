# NTOX — Control Theory

## Purpose

The science of making systems behave the way you want. Not just engineering — a universal framework for understanding feedback, stability, and regulation. From thermostats to economies, from neurons to rockets, control theory is everywhere.

## Core Principle

> Without feedback, systems drift.
> Without control, systems oscillate.
> Without stability, systems collapse.
> Control theory is the science of keeping things on track.

## Core Concepts

### Open-Loop Control
No feedback. Execute a predetermined plan.
- Simple
- No error correction
- Sensitive to disturbances
- Good for predictable environments

### Closed-Loop Control
Feedback-based. Adjust behavior based on observed output.
- Complex
- Error correction
- Robust to disturbances
- Good for unpredictable environments

### Feedback
Information about output used to adjust input.
- **Negative feedback**: Stabilizes (thermostat, homeostasis)
- **Positive feedback**: Destabilizes (compound interest, arms races)
- **Delay in feedback**: Creates oscillation

### Stability
A system is stable if it returns to equilibrium after disturbance.
- **BIBO stable**: Bounded input → bounded output
- **Asymptotically stable**: Returns to equilibrium
- **Marginally stable**: Oscillates without growing
- **Unstable**: Grows without bound

### Transfer Function
Mathematical description of input-output relationship.
- Characterizes system behavior
- Enables analysis and design
- Independent of input

### PID Control
Proportional-Integral-Derivative:
- **Proportional**: Corrects based on current error
- **Integral**: Corrects based on accumulated error
- **Derivative**: Corrects based on rate of change
- Most common control strategy

## Control Theory Principles

### 1. Bode's Gain-Phase Relationship
Phase lag is related to gain slope. You cannot independently set gain and phase.

### 2. Nyquist Criterion
Stability can be determined from the open-loop frequency response.

### 3. Root Locus
Poles of the closed-loop system move as gain changes.轨迹 shows stability boundaries.

### 4. State-Space Representation
Complete internal description of a system.
- State variables capture all relevant information
- Enables modern control design
- Handles multi-input, multi-output systems

### 5. Observability and Controllability
- **Controllability**: Can we drive the system to any state?
- **Observability**: Can we determine the state from outputs?
- Both are necessary for effective control

## Control Applications

| Domain | Application |
|--------|-------------|
| **Engineering** | Robots, rockets, process control |
| **Biology** | Homeostasis, neural control, gene regulation |
| **Economics** | Monetary policy, fiscal policy |
| **Ecology** | Population management, resource management |
| **Psychology** | Behavior modification, learning |
| **Software** | Rate limiting, load balancing, feedback loops |

## Common Control Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Overshoot** | Excessive correction | Tune damping |
| **Oscillation** | Persistent oscillation | Reduce gain, add damping |
| **Instability** | Unbounded growth | Ensure stability margins |
| **Integral windup** | Accumulated error during saturation | Anti-windup techniques |
| **Noise sensitivity** | Amplifying measurement noise | Add filtering |
| **Delay instability** | Feedback delay causes instability | Reduce delay, reduce gain |

## Integration With Other Modules

- **Systems Thinking**: Control theory is a formalization of systems thinking
- **Thermodynamics**: Thermodynamic limits constrain control
- **Systems Thinking**: Feedback loops are central to systems thinking
- **Simulation Engine**: Simulation tests control strategies
- **Engineering Reality**: Control theory is fundamental to engineering
- **Failure Analysis**: Control failures cause system failures

## The Control Theory Mantra

> Feedback is information.
> Information is power.
> But feedback must be processed.
> And processing takes time.
> And time creates delay.
> And delay creates oscillation.
> The art of control is managing this tension.

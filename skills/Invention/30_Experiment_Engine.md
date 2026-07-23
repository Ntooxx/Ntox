# NTOX — Experiment Engine

## Purpose

Design experiments that actually test what they claim to test. Not just "run an experiment" — design one that maximizes information, controls for confounds, and produces results that are interpretable.

## Core Principle

> A poorly designed experiment is worse than no experiment.
> Because it produces false confidence.
> And false confidence is more dangerous than acknowledged ignorance.

## Experiment Design Framework

### Phase 1: Objective Definition
- What question does this experiment answer?
- What hypothesis does it test?
- What outcome supports the hypothesis?
- What outcome refutes it?

### Phase 2: Variable Identification
- **Independent variables**: What you manipulate
- **Dependent variables**: What you measure
- **Controlled variables**: What you keep constant
- **Confounding variables**: What might interfere

### Phase 3: Control Design
- **Negative control**: What happens without treatment
- **Positive control**: Does the method work
- **Placebo control**: Controls for expectation
- **Dose-response**: Shows relationship between cause and effect

### Phase 4: Sample Design
- How many subjects?
- How are they assigned to groups?
- How are they randomized?
- How are they blinded?

### Phase 5: Measurement Design
- What instruments are used?
- What is their reliability?
- What is their validity?
- How are they calibrated?

### Phase 6: Analysis Plan
- What statistical tests will be used?
- How will missing data be handled?
- How will outliers be handled?
- What is the primary analysis?

## Experiment Types

| Type | Description |
|------|-------------|
| **Randomized controlled trial** | Gold standard for causal inference |
| **Crossover** | Each subject is their own control |
| **Factorial** | Test multiple factors simultaneously |
| **Bayesian** | Update beliefs as data accumulates |
| **Adaptive** | Modify based on interim results |
| **Natural experiment** | Exploit natural variation |
| **Simulation** | Computational experiment |

## Common Experiment Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **No control** | Missing comparison group | Include appropriate controls |
| **Selection bias** | Non-random assignment | Randomize properly |
| **HARKing** | Hypothesizing after results known | Pre-register |
| **P-hacking** | Trying many analyses | Correct for multiple comparisons |
| **Small sample** | Insufficient power | Calculate power in advance |
| **Confounding** | Hidden variables | Control or randomize |

## Integration With Other Modules

- **Scientific Method**: Experiments are the core of scientific testing
- **Research Engine**: Experiments are tools for research
- **Mathematical Thinking**: Statistics guide experimental design
- **Verification**: Experiments verify or refute hypotheses
- **Failure Analysis**: Failed experiments are learning opportunities
- **Simulation Engine**: Simulations can pilot experiments

## The Experiment Design Mantra

> Design the experiment BEFORE collecting data.
> Specify the analysis BEFORE seeing results.
> Pre-register when possible.
> The goal is truth, not confirmation.
> A well-designed negative result is more valuable than a poorly designed positive one.

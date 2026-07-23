# NTOX — Experimental Design Engine

## Purpose

Design experiments that actually test what they claim to test. Not just "run an experiment" — design one that maximizes information, controls for confounds, and produces results that are interpretable.

## Core Principle

> A poorly designed experiment is worse than no experiment.
> Because it produces false confidence.
> And false confidence is more dangerous than acknowledged ignorance.

## Design Framework

### Phase 1: Objective Definition

Before designing:
1. What question does this experiment answer?
2. What hypothesis does it test?
3. What outcome supports the hypothesis?
4. What outcome refutes it?
5. What would a null result mean?

### Phase 2: Variable Identification

**Independent variables**: What you manipulate
- What factors might affect the outcome?
- Which are you testing?
- Which are you controlling?

**Dependent variables**: What you measure
- What is the primary outcome?
- What are secondary outcomes?
- How will you measure them?

**Controlled variables**: What you keep constant
- What must be held constant?
- What could introduce confounds?
- How will you ensure constancy?

**Confounding variables**: What might interfere
- What else could explain the results?
- How will you control for these?
- What is the worst confound?

### Phase 3: Control Design

Types of controls:

| Control Type | Purpose |
|-------------|---------|
| **Negative control** | Shows what happens without treatment |
| **Positive control** | Shows that the method works |
| **Placebo control** | Controls for expectation effects |
| **Sham control** | Controls for the procedure itself |
| **Dose-response** | Shows that more treatment = more effect |
| **Time-course** | Shows when effects occur |

### Phase 4: Sample Design

**Sample size calculation**:
- What effect size do you expect?
- What power do you need? (typically 0.8+)
- What significance level? (typically 0.05)
- What variability do you expect?

**Randomization**:
- How will you assign subjects to groups?
- Is the randomization truly random?
- Are groups balanced on key variables?

**Blinding**:
- Who knows the treatment assignment?
- Can you blind participants?
- Can you blind assessors?
- Can you blind analysts?

### Phase 5: Measurement Design

- What instruments will you use?
- What is their reliability?
- What is their validity?
- What is their resolution?
- How will you calibrate them?
- How will you ensure consistency?

### Phase 6: Procedure Design

Step-by-step protocol:
1. Pre-experiment preparation
2. Baseline measurements
3. Intervention/treatment
4. Post-intervention measurements
5. Follow-up measurements
6. Data recording
7. Data verification

### Phase 7: Analysis Plan

Before collecting data, specify:
- Primary analysis method
- Secondary analyses
- Handling of missing data
- Handling of outliers
- Multiple comparison correction
- Sensitivity analyses

### Phase 8: Risk Assessment

What could go wrong?
- Equipment failure
- Sample loss
- Unexpected confounds
- Low response rate
- Measurement error
- Statistical insignificance

Mitigation strategies for each risk.

## Experimental Designs

### Randomized Controlled Trial (RCT)
- Gold standard for causal inference
- Random assignment to treatment/control
- Blinding where possible
- Large sample sizes

### Crossover Design
- Each subject serves as their own control
- Reduces between-subject variability
- Requires washout period
- Risk of carryover effects

### Factorial Design
- Tests multiple factors simultaneously
- Can detect interactions
- More efficient than separate experiments
- More complex analysis

### Bayesian Design
- Update beliefs as data accumulates
- Can stop early if evidence is strong
- More efficient sample usage
- Requires prior specification

### Adaptive Design
- Modify experiment based on interim results
- More efficient but more complex
- Requires careful planning
- Risk of bias

## Quality Metrics

| Metric | Target |
|--------|--------|
| **Internal validity** | Results are due to treatment, not confounds |
| **External validity** | Results generalize to other contexts |
| **Statistical power** | High probability of detecting true effects |
| **Effect size** | Meaningful and practically significant |
| **Precision** | Narrow confidence intervals |
| **Reproducibility** | Results can be replicated |

## Integration With Other Modules

- **Scientific Method**: Experiments are the core of scientific testing
- **Research Engine**: Experiments are tools for research
- **Mathematical Thinking**: Statistics guide experimental design
- **Verification**: Experiments verify or refute hypotheses
- **Failure Analysis**: Failed experiments are learning opportunities
- **Simulation Engine**: Simulations can pilot experiments

## The Experimental Design Mantra

> Design the experiment BEFORE collecting data.
> Specify the analysis BEFORE seeing results.
> Pre-register when possible.
> The goal is truth, not confirmation.
> A well-designed negative result is more valuable than a poorly designed positive one.

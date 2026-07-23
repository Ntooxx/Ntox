# NTOX — Reasoning Engine

## Purpose

The core inference engine. Handles deductive, inductive, abductive, and analogical reasoning. Manages the logic that connects observations to conclusions.

## Reasoning Types

### Deductive Reasoning
**From general to specific.** If premises are true, conclusion MUST be true.

```
All humans are mortal.
Socrates is human.
Therefore, Socrates is mortal.
```

Properties:
- Conclusion is certain (given true premises)
- No new information is generated
- Validity is about structure, not truth
- Soundness = valid structure + true premises

### Inductive Reasoning
**From specific to general.** Observations suggest a pattern.

```
The sun rose today.
The sun rose yesterday.
The sun has risen every day I've observed.
Therefore, the sun will rise tomorrow.
```

Properties:
- Conclusion is probable, not certain
- New information is generated
- Stronger with more observations
- Vulnerable to the problem of induction

### Abductive Reasoning
**From observation to best explanation.** The most likely cause.

```
The grass is wet.
It rained last night.
Rain explains wet grass.
Therefore, it probably rained.
```

Properties:
- Conclusion is plausible, not certain
- Often the starting point for hypothesis generation
- Vulnerable to overlooked alternatives
- Essential for diagnosis and investigation

### Analogical Reasoning
**From similarity to inference.** If A and B share properties, they may share others.

```
Electrons orbit nuclei.
Planets orbit stars.
Planets have elliptical orbits.
Therefore, electrons might have elliptical orbits.
```

Properties:
- Useful for generating hypotheses
- Dangerous for proving conclusions
- The strength depends on the relevance of the similarity
- Must be validated independently

## Reasoning Procedures

### Procedure 1: Argument Mapping
For any complex reasoning chain:
1. State the conclusion explicitly
2. List all premises
3. Show how premises connect to conclusion
4. Identify any implicit premises
5. Check logical validity at each step

### Procedure 2: Modus Ponens / Modus Tollens
**Modus Ponens**: If P then Q. P. Therefore Q.
**Modus Tollens**: If P then Q. Not Q. Therefore not P.

Use modus tollens aggressively — it is the basis of falsification.

### Procedure 3: Reductio Ad Absurdum
1. Assume the opposite of what you want to prove
2. Derive consequences
3. Show that consequences are absurd or contradictory
4. Therefore, the assumption is false

### Procedure 4: Case Analysis
1. List all possible cases
2. For each case, derive consequences
3. Eliminate cases that lead to contradictions
4. Remaining cases are candidates for truth

### Procedure 5: Conditional Reasoning
For any conditional claim (If A then B):
- Does A actually imply B?
- Is B the only consequence of A?
- Could B occur without A?
- Is the conditional strict or probabilistic?

## Reasoning Quality Metrics

| Metric | Description |
|--------|-------------|
| **Validity** | Does the conclusion follow from the premises? |
| **Soundness** | Is the argument valid and are premises true? |
| **Strength** | How likely is the conclusion given the premises? |
| **Cogency** | Is the argument strong and are premises true? |
| **Completeness** | Are all relevant factors considered? |
| **Consistency** | Does this contradict other known truths? |

## Common Reasoning Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Non sequitur** | Conclusion doesn't follow from premises | Check logical connection |
| **Equivocation** | Using a term in two senses | Define terms precisely |
| **Amphiboly** | Grammatical ambiguity | Rewrite clearly |
| **False cause** | Assuming causation from correlation | Test causation explicitly |
| **Hasty generalization** | Drawing conclusions from too few cases | Increase sample size |
| **Sweeping generalization** | Applying general rule to specific cases | Consider exceptions |
| **Special pleading** | Making exceptions without justification | Apply rules consistently |
| **Burden shifting** | Demanding proof of disproof | Proponent bears burden |

## Bayesian Reasoning

### The Framework
```
P(H|E) = P(E|H) * P(H) / P(E)
```

Where:
- P(H|E) = Posterior probability of hypothesis given evidence
- P(E|H) = Likelihood of evidence given hypothesis
- P(H) = Prior probability of hypothesis
- P(E) = Marginal probability of evidence

### Bayesian Updates
- Strong evidence dramatically shifts probability
- Weak evidence barely shifts probability
- Prior matters less as evidence accumulates
- Contradictory evidence should reduce confidence significantly

### Calibration
- 90% confidence should be right 90% of the time
- Calibrate by tracking predictions and outcomes
- Most people are overconfident — adjust down
- Use confidence intervals, not point estimates

## Integration With Other Modules

- **Meta Cognition**: Monitors reasoning quality in real-time
- **First Principles**: Provides the foundation premises
- **Scientific Method**: Structures reasoning into testable predictions
- **Critical Thinking**: Identifies reasoning errors and biases
- **Mathematical Thinking**: Provides formal tools for rigorous reasoning
- **Discovery Engine**: Uses abductive reasoning to generate new hypotheses

## The Reasoning Mantra

> Logic is not optional.
> If the reasoning is flawed, the conclusion is unreliable.
> Check every link in the chain.
> One broken link breaks the entire argument.

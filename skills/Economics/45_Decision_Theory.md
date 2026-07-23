# NTOX — Decision Theory

## Purpose

The mathematics of choosing. Not just making decisions — understanding what makes decisions good or bad, rational or irrational, optimal or satisfactory.

## Core Principle

> Every decision is a bet on the future.
> The quality of the decision depends on:
> The information available,
> The analysis performed,
> The values held,
> And the uncertainty acknowledged.
> Good decisions can have bad outcomes.
> Bad decisions can have good outcomes.
> Judge the decision, not the outcome.

## Decision Theory Framework

### Components
- **Decision maker**: The agent choosing
- **Alternatives**: What can be chosen
- **States of the world**: What might happen
- **Outcomes**: What results from each alternative-state pair
- **Preferences**: How outcomes are ranked
- **Beliefs**: Probabilities of states

### Decision Criteria

| Criterion | Description |
|-----------|-------------|
| **Maximax** | Best possible outcome (optimistic) |
| **Maximin** | Best worst-case outcome (pessimistic) |
| **Minimax regret** | Minimize maximum regret |
| **Expected utility** | Maximize weighted average |
| **Laplace** | Equal probability assumption |
| **Hurwicz** | Weight between best and worst |

### Expected Utility Theory
```
EU(a) = Σ u(o(a,s)) × p(s)
```
Where:
- a = action
- s = state
- o(a,s) = outcome
- u = utility function
- p = probability

## Decision Under Uncertainty

### Risk
Known probabilities.
- Expected value
- Expected utility
- Variance
- Risk aversion

### Ambiguity
Unknown probabilities.
- Maximin expected utility
- Minimax regret
- Robust optimization
- Info-gap decision theory

### Deep Uncertainty
Unknown unknowns.
- Scenario planning
- Robust decision making
- Adaptive management
- Real options

## Behavioral Decision Theory

### Bounded Rationality
- Limited cognitive ability
- Satisficing, not optimizing
- Heuristics and biases
- Sequential search

### Prospect Theory
- Losses loom larger than gains
- Reference dependence
- Probability weighting
- Diminishing sensitivity

### Heuristics and Biases
- **Availability**: Easy to recall = more likely
- **Representativeness**: Similar to prototype = more likely
- **Anchoring**: Initial value influences estimate
- **Framing**: Presentation affects choice

## Decision Quality Metrics

| Metric | Description |
|--------|-------------|
| **Rationality** | Consistent with beliefs and preferences |
| **Informedness** | Based on relevant information |
| **Thoughtfulness** | Appropriate analysis performed |
| **Responsiveness** | Sensitive to context |
| **Transparency** | Reasons can be articulated |
| **Adaptability** | Can be updated with new information |

## Common Decision Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Anchoring** | Overweighting initial information | Consider multiple starting points |
| **Framing** | Effects of presentation | Reframe in different ways |
| **Overconfidence** | Too certain of beliefs | Calibrate confidence |
| **Hindsight bias** | "I knew it all along" | Consider what was predictable |
| **Sunk cost** | Continuing because of past investment | Consider only future costs/benefits |
| **Status quo bias** | Preferring current state | Actively consider alternatives |

## Integration With Other Modules

- **Game Theory**: Decision theory in strategic situations
- **Statistics**: Statistics provides probability estimates
- **Meta Cognition**: Meta-cognition improves decision quality
- **Critical Thinking**: Critical thinking evaluates decisions
- **Research Engine**: Research informs decisions
- **Simulation Engine**: Simulation projects decision outcomes

## The Decision Theory Mantra

> Every decision is a bet on the future.
> Some bets are better than others.
> The quality of the bet depends on:
> The information available,
> The analysis performed,
> The values held,
> And the uncertainty acknowledged.
> Make the best bet you can.
> And be prepared to learn from the outcome.

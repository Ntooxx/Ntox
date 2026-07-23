# NTOX — Probability Engine

## Purpose

The mathematics of uncertainty. Not just calculating odds — reasoning under incomplete information, which is the default state of all real-world problems.

## Core Principle

> Uncertainty is not ignorance.
> It is the natural state of knowledge.
> Probability quantifies uncertainty.
> And quantified uncertainty is power.

## Probability Framework

### Axiomatic Foundation
1. P(A) ≥ 0 for all events A
2. P(Ω) = 1 (certain event)
3. P(A ∪ B) = P(A) + P(B) - P(A ∩ B) for disjoint events

### Interpretations

| Interpretation | Basis |
|----------------|-------|
| **Frequentist** | Long-run frequency of events |
| **Bayesian** | Degree of belief |
| **Logical** | Logical relationship between propositions |
| **Subjective** | Personal degree of belief |

## Core Concepts

### Conditional Probability
```
P(A|B) = P(A ∩ B) / P(B)
```
How probability changes with new information.

### Independence
```
P(A ∩ B) = P(A) × P(B)
```
When knowing one event gives no information about the other.

### Bayes' Theorem
```
P(A|B) = P(B|A) × P(A) / P(B)
```
How to update beliefs with evidence.

### Law of Total Probability
```
P(A) = Σ P(A|Bᵢ) × P(Bᵢ)
```
Probability of an event across all possible scenarios.

### Law of Large Numbers
As sample size increases, sample mean approaches expected value.

### Central Limit Theorem
Sum of many independent random variables approaches normal distribution.

## Probability Distributions

### Discrete Distributions

| Distribution | Use Case |
|-------------|----------|
| **Bernoulli** | Binary outcomes |
| **Binomial** | Number of successes in n trials |
| **Poisson** | Number of events in fixed interval |
| **Geometric** | Number of trials until first success |
| **Negative Binomial** | Number of trials until r successes |
| **Hypergeometric** | Sampling without replacement |

### Continuous Distributions

| Distribution | Use Case |
|-------------|----------|
| **Normal** | Natural phenomena, central limit theorem |
| **Uniform** | Equal probability across range |
| **Exponential** | Time between events |
| **Gamma** | Time until nth event |
| **Beta** | Probabilities of probabilities |
| **Chi-squared** | Variance testing |
| **t-distribution** | Small sample means |
| **F-distribution** | Variance ratios |

## Probability Reasoning Patterns

### Pattern 1: Conditional Reasoning
Always ask: What is the conditional probability?
- Base rates matter
- New information changes probabilities
- Conditioning on the right variable is critical

### Pattern 2: Independence Checking
Never assume independence without justification.
- Events may be dependent through shared causes
- Selection can create dependencies
- Time series are rarely independent

### Pattern 3: Base Rate Neglect
Always consider base rates.
- Rare conditions have low positive predictive value even with accurate tests
- Common causes dominate rare causes
- Prior probability matters

### Pattern 4: Conjunction Fallacy
P(A ∧ B) ≤ P(A) for all A, B.
- Specific combinations are never more probable than their components
- Representatives of categories are not more probable than categories

### Pattern 5: Monty Hall Reasoning
Always update on new information, even when it seems irrelevant.
- The host's action provides information
- Changing doors is optimal
- Intuition often fails with conditional probability

## Common Probability Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Gambler's fallacy** | Past events affect independent probabilities | Check independence |
| **Hot hand fallacy** | Streaks are real in random sequences | Statistical analysis |
| **Base rate neglect** | Ignoring prior probability | Use Bayes' theorem |
| **Conjunction fallacy** | P(A ∧ B) > P(A) | Check axioms |
| **Equiprobability bias** | Assuming all outcomes are equally likely | Estimate actual probabilities |
| **Anchoring** | Sticking with initial estimate | Update properly |
| **Availability bias** | Overweighting easily recalled events | Use base rates |

## Integration With Other Modules

- **Mathematical Thinking**: Probability is a branch of mathematics
- **Statistics**: Statistics uses probability to make inferences
- **Information Theory**: Information theory is built on probability
- **Scientific Method**: Probability quantifies uncertainty in experiments
- **Research Engine**: Probability guides research decisions
- **Simulation Engine**: Probability models random processes

## The Probability Mantra

> Uncertainty is not the enemy.
> It is the terrain.
> Probability is the map.
> Use it wisely.
> Update often.
> Never overtrust.
> Never undertrust.
> And always remember: the map is not the territory.

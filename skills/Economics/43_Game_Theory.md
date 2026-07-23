# NTOX — Game Theory

## Purpose

The mathematics of strategic interaction. When your outcome depends on others' choices, and their outcomes depend on yours. Game theory is not just economics — it is the study of any situation where agents interact strategically.

## Core Principle

> Your outcome depends on their choices.
> Their outcome depends on your choices.
> Everyone is strategic.
> Understanding strategic interaction
> is understanding the world.

## Game Theory Framework

### Game Components
- **Players**: Decision makers
- **Actions**: What players can do
- **Payoffs**: Outcomes for each combination of actions
- **Information**: What players know
- **Timing**: When decisions are made

### Types of Games
| Type | Description |
|------|-------------|
| **Simultaneous** | Players choose at the same time |
| **Sequential** | Players choose in order |
| **Cooperative** | Players can form binding agreements |
| **Non-cooperative** | No binding agreements |
| **Zero-sum** | One player's gain is another's loss |
| **Non-zero-sum** | All can gain or lose |

## Key Concepts

### Nash Equilibrium
No player can improve by changing strategy unilaterally.
- Every finite game has at least one
- May not be unique
- May not be optimal
- May be mixed (randomized)

### Dominant Strategy
Best strategy regardless of what others do.
- If exists, rational players choose it
- Not all games have dominant strategies
- Can lead to bad outcomes (prisoner's dilemma)

### Subgame Perfect Equilibrium
Nash equilibrium in every subgame.
- Used in sequential games
- Eliminates non-credible threats
- Found by backward induction

### Bayesian Equilibrium
Players have incomplete information.
- Players have types
- Players update beliefs
- Strategies are functions of types
- Found by Bayesian Nash equilibrium

## Classic Games

| Game | Description | Lesson |
|------|-------------|--------|
| **Prisoner's dilemma** | Both defect, both lose | Cooperation is hard |
| **Stag hunt** | Coordination problem | Trust is essential |
| **Battle of the sexes** | Coordination with conflict | Communication helps |
| **Chicken** | Brinkmanship | Commitment matters |
| **Matching pennies** | Zero-sum, no pure equilibrium | Randomization needed |
| **Centipede game** | Backward induction | Rationality can hurt |

## Game Theory Applications

| Application | Game Type |
|-------------|-----------|
| **Auctions** | Mechanism design |
| **Bargaining** | Cooperative games |
| **Deterrence** | Strategic moves |
| **Voting** | Collective choice |
| **Evolution** | Evolutionary games |
| **Politics** | Strategic interaction |
| **War** | Conflict and deterrence |
| **Business** | Competition and cooperation |

## Common Game Theory Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Ignoring strategic interaction** | Acting as if alone | Consider others' incentives |
| **Assuming rationality** | Others may not be rational | Bounded rationality |
| **Ignoring information** | Others know things you don't | Information asymmetry |
| **Ignoring commitment** | Words may not be binding | Credible commitments |
| **Ignoring repetition** | Single-shot vs repeated games | Consider future interactions |

## Integration With Other Modules

- **Decision Theory**: Game theory extends decision theory to strategic situations
- **Mechanism Design**: Design games with desired outcomes
- **Evolution**: Evolutionary game theory
- **Economics**: Markets are strategic environments
- **Complexity Science**: Multi-agent systems are strategic
- **RL**: Multi-agent RL is game-theoretic

## The Game Theory Mantra

> Your outcome depends on their choices.
> Their outcome depends on your choices.
> Everyone is strategic.
> Think about their incentives.
> Think about their information.
> Think about their beliefs.
> Then choose your strategy.
> Because in a game,
> the best move depends on the other player.

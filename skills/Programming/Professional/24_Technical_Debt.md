# Programming — Technical Debt

## Purpose

The implicit cost of future rework. Technical debt is not bad — it can be a strategic choice. But unmanaged technical debt is death by a thousand cuts.

## Core Principle

> Technical debt is not bad.
> Unmanaged technical debt is bad.
> Sometimes taking on debt is the right choice.
> But you must know you're taking it on.
> And you must have a plan to pay it back.

## What is Technical Debt?

### Martin Fowler's Quadrant

| | Deliberate | Inadvertent |
|---|---|---|
| **Reckless** | "We don't have time for design" | "What's layering?" |
| **Prudent** | "We must ship now, deal with consequences" | "Now we know how we should have done it" |

### Types of Technical Debt

| Type | Description |
|------|-------------|
| **Code debt** | Messy, duplicated, complex code |
| **Architecture debt** | Poor structural decisions |
| **Testing debt** | Insufficient tests |
| **Documentation debt** | Missing or outdated docs |
| **Dependency debt** | Outdated dependencies |
| **Infrastructure debt** | Manual processes |
| **Knowledge debt** | Tribal knowledge |

## Measuring Technical Debt

### Code Metrics
- Cyclomatic complexity
- Code duplication
- Test coverage
- Code smells
- Technical debt ratio

### Architecture Metrics
- Coupling between components
- Afferent/efferent coupling
- Instability
- Abstractness

### Process Metrics
- Deployment frequency
- Lead time for changes
- Mean time to recovery
- Change failure rate

## Managing Technical Debt

### 1. Identify
- Code review
- Static analysis
- Architectural reviews
- Team feedback

### 2. Prioritize
- Business impact
- Developer productivity
- Risk of inaction
- Cost of repayment

### 3. Plan
- Dedicated time for repayment
- Boy scout rule (leave code cleaner)
- Refactoring sprints
- Gradual improvement

### 4. Execute
- Small, incremental changes
- Test thoroughly
- Commit frequently
- Review changes

## Common Technical Debt Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Ignoring debt** | Pretending it doesn't exist | Track and measure |
| **Paying all at once** | Big bang refactoring | Incremental improvement |
| **Not prioritizing** | Fixing everything at once | Focus on highest impact |
| **Creating more debt** | Quick fixes that create more debt | Think before you code |
| **No tracking** | Debt not documented | Track in issue tracker |
| **No culture** | Debt not part of culture | Make debt visible |

## Integration

- **Refactoring**: Refactoring pays down debt
- **Code Review**: Review catches debt
- **Testing**: Testing prevents debt
- **Architecture**: Architecture decisions create debt
- **Estimation**: Debt affects estimation
- **Quality**: Debt affects quality

## Mantra

> Technical debt is not bad.
> Unmanaged technical debt is bad.
> Know when you're taking it on.
> Have a plan to pay it back.
> Make it visible.
> Track it.
> Prioritize it.
> Pay it down incrementally.
> Because debt compounds.
> And the longer you wait,
> the more it costs.

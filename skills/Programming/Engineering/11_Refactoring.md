# Programming — Refactoring

## Purpose

The practice of improving code structure without changing behavior. Refactoring is not cleaning — it is redesigning incrementally. Clean code is not written — it is rewritten.

## Core Principle

> Code is read more often than it is written.
> Refactoring makes code easier to read, understand, and modify.
> The boy scout rule: leave the code cleaner than you found it.

## Refactoring Principles

### 1. Small Steps
- One refactoring at a time
- Test after each step
- Commit frequently
- Don't mix refactoring with features

### 2. Preserve Behavior
- Refactoring doesn't change behavior
- Tests verify behavior is preserved
- If tests fail, something is wrong
- Refactoring is safe with tests

### 3. Continuous
- Refactor continuously, not in big batches
- Small improvements accumulate
- Don't let code rot
- Fix smells as you encounter them

### 4. Understand First
- Understand the code before refactoring
- Understand why it was written this way
- Understand the constraints
- Understand the dependencies

## Code Smells

### Bloaters
| Smell | Description |
|-------|-------------|
| **Long method** | Too many lines |
| **Large class** | Too many responsibilities |
| **Long parameter list** | Too many parameters |
| **Data clumps** | Same data groups repeated |
| **Primitive obsession** | Using primitives instead of objects |

### Object-Orientation Abusers
| Smell | Description |
|-------|-------------|
| **Switch statements** | Type-based switching |
| **Parallel inheritance** | Parallel class hierarchies |
| **Lazy class** | Class not doing enough |
| **Data class** | Class with only data, no behavior |
| **Refused bequest** | Subclass doesn't use parent features |

### Change Preventers
| Smell | Description |
|-------|-------------|
| **Divergent change** | One class modified for different reasons |
| **Shotgun surgery** | One change requires many classes |
| **Feature envy** | Method uses other class's data more |
| **Inappropriate intimacy** | Classes know too much about each other |
| **Comments** | Comments explain bad code |

## Refactoring Techniques

### Composing Methods
- Extract method
- Inline method
- Extract variable
- Inline temp
- Split temporary variable
- Replace temp with query

### Organizing Data
- Encapsulate field
- Replace data value with object
- Change value to reference
- Change reference to value
- Duplicate observed data

### Simplifying Conditional Expressions
- Consolidate conditional expression
- Consolidate duplicate conditional fragments
- Decompose conditional
- Introduce null object
- Remove control flag

### Simplifying Method Calls
- Add parameter
- Remove parameter
- Rename method
- Separate query from modifier
- Parameterize method

### Dealing with Generalization
- Pull up field
- Pull up method
- Pull up constructor body
- Push down field
- Push down method
- Extract subclass
- Extract superclass
- Extract interface
- Replace inheritance with delegation
- Replace delegation with inheritance

## Common Refactoring Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Big bang refactoring** | Refactor everything at once | Small steps |
| **Mixing with features** | Refactor while adding features | Separate commits |
| **No tests** | Can't verify behavior preserved | Write tests first |
| **Not understanding** | Refactoring without understanding | Study the code first |
| **Premature optimization** | Optimizing during refactoring | Separate concerns |
| **Breaking public API** | Changing external contracts | Version carefully |

## Integration

- **Code Review**: Review identifies refactoring opportunities
- **Testing**: Tests enable safe refactoring
- **Architecture**: Refactoring improves architecture
- **Debugging**: Refactoring makes debugging easier
- **Technical Debt**: Refactoring reduces technical debt
- **Clean Code**: Refactoring leads to clean code

## Mantra

> Code is read more often than it is written.
> Refactoring makes code easier to read.
> Small steps.
> Test after each step.
> Leave the code cleaner than you found it.
> Because the boy scout rule
> is the best refactoring rule.

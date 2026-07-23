# Programming — Working with Legacy Code

## Purpose

The art of dealing with code you didn't write, that doesn't have tests, that nobody understands, and that is critical to the business. Legacy code is not bad code — it is code that has survived.

## Core Principle

> Legacy code is code without tests.
> — Michael Feathers
> Legacy code is not bad code.
> It is code that has survived.
> It has survived because it works.
> Respect it.
> Understand it.
> Improve it carefully.

## Working with Legacy Code Framework

### Step 1: Understand Before Changing
- Read the code
- Understand the intent
- Find the tests (if any)
- Understand the dependencies
- Document what you learn

### Step 2: Characterize Existing Behavior
- Write characterization tests
- Capture current behavior
- Don't change behavior yet
- Build safety net

### Step 3: Make Changes Safely
- Small, incremental changes
- Test after each change
- Refactor to make changes easier
- Don't break existing behavior

### Step 4: Improve Incrementally
- Add tests for new code
- Refactor when you touch code
- Leave code cleaner than you found it
- Don't try to fix everything at once

## Legacy Code Patterns

### Sprout Method/Class
- Add new behavior as new method/class
- Don't modify existing code
- Gradually replace old code

### Wrap Method
- Add behavior before/after existing method
- Don't modify existing method
- Gradually replace old code

### Extract and Override
- Extract method
- Override in subclass
- Change behavior in subclass

### Parameterize Method
- Add parameter to method
- Gradually change callers
- Remove old behavior

## Common Legacy Code Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Big bang rewrite** | Rewrite everything | Incremental improvement |
| **Not understanding** | Changing without understanding | Study first |
| **Breaking things** | Changing behavior | Characterization tests |
| **Not testing** | No safety net | Add tests first |
| **Giving up** | Avoiding legacy code | Embrace the challenge |
| **Over-engineering** | Adding unnecessary complexity | Keep it simple |

## Integration

- **Testing**: Tests are essential for legacy code
- **Refactoring**: Refactoring improves legacy code
- **Debugging**: Debugging helps understand legacy code
- **Code Review**: Review helps improve legacy code
- **Technical Debt**: Legacy code is often technical debt
- **Documentation**: Documentation helps understand legacy code

## Mantra

> Legacy code is code without tests.
> Legacy code is not bad code.
> It is code that has survived.
> Respect it.
> Understand it.
> Improve it carefully.
> Add tests first.
> Change small.
> Leave it better than you found it.
> Because legacy code
> is the code that pays the bills.

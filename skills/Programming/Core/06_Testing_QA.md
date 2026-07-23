# Programming — Testing & Quality Assurance

## Purpose

The practice of verifying that software works correctly and continues to work. Testing is not a phase — it is a continuous activity that runs parallel to development.

## Core Principle

> Testing does not prove correctness.
> Testing reveals incorrectness.
> A tested system is not bug-free.
> A tested system has fewer bugs than an untested one.

## Testing Pyramid

```
        /\
       /  \      E2E Tests (few, slow, expensive)
      /    \
     /------\    Integration Tests (moderate)
    /        \
   /----------\  Unit Tests (many, fast, cheap)
```

## Testing Types

### Unit Testing
- Test individual functions/methods
- Fast, isolated, deterministic
- Mock external dependencies
- High coverage target

### Integration Testing
- Test component interactions
- Real dependencies (or close)
- Verify contracts between components
- Moderate coverage

### End-to-End Testing
- Test complete user flows
- Real system (or close)
- Slow, expensive, brittle
- Critical paths only

### Other Testing Types

| Type | Purpose |
|------|---------|
| **Performance** | Speed, throughput, latency |
| **Load** | Behavior under load |
| **Stress** | Behavior beyond limits |
| **Security** | Vulnerability detection |
| **Accessibility** | Usability for disabled users |
| **Compatibility** | Cross-browser/device testing |
| **Regression** | Prevent reintroduction of bugs |
| **Smoke** | Basic functionality check |

## Testing Best Practices

### 1. Test Early and Often
- Test during development, not after
- Continuous integration
- Test-driven development (TDD)
- Behavior-driven development (BDD)

### 2. Test in Isolation
- Mock external dependencies
- Use test doubles (stubs, mocks, fakes)
- Control test environment
- Make tests deterministic

### 3. Test Edge Cases
- Boundary values
- Error conditions
- Null/empty inputs
- Concurrent access

### 4. Write Testable Code
- Small, focused functions
- Dependency injection
- Avoid global state
- Make side effects explicit

### 5. Maintain Tests
- Tests are code too
- Refactor tests when refactoring code
- Delete obsolete tests
- Keep tests fast

## Test-Driven Development

```
1. Write a failing test
2. Write minimum code to pass
3. Refactor
4. Repeat
```

### Benefits
- Forces design thinking
- Provides documentation
- Enables refactoring
- Reduces debugging

## Test Coverage

- Measure lines/branches/functions covered
- Aim for high coverage, not 100%
- Focus on critical paths
- Coverage is a metric, not a goal

## Common Testing Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Testing implementation** | Tests break on refactor | Test behavior, not implementation |
| **Slow tests** | Tests take too long | Optimize, parallelize |
| **Flaky tests** | Tests pass/fail randomly | Fix determinism |
| **No isolation** | Tests depend on each other | Independent tests |
| **Ignoring edge cases** | Only testing happy path | Test boundaries |
| **Testing too much** | Brittle test suite | Focus on critical paths |

## Integration

- **CI/CD**: Tests run automatically
- **Debugging**: Tests help locate bugs
- **Refactoring**: Tests enable safe refactoring
- **Documentation**: Tests document behavior
- **Code Review**: Review includes test review
- **Performance**: Performance tests are essential

## Mantra

> Testing does not prove correctness.
> Testing reveals incorrectness.
> Test early.
> Test often.
> Test in isolation.
> Test edge cases.
> Test the behavior, not the implementation.
> And remember: the absence of bugs is not the presence of quality.

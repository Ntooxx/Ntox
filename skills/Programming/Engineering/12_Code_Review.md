# Programming — Code Review

## Purpose

The practice of examining code written by others. Code review is not just finding bugs — it is knowledge sharing, mentoring, and quality control. The strongest code survives the strongest review.

## Core Principle

> Code review is not about finding fault.
> It is about making the code better.
> The reviewer's job is to ask questions.
> The author's job is to answer them.
> Together, they make the code stronger.

## Code Review Framework

### For Reviewers

#### 1. Understand the Context
- What is the change trying to accomplish?
- What is the problem being solved?
- What are the constraints?
- What are the alternatives?

#### 2. Check the Design
- Is the approach correct?
- Is it the simplest approach?
- Does it fit the architecture?
- Are abstractions appropriate?

#### 3. Check the Implementation
- Is the code correct?
- Is it readable?
- Is it maintainable?
- Does it handle edge cases?

#### 4. Check the Tests
- Are there adequate tests?
- Do tests cover edge cases?
- Are tests readable?
- Are tests maintainable?

#### 5. Check the Documentation
- Is the code documented?
- Are APIs documented?
- Are changes documented?
- Is the commit message clear?

### For Authors

#### 1. Prepare the Change
- Self-review before submitting
- Write clear description
- Break large changes into smaller ones
- Ensure tests pass

#### 2. Respond to Feedback
- Be professional
- Explain your reasoning
- Consider alternatives
- Don't take it personally

#### 3. Learn
- Understand the feedback
- Apply lessons to future code
- Ask questions if unclear
- Thank the reviewer

## Code Review Checklist

### Correctness
- [ ] Does the code do what it's supposed to do?
- [ ] Are edge cases handled?
- [ ] Are error conditions handled?
- [ ] Is the logic correct?

### Design
- [ ] Is the approach appropriate?
- [ ] Are abstractions appropriate?
- [ ] Is the code maintainable?
- [ ] Does it fit the architecture?

### Readability
- [ ] Is the code clear?
- [ ] Are names meaningful?
- [ ] Is the code well-organized?
- [ ] Are comments helpful?

### Testing
- [ ] Are there adequate tests?
- [ ] Do tests cover edge cases?
- [ ] Are tests readable?
- [ ] Do tests verify behavior?

### Security
- [ ] Is input validated?
- [ ] Is output encoded?
- [ ] Are secrets protected?
- [ ] Is access controlled?

### Performance
- [ ] Is the code efficient?
- [ ] Are there unnecessary allocations?
- [ ] Are database queries optimized?
- [ ] Is caching used appropriately?

## Code Review Anti-Patterns

| Anti-Pattern | Description |
|-------------|-------------|
| **Rubber stamping** | Approving without review |
| **Nitpicking** | Focusing on minor issues |
| **Ego** | Taking feedback personally |
| **Gatekeeping** | Blocking for minor issues |
| **Scope creep** | Review expanding beyond change |
| **Delayed review** | Taking too long to review |

## Common Code Review Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Not reviewing** | Approving without reading | Take time to review |
| **Being rude** | Harsh comments | Be constructive |
| **Not explaining** | Just saying "wrong" | Explain why |
| **Mixing concerns** | Reviewing style and substance | Separate issues |
| **Not testing** | Only reading code | Run the code |
| **Ignoring tests** | Not reviewing tests | Review tests thoroughly |

## Integration

- **Architecture**: Review checks architectural decisions
- **Testing**: Review includes test review
- **Security**: Review catches security issues
- **Performance**: Review catches performance issues
- **Refactoring**: Review identifies refactoring opportunities
- **Documentation**: Review checks documentation

## Mantra

> Code review is not about finding fault.
> It is about making the code better.
> Be kind.
> Be constructive.
> Be thorough.
> Be timely.
> And remember: the goal is not to prove you're smart.
> The goal is to make the code better.

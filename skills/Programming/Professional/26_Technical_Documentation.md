# Programming — Technical Documentation

## Purpose

The art of explaining code to humans. Documentation is not just comments — it is the bridge between what code does and why it does it. Good documentation makes code accessible.

## Core Principle

> Code is written once.
> Documentation is read many times.
> If you can't explain it, you don't understand it.
> If you can't find it, you can't use it.
> Documentation is not overhead.
> It is the product.

## Documentation Types

| Type | Purpose |
|------|---------|
| **README** | Project overview, getting started |
| **API docs** | How to use the API |
| **Architecture docs** | System design decisions |
| **Code comments** | Why, not what |
| **Inline docs** | Function/variable documentation |
| **Changelogs** | What changed between versions |
| **Tutorials** | Learning-oriented guides |
| **How-to guides** | Task-oriented guides |
| **Reference** | Information-oriented docs |
| **Architecture Decision Records** | Why decisions were made |

## README Structure

```markdown
# Project Name

## What is this?
Brief description.

## Getting started
Installation and quick start.

## Usage
How to use it.

## API Reference
Detailed API docs.

## Contributing
How to contribute.

## License
License information.
```

## API Documentation

### What to Document
- What the API does
- How to use it
- What parameters it takes
- What it returns
- What errors it can produce
- Examples

### Documentation Tools
- OpenAPI/Swagger for REST
- GraphQL introspection
- JSDoc, Javadoc, etc.
- TypeDoc, Rustdoc, etc.

## Code Comments

### Good Comments
- Why, not what
- Explaining intent
- Clarifying assumptions
- Warning about gotchas
- Documenting decisions

### Bad Comments
- What the code does
- Redundant with code
- Outdated
- Misleading
- Filler

## Documentation Best Practices

1. **Write for your audience**: Beginners vs. experts
2. **Keep it up to date**: Outdated docs are worse than no docs
3. **Make it searchable**: Good structure and indexing
4. **Use examples**: Show, don't just tell
5. **Be concise**: Respect the reader's time
6. **Review documentation**: Just like code

## Common Documentation Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **No documentation** | Nobody knows how it works | Write docs |
| **Outdated docs** | Docs don't match code | Update with changes |
| **Too verbose** | Nobody reads it | Be concise |
| **No examples** | Hard to understand | Add examples |
| **Wrong audience** | Too technical or too simple | Know your audience |
| **No structure** | Hard to find information | Good organization |

## Integration

- **Code Review**: Review includes documentation
- **Onboarding**: Documentation enables onboarding
- **Maintenance**: Documentation enables maintenance
- **API Design**: API documentation is essential
- **Open Source**: Documentation enables contribution
- **Knowledge Management**: Documentation preserves knowledge

## Mantra

> Code is written once.
> Documentation is read many times.
> If you can't explain it, you don't understand it.
> If you can't find it, you can't use it.
> Documentation is not overhead.
> It is the product.
> Write it well.
> Keep it updated.
> Make it searchable.
> Because documentation is the bridge
> between code and human.

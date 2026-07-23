# Programming — API Design

## Purpose

The contract between systems. Good API design makes integration easy. Bad API design makes integration impossible. APIs are not just technical interfaces — they are products.

## Core Principle

> An API is a product.
> The developer using it is the customer.
> Make their life easy.
> Because if your API is hard to use, they won't use it.

## API Design Principles

### 1. Consistency
- Naming conventions
- Parameter ordering
- Return types
- Error handling
- Versioning

### 2. Simplicity
- Easy to understand
- Easy to use
- Hard to misuse
- Minimal ceremony

### 3. Completeness
- Cover all use cases
- Provide sensible defaults
- Allow customization
- Document everything

### 4. Evolution
- Backward compatibility
- Versioning strategy
- Deprecation policy
- Migration guides

## API Types

| Type | Use Case |
|------|----------|
| **REST** | CRUD operations, web APIs |
| **GraphQL** | Flexible queries, complex data |
| **gRPC** | High-performance, internal services |
| **WebSocket** | Real-time, bidirectional |
| **Message Queue** | Async, decoupled systems |
| **CLI** | Command-line tools |
| **Library** | Code reuse |

## REST API Design

### Resource Naming
- Use nouns, not verbs
- Use plural for collections
- Use nesting for relationships
- Use query parameters for filtering

### HTTP Methods
| Method | Purpose |
|--------|---------|
| **GET** | Read resource |
| **POST** | Create resource |
| **PUT** | Replace resource |
| **PATCH** | Update resource |
| **DELETE** | Delete resource |

### Status Codes
| Code | Meaning |
|------|---------|
| **200** | Success |
| **201** | Created |
| **204** | No content |
| **400** | Bad request |
| **401** | Unauthorized |
| **403** | Forbidden |
| **404** | Not found |
| **409** | Conflict |
| **422** | Unprocessable |
| **500** | Server error |

### Pagination
- Offset-based: simple but slow for large datasets
- Cursor-based: efficient for large datasets
- Page-based: user-friendly for UIs

## GraphQL Design

### Schema Design
- Types for objects
- Queries for reads
- Mutations for writes
- Subscriptions for real-time

### Best Practices
- Use DataLoader for N+1 prevention
- Design for client needs
- Use fragments for reusability
- Handle errors gracefully

## API Documentation

- OpenAPI/Swagger for REST
- GraphQL introspection
- Code examples
- Error documentation
- Rate limiting documentation

## Common API Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Inconsistency** | Different patterns across API | Enforce conventions |
| **Over-fetching** | Returning too much data | Use field selection |
| **Under-fetching** | Requiring multiple calls | Use pagination/links |
| **No versioning** | Breaking changes | Version from day one |
| **Poor errors** | Unhelpful error messages | Provide error details |
| **No documentation** | Developers can't figure it out | Document everything |

## Integration

- **Architecture**: API design is architectural
- **Security**: API security is critical
- **Testing**: APIs must be tested
- **Documentation**: APIs must be documented
- **Backend**: Backend exposes APIs
- **Frontend**: Frontend consumes APIs

## Mantra

> An API is a product.
> The developer using it is the customer.
> Make their life easy.
> Be consistent.
> Be simple.
> Be complete.
> Be documented.
> Be versioned.

# Programming — Database Design

## Purpose

The art of organizing data for efficient retrieval, modification, and maintenance. Good database design is the foundation of reliable, performant applications.

## Core Principle

> Data is the most valuable asset.
> Poor data design is the most expensive mistake.
> Design for your queries, not your data.
> Normalize until performance requires denormalization.

## Database Types

| Type | Use Case |
|------|----------|
| **Relational (SQL)** | Structured data, ACID transactions |
| **Document (NoSQL)** | Semi-structured data, flexible schema |
| **Key-Value** | Simple lookups, caching |
| **Column-Family** | Wide-column analytical queries |
| **Graph** | Relationships, social networks |
| **Time-Series** | Metrics, IoT data |
| **Vector** | Embeddings, similarity search |

## Relational Database Design

### Normalization Forms

| Form | Rule |
|------|------|
| **1NF** | Atomic values, no repeating groups |
| **2NF** | 1NF + no partial dependencies |
| **3NF** | 2NF + no transitive dependencies |
| **BCNF** | Every determinant is a candidate key |
| **4NF** | No multi-valued dependencies |
| **5NF** | No join dependencies |

### Entity-Relationship Modeling
- **Entities**: Things that exist
- **Attributes**: Properties of entities
- **Relationships**: Connections between entities
- **Cardinality**: One-to-one, one-to-many, many-to-many

### Indexing
- **B-tree index**: Default, good for range queries
- **Hash index**: Fast equality lookups
- **Composite index**: Multiple columns
- **Covering index**: Includes all needed columns
- **Partial index**: Subset of rows

### Query Optimization
- Use EXPLAIN/ANALYZE
- Avoid SELECT *
- Use appropriate indexes
- Avoid N+1 queries
- Use batch operations
- Consider query plan

## NoSQL Design

### Document Database Design
- Embed related data (denormalize)
- Design for your queries
- Use references for many-to-many
- Consider document size limits

### Key-Value Design
- Choose good keys
- Consider partitioning
- Avoid hot keys
- Use consistent hashing

### Graph Database Design
- Model relationships as first-class
- Use relationships for traversal
- Index node properties
- Consider traversal patterns

## Common Database Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **No index** | Full table scans | Add appropriate indexes |
| **Over-normalization** | Too many joins | Denormalize for reads |
| **N+1 queries** | Many small queries | Use JOINs or batch |
| **Missing constraints** | Invalid data | Use PK, FK, UNIQUE, CHECK |
| **No backup** | Data loss | Regular backups |
| **Ignoring concurrency** | Race conditions | Use transactions |

## Integration

- **Architecture**: Database is often the core of architecture
- **Performance**: Database performance is critical
- **Security**: Database security is essential
- **Data Engineering**: Database design is data engineering
- **Backend**: Backend depends on database design
- **API Design**: API design depends on data model

## Mantra

> Data is the most valuable asset.
> Design for your queries, not your data.
> Normalize until performance requires denormalization.
> Index everything you search.
> Constraint everything you value.
> Backup everything you need.

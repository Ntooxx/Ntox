# Programming — System Design

## Purpose

The practice of designing large-scale systems. System design is not just architecture — it is the art of making trade-offs. Scalability, reliability, maintainability, and cost must be balanced.

## Core Principle

> System design is about trade-offs.
> There is no perfect system.
> There are only systems that are good enough
> for the constraints at hand.
> Understand the constraints.
> Make the trade-offs explicit.

## System Design Framework

### Step 1: Requirements
- Functional requirements: What should the system do?
- Non-functional requirements: How should it perform?
- Constraints: What are the limits?

### Step 2: Architecture
- High-level design
- Component identification
- Interface definition
- Data flow

### Step 3: Deep Dive
- Detailed design of components
- Database schema
- API contracts
- Algorithms

### Step 4: Trade-offs
- What are the alternatives?
- What are we choosing?
- Why are we choosing it?
- What are we giving up?

## System Design Concepts

### Scalability
- **Vertical scaling**: Bigger machine
- **Horizontal scaling**: More machines
- **Load balancing**: Distribute traffic
- **Sharding**: Split data

### Reliability
- **Redundancy**: Backup components
- **Failover**: Switch to backup
- **Replication**: Copy data
- **Monitoring**: Detect issues

### Availability
- **Uptime**: Percentage of time available
- **SLA**: Service level agreement
- **SLI**: Service level indicator
- **Error budgets**: Acceptable failure rate

### Performance
- **Latency**: Time per request
- **Throughput**: Requests per second
- **Caching**: Store frequently accessed data
- **CDN**: Serve content close to users

## Common System Design Patterns

| Pattern | Description |
|---------|-------------|
| **API Gateway** | Single entry point |
| **CQRS** | Separate reads and writes |
| **Event Sourcing** | Store events, not state |
| **Circuit Breaker** | Stop calling failing service |
| **Bulkhead** | Isolate failures |
| **Retry with Backoff** | Retry after delay |
| **Saga** | Distributed transactions |

## System Design Interview

### Approach
1. Clarify requirements
2. Design high-level architecture
3. Deep dive on components
4. Discuss trade-offs
5. Address scalability and reliability

### Common Questions
- Design a URL shortener
- Design a chat system
- Design a news feed
- Design a search engine
- Design a video streaming service

## Common System Design Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Over-engineering** | Too complex for requirements | Start simple |
| **Under-engineering** | Too simple for requirements | Consider scale |
| **Ignoring failure** | Assuming components work | Design for failure |
| **No monitoring** | Can't detect issues | Monitor everything |
| **Ignoring cost** | Expensive solutions | Consider cost |
| **No documentation** | Nobody understands system | Document everything |

## Integration

- **Architecture**: System design is architectural
- **Distributed Systems**: System design uses distributed systems concepts
- **Database**: Database design is central
- **Networking**: Networking is fundamental
- **Security**: Security is essential
- **DevOps**: DevOps enables system design

## Mantra

> System design is about trade-offs.
> There is no perfect system.
> There are only systems that are good enough
> for the constraints at hand.
> Understand the constraints.
> Make the trade-offs explicit.
> Design for failure.
> Scale when necessary.
> Monitor always.

# NTOX — Distributed Systems

## Purpose

Systems that run on multiple machines. The eight fallacies of distributed computing are the most expensive mistakes in software engineering. Understanding distribution is understanding why things fail in ways that seem impossible.

## Core Principle

> The network is unreliable.
> Clocks are not synchronized.
> Nothing is instantaneous.
> And everything can fail in ways you didn't anticipate.
> Distributed systems are hard because they violate every assumption we make about local computation.

## The Eight Fallacies

1. **The network is reliable** → It isn't. Plan for failure.
2. **Latency is zero** → It isn't. It's significant and variable.
3. **Bandwidth is infinite** → It isn't. It's limited and shared.
4. **The network is secure** → It isn't. Everything can be intercepted.
5. **Topology doesn't change** → It does. Nodes come and go.
6. **There is one administrator** → There isn't. Different policies, different goals.
7. **Transport cost is zero** → It isn't. Serialization, deserialization, protocol overhead.
8. **The network is homogeneous** → It isn't. Different hardware, software, versions.

## CAP Theorem

In a distributed system, you can only have two of:
- **Consistency**: Every read receives the most recent write
- **Availability**: Every request receives a response
- **Partition tolerance**: System continues despite network failures

Since network partitions are inevitable, the real choice is between:
- **CP**: Consistent but may be unavailable during partitions
- **AP**: Available but may be inconsistent during partitions

## Consistency Models

| Model | Description |
|-------|-------------|
| **Strong** | Every read sees the most recent write |
| **Eventual** | Eventually, all replicas converge |
| **Causal** | Causally related operations are seen in order |
| **Linearizable** | Operations appear instantaneous |
| **Sequential** | All operations appear in some total order |

## Distributed Systems Concepts

### Consensus
Getting all nodes to agree on something.
- **Paxos**: Classic consensus algorithm
- **Raft**: Understandable consensus
- **Byzantine fault tolerance**: Consensus with malicious nodes
- **Leader election**: Choosing a coordinator

### Replication
Keeping copies of data on multiple nodes.
- **Primary-backup**: One primary, multiple backups
- **Multi-primary**: Multiple primaries
- **Chain replication**: Replicate through chain
- **Quorum**: Majority-based replication

### Partitioning
Splitting data across nodes.
- **Hash partitioning**: Hash-based distribution
- **Range partitioning**: Range-based distribution
- **Consistent hashing**: Minimal redistribution on change
- **Sharding**: Database partitioning

### Failure Detection
Knowing when nodes have failed.
- **Heartbeats**: Periodic health checks
- **Gossip protocols**: Spread failure information
- **Phi-accrual detector**: Adaptive failure detection
- **Membership protocols**: Manage group membership

## Distributed Systems Patterns

| Pattern | Description |
|---------|-------------|
| **Circuit breaker** | Stop calling failing service |
| **Retry with backoff** | Retry after increasing delays |
| **Bulkhead** | Isolate failures to components |
| **Saga** | Manage distributed transactions |
| **Event sourcing** | Store events, not state |
| **CQRS** | Separate reads and writes |
| **Sidecar** | Offload cross-cutting concerns |

## Common Distributed Systems Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Split brain** | Two masters during partition | Use consensus |
| **Data loss** | Writes not persisted | Replicate with quorum |
| **Cascading failure** | One failure triggers others | Circuit breakers |
| **Thundering herd** | Many requests after recovery | Backoff, staggering |
| **Clock skew** | Clocks disagree on time | Use logical clocks |
| **Network partition** | Nodes can't communicate | Design for partition tolerance |

## Integration With Other Modules

- **Systems Thinking**: Distributed systems are complex systems
- **Complexity Science**: Emergent behavior in distributed systems
- **Architecture**: Distributed systems are architectural decisions
- **Failure Analysis**: Distributed failures are complex
- **Simulation**: Simulate distributed behavior
- **Thermodynamics**: Network latency is analogous to thermodynamic cost

## The Distributed Systems Mantra

> The network is unreliable.
> Plan for failure.
> Design for partition tolerance.
> Accept eventual consistency.
> Use consensus for critical decisions.
> And always, always have a timeout.
> Because the worst thing that can happen
> is not failure.
> It's hanging forever.

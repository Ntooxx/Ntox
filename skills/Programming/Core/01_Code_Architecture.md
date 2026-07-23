# Programming — Code Architecture (Deep Dive)

## Purpose

The structural design of software systems. Not just coding — thinking about modularity, abstraction, coupling, cohesion, and scalability before writing a single line. This deep dive includes real procedures, examples, and decision trees for making architectural decisions.

## Core Principle

> Architecture is the decisions you wish you got right early.
> Because reversing them later is expensive.
> Or impossible.
> The cost of change increases exponentially with time.

---

## The Architecture Decision Framework

### When to Make Architecture Decisions

Not every decision is an architecture decision. Here's how to tell:

**Architecture Decision:**
- Affects multiple components
- Is hard to reverse
- Defines interfaces between parts
- Determines system properties (scalability, security, etc.)
- Is discussed in design meetings

**Implementation Detail:**
- Affects one component
- Is easy to change
- Is internal to a module
- Doesn't affect system properties
- Can be decided while coding

**Decision Tree:**
```
Is this decision:
├── Hard to reverse?
│   ├── YES → Architecture decision
│   └── NO → Implementation detail
│
├── Affects multiple components?
│   ├── YES → Architecture decision
│   └── NO → Implementation detail
│
├── Defines interfaces?
│   ├── YES → Architecture decision
│   └── NO → Implementation detail
│
└── Determines system properties?
    ├── YES → Architecture decision
    └── NO → Implementation detail
```

### The ADR (Architecture Decision Record) Template

Every significant architecture decision should be documented:

```markdown
# ADR-001: Use PostgreSQL for primary database

## Status
Accepted

## Date
2024-01-15

## Context
We need a primary database for our application.
Requirements:
- ACID transactions
- Complex queries
- JSON support
- Good ecosystem
- Team familiarity

## Decision
We will use PostgreSQL as our primary database.

## Consequences

### Positive
- ACID support
- Excellent JSON support (JSONB)
- Rich ecosystem
- Team has experience

### Negative
- Slower than NoSQL for simple key-value operations
- Requires schema migrations
- More complex than SQLite for development

### Risks
- Scaling beyond single node requires planning
- Team may over-reuse JSONB when relational would be better

## Alternatives Considered
- MySQL: Less features, weaker JSON support
- MongoDB: No ACID, weaker consistency
- SQLite: Doesn't scale, limited concurrency
```

---

## Architecture Patterns: Decision Tree

```
What kind of system are you building?

├── Small application (< 10K LOC)
│   ├── Monolith
│   │   ├── Layered architecture
│   │   ├── Simple, fast, easy to deploy
│   │   └── Good for: small teams, MVPs, prototypes
│   │
│   └── When to split:
│       ├── Team size > 5 developers
│       ├── Multiple deployment targets
│       ├── Different scaling requirements
│       └── Clear domain boundaries
│
├── Medium application (10K-100K LOC)
│   ├── Modular monolith
│   │   ├── Modules with clear boundaries
│   │   ├── Can be split later if needed
│   │   └── Good for: growing teams, evolving requirements
│   │
│   └── Microservices (if needed):
│       ├── Clear service boundaries
│       ├── Independent deployment
│       └── Good for: multiple teams, different tech stacks
│
├── Large application (100K+ LOC)
│   ├── Microservices
│   │   ├── Service per domain
│   │   ├── Independent deployment
│   │   ├── Technology diversity
│   │   └── Good for: large teams, complex domains
│   │
│   └── Considerations:
│       ├── Operational complexity
│       ├── Network overhead
│       ├── Data consistency
│       └── Team organization
│
└── Distributed system
    ├── Event-driven
    │   ├── Asynchronous communication
    │   ├── Loose coupling
    │   ├── Eventual consistency
    │   └── Good for: high throughput, real-time
    │
    └── CQRS + Event Sourcing
        ├── Separate reads and writes
        ├── Audit trail
        ├── Time travel
        └── Good for: complex domains, audit requirements
```

---

## Real Architecture Decisions

### Example 1: Choosing a Database

**Scenario:** Building a social media application

**Requirements:**
- User profiles (structured data)
- Posts and comments (semi-structured)
- User relationships (graph)
- Real-time notifications (message queue)
- Search (full-text)

**Decision Tree:**
```
What is the primary data model?
├── Relational (users, relationships)
│   ├── PostgreSQL
│   │   ├── Strong consistency
│   │   ├── Complex queries
│   │   ├── JSON support for semi-structured data
│   │   └── Good for: user data, relationships
│   │
│   └── MySQL
│       ├── Faster for simple queries
│       ├── Larger ecosystem
│       └── Good for: high-read workloads
│
├── Document (posts, comments)
│   ├── MongoDB
│   │   ├── Flexible schema
│   │   ├── Good for: content that varies
│   │   └── Trade-off: weaker consistency
│   │
│   └── DynamoDB
│       ├── Auto-scaling
│       ├── Predictable performance
│       └── Trade-off: limited querying
│
├── Graph (relationships)
│   ├── Neo4j
│   │   ├── Optimized for graph queries
│   │   ├── "Find friends of friends"
│   │   └── Trade-off: operational complexity
│   │
│   └── PostgreSQL with recursive CTEs
│       ├── Good enough for most cases
│       ├── Single database
│       └── Trade-off: less performant for deep traversals
│
├── Search (full-text)
│   ├── Elasticsearch
│   │   ├── Best-in-class search
│   │   ├── Good for: complex queries, analytics
│   │   └── Trade-off: operational complexity
│   │
│   └── PostgreSQL full-text search
│       ├── Good enough for simple cases
│       ├── Single database
│       └── Trade-off: less performant at scale
│
└── Message Queue (notifications)
    ├── Redis Pub/Sub
    │   ├── Fast
    │   ├── Simple
    │   └── Trade-off: no persistence
    │
    ├── RabbitMQ
    │   ├── Reliable
    │   ├── Feature-rich
    │   └── Trade-off: more complex
    │
    └── Kafka
        ├── High throughput
        ├── Durable
        └── Trade-off: operational complexity

**Decision:** PostgreSQL (primary) + Redis (cache/pub/sub) + Elasticsearch (search)

**Why:**
- PostgreSQL handles user data, posts, comments, and relationships
- JSONB handles semi-structured data
- Redis handles caching and real-time notifications
- Elasticsearch handles search
- Team knows PostgreSQL well
- Single primary database reduces operational complexity

**Risks:**
- PostgreSQL may not scale for very large graph queries → Monitor, consider Neo4j if needed
- Elasticsearch adds operational complexity → Start with PostgreSQL full-text search, add ES only if needed
```

### Example 2: API Design Decision

**Scenario:** Building a mobile app with a backend API

**Requirements:**
- Mobile app (iOS/Android)
- Web app
- Third-party integrations
- Real-time features
- Offline support

**Decision Tree:**
```
What type of API?
├── REST
│   ├── Simple, well-understood
│   ├── Good for: CRUD operations
│   ├── Tools: Swagger, Postman
│   └── Good for: third-party integrations
│
├── GraphQL
│   ├── Flexible queries
│   ├── Good for: mobile (different data needs)
│   ├── Tools: Apollo, Relay
│   └── Good for: complex data requirements
│
├── gRPC
│   ├── High performance
│   ├── Good for: internal services
│   ├── Tools: Protocol Buffers
│   └── Good for: microservices communication
│
└── WebSocket
    ├── Real-time
    ├── Good for: notifications, chat
    ├── Tools: Socket.io, ws
    └── Good for: live updates

**Decision:** GraphQL (primary) + REST (third-party) + WebSocket (real-time)

**Why:**
- GraphQL gives mobile app exactly the data it needs (no over-fetching)
- REST is simpler for third-party integrations
- WebSocket handles real-time features
- GraphQL subscriptions handle real-time GraphQL

**Implementation:**
```
Mobile App → GraphQL API → Business Logic → Database
Web App → GraphQL API → Business Logic → Database
Third Party → REST API → Business Logic → Database
Real-time → WebSocket → Event Bus → Subscribers
```

**Risks:**
- GraphQL complexity → Start with simple queries, add complexity as needed
- N+1 queries → Use DataLoader
- Caching → Use persisted queries and CDN
```

### Example 3: Authentication Decision

**Scenario:** Building a SaaS application

**Requirements:**
- User authentication
- Role-based access control
- Multi-tenancy
- SSO for enterprise customers
- API authentication

**Decision Tree:**
```
What authentication approach?
├── Build your own
│   ├── Full control
│   ├── But: security risk, time-consuming
│   └── Only if: unique requirements that no provider meets
│
├── Auth0 / Okta / Firebase Auth
│   ├── Fast to implement
│   ├── Security handled by experts
│   ├── But: vendor lock-in, cost at scale
│   └── Good for: most applications
│
├── Self-hosted (Keycloak, etc.)
│   ├── Control without building from scratch
│   ├── But: operational complexity
│   └── Good for: enterprise, compliance requirements
│
└── Hybrid
    ├── Use provider for auth
    ├── Store your own user data
    └── Good for: flexibility

**Decision:** Auth0 (authentication) + custom authorization

**Why:**
- Auth0 handles the hard parts (password hashing, MFA, SSO)
- Custom authorization for business-specific rules
- Team can focus on product, not auth infrastructure

**Implementation:**
```
User → Auth0 → JWT Token → API Gateway
API Gateway → Validate JWT → Authorization Service → Business Logic
Authorization Service → Check roles, permissions, tenant
```

**Risks:**
- Vendor lock-in → Abstract behind interface, can swap later
- Cost at scale → Monitor usage, negotiate enterprise agreement
- Complexity → Keep auth logic simple, use Auth0 rules for complex logic
```

---

## Architecture Evaluation Checklist

Before finalizing any architecture:

```
□ Modularity
  ├── Are components independent?
  ├── Can they be developed separately?
  ├── Can they be tested separately?
  └── Can they be deployed separately?

□ Abstraction
  ├── Are abstractions stable?
  ├── Do they capture essential complexity?
  ├── Are they at the right level?
  └── Will they change frequently?

□ Coupling
  ├── What depends on what?
  ├── What happens if one component changes?
  ├── Are there hidden dependencies?
  └── Can dependencies be removed?

□ Scalability
  ├── What becomes the bottleneck at 100x?
  ├── Can the system scale horizontally?
  ├── What are the scaling limits?
  └── What is the cost of scaling?

□ Failure
  ├── What happens when components fail?
  ├── How does the system recover?
  ├── What is the blast radius?
  └── What is the recovery time?

□ Evolution
  ├── How does the system evolve?
  ├── What can be changed without breaking?
  ├── What is the migration path?
  └── How is backward compatibility maintained?

□ Simplicity
  ├── Can this be expressed with fewer primitives?
  ├── Is there unnecessary complexity?
  ├── What can be removed?
  └── Am I over-engineering?
```

---

## Architecture Anti-Patterns: Real Examples

### Anti-Pattern 1: The Big Ball of Mud

**Symptoms:**
- No clear structure
- Everything depends on everything
- Changes break unrelated things
- Nobody understands the whole system

**Real Example:**
```javascript
// Everything in one file
const db = require('./database');
const auth = require('./auth');
const email = require('./email');
const payment = require('./payment');
const analytics = require('./analytics');

// User creation touches everything
async function createUser(data) {
  const user = await db.users.create(data);
  await auth.createPassword(user.id, data.password);
  await email.sendWelcome(user.email);
  await payment.createCustomer(user.id);
  await analytics.track('user_created', user.id);
  return user;
}
```

**Fix:** Extract services, define interfaces, reduce coupling.

### Anti-Pattern 2: The God Object

**Symptoms:**
- One class/module does everything
- 1000+ lines of code
- Multiple responsibilities
- Hard to test

**Real Example:**
```python
class UserManager:
    def create_user(self, data): ...
    def delete_user(self, id): ...
    def authenticate(self, credentials): ...
    def authorize(self, user, resource): ...
    def send_email(self, to, subject, body): ...
    def process_payment(self, user, amount): ...
    def generate_report(self, filters): ...
    def export_data(self, format): ...
    # ... 50 more methods
```

**Fix:** Single Responsibility Principle. Split into UserService, AuthService, EmailService, PaymentService, etc.

### Anti-Pattern 3: The Spaghetti Architecture

**Symptoms:**
- Circular dependencies
- Unclear data flow
- Hard to trace execution
- Testing is nearly impossible

**Real Example:**
```
User → Order → Inventory → User → Payment → Order → User
```

**Fix:** Define clear layers, enforce dependency direction, use dependency injection.

---

## The Architecture Review Process

### Step 1: Understand the Current State

```
Questions to answer:
1. What is the current architecture?
2. What are the pain points?
3. What is working well?
4. What is technical debt?
5. What are the constraints?
```

### Step 2: Identify the Problems

```
Categories of problems:
├── Structural
│   ├── Too much coupling
│   ├── Wrong abstractions
│   └── Missing boundaries
│
├── Scalability
│   ├── Can't handle load
│   ├── Can't scale specific components
│   └── Cost is too high
│
├── Reliability
│   ├── Too many failures
│   ├── Slow recovery
│   └── Data loss risk
│
├── Maintainability
│   ├── Hard to change
│   ├── Hard to understand
│   └── Hard to test
│
└── Evolution
    ├── Can't add new features
    ├── Can't adopt new technology
    └── Can't split the team
```

### Step 3: Propose Solutions

```
For each problem:
1. What are the options?
2. What are the trade-offs?
3. What is the recommended approach?
4. What are the risks?
5. What is the migration path?
```

### Step 4: Evaluate and Decide

```
Decision matrix:
├── Option A: [Description]
│   ├── Pros: [List]
│   ├── Cons: [List]
│   ├── Risk: [Low/Medium/High]
│   ├── Effort: [Days/Weeks/Months]
│   └── Impact: [Low/Medium/High]
│
├── Option B: [Description]
│   └── [Same structure]
│
└── Recommendation: [Option X because Y]
```

### Step 5: Plan the Migration

```
Migration plan:
1. Phase 1: [What to do first]
2. Phase 2: [What to do next]
3. Phase 3: [Final steps]
4. Rollback plan: [How to undo if needed]
5. Success criteria: [How to know it worked]
```

---

## Cross-References

- **System Design**: Architecture is the foundation of system design. See `Programming/Systems/18_System_Design.md`
- **Refactoring**: Improves architecture incrementally. See `Programming/Engineering/11_Refactoring.md`
- **Code Review**: Reviews check architectural decisions. See `Programming/Engineering/12_Code_Review.md`
- **Testing**: Architecture affects testability. See `Programming/Core/06_Testing_QA.md`
- **DevOps**: Architecture affects deployment. See `Programming/Engineering/07_DevOps_Deployment.md`
- **Technical Debt**: Bad architecture creates debt. See `Programming/Professional/24_Technical_Debt.md`
- **Systems Thinking**: Architecture is systems thinking applied to code. See NTOX `Physics/20_Systems_Thinking.md`
- **First Principles**: Architecture decisions should be principled. See NTOX `Core/03_First_Principles.md`

---

## The Architecture Mantra

> Think before you code.
> Design before you implement.
> Architect before you build.
>
> Ask yourself:
> Is this modular?
> Are the abstractions stable?
> Is there unnecessary coupling?
> What becomes the bottleneck at 100x?
> Can this be expressed with fewer primitives?
> Am I over-engineering?
> Am I under-engineering?
>
> Because the cost of change increases exponentially with time.
> And the hardest decisions are the ones you make first.
> But the most impactful ones are also the ones you make first.
> Make them well.
> Document them.
> And be ready to evolve.

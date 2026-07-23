# Programming — DevOps & Deployment

## Purpose

The practice of bridging development and operations. DevOps is not just tools — it is a culture of automation, monitoring, and continuous improvement. Ship fast, ship safe, ship often.

## Core Principle

> If it's done manually, it's not done yet.
> Automate everything that can be automated.
> Monitor everything that can be monitored.
> Ship early, ship often, ship safely.

## DevOps Practices

### Continuous Integration
- Merge code changes frequently
- Automated build on every merge
- Automated test suite
- Fast feedback loop

### Continuous Delivery
- Always in a deployable state
- Automated deployment pipeline
- Manual approval for production
- Rollback capability

### Continuous Deployment
- Deploy every change automatically
- Fast, reliable pipeline
- Comprehensive monitoring
- Quick rollback

### Infrastructure as Code
- Version control infrastructure
- Reproducible environments
- Automated provisioning
- Immutable infrastructure

## Deployment Pipeline

```
Code → Build → Test → Stage → Deploy → Monitor
  ↓      ↓      ↓      ↓       ↓        ↓
 Lint   Compile  Unit   Staging  Canary  Metrics
 Type   Bundle   Integ  Prod     Full    Logs
 Check  Minify   E2E    Mirror   Rollout Alerts
```

### Pipeline Stages

| Stage | Purpose |
|-------|---------|
| **Build** | Compile, bundle, package |
| **Test** | Run test suite |
| **Stage** | Deploy to staging |
| **Canary** | Deploy to small subset |
| **Full** | Deploy to all |
| **Monitor** | Watch for issues |

## Deployment Strategies

| Strategy | Description |
|----------|-------------|
| **Rolling** | Gradual replacement |
| **Blue-Green** | Two identical environments |
| **Canary** | Small subset first |
| **Feature flags** | Toggle features |
| **A/B testing** | Compare versions |
| **Shadow** | Run both versions |

## Monitoring & Observability

### Three Pillars
- **Metrics**: Quantitative measurements
- **Logs**: Discrete events
- **Traces**: Request flow through system

### Key Metrics (RED)
- **Rate**: Requests per second
- **Errors**: Error rate
- **Duration**: Latency

### Key Metrics (USE)
- **Utilization**: Resource usage
- **Saturation**: Queue depth
- **Errors**: Error count

## Common DevOps Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Manual deployment** | Human error, slow | Automate pipeline |
| **No rollback** | Can't recover from failure | Always have rollback |
| **No monitoring** | Issues discovered by users | Monitor proactively |
| **Snowflake servers** | Unique, irreplaceable servers | Immutable infrastructure |
| **Configuration drift** | Environments diverge | Infrastructure as code |
| **No capacity planning** | Running out of resources | Monitor and plan |

## Integration

- **Architecture**: DevOps enables architectural decisions
- **Security**: DevSecOps integrates security
- **Performance**: DevOps includes performance monitoring
- **Testing**: DevOps requires automated testing
- **Cloud**: DevOps uses cloud infrastructure
- **Distributed Systems**: DevOps manages distributed systems

## Mantra

> If it's done manually, it's not done yet.
> Automate everything.
> Monitor everything.
> Ship early, ship often, ship safely.
> And always have a rollback plan.
> Because something will go wrong.
> The question is: how fast can you recover?

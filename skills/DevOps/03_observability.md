# Observability

## Triggers
- "add logging"
- "metrics and monitoring"
- "alert fatigue"
- "set up dashboards"
- "how do i know it is working"
- "observability"
- "on call is too noisy"

## Purpose
Designs logging, metrics, and alerting that answer real questions: is it broken, who is affected, what changed, and why. Optimizes for signal, not coverage.

## Core Principle

You do not need more data — you need answers to four questions on one screen: Is it up? Who is hurting? What changed? How bad? Instrument backwards from those questions.

## The Three Pillars

| Pillar | Use it for | Rules |
|--------|-----------|-------|
| **Metrics** | Rates, counts, latencies — alert on these | Aggregated, cheap, long retention |
| **Logs** | Per-request detail — investigate with these | Structured JSON, never free text |
| **Traces** | One request's journey across services | Sample aggressively, keep errors always |

## Metric Design

- **RED** per endpoint: Rate, Errors, Duration — the minimum viable service dashboard.
- **USE** per resource: Utilization, Saturation, Errors — for queues, disks, pools.
- Percentiles over averages: p50/p95/p99; an average hides the users who are suffering.
- Every metric needs a unit and a threshold that implies an action — otherwise delete it.

## Logging Rules

- Structured fields: timestamp, level, service, request_id, duration_ms, error.
- Log state changes and decisions, not loops — one line per request completion, not per iteration.
- Never log secrets, tokens, full PII, or megabyte payloads; redact at the source.
- Search with grep and a request_id to reconstruct one user's path end to end.

## Alert Design

- Alert on symptoms users feel (error rate, latency), not causes (CPU, disk) — unless the cause is irreversible.
- Every alert must name the runbook action in its description. No runbook, no page.
- If an alert fires and nobody acts, delete or downgrade it — noise trains people to ignore everything.
- Page only for SEV-worthy conditions; everything else goes to a daily digest.

## Output Format

Present as: the question each signal answers, the proposed metric/log field with its threshold, the alert with its runbook line, and the dashboard row it belongs to.

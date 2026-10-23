# Incident Response

## Triggers
- "production is down"
- "incident response"
- "we have an outage"
- "sev 1"
- "service is broken"
- "on call"
- "write a postmortem"

## Purpose
Runs a disciplined response to production incidents: contain first, diagnose second, fix third, and finish with a blameless postmortem that prevents recurrence.

## Core Principle

During an incident, the goal is restoration, not explanation. Restore service with the fastest safe action, then investigate at leisure. Never debug in production while users are still bleeding.

## Severity Levels

| Level | Meaning | Response |
|-------|---------|----------|
| **SEV1** | All users down, data at risk, revenue stopped | Page immediately, commander assigned |
| **SEV2** | Major feature broken, no workaround | Page in business hours, fix today |
| **SEV3** | Degraded, workaround exists | Ticket, fix this week |
| **SEV4** | Cosmetic or edge case | Backlog |

## Response Workflow

1. Declare the incident and pick an incident commander — the person who coordinates, not types.
2. Mitigate first: roll back the last deploy, fail over, disable the feature flag, shed load — whichever is fastest and safest.
3. Announce status visibly with timestamps; silence is the second-worst outage experience.
4. Preserve evidence: capture logs, dashboards, and deploy SHAs before restarts destroy them.
5. Once restored, verify with a smoke test, then announce recovery.
6. Write the postmortem within 48 hours while memory is fresh.

## Triage Questions

- What changed in the last 24 hours? (Deploys, config, traffic, dependencies)
- Is it one service or one dependency showing up everywhere?
- Does rollback fix it? If yes, you have your cause.
- Who else is affected — internal dashboards, or real users?

## Blameless Postmortem Template

- Timeline (UTC): detection, mitigation, restoration, follow-ups
- Impact: users affected, duration, revenue or data loss
- Root cause: the chain of conditions, not the person who typed
- What went well / what made it harder
- Action items: each with an owner and a date, sized small enough to actually ship

## Output Format

During: short status lines with timestamps and next action. After: the postmortem in the template above, with action items ranked by how much risk they remove.

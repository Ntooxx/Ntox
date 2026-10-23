# Privacy Compliance Basics

## Triggers
- "gdpr compliance"
- "privacy policy"
- "data protection"
- "ccpa"
- "do we need consent"
- "user data request"
- "dpa review"

## Purpose
Maps a product's data handling against privacy-regulation fundamentals (GDPR-style and CCPA-style): what data exists, why it is processed, who sees it, and how user requests are honored.

## Scope

Issue-spotting and operational checklists only — not legal advice. Confirm conclusions with qualified counsel before relying on them.

## Core Principle

Privacy compliance is an inventory problem before it is a policy problem: you cannot honor a deletion request, answer a data-access question, or prove consent for data you have never cataloged.

## Workflow

1. Build the data inventory: field, purpose, location, retention, who can access it, subprocessors touched.
2. Classify each purpose: contract performance, legitimate interest, consent, or legal obligation.
3. Flag data with no purpose — deletion candidates and the first thing a regulator asks about.
4. Check consent mechanics where required: freely given, specific, withdrawable as easily as granted.
5. Map user rights handling: access, correction, deletion, export, opt-out of sale/sharing — with a SLA you actually meet.
6. Review retention: every store needs an expiry, and the expiry needs an automated enforcement job.
7. Review subprocessors: DPA in place, transfer mechanism for cross-border data, breach notification window.

## Common Gaps

- Analytics SDKs collecting identifiers before consent fires.
- Logs containing personal data with no retention limit.
- Backups that make "deletion" a promise you cannot keep without a documented backup-expiry path.
- Vague privacy policy that describes none of the actual data flows.
- No record of processing activities — the document regulators request first.

## Breach First Steps

Contain, preserve evidence, assess risk and jurisdiction thresholds, notify internally per the incident plan, then regulators and affected users within the required window (often 72 hours) — with counsel driving the wording.

## Output Format

Present as: inventory table (data / purpose / retention / gaps), ranked findings with the regulation concept at risk, and a remediation checklist ordered by effort-to-risk ratio. End with the explicit note that counsel must confirm.

# Infrastructure As Code Review

## Triggers
- "review this terraform"
- "infrastructure as code"
- "terraform plan"
- "iac review"
- "state drift"
- "hcl help"
- "cloudformation review"

## Purpose
Reviews and writes infrastructure-as-code changes (Terraform, Pulumi, CloudFormation, Bicep) with an eye for blast radius, drift, security, and cost before anything reaches production.

## Core Principle

A plan diff is a contract. Review the plan output, not just the HCL — what the code says matters less than what the engine will actually do to real resources.

## Review Workflow

1. Run or read `terraform plan` output first; the diff is the review surface.
2. Check for destructive operations: resource replacement, `count` changes that orphan state, renamed modules.
3. Verify every new resource has explicit lifecycle intent — `prevent_destroy` where it matters, `create_before_destroy` for zero-downtime rollouts.
4. Confirm no hardcoded secrets, account IDs, or public exposure (0.0.0.0/0, public S3, open security groups).
5. Look for tag/label propagation so cost and ownership are traceable.
6. Flag unbounded resources: autoscaling without ceilings, log groups without retention, EBS without lifecycle.

## Red Flags

| Pattern | Risk |
|---------|------|
| Changed resource forces replacement | Downtime or data loss |
| Module source pinned to `main` | Non-reproducible deploys |
| Secrets in `tfvars` committed to git | Credential leak |
| Missing state locking | Concurrent runs corrupt state |
| Single AZ by default | Availability incident waiting |
| `terraform destroy` in CI | One typo from catastrophe |

## State and Drift

- Detect drift with a scheduled plan (not apply) and alert on non-empty unexpected diffs.
- State lives remotely, versioned, encrypted, with one lock per workspace.
- Never hand-edit cloud resources outside IaC; fix the code or import the resource.

## Output Format

Return: verdict (safe / needs changes / dangerous), the specific line or plan step that worries you, the failure scenario it causes, and the concrete replacement snippet.

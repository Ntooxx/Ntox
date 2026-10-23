# Deployment Pipeline

## Triggers
- "deploy pipeline"
- "ci cd setup"
- "fix the build"
- "why did ci fail"
- "green builds"
- "pipeline is flaky"
- "set up continuous delivery"

## Purpose
Designs, reviews, and debugs CI/CD pipelines. Covers stage architecture, failure triage, caching, artifact flow, and safe rollout strategies so code moves from commit to production without heroics.

## Core Principle

A pipeline is a production system for commits. Every minute it saves must outweigh every minute it costs, and a red build must always be trustworthy — never something people learn to re-run.

## Pipeline Stages

| Stage | Purpose | Failure means |
|-------|---------|---------------|
| **Lint** | Style and static problems | Fast, fix immediately |
| **Test** | Unit and integration correctness | Block merge |
| **Build** | Compile/package artifacts | Block merge |
| **Security scan** | Dependencies, secrets, SAST | Block merge on high severity |
| **Deploy** | Ship to an environment | Page a human |
| **Smoke test** | Verify the deployment | Auto-rollback |

## Debugging Workflow

1. Read the failing step's log first — with the read or grep tool, never from memory.
2. Reproduce locally with the same commands through the shell tool; if it passes locally, suspect environment drift.
3. Check the dependency lockfile changed; unlocked versions are the most common "nothing changed" failure.
4. Suspect cache poisoning when a clean run fixes it — then fix the cache key, not the symptom.
5. Separate flaky from broken: three reruns of the same commit tells you which one you have.
6. Fix the root cause before restarting the job, and record flaky tests in a quarantine list with an owner.

## Rollout Strategies

- **Trunk-based with feature flags** for teams shipping daily.
- **Canary**: 1% → 10% → 100% with automatic rollback on error-rate or latency regression.
- **Blue/green** when rollback must be instant and environments are cheap.
- Always define the rollback command before the deploy command exists.

## Review Checklist

- Secrets come from the secret store, never the repo or log output.
- Builds are reproducible: locked dependencies, pinned tool versions, fixed base images.
- Test time stays under ~10 minutes wall clock or people stop running it.
- Deploys are one command (or one push) with zero manual steps.
- Every pipeline step has a clear owner when it breaks at 3am.

## Output Format

Report as: stage that failed, evidence from the log (quoted lines), most likely root cause ranked first, the exact fix, and the prevention step so it cannot recur.

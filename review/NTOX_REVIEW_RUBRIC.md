# NTOX High-Level Reviewer

A repeatable, evidence-based review of NTOX as a product and as an engineering artefact. The reviewer is a program, not a mood: it reads the tree, runs the checks, probes for dead wiring, audits marketing claims against measured values, and prints a scorecard.

```bash
npm run review                 # full audit: typecheck, lint, tests, registry lookup
npm run review -- --quick      # static signals only, reuses the last runtime result
npm run review -- --offline    # skip the npm registry check
npm run review -- --gate 7.5   # exit non-zero below a threshold, for CI
npm run review -- --json       # machine-readable payload on stdout
```

Outputs:

| File | Contents |
| --- | --- |
| `review/NTOX_HIGH_LEVEL_REVIEW.md` | The rendered report: scorecard, evidence per dimension, competitor matrix, claim audit, findings, action plan |
| `review/latest.json` | The same data, structured, for dashboards or CI |
| `review/runtime-cache.json` | Last typecheck, lint and test result, reused by `--quick` |

## The question

> Is NTOX a credible agent runtime today, how does it compare with the products a user would actually choose between, and what specifically holds the score down?

The reviewer refuses two failure modes:

1. **Marketing echo.** Repeating claims the tree does not support.
2. **Feature counting.** Scoring a capability because a module with that name exists.

A capability is only credited when it is wired into the live agent loop. This is why the reviewer contains code probes: regex signatures for known defects, each quoted with file and line, each confirmed by inspection before it is reported.

## Evidence hierarchy

| Tier | Source | How it is used |
| --- | --- | --- |
| Measured | Files, line counts, registry comparison, tool registry versus allowlist, blocklist size, git history | Scored directly |
| Executed | `tsc --noEmit`, `eslint`, `vitest run`, coverage artifact, `npm view` | Scored directly; a failure zeroes the signal |
| Probed | Code signatures for suppression flags, dead wiring, policy bypass, opt-in boundaries | Caps the related signal, quoted as evidence |
| Estimated | Competitor scores, positioning, market read | Labelled, confidence-tagged, never mixed with NTOX's measured columns |

## Scoring model

Each dimension has 1-3 fixed signals. Each signal is a measurable fact with a weight. A signal maps to 0-1, then the dimension's weighted mean maps to 1-10:

```
measured = Σ(weight × value) / Σ(weight)      # null signals excluded, not guessed
score    = 1 + 9 × measured
overall  = Σ(dimension weight × score) / 100
```

Weights sum to 100. The scale is anchored: **1** absent or misleading, **5** present but shallow or inconsistent, **10** best in class and evidenced.

## Weights and why

| Dimension | Weight | Rationale |
| --- | ---: | --- |
| Meta-cognition and learning loop | 14% | NTOX's entire thesis. If this is veneer, the product has no reason to exist. |
| Engineering quality and reliability | 14% | An agent runs unattended with shell access. Trust is not optional. |
| Core agent loop | 13% | Table stakes against modern coding agents. Weak here and nothing else matters. |
| Memory and personalisation | 12% | The second half of the differentiation claim. |
| Tools, channels and interoperability | 12% | Determines whether it can act, and whether it fits existing workflows. |
| Security and trust | 10% | Blast radius under autonomy. |
| Onboarding and day-to-day UX | 9% | Friction between install and first useful turn. |
| Product clarity and documentation | 8% | Can a stranger understand it without trusting the README? |
| Distribution and ecosystem | 8% | Can anyone adopt it today, and can others build on it? |

**51% of the weight sits on the four dimensions where NTOX is strongest.** That is deliberate — it is a review of *this* product's thesis, not a generic popularity contest — and it is also the softest part of the rubric. So the reviewer re-scores the same evidence under an **adoption weighting** (engineering 18, core loop 14, security 14, UX 12, integration 11, distribution 9, memory 8, cognition 7, clarity 7). If NTOX's rank collapses between the two weightings, the report says so.

### Hard gates

Some facts are not tradeable. A dimension can be capped when a gate fails:

| Dimension | Gate | Cap | Why |
| --- | --- | ---: | --- |
| Distribution | package not on the public registry | 5.5 | No install path means no adoption, whatever else exists |

The gate and the raw score are both printed, so the cap is visible rather than hidden in arithmetic.

## Competitive set

Six products a buyer would compare against, chosen for different reasons:

| Product | Why it is in the set |
| --- | --- |
| Claude Code | The reference for tool discipline, permission UX and polish |
| OpenAI Codex CLI | The reference for default OS-level sandboxing |
| Aider | The reference for repository awareness and git-native editing |
| OpenHands | The reference for container sandboxing and agent platforms |
| Goose | The reference for MCP-native extension ecosystems |
| Cline | The reference for IDE distribution and plan/act modes |

Competitor scores are **analyst estimates** from public documentation, confidence-tagged in `scripts/review/competitors.json`. They are directional, not measured. NTOX is always measured. The report never presents the two as the same kind of number.

## Bias controls

1. **Signals are fixed before scoring.** The rubric lives in `rubric.json`; the evidence must fit the signal, never the reverse.
2. **Claims are audited.** Every numeric claim in the README that can be checked against the tree is checked, and mismatches become findings.
3. **Behaviour over existence.** Probes catch the classic failures: a feature gated off in the default config, output sent to a callback instead of storage, a sandbox that falls back to the host, a policy applied to built-ins but not to MCP tools.
4. **Hard gates prevent compensation.** A strength elsewhere cannot buy back a broken install path.
5. **Two weightings.** Capability-weighted and adoption-weighted rankings are both published.
6. **Negative results are kept.** Findings list what is broken even when the dimension still scores well, and the method section states what was not measured.

## Severity scale

| Level | Meaning |
| --- | --- |
| P0 | Blocks a core task, loses work, or makes the product unusable |
| P1 | Materially undermines the product claim, security boundary, or adoption |
| P2 | Noticeable weakness in a capability the product advertises |
| P3 | Cosmetic, stale, or low-frequency issue |

Signal-derived findings are graded by materiality: `(dimension weight / 100) × signal weight × (1 − value)`.

## What this review does not measure

- **Model quality.** The dominant variable in felt agent performance belongs to the provider.
- **Task completion rate.** `src/benchmark` can measure it, but requires provider credentials; this review does not fabricate it.
- **Latency and cost per task.** Not measured here.
- **Desktop UX.** Covered separately in `docs/UI_UX_AUDIT.md` and `docs/NTOX_SENIOR_UI_UX_CRITIC.md`.
- **Learning efficacy over time.** The instrumentation exists; a longitudinal result does not yet.

Any of these can be added as a signal, but only if the evidence is reproducible.

## Extending

- Add a code signature to `scripts/review/probes.mjs` (`file`, `match`, optional `unless` / `minLines`, severity, dimension, fix).
- Add a signal to `rubric.json` and a matching computation in `scripts/review/index.mjs` (`buildSignals`). Unknown signal ids fail loudly, so the rubric and the code cannot drift silently.
- Re-run `npm run review` and diff `latest.json`.

# Phase 3 — Preflight Report

Generated: 2026-10-27T23:09:00.077Z
Suite: `scripts/experiments/phase3-tasks.json` (sha256:bb43dd6b1cf4a060b08add7c46b04732294a5eac38b8d772147c63e836cb4207)
Result: **PASS — execution may proceed**

| Check | Verdict | Detail |
|---|---|---|
| P1-signer-isolation — Signer not accessible to the agent | ✅ pass | no agent-surface module references signing; policy denies C:\Users\anton\.ntox\procedures (read/write) with no grant that opens it |
| P2-version-binding — Evidence is version-bound | ✅ pass | stale-version, cross-procedure, and content-drift evidence all rejected; bound evidence promotes |
| P3-reuse-accounting — Candidates can never count as verified reuse | ✅ pass | 6 accounting cases hold (candidate→candidate-reuse, decoy never verified-reuse, replay→incorrect-reuse) |
| P4-frozen-fixtures — Frozen fixtures and checks present and valid | ✅ pass | 6 families, 30 tasks, all checks compile (sha256:bb43dd6b1cf4a060b08add7c46b04732294a5eac38b8d772147c63e836cb4207) |

Gates (reviewer decision 2026-10-27): harness implementation approved, experimental execution NOT authorized.
This report certifies only that the pre-execution blockers are closed.

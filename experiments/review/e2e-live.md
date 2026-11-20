# Live E2E validation (opt-in)

Mode: offline (local MiniLM) · generated 2026-11-19T23:31:45.343Z

All runs use temporary directories; no live provider key or personal memory is written to the repository.

| Check | Status | Detail |
|---|---|---|
| reembed | pass | dry-run flagged 3; real run migrated 3; backup present; second run no-op; new-model retrieval ok |
| semantic-skill-match | pass | zero-keyword-overlap query selected the correct skill; local-hash fell back to keywords |
| self-author | skipped | requires --live with NTOX_API_KEY/OPENROUTER_API_KEY |

## Manual REPL smoke (requires a TTY)

Not automatable in CI. Run `npm run dev` in a terminal and exercise: a plain turn, a tool turn,
a memory turn (`/memory`), `/trace`, and `/skills`. Paste redacted snippets here after the run.

# NTOX Improvement Plan

## Direction

NTOX should feel like one agent with two first-class surfaces:

- CLI for fast engineering loops, automation, and power-user inspection.
- Web chat for daily use, review, planning, memory, and multi-step work.

The product direction is minimal, work-focused, and inspectable. The UI should stay quiet: chat first, compact runtime state second, no marketing layer.

## Near-Term Priorities

1. Make skills easier to add and trust.
   - Add a skill authoring format with `skill.md` plus metadata.
   - Support local skill folders, bundled skills, and imported external skill packs.
   - Add `/skill create`, `/skill test`, `/skill enable`, `/skill disable`, and `/skill explain`.
   - Show why a skill activated in CLI trace and web activity.

2. Add a plugin layer above skills.
   - Define `plugin.json` with commands, tools, skills, permissions, and config schema.
   - Load plugins from `~/.ntox/plugins`, repo-local `.ntox/plugins`, and packaged plugin bundles.
   - Gate plugins through the existing workspace policy system.
   - Surface plugin status in `/status`, `/permissions`, and the web sidebar.

3. Improve the web UI without making it heavy.
   - Add conversation list and rename/delete.
   - Add command palette for `/memory`, `/alive`, `/trace`, `/skill`, and model switching.
   - Add trace drawer for tool calls, policy decisions, context cost, memories, skills, and Alive events.
   - Add settings drawer for model, provider, workspace profile, and UI theme.
   - Keep the first screen as chat, not a dashboard.

4. Strengthen memory and recovery.
   - Continue correction-aware durable memory ranking.
   - Add contradiction review and a small memory diff when a correction rewrites a fact.
   - Turn failed tools into structured recovery objects with root cause, next action, and retry policy.
   - Add user-visible recovery history in `/alive` and the web trace drawer.

5. Prove quality with broader evaluations.
   - Keep the paired DeepSeek Harness eval for memory and correction proof.
   - Add ablation evals for strategy, patterns, memory, theories, mistakes, and full learning.
   - Track task completion, correction recall, tool recovery, leakage, context cost, and answer length.
   - Add a 20+ task mixed benchmark before raising the overall project rating above 8/10.

## Architecture Notes

Skills should remain lightweight instructions that can be activated by semantic match, explicit command, or plugin dependency.

Plugins should be installable capability bundles. A plugin may include skills, tools, gateways, UI panels, scheduled jobs, or provider adapters, but every permission should flow through one policy runtime.

The web UI should not fork the agent. It should continue using the shared gateway and dispatcher path so CLI, web, and messaging gateways all observe the same agent behavior.

## Quality Bar

Before calling a milestone complete:

- Typecheck, lint, build, and root tests pass.
- Gateway-specific tests cover any new web events or commands.
- Any new plugin or skill mechanism has at least one fixture plugin/skill and one failure test.
- Evaluation scripts run in isolated temp directories and do not leak test data through source files.
- UI remains responsive at desktop and mobile widths.

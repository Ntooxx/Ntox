# NTOX Strategic Plan: From Cognitive Prototype to Serious Personal Agent

## Executive Summary

NTOX is currently strongest as a research-flavored personal agent: it has memory, skills, tool use, gateways, traces, theory memory, a cognitive kernel, and meta-cognition. That makes it more interesting than a basic "LLM plus tools" CLI. It is not yet at the product level of mature personal agents such as Hermes or OpenClaw, because reliability, UX polish, integration breadth, and proof of cognitive advantage are still uneven.

The path forward is not to copy competitors feature-for-feature. NTOX should win on a sharper identity:

> A local-first personal agent that becomes visibly better over time because it remembers, tests its beliefs, catches shallow reasoning, and can explain how it made decisions.

To reach that level, NTOX needs five major upgrades:

1. A calmer, higher-quality chat experience.
2. A trustworthy tool and browser layer.
3. Memory that creates visible continuity instead of hidden database activity.
4. Cognitive systems that measurably improve answers and actions.
5. A gateway/integration layer that makes NTOX feel present outside the terminal.

## Current Position

### Rough Score Today

| Dimension | Score | Notes |
|---|---:|---|
| Agent architecture | 7.5/10 | Ambitious loop, skills, memory, policy, traces, cognition. |
| Product UX | 5.5/10 | CLI works, but polish and consistency lag behind the architecture. |
| Tool reliability | 6.5/10 | Good foundations, but browser/search/fetch need hardening and better recoveries. |
| Memory usefulness | 6/10 | Storage/retrieval exists; user-visible payoff is inconsistent. |
| Cognitive differentiation | 7/10 idea, 5.5/10 proof | The concepts are special, but need evaluation and clearer user-facing value. |
| Ecosystem/integrations | 5/10 | Telegram/Discord/Web exist, but not yet a broad assistant surface. |
| Trust/security | 6.5/10 | Policy and validation exist; sandboxing, permissions UX, and secrets handling need continued hardening. |

Overall: **6.5/10 as a usable agent, 7.5/10 as a promising prototype.**

### Strategic Comparison

Hermes appears stronger on polished terminal UX, onboarding, docs, multi-channel assistant feel, and product coherence. OpenClaw appears stronger on ecosystem gravity, local assistant positioning, multi-platform reach, and user adoption. NTOX is strongest where both are easiest to underestimate: introspection, theory formation, mistake memory, false-success detection, and cognitive pattern compilation.

That is the wedge. NTOX should not merely become "another chat-app agent." It should become the agent that users trust for complex work because it can remember, audit itself, revise beliefs, and show its trace.

## Product North Star

NTOX should feel like:

- A serious local agent for builders, researchers, founders, and technical operators.
- Fast enough for everyday chat.
- Careful enough for code, files, web research, and long-running tasks.
- Personally adaptive without becoming noisy or creepy.
- Transparent when it uses tools, memory, or confidence judgments.
- Quiet by default, powerful when inspected.

The most important UX principle:

> Intelligence must become visible as better outcomes, not extra status text.

## Milestone 1: Chat Quality and Terminal Feel

### Goal

Make the CLI feel calm, clean, responsive, and premium. This is the first trust layer. If the chat surface feels buggy, users will not believe the deeper cognition is real.

### Implement

- Remove remaining sound references from docs, config UI, and commands.
- Fix all mojibake and broken terminal characters in docs and CLI output.
- Standardize streaming output so assistant text, tool tags, memory tags, errors, and usage bars never collide.
- Add a single render policy for callback verbosity:
  - Normal mode: only assistant answer plus compact tool state.
  - Verbose mode: memory, theory, confidence, disagreement, style guidance, cognitive trace.
  - Debug mode: raw tool calls, token budgets, retry reasons.
- Add `/ui minimal`, `/ui normal`, `/ui debug`, and persist the setting.
- Improve interrupt behavior:
  - First Ctrl+C cancels current generation.
  - Second Ctrl+C exits.
  - Interrupted turns are marked in trace and not stored as successful memory.
- Add terminal snapshot tests for core render functions.

### What It Brings

- NTOX starts feeling intentional rather than experimental.
- Users can keep the agent open all day without fatigue.
- The cognitive systems can remain available without spraying internal noise into the chat.

### Acceptance Criteria

- No `/sound` command appears in help or README.
- No broken encoded characters appear in `README.md`, `ROADMAP.md`, `AGENTS.md`, or CLI output.
- A normal chat turn produces no more than one compact tool/status line unless verbose mode is enabled.
- Ctrl+C cancellation works without corrupting the next prompt.

## Milestone 2: Browser, Search, and Fetch Reliability

### Goal

Make web work dependable enough that the agent can research, browse modern pages, cite sources, and recover gracefully from failures.

### Implement

- Unify `search`, `web_fetch`, and `browse` behind a shared `web-service.ts`.
- Add a fetch strategy ladder:
  1. Direct fetch with clean headers.
  2. HTML-to-markdown extraction.
  3. Browser-rendered markdown snapshot.
  4. Search fallback when direct URL fails.
- Add source objects with normalized fields:
  - `url`
  - `finalUrl`
  - `title`
  - `contentType`
  - `fetchedAt`
  - `excerpt`
  - `confidence`
  - `method`
- Improve browser installation detection and error messages.
- Add page-level diagnostics:
  - blocked by bot wall
  - timeout
  - no meaningful text
  - private URL blocked
  - unsupported content type
- Add PDF detection and either fail clearly or route to a PDF extractor.
- Add citation discipline to prompts and final answers when web data is used.
- Add tests using local HTTP fixtures for redirects, large responses, HTML extraction, bot-wall-like pages, and private URL blocking.

### What It Brings

- Research answers become more trustworthy.
- NTOX can compete with productized agents on everyday web tasks.
- Tool failures become understandable instead of mysterious.

### Acceptance Criteria

- At least 20 deterministic web fixture tests.
- Browser fallback is automatic when direct fetch returns low-content HTML.
- Every web-derived answer can cite final URLs.
- Browse failures return actionable errors.

## Milestone 3: Memory That Users Can Feel

### Goal

Turn memory from passive retrieval into visible continuity. Users should notice that NTOX remembers projects, preferences, facts, decisions, and unresolved threads.

### Implement

- Split memory into explicit lanes:
  - `facts`: stable user/project facts.
  - `preferences`: communication and workflow preferences.
  - `decisions`: choices made and rationale.
  - `tasks`: open loops and commitments.
  - `episodes`: raw conversational memory.
- Add memory write policy:
  - Store durable facts only when confidence is high.
  - Ask before storing sensitive or ambiguous personal facts.
  - Decay or archive stale memories.
- Add `/remember`, `/forget`, `/memory edit`, and `/memory why <id>`.
- Add memory provenance:
  - when learned
  - from which message
  - confidence
  - last used
  - contradiction count
- Add contradiction detection:
  - "You previously said X, now you seem to prefer Y. Should I update that?"
- Add project briefs:
  - automatically summarize active repo/project context.
  - refresh after meaningful code changes.
  - inject only the relevant brief into context.

### What It Brings

- The agent feels persistent without feeling invasive.
- Long-running work becomes easier because NTOX carries decisions forward.
- Memory becomes inspectable and correctable, which improves trust.

### Acceptance Criteria

- User can inspect why a memory was retrieved.
- User can delete or edit any memory from CLI.
- Contradictory preferences produce an update prompt.
- Project brief injection reduces repeated context gathering on the same repo.

## Milestone 4: Prove the Cognitive Kernel

### Goal

Make NTOX's most unique architecture measurable. The cognitive kernel, theory store, and false-success detector should improve outcomes, not just exist.

### Implement

- Add an evaluation harness with paired runs:
  - baseline agent loop
  - memory only
  - memory plus skills
  - memory plus skills plus cognitive kernel
  - full meta-cognition
- Define benchmark categories:
  - coding task completion
  - debugging accuracy
  - web research fidelity
  - planning quality
  - self-correction after wrong assumptions
  - preference adherence after long context
- Add theory prediction tracking:
  - theory predicts an outcome or useful strategy.
  - later result confirms or contradicts it.
  - confidence updates from prediction error.
- Connect false-success detection to retries and memory:
  - mark shallow answer attempts.
  - avoid storing shallow conclusions as durable facts.
  - decay theories that repeatedly produce shallow answers.
- Add `/cognition eval` to run local benchmark subsets.
- Add `/why` for the last answer:
  - relevant memories
  - active skills
  - theories used
  - tool calls
  - confidence signals

### What It Brings

- NTOX can claim differentiation with evidence.
- The cognitive features become product value, not architecture trivia.
- Users can understand when the agent is reasoning from memory, theory, or live tools.

### Acceptance Criteria

- Benchmark report shows whether cognition improves or hurts each task class.
- Any cognitive feature that consistently hurts is disabled or reworked.
- `/why` explains the last answer without exposing raw prompt clutter.

## Milestone 5: Tool Safety and Autonomy

### Goal

Let NTOX do more real work while reducing the risk of bad tool calls, file damage, prompt injection, or untrusted skill behavior.

### Implement

- Make tool execution policy explicit and inspectable:
  - read-only
  - workspace-write
  - shell-confirm
  - sandboxed-auto
  - unrestricted
- Prefer Docker sandboxing for shell commands when available.
- Add preflight plans for risky operations:
  - file deletion
  - recursive edits
  - package installation
  - network calls to unfamiliar hosts
  - credential or config changes
- Add automatic checkpoints before edits.
- Add `ntox diff` or `/diff` to show changes made in the last turn.
- Add skill permission manifests:
  - tools allowed
  - network allowed
  - filesystem scope
  - confirmation requirements
- Add prompt-injection quarantine for web content:
  - separate fetched content from instructions.
  - strip or label hostile instruction patterns.
  - never let web content alter system/tool policy.

### What It Brings

- Users can grant more autonomy with less anxiety.
- NTOX becomes safer for coding and ops workflows.
- Skills become extensible without becoming a security blind spot.

### Acceptance Criteria

- Risky tool calls show clear approval prompts unless policy allows them.
- `/permissions` fully explains current policy and recent denials.
- `/diff` shows last-turn file changes.
- Web prompt-injection fixtures are blocked or isolated in tests.

## Milestone 6: Multi-Agent Workflows That Matter

### Goal

Move beyond internal "debate" text and use subagents for real parallel work: research, code review, alternative solutions, test generation, and critique.

### Implement

- Give subagents persistent run records:
  - task
  - assigned role
  - tools used
  - output
  - duration
  - success score
  - parent turn
- Add orchestrated workflows:
  - `research`: gather sources, synthesize, critic verifies.
  - `code-review`: reviewer finds issues, implementer patches, tester validates.
  - `design`: proposer creates options, critic evaluates tradeoffs.
  - `debug`: reproducer isolates failure, fixer patches, tester confirms.
- Add winner selection:
  - compare multiple candidate plans or patches.
  - select based on tests, confidence, and critique score.
- Add `/agents inspect <id>` and `/agents compare`.
- Keep concurrency conservative until cost/latency is measured.

### What It Brings

- NTOX becomes meaningfully better on complex tasks.
- The existing orchestrator becomes operational instead of decorative.
- Users get higher-quality work without managing multiple prompts manually.

### Acceptance Criteria

- Multi-agent workflows produce traceable subagent records.
- At least one workflow demonstrably improves benchmark results.
- Failed subagents do not pollute durable memory.

## Milestone 7: Gateway and Presence Layer

### Goal

Make NTOX available where the user already talks, while preserving the same memory, policy, and trace behavior across channels.

### Implement

- Extract message execution from REPL into a shared conversation service.
- Make CLI, Telegram, Discord, and Web UI use the same execution path.
- Add voice handling:
  - incoming Telegram/Discord voice messages through STT.
  - optional spoken summaries through TTS.
  - disabled by default.
- Add Slack or Matrix gateway.
- Add gateway identity and permissions:
  - channel-specific user allowlists.
  - per-channel tool policy.
  - channel-specific output length limits.
- Add cross-channel continuity:
  - user can start in Telegram and continue in CLI.
  - trace includes channel source.

### What It Brings

- NTOX becomes a real assistant, not only a terminal experiment.
- Multi-channel behavior stops feeling bolted on.
- Users can safely expose NTOX to messaging apps without granting every channel full power.

### Acceptance Criteria

- Same prompt through CLI and gateway follows the same core tool/memory policy.
- Voice message round trip works in at least one gateway.
- Channel allowlist tests exist.

## Milestone 8: Web UI as an Inspection Surface

### Goal

Do not make a generic chat dashboard. Build a control room for what makes NTOX special: traces, memory, theories, skills, tool calls, and project context.

### Implement

- Add Web UI panels:
  - chat
  - last trace
  - memory browser
  - theory browser
  - tool timeline
  - workspace permissions
  - subagent runs
- Add read-only mode for remote access.
- Add local auth token mode.
- Add memory edit/delete from UI.
- Add source cards for web research.
- Add project context view for active workspace.

### What It Brings

- NTOX's internals become understandable.
- Users can debug trust issues visually.
- This creates a product advantage over agents that hide their reasoning infrastructure.

### Acceptance Criteria

- Web UI can inspect the last turn without reading logs.
- User can delete a memory from the UI.
- Tool timeline shows status, duration, and errors.

## Milestone 9: Packaging, Onboarding, and Ecosystem

### Goal

Make NTOX easy to install, configure, extend, and trust.

### Implement

- Improve `ntox setup`:
  - provider selection
  - local provider detection
  - gateway token setup
  - browser availability check
  - sandbox availability check
  - first project profile
- Add health checks:
  - `ntox doctor`
  - validates config, provider, browser, sandbox, gateway tokens, permissions.
- Add skill marketplace conventions:
  - trusted bundled skills
  - local skills
  - third-party skills with permission manifests
- Add contributor docs:
  - writing tools
  - writing skills
  - adding gateways
  - adding benchmarks
- Add release process:
  - changelog
  - semantic versioning
  - signed release artifacts if feasible.

### What It Brings

- NTOX becomes approachable for users beyond the original developer.
- Skills and gateways become a real ecosystem surface.
- Support burden drops because `doctor` catches common setup failures.

### Acceptance Criteria

- Fresh install to first successful chat in under five minutes.
- `ntox doctor` catches missing browser, missing provider key, invalid config, and unsafe web binding.
- Third-party skill permissions are visible before activation.

## Milestone 10: Differentiation Features

### Goal

Build features that make NTOX clearly distinct rather than merely comparable.

### Implement

- Living project memory:
  - NTOX maintains an evolving model of the current repo, goals, architecture, tests, risks, and recent decisions.
- Belief ledger:
  - theories and assumptions are tracked, confirmed, contradicted, or retired.
- Personal operating model:
  - NTOX learns how the user likes plans, code reviews, summaries, risk calls, and creative collaboration.
- Self-audit mode:
  - after important work, NTOX audits what changed, what is missing, what is risky, and what tests prove.
- "What changed my mind?" command:
  - shows belief updates caused by new evidence.
- "Run the loop" mode:
  - plan, act, test, critique, revise, summarize.

### What It Brings

- NTOX becomes more than a tool runner.
- Users get the feeling of a collaborator with continuity.
- This is the strongest route to being genuinely special.

### Acceptance Criteria

- NTOX can summarize a project's current state after several sessions.
- NTOX can identify a changed assumption and cite the evidence that changed it.
- Self-audit catches missing tests or risky changes in benchmarked tasks.

## Implementation Order

Recommended order:

1. Chat quality and terminal feel.
2. Browser/search/fetch reliability.
3. Tool safety and autonomy.
4. Memory users can feel.
5. Prove the cognitive kernel.
6. Multi-agent workflows.
7. Gateway and presence layer.
8. Web UI inspection surface.
9. Packaging and ecosystem.
10. Differentiation features.

This order intentionally fixes trust and UX before expanding autonomy. More features on an unreliable surface will make the project feel worse, not better.

## Score Targets

| Stage | Target Score | Meaning |
|---|---:|---|
| Now | 6.5/10 | Powerful prototype, uneven UX. |
| After M1-M2 | 7.2/10 | Feels clean and can research reliably. |
| After M3-M5 | 8/10 | Memory, safety, and cognition produce visible trust. |
| After M6-M7 | 8.5/10 | Real multi-agent workflows and assistant presence. |
| After M8-M10 | 9/10 | Distinctive personal cognitive agent with product polish. |

## Key Risks

- Building too much internal cognition without proving it improves results.
- Letting memory become noisy, stale, or creepy.
- Adding gateways before policy and permissions are clear.
- Making the UI verbose because the architecture is interesting.
- Competing with OpenClaw on ecosystem before NTOX has a sharper niche.
- Treating sandboxing and prompt-injection protection as solved too early.

## Non-Goals

- NTOX should not become a generic clone of Hermes or OpenClaw.
- NTOX should not prioritize a marketing landing page over the working assistant.
- NTOX should not expose autonomous actions broadly before permissioning is understandable.
- NTOX should not keep cognitive features enabled if benchmarks show they hurt.

## The Bet

The bet is that the next generation of personal agents will not win only by having more integrations. They will win by being trustworthy over time: remembering the right things, correcting themselves, explaining their actions, and improving from evidence.

That is where NTOX can be special.

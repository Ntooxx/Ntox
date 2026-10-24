export const PROBES = [
  {
    id: "bandit-guidance-suppressed",
    signal: "learned_guidance_reaches_model",
    file: "src/core/agent.ts",
    match: /strategyPrompt\s*&&\s*!cfg\.cognitiveKernel\.isEnabled\(\)/,
    severity: "P1",
    dimension: "cognition",
    title: "Learned strategy guidance is discarded under the default configuration",
    detail:
      "The Thompson-sampling bandit selects a stance and produces guidance, but the prompt section is only emitted when the cognitive kernel is disabled. Cognition defaults to enabled, so the main behavioural payoff of the bandit never reaches the model.",
    fix:
      "Compose strategy guidance unconditionally, or gate it on the absence of a kernel-produced equivalent. Add a default-config test that asserts the guidance appears.",
  },
  {
    id: "reflection-not-persisted",
    signal: "reflection_persisted",
    file: "src/core/agent.ts",
    match: /if \(reflection && callbacks\.onReflection\) \{?\s*\n?\s*callbacks\.onReflection\(reflection\)/,
    severity: "P2",
    dimension: "cognition",
    title: "Reflection output is delivered to a callback and never stored",
    detail:
      "The reflector makes a real LLM call, then hands the text to a UI callback. Nothing writes it to memory, the mistake journal or the next system prompt, and the feature defaults to off.",
    fix:
      "Persist reflections with a confidence and a decay window, then inject the ones that are still relevant into the next prompt.",
  },
  {
    id: "mcp-bypasses-tool-policy",
    signal: "policy_uniformity",
    file: "src/mcp/bridge.ts",
    match: /this\.registry\.register\(/,
    unless: /enforceToolPolicy/,
    severity: "P1",
    dimension: "security",
    title: "MCP tools bypass the workspace tool policy",
    detail:
      "Built-in tools are wrapped in enforceToolPolicy before registration. MCP tools are registered directly into the same registry, so a configured external server can expose capabilities the active workspace profile denies.",
    fix:
      "Route MCP registrations through the same policy wrapper, using the server name as the policy subject.",
  },
  {
    id: "docker-opt-in-and-soft-fail",
    signal: "sandbox_strength",
    file: "src/tools/shell.ts",
    match: /config\.dockerEnabled \|\| !IS_WINDOWS/,
    severity: "P1",
    dimension: "security",
    title: "Sandboxing is off by default on Windows and silently degrades to host execution",
    detail:
      "Docker is attempted automatically on POSIX but only when explicitly enabled on Windows. If the Docker probe fails the shell falls through to host execution, so the sandbox is a best-effort wrapper rather than a boundary.",
    fix:
      "Make sandbox mode explicit and fail closed when it is requested, or surface the degraded state in /trace and to the user.",
  },
  {
    id: "docker-unhardened",
    signal: "sandbox_strength",
    file: "src/tools/shell.ts",
    match: /docker run --rm -v/,
    unless: /--read-only|--cap-drop|--pids-limit|--memory/,
    severity: "P2",
    dimension: "security",
    title: "Sandbox container has no isolation hardening flags",
    detail:
      "The container runs with the workspace mounted read-write, no user namespace, no capability drop, no readonly root, and no pid or memory limits.",
    fix:
      "Add --cap-drop ALL, --security-opt no-new-privileges, a non-root --user, pids and memory limits, and an explicit writable mount.",
  },
  {
    id: "decision-kernel-requires-slash",
    file: "src/core/agent.ts",
    match: /startsWith\("\/kernel"\)/,
    severity: "P2",
    dimension: "cognition",
    title: "The symbolic decision kernel only runs behind a slash command",
    detail:
      "Goals, subtasks, dependency ordering and the verifier are implemented, but the routing entry point returns null unless the input begins with /kernel. It is a demo surface, not part of the normal agent loop.",
    fix:
      "Promote goal decomposition to a tool the model can call, and verify subtask success predicates automatically.",
  },
  {
    id: "agent-monolith",
    signal: "maintainability",
    file: "src/core/agent.ts",
    match: /class Agent\b/,
    minLines: 1500,
    severity: "P2",
    dimension: "engineering",
    title: "Core agent file has grown into a monolith",
    detail:
      "The main loop, prompt assembly, memory wiring, surprise handling, reflection, tool routing and persistence live in one file above 2,000 lines with a 60KB+ test file beside it.",
    fix:
      "Extract prompt composition, post-turn learning and tool execution into separate modules with explicit interfaces.",
  },
  {
    id: "theory-confirmation-circular",
    signal: "theory_outcome_scoring",
    file: "src/research/theory-store.ts",
    match: /confidence\s*[+=]/,
    severity: "P2",
    dimension: "memory",
    title: "Theory confidence is raised by domain similarity, not task outcome",
    detail:
      "Recent observations in the same domain are treated as confirmation, so a theory can gain confidence without ever predicting anything that was checked. Only false-success detection lowers it.",
    fix:
      "Tie theory confidence to resolved predictions with recorded Brier error, and require an explicit prediction per confirmation.",
  },
  {
    id: "self-awareness-hardcoded-confidence",
    signal: "self_awareness_depth",
    file: "src/core/agent.ts",
    match: /shouldRequestFeedback\(0\.5,/,
    severity: "P3",
    dimension: "cognition",
    title: "Self-awareness asks for feedback on a hardcoded confidence",
    detail:
      "The feedback trigger passes a literal 0.5 instead of the stance calibration the system already computes, so the claim of measured self-knowledge is weaker than advertised.",
    fix:
      "Feed the stance-level calibration and recent Brier error into the feedback trigger.",
  },
];

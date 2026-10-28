/**
 * Phase 3 harness — one agent trial per process (or a mechanical reuse run in mode
 * "reuse"). NTOX_DIR must be set before any NTOX module loads (paths.ts freezes it at
 * import), hence the dynamic imports below.
 *
 * Env contract:
 *   PHASE3_STATE        per-arm state dir (becomes NTOX_DIR — isolation boundary)
 *   PHASE3_WORKSPACE    fresh task workspace
 *   PHASE3_PROMPT       task prompt ({workspace} already substituted; trial mode only)
 *   PHASE3_OUT          output JSON path
 *   PHASE3_TIMEOUT_MS   trial timeout
 *   PHASE3_TASK_ID      audit id
 *   PHASE3_PROCEDURE    optional path to procedure JSON (arm C injection / reuse target)
 *   PHASE3_MODE         "trial" (default) | "reuse" (mechanical attemptReuse, no agent)
 *   PHASE3_BINDINGS     path to bindings JSON (reuse mode)
 *   PHASE3_MEMORY       "off" disables the memory surface (C-only phases must not
 *                       touch episodic state — arm comparability)
 */
const state = process.env.PHASE3_STATE;
const workspace = process.env.PHASE3_WORKSPACE;
const prompt = process.env.PHASE3_PROMPT;
const outPath = process.env.PHASE3_OUT;
const timeoutMs = Number(process.env.PHASE3_TIMEOUT_MS ?? "120000");
const taskId = process.env.PHASE3_TASK_ID ?? "unknown";
const procedurePath = process.env.PHASE3_PROCEDURE;
const mode = process.env.PHASE3_MODE ?? "trial";
const bindingsPath = process.env.PHASE3_BINDINGS;
const memoryOff = process.env.PHASE3_MEMORY === "off";

if (!state || !workspace || !outPath || (mode === "trial" && !prompt)) {
  console.error("missing PHASE3_STATE / PHASE3_WORKSPACE / PHASE3_OUT / (PHASE3_PROMPT in trial mode)");
  process.exit(2);
}

// isolation FIRST — everything below sees NTOX_DIR = the per-arm state dir
process.env.NTOX_DIR = state;

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Tool, ToolResult, WorkspaceProfile } from "../../../src/types/index.js";
import type { ProcedureExecutor } from "../../../src/memory/applicability.js";
import type { StoredProcedure } from "../../../src/memory/procedure-store.js";

const { loadConfig, MEMORY_DIR } = await import("../../../src/core/config.js");
const { createSharedInfra, createSessionInfra, createAgentConfig } = await import("../../../src/core/dispatcher.js");
const { Agent } = await import("../../../src/core/agent.js");
const { enforceToolPolicy } = await import("../../../src/core/policy.js");
const { checkApplicability } = await import("../../../src/memory/applicability.js");
const { attemptReuse, renderProcedureForPrompt } = await import("../../../src/memory/procedure-reuse.js");
const { currentVersionOf } = await import("../../../src/memory/procedure-store.js");

// Copied config carries the SOURCE install's memory path in its systemPrompt — re-point
// it at this state dir (same normalization as the arena adapter).
function normalizeMemoryPromptPath(systemPrompt: string): string {
  return systemPrompt.replace(
    /A memory file at \S+ contains summaries/,
    `A memory file at ${join(MEMORY_DIR, "memory.md")} contains summaries`,
  );
}

const baseConfig = loadConfig();
const config = {
  ...baseConfig,
  systemPrompt: normalizeMemoryPromptPath(baseConfig.systemPrompt),
  // Arm-comparability control: C-only phases must never read or write episodic state.
  ...(memoryOff ? { memoryEnabled: false } : {}),
};

const baseProfile = config.profiles.find((p) => p.id === config.defaultProfileId) ?? config.profiles[0];
const profile: WorkspaceProfile = {
  ...baseProfile,
  id: "phase3-trial",
  name: "Phase 3 Trial Workspace",
  workspaceRoot: workspace,
  readRoots: [workspace],
  writeRoots: [workspace],
  // Identical across arms (protocol.frozenKnobs.shellPolicy): workspace-confined shell.
  shellPolicy: "workspace",
  allowedTools: [],
};

const infra = createSharedInfra(config, profile);
const session = createSessionInfra(infra, config);
const agentConfig = createAgentConfig({ ...infra, ...session }, config, `phase3-${taskId}`);
const agent = new Agent(agentConfig);

// Policy-enforced executor: every applicability probe and any mechanical step goes
// through the SAME tool policy the agent faces (rule §5.2). Each call is entered in the
// ledger with the policy decisions it produced — the policy-bypass metric is derived
// from these real events (reviewer blocker 2).
const callLedger: { tool: string; success: boolean; decisions: { allowed?: boolean }[] }[] = [];
const executor: ProcedureExecutor = async (toolName: string, args: Record<string, unknown>): Promise<ToolResult> => {
  const tool: Tool | undefined = infra.tools.get(toolName);
  if (!tool) {
    callLedger.push({ tool: toolName, success: false, decisions: [] });
    return { success: false, error: `unknown tool ${toolName}` };
  }
  const before = infra.policy.decisions.length;
  try {
    const result = await enforceToolPolicy(tool, infra.policy).execute(args);
    callLedger.push({
      tool: toolName,
      success: result.success,
      decisions: infra.policy.decisions.slice(before).map((d) => ({ allowed: d.allowed })),
    });
    return result;
  } catch (error) {
    callLedger.push({
      tool: toolName,
      success: false,
      decisions: infra.policy.decisions.slice(before).map((d) => ({ allowed: d.allowed })),
    });
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};

/* ---------------- mode "reuse": mechanical execution of the candidate's steps ---------------- */
if (mode === "reuse") {
  if (!procedurePath || !bindingsPath) {
    console.error("reuse mode requires PHASE3_PROCEDURE and PHASE3_BINDINGS");
    process.exit(2);
  }
  const procedure = JSON.parse(readFileSync(procedurePath, "utf-8")) as StoredProcedure;
  const bindings = JSON.parse(readFileSync(bindingsPath, "utf-8")) as Record<string, string>;
  const reuse = await attemptReuse(procedure, {
    executor,
    taskId,
    scope: workspace,
    bindings,
  });
  mkdirSync(join(outPath, ".."), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        taskId,
        mode,
        reuse: {
          outcome: reuse.outcome,
          detail: reuse.detail,
          applicability: reuse.applicability,
          steps: reuse.steps,
        },
        bindings,
        callLedger,
        policyDecisions: infra.policy.decisions,
      },
      null,
      1,
    ),
  );
  process.exit(0);
}

let finalPrompt = prompt;
let procedureInfo: Record<string, unknown> | null = null;

if (procedurePath) {
  const procedure = JSON.parse(readFileSync(procedurePath, "utf-8")) as StoredProcedure;
  const applicability = await checkApplicability(procedure, executor, { scope: workspace });
  const injected = applicability.applicable;
  if (injected) {
    finalPrompt = `${prompt}\n\n${renderProcedureForPrompt(procedure)}`;
  }
  const version = currentVersionOf(procedure);
  procedureInfo = {
    procedureId: procedure.id,
    procedureState: procedure.state,
    procedureVersion: version.version,
    injected,
    applicability,
  };
}

let response = "";
let toolCalls = 0;
let llmCalls = 0;
let inputTokens = 0;
let cachedTokens = 0;
let outputTokens = 0;
let costUsd = 0;

const controller = new AbortController();
const startedAt = Date.now();
let timedOut = false;
let failure: string | undefined;
const timer = setTimeout(() => {
  timedOut = true;
  controller.abort();
}, timeoutMs);

try {
  const stream = agent.run(
    finalPrompt,
    {
      onToken: (token: string) => {
        response += token;
      },
      onToolCall: () => {
        toolCalls += 1;
      },
      onToolResult: () => {},
      onUsage: (usage: { inputTokens: number; outputTokens: number; cachedTokens?: number; cost: number }) => {
        llmCalls += 1;
        inputTokens += usage.inputTokens;
        outputTokens += usage.outputTokens;
        cachedTokens += usage.cachedTokens ?? 0;
        costUsd += usage.cost;
      },
      onThinking: () => {},
    },
    { signal: controller.signal },
  );
  for await (const _chunk of stream) {
    /* drain */
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  clearTimeout(timer);
}

mkdirSync(join(outPath, ".."), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify(
    {
      taskId,
      mode,
      response: response.trim(),
      usage: {
        inputTokens,
        outputTokens,
        cachedTokens,
        costUsd,
        durationMs: Date.now() - startedAt,
        llmCalls,
        toolCalls,
      },
      // Reviewer requirement 3: every policy decision of the trial.
      policyDecisions: infra.policy.decisions,
      // Reviewer blocker 2: per-call policy evidence for the bypass metric.
      callLedger,
      procedure: procedureInfo,
      error: timedOut ? `timeout after ${timeoutMs}ms` : failure,
    },
    null,
    1,
  ),
);
process.exit(0);

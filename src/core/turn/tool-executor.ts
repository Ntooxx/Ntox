import type { Message, ToolResult, ToolCall, ToolContext, AgentTurnTrace, AgentToolTrace } from "../../types/index.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type { Analytics } from "../../meta/analytics.js";
import type { NtoxCognitiveLayer } from "../../cognition/layer.js";
import type { Mind } from "../../mind/mind.js";
import type { MindTurnHandle } from "../../mind/types.js";
import type { AgentCallbacks } from "../agent.js";
import { createUntrustedWrapper, detectToolCallInjection, markToolOutput } from "../injection-defenses.js";
import {
  TOOL_CONCURRENCY,
  MAX_TOOL_CALLS_PER_TURN,
  MAX_WEB_TOOL_CALLS_PER_TURN,
  WEB_TOOL_NAMES,
  unfinishedPlanTasks,
  collectTurnFailures,
} from "./turn-helpers.js";

export interface ToolCallBudget {
  total: number;
  web: number;
}

export interface RepeatWatch {
  names: string | null;
  tokens: Set<string> | null;
  strikes: number;
  notifiedAt: number;
}

export const REPEAT_SIMILARITY_THRESHOLD = 0.6;
export const REPEAT_STRIKES_BEFORE_NUDGE = 3;
export const REPEAT_MIN_TOKENS = 4;

export function resultTokens(content: string): Set<string> {
  const tokens = content
    .toLowerCase()
    .replace(/\d+/g, " ")
    .split(/[^a-z]+/)
    .filter((token) => token.length >= 3);
  return new Set(tokens);
}

export function toolResultSignature(result: ToolResult): string {
  if (typeof result.data === "string") return result.data;
  if (result.data !== undefined && result.data !== null) return JSON.stringify(result.data);
  return result.error ?? "";
}

export function tokenSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}

export interface PreparedToolCall {
  tc: ToolCall;
  args: Record<string, unknown>;
  key: string;
  trace: AgentToolTrace | null;
  duplicate: boolean;
  skipReason?: string;
  durationMs?: number;
}

export interface ToolExecContext {
  tools: ToolRegistry;
  analytics: Analytics;
  sessionId: string;
  currentTrace: AgentTurnTrace | null;
  toolUsageThisSession: Record<string, number>;
  cognitiveLayer: NtoxCognitiveLayer;
  runTurnId: string;
  mind?: Mind;
  mindTurn: MindTurnHandle | null;
  toolFailureThisTurn: boolean;
  sanitizeTraceArgs: (args: Record<string, unknown>) => Record<string, unknown>;
  pushMessage: (msg: Message) => void;
  recordAliveToolOutcome: (
    toolName: string,
    result: ToolResult,
    args: Record<string, unknown>,
    durationMs: number | undefined,
    callbacks: AgentCallbacks,
  ) => void;
}

export function stableToolKey(name: string, args: Record<string, unknown>): string {
  const ordered = Object.keys(args)
    .sort()
    .reduce(
      (acc, key) => {
        const value = args[key];
        acc[key] = typeof value === "string" && value.length > 500 ? value.slice(0, 500) : value;
        return acc;
      },
      {} as Record<string, unknown>,
    );
  return `${name}:${JSON.stringify(ordered)}`;
}

export function extractAutoCheckpointId(result: ToolResult): string | undefined {
  const data = result.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const id = (data as { autoCheckpointId?: unknown }).autoCheckpointId;
  return typeof id === "string" && id ? id : undefined;
}

export function buildTurnLimitNotice(ctx: ToolExecContext, sessionId: string): string {
  const tasks = unfinishedPlanTasks(sessionId);
  const failures = collectTurnFailures(ctx.currentTrace);
  const parts: string[] = [];
  if (tasks.length > 0) {
    const taskList = tasks
      .slice(0, 5)
      .map((task) => `${task.id} ${task.title}`)
      .join("; ");
    parts.push(`the plan is unfinished (${taskList})`);
  }
  if (failures.length > 0) {
    const failureList = failures
      .slice(0, 3)
      .map((failure) => `${failure.name} — ${failure.error.slice(0, 160)}`)
      .join("; ");
    parts.push(`some calls failed (${failureList})`);
  }
  if (parts.length === 0) {
    return `\n\n[Note: I hit this turn's work limit. Say "continue" to resume where I left off.]`;
  }
  return `\n\n[Note: I stopped at this turn's work limit with ${parts.join(" and ")}. Say "continue" to resume.]`;
}

export async function executeToolBatch(
  ctx: ToolExecContext,
  toolCalls: ToolCall[],
  toolContext: ToolContext,
  failedToolCalls: Map<string, string>,
  callbacks: AgentCallbacks,
  budget: ToolCallBudget,
  repeatWatch: RepeatWatch,
): Promise<void> {
  const prepared: PreparedToolCall[] = toolCalls.map((tc) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.arguments || "{}");
    } catch {
      /* keep empty args */
    }
    const key = stableToolKey(tc.name, args);
    let trace: AgentToolTrace | null = null;
    if (ctx.currentTrace) {
      trace = { name: tc.name, args: ctx.sanitizeTraceArgs(args) };
      ctx.currentTrace.toolCalls.push(trace);
    }
    return { tc, args, key, trace, duplicate: false };
  });

  for (const item of prepared) {
    const priorFailure = failedToolCalls.get(item.key);
    if (priorFailure) item.skipReason = priorFailure;
    if (item.skipReason) continue;
    if (budget.total >= MAX_TOOL_CALLS_PER_TURN) {
      item.skipReason = `turn limit of ${MAX_TOOL_CALLS_PER_TURN} tool calls reached`;
      continue;
    }
    if (WEB_TOOL_NAMES.has(item.tc.name) && budget.web >= MAX_WEB_TOOL_CALLS_PER_TURN) {
      item.skipReason = `turn limit of ${MAX_WEB_TOOL_CALLS_PER_TURN} web calls reached`;
      continue;
    }
    budget.total++;
    if (WEB_TOOL_NAMES.has(item.tc.name)) budget.web++;
  }

  for (const item of prepared) {
    callbacks.onToolCall(item.tc.name, item.args);
    ctx.analytics.trackToolCall(item.tc.name);
    ctx.toolUsageThisSession[item.tc.name] = (ctx.toolUsageThisSession[item.tc.name] || 0) + 1;
  }

  const groups: PreparedToolCall[][] = [];
  let parallelGroup: PreparedToolCall[] = [];
  let groupSeen = new Set<string>();
  for (const item of prepared) {
    const tool = ctx.tools.get(item.tc.name);
    if (tool?.parallelSafe === true && !item.skipReason) {
      if (groupSeen.has(item.key)) {
        item.duplicate = true;
      } else {
        groupSeen.add(item.key);
      }
      parallelGroup.push(item);
      continue;
    }
    if (parallelGroup.length > 0) {
      groups.push(parallelGroup);
      parallelGroup = [];
      groupSeen = new Set<string>();
    }
    groups.push([item]);
  }
  if (parallelGroup.length > 0) groups.push(parallelGroup);

  const batchTokens = new Set<string>();
  for (const group of groups) {
    for (const content of await runToolGroup(ctx, group, toolContext, failedToolCalls, callbacks)) {
      for (const token of resultTokens(content)) batchTokens.add(token);
    }
  }
  trackRepeatBatch(repeatWatch, prepared, batchTokens);
}

export function trackRepeatBatch(watch: RepeatWatch, prepared: PreparedToolCall[], batchTokens: Set<string>): void {
  const names = [...new Set(prepared.filter((item) => !item.skipReason && !item.duplicate).map((item) => item.tc.name))]
    .sort()
    .join(",");

  if (!names || batchTokens.size < REPEAT_MIN_TOKENS) {
    watch.names = null;
    watch.tokens = null;
    watch.strikes = 0;
    return;
  }

  const similar =
    watch.names === names &&
    watch.tokens !== null &&
    tokenSimilarity(watch.tokens, batchTokens) >= REPEAT_SIMILARITY_THRESHOLD;
  watch.names = names;
  watch.tokens = batchTokens;
  watch.strikes = similar ? watch.strikes + 1 : 0;
  if (!similar) return;

  for (const item of prepared) {
    if (item.trace && !item.skipReason && !item.duplicate) item.trace.reason = "repeat-detected";
  }
}

export async function runToolGroup(
  ctx: ToolExecContext,
  group: PreparedToolCall[],
  toolContext: ToolContext,
  failedToolCalls: Map<string, string>,
  callbacks: AgentCallbacks,
): Promise<string[]> {
  const results: ToolResult[] = new Array(group.length);
  const untrusted = createUntrustedWrapper();
  let cursor = 0;
  const workerCount = Math.min(TOOL_CONCURRENCY, group.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= group.length) return;
      const item = group[index];
      const skipReason = item.skipReason ?? (item.duplicate ? "duplicate in batch" : undefined);
      if (skipReason) {
        const error =
          skipReason === "duplicate in batch"
            ? "Duplicate tool call in the same batch skipped."
            : skipReason.includes("limit")
              ? `Tool call skipped: ${skipReason}`
              : `Repeated failed tool call skipped: ${skipReason}`;
        results[index] = {
          success: false,
          error,
          data: {
            guidance: skipReason.includes("limit")
              ? "Stop requesting tools and answer using the evidence already available. State remaining uncertainty."
              : "Change the arguments, choose another tool, or answer without retrying the same failed call.",
          },
        };
        continue;
      }
      const tool = ctx.tools.get(item.tc.name);
      if (!tool) {
        results[index] = { success: false, error: `Unknown tool: ${item.tc.name}` };
        continue;
      }
      const startedAt = Date.now();
      try {
        results[index] = detectToolCallInjection(item.args)
          ? { success: false, error: "POLICY_DENIED: injected instruction detected in tool arguments" }
          : await tool.execute(item.args, toolContext);
      } catch (e) {
        results[index] = { success: false, error: e instanceof Error ? e.message : String(e) };
      }
      item.durationMs = Date.now() - startedAt;
    }
  });
  await Promise.all(workers);

  const contents: string[] = [];
  for (let i = 0; i < group.length; i++) {
    const item = group[i];
    const skipReason = item.skipReason ?? (item.duplicate ? "duplicate in batch" : undefined);
    const result = results[i] ?? { success: false, error: "Tool call produced no result" };
    if (item.trace) {
      item.trace.success = result.success;
      if (result.error) item.trace.error = result.error;
      item.trace.durationMs = item.durationMs;
      item.trace.autoCheckpointId = extractAutoCheckpointId(result);
      if (skipReason) item.trace.reason = "repeat-skipped";
    }
    if (!result.success) ctx.toolFailureThisTurn = true;
    if (ctx.mind && ctx.mindTurn) {
      ctx.mind.recordTool(ctx.mindTurn, {
        name: item.tc.name,
        success: result.success,
        durationMs: item.durationMs,
        argsHash: item.key,
      });
    }
    if (!result.success && !skipReason) failedToolCalls.set(item.key, result.error || "failed");
    const resultContent = compressToolResult(result);
    if (!skipReason) contents.push(toolResultSignature(result));
    if (ctx.currentTrace?.contextBudget) {
      const tokens = Math.ceil(resultContent.length / 4);
      ctx.currentTrace.contextBudget.toolResults += tokens;
      ctx.currentTrace.contextBudget.total += tokens;
    }
    callbacks.onToolResult(item.tc.name, result, item.args);
    ctx.recordAliveToolOutcome(item.tc.name, result, item.args, item.durationMs, callbacks);
    try {
      await ctx.cognitiveLayer.afterTool({
        sessionId: ctx.sessionId,
        turnId: ctx.runTurnId,
        toolName: item.tc.name,
        success: result.success,
        error: result.error,
        durationMs: item.durationMs,
      });
    } catch {
      /* best effort */
    }
    ctx.pushMessage({
      role: "tool",
      tool_call_id: item.tc.id,
      content: markToolOutput(item.tc.name, resultContent, untrusted),
    });
  }
  return contents;
}

export function compressToolResult(result: ToolResult): string {
  if (
    !result.success &&
    result.error &&
    /ParserError|CommandNotFoundException|Unix-style command|looks like code|malformed tool XML/i.test(result.error)
  ) {
    return JSON.stringify({
      success: false,
      error: result.error.split("\n")[0].slice(0, 300),
      guidance:
        "Do not retry the same shell command. If the user asked for code, answer in chat without tools. On Windows use PowerShell syntax.",
    });
  }
  const json = JSON.stringify(result);
  if (json.length <= 12_000) return json;
  const head = json.slice(0, 8_000);
  const tail = json.slice(-2_000);
  return JSON.stringify({
    success: result.success,
    data: `${head}\n\n... tool result compressed (${json.length} chars) ...\n\n${tail}`,
    error: result.error,
  });
}

import type { Tool } from "../types/index.js";
import { Agent } from "../core/agent.js";
import { createAgentConfig, createSessionInfra, createSharedInfra } from "../core/dispatcher.js";
import { getBaseDir, loadConfig } from "../core/config.js";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SUBAGENT_TIMEOUT = 120_000;
const MAX_CONCURRENT = 3;
const MAX_RESULT = 20_000;

export type SubagentStatus = "queued" | "running" | "succeeded" | "failed" | "timed_out" | "cancelled";
export type SubagentRole = "general" | "researcher" | "implementer" | "verifier";

export interface SubagentVerdict {
  outcome: "pass" | "fail" | "uncertain";
  findings: string[];
}

export interface SubagentRun {
  id: string;
  task: string;
  tools: string[];
  status: SubagentStatus;
  sessionId: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  resultSummary?: string;
  result?: string;
  error?: string;
  fitness: number;
  role?: SubagentRole;
  queuedAt?: number;
  verdict?: SubagentVerdict;
  artifact?: unknown;
}

interface SubagentRequest {
  task: string;
  tools: string[];
  role: SubagentRole;
  context?: string;
  output: "text" | "json";
}

interface ActiveSubagent {
  run: SubagentRun;
  controller: AbortController;
  promise: Promise<SubagentRun>;
}

interface PendingSubagent extends ActiveSubagent {
  request: SubagentRequest;
  resolve: (run: SubagentRun) => void;
  reject: (error: Error) => void;
}

let activeCount = 0;
const activeRuns = new Map<string, ActiveSubagent>();
const pending: PendingSubagent[] = [];

const ROLE_PROMPTS: Record<SubagentRole, string> = {
  general: "You are a focused subagent. Complete only the assigned task and return the result directly.",
  researcher:
    "You are a research subagent. Gather evidence from primary sources, separate verified facts from leads, and return concise findings with sources. Do not edit files.",
  implementer:
    "You are an implementation subagent. Work only on the files you own, make minimal changes, and report exactly what you changed and what you verified.",
  verifier:
    "You are a verification subagent. Do not modify any file. Challenge the result, look for missing cases and unsupported claims, then end your reply with exactly:\nVERDICT: PASS | FAIL | UNCERTAIN\nFINDINGS:\n- one concrete finding per line",
};

export interface DecompositionAssessment {
  recommendation: "direct" | "parallel";
  reasons: string[];
  suggestedRoles: SubagentRole[];
  checklist: string[];
}

export function assessDecomposition(task: string, tools: string[] = []): DecompositionAssessment {
  const normalized = task.toLowerCase().trim();
  const reasons: string[] = [];
  const items = (task.match(/^\s*(?:[-*]|\d+[.)])\s+/gm) ?? []).length;
  const joiner = /\b(?:and then|respectively|in parallel|separately|each of)\b/.test(normalized);
  const mutating = tools.filter((tool) => ["write", "edit", "shell"].includes(tool));
  const monolithic =
    /\b(?:single|one|whole|entire|complete)\b/.test(normalized) &&
    /\b(?:file|page|document|artifact|draft|feature)\b/.test(normalized);

  if (task.trim().length < 80) reasons.push("task is too small to decompose without overhead");
  if (monolithic) reasons.push("one coherent artifact needs a single context");
  if (mutating.length > 1 && !joiner) reasons.push("multiple mutating tools share state that must stay serial");
  if (items >= 2 || joiner) reasons.push("independent workstreams are explicitly present");

  const parallel = (items >= 2 || joiner) && !monolithic;
  const recommendation: "direct" | "parallel" = parallel ? "parallel" : "direct";
  const suggestedRoles: SubagentRole[] = parallel
    ? mutating.length
      ? ["researcher", "implementer", "verifier"]
      : ["researcher", "verifier"]
    : [];

  return {
    recommendation,
    reasons,
    suggestedRoles,
    checklist: parallel
      ? [
          "give each subagent a disjoint output and explicit ownership",
          "pass distilled parent context, not the raw history",
          "run a verifier subagent on the merged result",
        ]
      : ["do the work in the parent context", "optionally run one verifier on the finished result"],
  };
}

export function buildSubagentTask(task: string, context?: string): string {
  const clean = context?.trim();
  return clean ? `Context from parent (authoritative, do not re-derive):\n${clean}\n\nTask:\n${task}` : task;
}

export function parseVerdict(text: string): SubagentVerdict | undefined {
  const match = /VERDICT:\s*(PASS|FAIL|UNCERTAIN)/i.exec(text);
  if (!match) return undefined;
  const outcome = match[1].toLowerCase() as SubagentVerdict["outcome"];
  const findings = text
    .slice(match.index + match[0].length)
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter((line) => line.length > 0 && !/^FINDINGS:/i.test(line))
    .slice(0, 20);
  return { outcome, findings };
}

export function parseStructuredOutput(text: string): unknown | undefined {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    return undefined;
  }
}

function parseTools(value: unknown): string[] {
  if (Array.isArray(value))
    return value
      .map(String)
      .map((tool) => tool.trim())
      .filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((tool) => tool.trim())
      .filter(Boolean);
  }
  return [];
}

function parseRole(value: unknown): SubagentRole {
  return value === "researcher" || value === "implementer" || value === "verifier" ? value : "general";
}

function parseOutput(value: unknown): "text" | "json" {
  return value === "json" ? "json" : "text";
}

function runsPath(): string {
  return join(getBaseDir(), "subagent-runs.json");
}

function loadRuns(): SubagentRun[] {
  const path = runsPath();
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SubagentRun[];
  } catch {
    return [];
  }
}

function saveRuns(runs: SubagentRun[]): void {
  const dir = getBaseDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(runsPath(), JSON.stringify(runs.slice(-200), null, 2));
}

function upsertRun(run: SubagentRun): void {
  const runs = loadRuns();
  const idx = runs.findIndex((item) => item.id === run.id);
  if (idx >= 0) runs[idx] = run;
  else runs.push(run);
  saveRuns(runs);
}

export function getSubagentRuns(limit = 20): SubagentRun[] {
  reconcileStaleRuns();
  return loadRuns()
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit);
}

export function getQueueSnapshot(): { active: number; capacity: number; queued: number } {
  return { active: activeCount, capacity: MAX_CONCURRENT, queued: pending.length };
}

let reconciled = false;

function reconcileStaleRuns(): void {
  if (reconciled) return;
  reconciled = true;
  const runs = loadRuns();
  let changed = false;
  for (const run of runs) {
    if (run.status !== "running" && run.status !== "queued") continue;
    run.status = "failed";
    run.error = "Subagent interrupted before completion";
    run.completedAt = run.completedAt ?? Date.now();
    run.durationMs = run.completedAt - run.startedAt;
    run.fitness = 0;
    changed = true;
  }
  if (changed) saveRuns(runs);
}

export function getActiveSubagentCount(): number {
  return activeCount;
}

function summarizeRun(run: SubagentRun) {
  return {
    id: run.id,
    task: run.task.slice(0, 300),
    tools: run.tools,
    status: run.status,
    sessionId: run.sessionId,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
    resultSummary: run.resultSummary,
    error: run.error,
    fitness: run.fitness,
    role: run.role,
    queuedAt: run.queuedAt,
    verdict: run.verdict,
  };
}

function finalize(run: SubagentRun, status: SubagentStatus, error?: string): void {
  run.status = status;
  run.completedAt = Date.now();
  run.durationMs = run.completedAt - run.startedAt;
  run.error = error;
  run.fitness = status === "succeeded" ? (run.result && run.result.length > 0 ? 0.7 : 0.2) : 0;
  upsertRun(run);
}

function makeRun(request: SubagentRequest): SubagentRun {
  return {
    id: `run_${randomUUID().slice(0, 8)}`,
    task: request.task,
    tools: request.tools,
    status: "queued",
    sessionId: `subagent-${randomUUID().slice(0, 8)}`,
    startedAt: Date.now(),
    fitness: 0,
    role: request.role,
  };
}

function launch(run: SubagentRun, request: SubagentRequest): ActiveSubagent {
  run.status = "running";
  upsertRun(run);
  activeCount++;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SUBAGENT_TIMEOUT);
  if (typeof timer.unref === "function") timer.unref();

  const promise = Promise.resolve().then(async (): Promise<SubagentRun> => {
    try {
      const config = loadConfig();
      const shared = createSharedInfra(config);
      const session = createSessionInfra(shared, config);

      if (request.tools.length > 0) {
        const { ToolRegistry } = await import("../tools/registry.js");
        const filtered = new ToolRegistry();
        for (const name of request.tools) {
          const tool = shared.tools.get(name);
          if (tool) filtered.register(tool);
        }
        shared.tools = filtered;
      }

      const roleNote = ROLE_PROMPTS[request.role];
      const outputNote =
        request.output === "json" ? "\n\nReturn one JSON object only, with no prose or code fences." : "";
      const agentConfig = createAgentConfig({ ...shared, ...session }, config, run.sessionId, {
        skipReflection: true,
        memoryEnabled: false,
        strategyEnabled: false,
        mistakesEnabled: false,
        sessionSource: "subagent",
        systemPrompt: `${config.systemPrompt}\n\n${roleNote}${outputNote}`,
      });

      const agent = new Agent(agentConfig);
      let response = "";
      const stream = agent.run(
        buildSubagentTask(request.task, request.context),
        {
          onToken: (token) => {
            response += token;
          },
          onToolCall: () => {},
          onToolResult: () => {},
          onUsage: () => {},
          onThinking: () => {},
        },
        { signal: controller.signal },
      );
      for await (const _ of stream) {
        /* drain */
      }

      if (controller.signal.aborted) throw new Error("Subagent cancelled");
      const result = response.trim();
      run.result = result.slice(0, MAX_RESULT);
      run.resultSummary = result.replace(/\s+/g, " ").slice(0, 500);
      if (request.output === "json") {
        const artifact = parseStructuredOutput(result);
        if (artifact === undefined) {
          finalize(run, "failed", "Subagent returned invalid JSON");
          return run;
        }
        run.artifact = artifact;
      }
      if (request.role === "verifier") {
        const verdict = parseVerdict(result);
        if (verdict) run.verdict = verdict;
      }
      finalize(run, "succeeded");
      return run;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const status = timedOut ? "timed_out" : controller.signal.aborted ? "cancelled" : "failed";
      const error =
        status === "timed_out"
          ? `Subagent timed out after ${SUBAGENT_TIMEOUT / 1000}s`
          : status === "cancelled"
            ? "Subagent cancelled"
            : message;
      finalize(run, status, error);
      return run;
    } finally {
      clearTimeout(timer);
      activeCount--;
      activeRuns.delete(run.id);
      drainQueue();
    }
  });

  const active: ActiveSubagent = { run, controller, promise };
  activeRuns.set(run.id, active);
  return active;
}

function drainQueue(): void {
  while (activeCount < MAX_CONCURRENT && pending.length > 0) {
    const next = pending.shift()!;
    if (next.controller.signal.aborted) {
      finalize(next.run, "cancelled", "Subagent cancelled");
      activeRuns.delete(next.run.id);
      next.resolve(next.run);
      continue;
    }
    const active = launch(next.run, next.request);
    activeRuns.set(next.run.id, { ...next, promise: active.promise });
    active.promise.then(next.resolve, next.reject);
  }
}

function enqueue(request: SubagentRequest): ActiveSubagent {
  const run = makeRun(request);
  if (activeCount < MAX_CONCURRENT && pending.length === 0) return launch(run, request);

  run.queuedAt = Date.now();
  upsertRun(run);
  let resolve!: (value: SubagentRun) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<SubagentRun>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const controller = new AbortController();
  const entry: PendingSubagent = { run, request, controller, promise, resolve, reject };
  pending.push(entry);
  activeRuns.set(run.id, entry);
  return entry;
}

function cancelRun(runId: string): { success: boolean; error?: string } {
  const idx = pending.findIndex((entry) => entry.run.id === runId);
  if (idx >= 0) {
    const [entry] = pending.splice(idx, 1);
    entry.controller.abort();
    finalize(entry.run, "cancelled", "Subagent cancelled");
    activeRuns.delete(runId);
    entry.resolve(entry.run);
    return { success: true };
  }
  const active = activeRuns.get(runId);
  if (!active) return { success: false, error: `Subagent run not found: ${runId}` };
  active.controller.abort();
  return { success: true };
}

export const subagentTool: Tool = {
  name: "subagent",
  description:
    "Run isolated subagents with their own message history and a filtered tool set. Call action plan first to decide whether parallelism is worth it, then run to block until done, spawn to queue a run and poll with status, cancel to stop one, and list to inspect recent runs. Pass context with distilled parent state and role to specialise work; use verifier for independent review of a finished result. Never use subagents for work that needs the parent's live context.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["plan", "run", "spawn", "status", "cancel", "list"],
        description: "run (default, blocking), plan (no spawn), spawn (async/queued), status, cancel, or list",
      },
      task: { type: "string", description: "Task description or prompt for the subagent" },
      context: { type: "string", description: "Distilled parent context the subagent should treat as authoritative" },
      role: {
        type: "string",
        enum: ["general", "researcher", "implementer", "verifier"],
        description: "Specialisation; verifier returns a structured PASS/FAIL/UNCERTAIN verdict",
      },
      output: {
        type: "string",
        enum: ["text", "json"],
        description: "json requires the subagent to return a single JSON object, exposed as a parsed artifact",
      },
      tools: {
        type: "string",
        description: "Comma-separated list of tool names the subagent can use (default: all available tools)",
      },
      runId: { type: "string", description: "Run id for status or cancel" },
    },
    required: [],
  },
  async execute(args) {
    reconcileStaleRuns();
    const action = String(args.action || "run");

    if (action === "list") {
      const runs = getSubagentRuns(20).map(summarizeRun);
      const active = [...activeRuns.values()].map((item) => item.run);
      return {
        success: true,
        data: { runs, activeCount, active: active.map((run) => run.id), queue: getQueueSnapshot() },
      };
    }

    if (action === "status") {
      const runId = String(args.runId || "");
      if (!runId) {
        return {
          success: true,
          data: { runs: getSubagentRuns(20).map(summarizeRun), activeCount, queue: getQueueSnapshot() },
        };
      }
      const live = activeRuns.get(runId)?.run;
      const stored = live || loadRuns().find((item) => item.id === runId);
      if (!stored) return { success: false, error: `Subagent run not found: ${runId}` };
      const queuePosition = pending.findIndex((entry) => entry.run.id === runId) + 1;
      return { success: true, data: { run: stored, active: activeRuns.has(runId), queuePosition } };
    }

    if (action === "cancel") {
      const runId = String(args.runId || "");
      if (!runId) return { success: false, error: "runId is required for cancel" };
      if (!activeRuns.has(runId)) {
        const stored = loadRuns().find((item) => item.id === runId);
        if (!stored) return { success: false, error: `Subagent run not found: ${runId}` };
        return { success: false, error: `Subagent run is not active (status: ${stored.status})` };
      }
      const result = cancelRun(runId);
      return result.success
        ? { success: true, data: { runId, status: "cancelled" } }
        : { success: false, error: result.error };
    }

    if (action !== "run" && action !== "spawn" && action !== "plan") {
      return { success: false, error: `Unknown action: ${action}` };
    }

    const task = String(args.task || "").trim();
    if (!task) return { success: false, error: "task is required" };

    if (action === "plan") {
      return {
        success: true,
        data: { task: task.slice(0, 300), ...assessDecomposition(task, parseTools(args.tools)) },
      };
    }

    const request: SubagentRequest = {
      task,
      tools: parseTools(args.tools),
      role: parseRole(args.role),
      context: typeof args.context === "string" ? args.context : undefined,
      output: parseOutput(args.output),
    };
    const active = enqueue(request);

    if (action === "spawn") {
      return {
        success: true,
        data: {
          runId: active.run.id,
          sessionId: active.run.sessionId,
          status: active.run.status,
          role: active.run.role,
          queuePosition: pending.findIndex((entry) => entry.run.id === active.run.id) + 1,
          guidance: "Poll with action status and cancel with action cancel.",
        },
      };
    }

    const run = await active.promise;
    if (run.status !== "succeeded") {
      return { success: false, error: run.error || `Subagent ${run.status}`, data: { run } };
    }
    return {
      success: true,
      data: {
        response: run.result,
        sessionId: run.sessionId,
        runId: run.id,
        role: run.role,
        fitness: run.fitness,
        durationMs: run.durationMs,
        verdict: run.verdict,
        artifact: run.artifact,
      },
    };
  },
};

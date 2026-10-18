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
}

interface ActiveSubagent {
  run: SubagentRun;
  controller: AbortController;
  promise: Promise<SubagentRun>;
}

let activeCount = 0;
const activeRuns = new Map<string, ActiveSubagent>();

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
  };
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

function startSubagent(task: string, requestedTools: string[]): ActiveSubagent {
  const sessionId = `subagent-${randomUUID().slice(0, 8)}`;
  const run: SubagentRun = {
    id: `run_${randomUUID().slice(0, 8)}`,
    task,
    tools: requestedTools,
    status: "queued",
    sessionId,
    startedAt: Date.now(),
    fitness: 0,
  };
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
    run.status = "running";
    upsertRun(run);
    try {
      const config = loadConfig();
      const shared = createSharedInfra(config);
      const session = createSessionInfra(shared, config);

      if (requestedTools.length > 0) {
        const { ToolRegistry } = await import("../tools/registry.js");
        const filtered = new ToolRegistry();
        for (const name of requestedTools) {
          const tool = shared.tools.get(name);
          if (tool) filtered.register(tool);
        }
        shared.tools = filtered;
      }

      const agentConfig = createAgentConfig({ ...shared, ...session }, config, sessionId, {
        skipReflection: true,
        memoryEnabled: false,
        strategyEnabled: false,
        mistakesEnabled: false,
        sessionSource: "subagent",
      });

      const agent = new Agent(agentConfig);
      let response = "";

      const stream = agent.run(
        task,
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
      run.status = "succeeded";
      run.completedAt = Date.now();
      run.durationMs = run.completedAt - run.startedAt;
      run.result = result.slice(0, MAX_RESULT);
      run.resultSummary = result.replace(/\s+/g, " ").slice(0, 500);
      run.fitness = result.length > 0 ? 0.7 : 0.2;
      upsertRun(run);
      return run;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      run.status = timedOut ? "timed_out" : controller.signal.aborted ? "cancelled" : "failed";
      if (run.status === "timed_out") run.error = `Subagent timed out after ${SUBAGENT_TIMEOUT / 1000}s`;
      else if (run.status === "cancelled") run.error = "Subagent cancelled";
      else run.error = message;
      run.completedAt = Date.now();
      run.durationMs = run.completedAt - run.startedAt;
      run.fitness = 0;
      upsertRun(run);
      return run;
    } finally {
      clearTimeout(timer);
      activeCount--;
      activeRuns.delete(run.id);
    }
  });

  const active: ActiveSubagent = { run, controller, promise };
  activeRuns.set(run.id, active);
  return active;
}

export const subagentTool: Tool = {
  name: "subagent",
  description:
    "Run isolated subagents with their own message history and a filtered tool set. Use action run to block until done, spawn to get a run id immediately and poll with status, cancel to stop one, and list to inspect recent runs. Never use subagents for work that needs the parent's live context.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["run", "spawn", "status", "cancel", "list"],
        description: "run (default, blocking), spawn (async), status, cancel, or list",
      },
      task: { type: "string", description: "Task description or prompt for the subagent" },
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
      return { success: true, data: { runs, activeCount, active: active.map((run) => run.id) } };
    }

    if (action === "status") {
      const runId = String(args.runId || "");
      if (!runId) {
        return { success: true, data: { runs: getSubagentRuns(20).map(summarizeRun), activeCount } };
      }
      const live = activeRuns.get(runId)?.run;
      const stored = live || loadRuns().find((item) => item.id === runId);
      if (!stored) return { success: false, error: `Subagent run not found: ${runId}` };
      return { success: true, data: { run: stored, active: activeRuns.has(runId) } };
    }

    if (action === "cancel") {
      const runId = String(args.runId || "");
      if (!runId) return { success: false, error: "runId is required for cancel" };
      const active = activeRuns.get(runId);
      if (!active) {
        const stored = loadRuns().find((item) => item.id === runId);
        if (!stored) return { success: false, error: `Subagent run not found: ${runId}` };
        return { success: false, error: `Subagent run is not active (status: ${stored.status})` };
      }
      active.controller.abort();
      return { success: true, data: { runId, status: "cancelled" } };
    }

    if (action !== "run" && action !== "spawn") {
      return { success: false, error: `Unknown action: ${action}` };
    }

    const task = String(args.task || "").trim();
    if (!task) return { success: false, error: "task is required" };
    if (activeCount >= MAX_CONCURRENT) {
      return { success: false, error: `Max concurrent subagents (${MAX_CONCURRENT}) reached. Wait for one to finish.` };
    }

    const requestedTools = parseTools(args.tools);
    const active = startSubagent(task, requestedTools);

    if (action === "spawn") {
      return {
        success: true,
        data: {
          runId: active.run.id,
          sessionId: active.run.sessionId,
          status: active.run.status,
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
        fitness: run.fitness,
        durationMs: run.durationMs,
      },
    };
  },
};

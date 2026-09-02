import type { Tool } from "../types/index.js";
import { Agent } from "../core/agent.js";
import { createAgentConfig, createSessionInfra, createSharedInfra } from "../core/dispatcher.js";
import { loadConfig } from "../core/config.js";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";

const SUBAGENT_TIMEOUT = 120_000;
const MAX_CONCURRENT = 3;

let activeCount = 0;

export interface SubagentRun {
  id: string;
  task: string;
  tools: string[];
  status: "queued" | "running" | "succeeded" | "failed" | "timed_out";
  sessionId: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  resultSummary?: string;
  error?: string;
  fitness: number;
}

const RUNS_PATH = join(NTOX_DIR, "subagent-runs.json");

function loadRuns(): SubagentRun[] {
  if (!existsSync(RUNS_PATH)) return [];
  try { return JSON.parse(readFileSync(RUNS_PATH, "utf-8")) as SubagentRun[]; } catch { return []; }
}

function saveRuns(runs: SubagentRun[]): void {
  if (!existsSync(NTOX_DIR)) mkdirSync(NTOX_DIR, { recursive: true });
  writeFileSync(RUNS_PATH, JSON.stringify(runs.slice(-200), null, 2));
}

function upsertRun(run: SubagentRun): void {
  const runs = loadRuns();
  const idx = runs.findIndex((r) => r.id === run.id);
  if (idx >= 0) runs[idx] = run;
  else runs.push(run);
  saveRuns(runs);
}

export function getSubagentRuns(limit = 20): SubagentRun[] {
  return loadRuns().sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}

export const subagentTool: Tool = {
  name: "subagent",
  description: "Spawn an isolated subagent to handle a task independently. The subagent has its own message history and can use a filtered set of tools. Use for parallel or isolated work.",
  parameters: {
    type: "object",
    properties: {
      task: { type: "string", description: "Task description or prompt for the subagent" },
      tools: { type: "string", description: "Comma-separated list of tool names the subagent can use (default: all available tools)" },
    },
    required: ["task"],
  },
  async execute(args) {
    const task = String(args.task);
    if (!task) return { success: false, error: "task is required" };

    if (activeCount >= MAX_CONCURRENT) {
      return { success: false, error: `Max concurrent subagents (${MAX_CONCURRENT}) reached. Wait for one to finish.` };
    }

    activeCount++;
    const sessionId = `subagent-${randomUUID().slice(0, 8)}`;
    const requestedTools = args.tools
      ? String(args.tools).split(",").map((t) => t.trim()).filter(Boolean)
      : [];
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
    try {
      const config = loadConfig();
      const shared = createSharedInfra(config);
      const session = createSessionInfra(shared);

      if (args.tools) {
        const filtered = new (await import("../tools/registry.js")).ToolRegistry();
        for (const name of requestedTools) {
          const tool = shared.tools.get(name);
          if (tool) filtered.register(tool);
        }
        shared.tools = filtered;
      }

      run.status = "running";
      upsertRun(run);
      const agentConfig = createAgentConfig({ ...shared, ...session }, config, sessionId, {
        skipReflection: true,
        memoryEnabled: false,
        strategyEnabled: false,
        mistakesEnabled: false,
      });

      const agent = new Agent(agentConfig);
      let response = "";

      const timeoutPromise = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error("Subagent timed out after 120s")), SUBAGENT_TIMEOUT);
      });

      const workPromise = (async () => {
        const stream = agent.run(task, {
          onToken: (t) => { response += t; },
          onToolCall: () => {},
          onToolResult: () => {},
          onUsage: () => {},
          onThinking: () => {},
        });
        for await (const _ of stream) { /* drain */ }
        return response.trim();
      })();

      const result = await Promise.race([workPromise, timeoutPromise]);
      run.status = "succeeded";
      run.completedAt = Date.now();
      run.durationMs = run.completedAt - run.startedAt;
      run.resultSummary = result.replace(/\s+/g, " ").slice(0, 500);
      run.fitness = result.length > 0 ? 0.7 : 0.2;
      upsertRun(run);
      return { success: true, data: { response: result, sessionId, runId: run.id, fitness: run.fitness } };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      run.status = message.includes("timed out") ? "timed_out" : "failed";
      run.completedAt = Date.now();
      run.durationMs = run.completedAt - run.startedAt;
      run.error = message;
      run.fitness = 0;
      upsertRun(run);
      return { success: false, error: message };
    } finally {
      activeCount--;
    }
  },
};

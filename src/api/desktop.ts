import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { cpus, totalmem, freemem, uptime } from "node:os";
import { getBaseDir, loadConfig, saveConfig } from "../core/config.js";
import { clearNotifications, listNotifications } from "../alive/notifications.js";
import { createSharedInfra } from "../core/dispatcher.js";
import { MemoryStore } from "../memory/episodic.js";
import { getSubagentRuns, subagentTool } from "../tools/subagent.js";
import {
  CONFIG_SECRET_FIELDS,
  credentialStatuses,
  deleteProviderCredential,
  getProviderCredential,
  markProviderVerified,
  setProviderCredential,
} from "../core/credentials.js";
import { getProviderNames, getProviders, probeProvider, providerRequiresKey } from "../core/llm.js";
import { getDefaultProfile } from "../core/policy.js";
import { redactError } from "../core/redact.js";

type Json = Record<string, unknown>;
type WorkflowStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type WorkflowMode = "research" | "execute";

const RESEARCH_TOOLS = ["read", "glob", "ls", "grep", "search", "web_fetch", "web_read"];

export function workflowToolNames(mode: WorkflowMode, tools: { name: string }[]): string[] {
  const allowed =
    mode === "execute" ? tools.filter((tool) => tool.name !== "subagent") : tools.filter((tool) => RESEARCH_TOOLS.includes(tool.name));
  return allowed.map((tool) => tool.name).sort();
}

interface DesktopWorkflow {
  id: string;
  goal: string;
  status: WorkflowStatus;
  mode: WorkflowMode;
  concurrency: number;
  createdAt: number;
  updatedAt: number;
  tasks: {
    id: string;
    title: string;
    prompt: string;
    status: string;
    runId?: string;
    result?: string;
    error?: string;
    startedAt?: number;
    completedAt?: number;
  }[];
}

function send(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function body(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body too large");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Json;
}

function workflowPath(): string {
  return join(getBaseDir(), "desktop-workflows.json");
}

function loadWorkflows(): DesktopWorkflow[] {
  try {
    const parsed = JSON.parse(readFileSync(workflowPath(), "utf8")) as {
      schemaVersion?: number;
      workflows?: DesktopWorkflow[];
    };
    return parsed.schemaVersion === 1 && Array.isArray(parsed.workflows) ? parsed.workflows : [];
  } catch {
    return [];
  }
}

function saveWorkflows(workflows: DesktopWorkflow[]): void {
  const target = workflowPath();
  const temp = `${target}.${process.pid}.tmp`;
  mkdirSync(getBaseDir(), { recursive: true });
  writeFileSync(temp, JSON.stringify({ schemaVersion: 1, workflows: workflows.slice(-100) }, null, 2));
  renameSync(temp, target);
}

function refreshWorkflow(workflow: DesktopWorkflow): DesktopWorkflow {
  const previous = JSON.stringify({ status: workflow.status, tasks: workflow.tasks });
  for (const task of workflow.tasks) {
    if (!task.runId || ["completed", "failed", "cancelled", "timed_out"].includes(task.status)) continue;
    const run = getSubagentRuns(200).find((item) => item.id === task.runId);
    if (!run) continue;
    task.status = run.status;
    task.result = run.result;
    task.error = run.error;
    task.completedAt = run.completedAt;
  }
  if (workflow.tasks.every((task) => task.status === "succeeded")) workflow.status = "completed";
  else if (workflow.tasks.some((task) => ["failed", "timed_out"].includes(task.status))) workflow.status = "failed";
  else if (
    workflow.tasks.some((task) => task.status === "cancelled") &&
    workflow.tasks.every((task) => ["cancelled", "succeeded", "failed", "timed_out"].includes(task.status))
  )
    workflow.status = "cancelled";
  else if (workflow.tasks.some((task) => task.status === "running" || task.status === "queued"))
    workflow.status = "running";
  if (previous !== JSON.stringify({ status: workflow.status, tasks: workflow.tasks })) workflow.updatedAt = Date.now();
  return workflow;
}

function nonSecretConfig() {
  const config = loadConfig();
  return {
    schemaVersion: config.schemaVersion ?? 1,
    model: config.model,
    provider: config.provider,
    apiBaseUrl: config.apiBaseUrl,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    memoryEnabled: config.memoryEnabled,
    memoryRetrievalCount: config.memoryRetrievalCount,
    embeddingModel: config.embeddingModel,
    apiPort: config.apiPort,
    webPort: config.webPort,
    webHost: config.webHost,
    dockerEnabled: config.dockerEnabled,
    metaStrategyEnabled: config.metaStrategyEnabled,
    metaMistakesEnabled: config.metaMistakesEnabled,
    cognitiveEnabled: config.cognitiveEnabled,
    theoryEnabled: config.cognitiveEnabled ? config.theoryEnabled : false,
    defaultProfileId: config.defaultProfileId,
    profiles: config.profiles,
    workspace: process.cwd(),
  };
}

function providerCatalog() {
  const names = getProviderNames();
  return getProviders().map((id) => ({ id, name: names[id] || id, apiKeyRequired: providerRequiresKey(id) }));
}

function assertNoSecrets(payload: Json): void {
  const leaked = CONFIG_SECRET_FIELDS.filter((field) => field in payload);
  if (leaked.length) throw new Error(`Secrets cannot be set through this endpoint (${leaked.join(", ")}).`);
}

const TOOL_NAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,39}$/i;
const SHELL_POLICIES = ["disabled", "workspace", "approval-required"] as const;
const NETWORK_POLICIES = ["disabled", "fetch-only", "browser-allowed"] as const;

function parseToolNames(value: unknown, field: string, errors: string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) {
    errors.push(`${field} must be an array of at most 50 tool names.`);
    return [];
  }
  for (const entry of value) {
    if (typeof entry !== "string" || !TOOL_NAME_PATTERN.test(entry)) {
      errors.push(`${field} contains an invalid tool name.`);
      return [];
    }
  }
  return [...new Set(value as string[])];
}

function parseRoots(value: unknown, field: string, errors: string[]): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    errors.push(`${field} must be an array of 1 to 50 absolute paths.`);
    return null;
  }
  const roots: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim() || entry.trim().length > 300 || !isAbsolute(entry.trim())) {
      errors.push(`${field} must contain absolute paths.`);
      return null;
    }
    roots.push(resolve(entry.trim()));
  }
  return [...new Set(roots)];
}

function parsePolicy<T extends string>(value: unknown, field: string, allowed: readonly T[], errors: string[]): T | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    errors.push(`${field} must be one of: ${allowed.join(", ")}.`);
    return null;
  }
  return value as T;
}

function loadEvaluationHistory() {
  const directory = join(process.cwd(), "experiments", "meta-eval");
  const runs: {
    id: string;
    suite: string;
    agent: string;
    score: string;
    status: string;
    completedAt: string;
    curriculum: string;
  }[] = [];
  try {
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .filter((item) => item.isDirectory())
      .slice(-30)) {
      for (const file of readdirSync(join(directory, entry.name)).filter(
        (name) => name.startsWith("longitudinal-") && name.endsWith(".json"),
      )) {
        try {
          const report = JSON.parse(readFileSync(join(directory, entry.name, file), "utf8")) as {
            curriculum?: string;
            generatedAt?: number;
            arms?: { arm?: string; mean?: number }[];
          };
          if (!Array.isArray(report.arms) || typeof report.generatedAt !== "number") continue;
          for (const arm of report.arms) {
            if (typeof arm.mean !== "number") continue;
            runs.push({
              id: `${file.replace(/\.json$/, "")}-${arm.arm || "arm"}`,
              suite: "NTOX meta-cognition longitudinal",
              agent: arm.arm || "unknown",
              score: `${(arm.mean * 100).toFixed(1)}%`,
              status: "Completed",
              completedAt: new Date(report.generatedAt).toISOString(),
              curriculum: report.curriculum || "unknown",
            });
          }
        } catch {
          continue;
        }
      }
    }
  } catch {
    return { suites: [], runs: [], summary: null, message: "No evaluation run records are available in this runtime." };
  }
  runs.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  const scores = runs.map((run) => Number.parseFloat(run.score));
  return {
    suites: [...new Set(runs.map((run) => run.suite))],
    runs: runs.slice(0, 100),
    summary: runs.length
      ? { runs: runs.length, meanScore: scores.reduce((sum, score) => sum + score, 0) / scores.length }
      : null,
    message: runs.length ? undefined : "No evaluation run records are available in this runtime.",
  };
}

export interface DesktopApiOptions {
  onReload?: () => void;
  onBootstrap?: () => void;
}

export function createDesktopApi(options: DesktopApiOptions = {}) {
  let sharedInfra: ReturnType<typeof createSharedInfra> | null = null;
  const getShared = () => (sharedInfra ??= createSharedInfra(loadConfig()));
  const getTools = () => getShared().tools;
  const reload = () => {
    sharedInfra = null;
    options.onReload?.();
  };
  const settingsPayload = () => ({
    settings: nonSecretConfig(),
    providers: providerCatalog(),
    credentials: credentialStatuses(),
  });
  const permissionsPayload = () => ({
    profile: (() => {
      const profile = getShared().policy.profile;
      return {
        id: profile.id,
        name: profile.name,
        workspaceRoot: profile.workspaceRoot,
        readRoots: profile.readRoots,
        writeRoots: profile.writeRoots,
        allowedTools: profile.allowedTools,
        shellPolicy: profile.shellPolicy,
        networkPolicy: profile.networkPolicy,
        autoCheckpoint: profile.autoCheckpoint,
      };
    })(),
    defaultProfileId: loadConfig().defaultProfileId,
    tools: getTools()
      .list()
      .map((tool) => tool.name)
      .sort(),
  });

  return async function handleDesktopApi(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    method: string,
  ): Promise<boolean> {
    if (
      !pathname.startsWith("/api/desktop") &&
      !pathname.startsWith("/api/agents") &&
      !pathname.startsWith("/api/tasks") &&
      !pathname.startsWith("/api/memory") &&
      !pathname.startsWith("/api/tools") &&
      !pathname.startsWith("/api/evaluations") &&
      !pathname.startsWith("/api/settings")
    )
      return false;
    try {
      if (pathname === "/api/desktop/bootstrap" && method === "GET") {
        try {
          options.onBootstrap?.();
        } catch (error) {
          console.error(`[desktop] bootstrap hook failed: ${redactError(error)}`);
        }
        const config = nonSecretConfig();
        const runs = getSubagentRuns(100);
        const workflows = loadWorkflows().map(refreshWorkflow);
        send(res, 200, {
          schemaVersion: 1,
          runtime: {
            status: "operational",
            version: "0.1.0",
            uptimeSeconds: Math.floor(uptime()),
            cpuCount: cpus().length,
            memoryTotalBytes: totalmem(),
            memoryFreeBytes: freemem(),
          },
          config,
          notifications: listNotifications(20),
          agents: { active: runs.filter((run) => run.status === "running").length, total: 1 + runs.length },
          tasks: {
            active: workflows
              .flatMap((item) => item.tasks)
              .filter((task) => ["running", "queued"].includes(task.status)).length,
          },
        });
        return true;
      }
      if (pathname === "/api/desktop/bootstrap" && method === "POST") {
        const payload = await body(req);
        if (payload.clearNotifications === true) {
          const cleared = clearNotifications();
          send(res, 200, { cleared, notifications: listNotifications(20) });
          return true;
        }
        send(res, 400, { error: "Unsupported bootstrap action." });
        return true;
      }
      if (pathname === "/api/agents" && method === "GET") {
        const runs = getSubagentRuns(100).map((run) => ({
          id: run.id,
          name: `NTOX Subagent ${run.id.slice(-4)}`,
          role: "Task worker",
          status: run.status,
          currentTask: run.task,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          tools: run.tools,
          resultSummary: run.resultSummary,
          error: run.error,
        }));
        send(res, 200, {
          agents: [
            {
              id: "ntox-coordinator",
              name: "NTOX Coordinator",
              role: "Primary assistant",
              status: "available",
              currentTask: null,
              tools: getTools()
                .list()
                .map((tool) => tool.name),
            },
            ...runs,
          ],
        });
        return true;
      }
      if (pathname === "/api/tasks" && method === "GET") {
        const workflows = loadWorkflows();
        const previous = JSON.stringify(workflows);
        workflows.forEach(refreshWorkflow);
        if (previous !== JSON.stringify(workflows)) saveWorkflows(workflows);
        send(res, 200, {
          workflows: workflows.reverse(),
          tasks: workflows
            .flatMap((workflow) =>
              workflow.tasks.map((task) => ({
                ...task,
                workflowId: workflow.id,
                goal: workflow.goal,
                workflowStatus: workflow.status,
              })),
            )
            .reverse(),
        });
        return true;
      }
      if (pathname === "/api/tasks" && method === "POST") {
        const payload = await body(req);
        const goal = typeof payload.goal === "string" ? payload.goal.trim() : "";
        const requested = Array.isArray(payload.subtasks) ? payload.subtasks : [goal];
        const prompts = requested
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean);
        if (
          !goal ||
          goal.length > 10_000 ||
          prompts.length < 1 ||
          prompts.length > 3 ||
          prompts.some((item) => item.length > 10_000)
        ) {
          send(res, 400, { error: "Provide a goal and between one and three subtasks." });
          return true;
        }
        const mode: WorkflowMode = payload.mode === "execute" ? "execute" : "research";
        const available = getTools().list();
        const safeTools = workflowToolNames(mode, available);
        const workflow: DesktopWorkflow = {
          id: `wf_${randomUUID().slice(0, 12)}`,
          goal,
          status: "queued",
          mode,
          concurrency: prompts.length,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          tasks: prompts.map((prompt, index) => ({
            id: `task_${randomUUID().slice(0, 10)}`,
            title: prompt.split(/[.!?\n]/)[0].slice(0, 90) || `Subtask ${index + 1}`,
            prompt,
            status: "queued",
            startedAt: Date.now(),
          })),
        };
        for (const task of workflow.tasks) {
          const modeNote = mode === "execute" ? "\n\nYou may use every tool this runtime allows, including shell and file writes. Carry the goal out instead of only describing how to." : "";
          const result = await subagentTool.execute({
            action: "spawn",
            task: `${task.prompt}\n\nOverall goal: ${goal}${modeNote}`,
            tools: safeTools.join(","),
          });
          const data = result.data as { runId?: string } | undefined;
          if (!result.success || !data?.runId) {
            task.status = "failed";
            task.error = result.error || "Unable to start agent run";
          } else {
            task.runId = data.runId;
            task.status = "running";
          }
        }
        refreshWorkflow(workflow);
        const workflows = loadWorkflows();
        workflows.push(workflow);
        saveWorkflows(workflows);
        send(res, 201, { workflow });
        return true;
      }
      const taskAction = pathname.match(/^\/api\/tasks\/([^/]+)\/(cancel|retry)$/);
      if (taskAction && method === "POST") {
        const [, id, action] = taskAction;
        const workflows = loadWorkflows();
        const workflow = workflows.find((item) => item.id === id);
        if (!workflow) {
          send(res, 404, { error: "Workflow not found" });
          return true;
        }
        if (action === "cancel") {
          for (const task of workflow.tasks.filter((item) => item.runId && ["queued", "running"].includes(item.status)))
            await subagentTool.execute({ action: "cancel", runId: task.runId });
          workflow.status = "cancelled";
        } else {
          const failed = workflow.tasks.filter((item) => ["failed", "timed_out", "cancelled"].includes(item.status));
          if (!failed.length) {
            send(res, 409, { error: "Workflow has no retryable tasks" });
            return true;
          }
          for (const task of failed) {
            const result = await subagentTool.execute({
              action: "spawn",
              task: `${task.prompt}\n\nOverall goal: ${workflow.goal}`,
              tools: "read,glob,ls,grep,search,web_fetch,web_read",
            });
            const data = result.data as { runId?: string } | undefined;
            task.status = result.success && data?.runId ? "running" : "failed";
            task.runId = data?.runId;
            task.error = result.success ? undefined : result.error;
          }
          workflow.status = "running";
        }
        refreshWorkflow(workflow);
        saveWorkflows(workflows);
        send(res, 200, { workflow });
        return true;
      }
      const workflowMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (workflowMatch && method === "GET") {
        const workflows = loadWorkflows();
        const workflow = workflows.find((item) => item.id === workflowMatch[1]);
        if (!workflow) {
          send(res, 404, { error: "Workflow not found" });
          return true;
        }
        const previous = JSON.stringify(workflow);
        refreshWorkflow(workflow);
        if (previous !== JSON.stringify(workflow)) saveWorkflows(workflows);
        send(res, 200, { workflow });
        return true;
      }
      if (pathname === "/api/memory" && method === "GET") {
        const memory = new MemoryStore();
        const url = new URL(req.url || "/", "http://localhost");
        const query = url.searchParams.get("q") || "";
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
        const episodes = query ? memory.search(query, limit) : memory.getRecent(limit);
        const durable = query
          ? memory.searchDurableMemories(query, limit)
          : memory.listDurableMemories().slice(0, limit);
        send(res, 200, {
          stats: memory.getStats(),
          total: memory.getStats().totalEpisodes + memory.listDurableMemories().length,
          records: [
            ...episodes.map((episode) => ({
              id: episode.id,
              type: "episodic",
              text: episode.summary,
              createdAt: episode.timestamp,
              source: episode.sessionId,
              detail: episode.userMessage,
            })),
            ...durable.map((item) => ({
              id: item.id,
              type: item.lane,
              text: item.text,
              createdAt: item.updatedAt,
              source: item.provenance,
              confidence: item.confidence,
            })),
          ],
        });
        return true;
      }
      if (pathname === "/api/memory/graph" && method === "GET") {
        const memory = new MemoryStore();
        const records = [
          ...memory
            .getRecent(100)
            .map((episode) => ({ id: episode.id, text: episode.summary, type: "episodic", group: episode.sessionId })),
          ...memory
            .listDurableMemories()
            .slice(0, 100)
            .map((item) => ({ id: item.id, text: item.text, type: item.lane, group: item.provenance })),
        ];
        const links: { source: string; target: string }[] = [];
        for (let i = 1; i < records.length; i++)
          if (records[i].group === records[i - 1].group)
            links.push({ source: records[i - 1].id, target: records[i].id });
        send(res, 200, {
          nodes: records,
          links,
          total: memory.getStats().totalEpisodes + memory.listDurableMemories().length,
        });
        return true;
      }
      const memoryId = pathname.match(/^\/api\/memory\/([^/]+)$/);
      if (memoryId && ["GET", "PATCH", "DELETE"].includes(method)) {
        const memory = new MemoryStore();
        const item = memory.getDurableMemory(memoryId[1]);
        if (!item) {
          send(res, 404, { error: "Durable memory not found" });
          return true;
        }
        if (method === "GET") send(res, 200, { memory: item });
        else if (method === "DELETE") send(res, memory.deleteDurableMemory(item.id) ? 200 : 404, { deleted: true });
        else {
          const payload = await body(req);
          const text = typeof payload.text === "string" ? payload.text.trim() : "";
          if (!text || text.length > 10_000) {
            send(res, 400, { error: "Memory text is required" });
            return true;
          }
          send(res, 200, { memory: memory.updateDurableMemory(item.id, text) });
        }
        return true;
      }
      if (pathname === "/api/tools" && method === "GET") {
        send(res, 200, {
          tools: getTools()
            .list()
            .map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters || {},
              enabled: true,
              category: tool.name === "subagent" ? "Orchestration" : "Runtime",
              requiresApproval: ["shell", "write", "edit"].includes(tool.name),
            })),
        });
        return true;
      }
      if (pathname === "/api/evaluations" && method === "GET") {
        send(res, 200, loadEvaluationHistory());
        return true;
      }
      if (pathname === "/api/desktop/permissions" && method === "GET") {
        send(res, 200, permissionsPayload());
        return true;
      }
      if (pathname === "/api/desktop/permissions" && method === "PATCH") {
        const payload = await body(req);
        assertNoSecrets(payload);
        const errors: string[] = [];
        const addTools = parseToolNames(payload.addTools, "addTools", errors);
        const removeTools = parseToolNames(payload.removeTools, "removeTools", errors);
        const readRoots = parseRoots(payload.readRoots, "readRoots", errors);
        const writeRoots = parseRoots(payload.writeRoots, "writeRoots", errors);
        const shellPolicy = parsePolicy(payload.shellPolicy, "shellPolicy", SHELL_POLICIES, errors);
        const networkPolicy = parsePolicy(payload.networkPolicy, "networkPolicy", NETWORK_POLICIES, errors);
        let autoCheckpoint: boolean | null = null;
        if (payload.autoCheckpoint !== undefined) {
          if (typeof payload.autoCheckpoint === "boolean") autoCheckpoint = payload.autoCheckpoint;
          else errors.push("autoCheckpoint must be a boolean.");
        }
        const touched = [
          "addTools",
          "removeTools",
          "readRoots",
          "writeRoots",
          "shellPolicy",
          "networkPolicy",
          "autoCheckpoint",
        ].some((field) => payload[field] !== undefined);
        if (!touched) errors.push("No permission changes were provided.");
        if (errors.length) {
          send(res, 400, { error: errors.join(" ") });
          return true;
        }

        const config = loadConfig();
        const profile = getDefaultProfile(config.profiles, config.defaultProfileId);
        const runtimeProfile = getShared().policy.profile;
        if (profile.id === runtimeProfile.id) profile.workspaceRoot = runtimeProfile.workspaceRoot;
        const unrestricted = profile.allowedTools.length === 0;
        if (unrestricted && addTools.length) {
          send(res, 400, { error: "This profile already allows every tool, so there is nothing to add." });
          return true;
        }
        if (removeTools.length || addTools.length) {
          const current = unrestricted
            ? getTools()
                .list()
                .map((tool) => tool.name)
            : profile.allowedTools;
          const remaining = removeTools.length
            ? [...new Set(current.filter((name) => !removeTools.includes(name)))]
            : current;
          const next = [...new Set([...remaining, ...addTools])];
          if (next.length === 0) {
            send(res, 400, { error: "The tool allowlist cannot be empty — keep at least one tool enabled." });
            return true;
          }
          profile.allowedTools = next;
        }
        if (readRoots) profile.readRoots = readRoots;
        if (writeRoots) profile.writeRoots = writeRoots;
        if (shellPolicy) profile.shellPolicy = shellPolicy;
        if (networkPolicy) profile.networkPolicy = networkPolicy;
        if (autoCheckpoint !== null) profile.autoCheckpoint = autoCheckpoint;
        saveConfig(config);
        reload();
        send(res, 200, permissionsPayload());
        return true;
      }
      if (pathname === "/api/settings" && method === "GET") {
        send(res, 200, settingsPayload());
        return true;
      }
      if (pathname === "/api/settings/providers" && method === "GET") {
        send(res, 200, { providers: providerCatalog(), credentials: credentialStatuses() });
        return true;
      }
      if (pathname === "/api/settings/reload" && method === "POST") {
        reload();
        send(res, 200, settingsPayload());
        return true;
      }
      if (pathname === "/api/settings" && method === "PATCH") {
        const payload = await body(req);
        assertNoSecrets(payload);
        const config = loadConfig();
        if (payload.model !== undefined) {
          if (typeof payload.model !== "string" || !payload.model.trim() || payload.model.trim().length > 200) {
            send(res, 400, { error: "Model must be a non-empty string of 200 characters or fewer." });
            return true;
          }
          config.model = payload.model.trim();
        }
        if (payload.provider !== undefined) {
          const provider = typeof payload.provider === "string" ? payload.provider.trim() : "";
          if (!getProviders().includes(provider)) {
            send(res, 400, { error: "Unknown provider." });
            return true;
          }
          config.provider = provider;
        }
        if (payload.apiBaseUrl !== undefined) {
          if (typeof payload.apiBaseUrl !== "string" || payload.apiBaseUrl.length > 400) {
            send(res, 400, { error: "Invalid base URL." });
            return true;
          }
          config.apiBaseUrl = payload.apiBaseUrl.trim();
        }
        if (payload.temperature !== undefined) {
          if (typeof payload.temperature !== "number" || payload.temperature < 0 || payload.temperature > 2) {
            send(res, 400, { error: "Temperature must be between 0 and 2." });
            return true;
          }
          config.temperature = payload.temperature;
        }
        if (payload.maxTokens !== undefined) {
          if (
            !Number.isInteger(payload.maxTokens) ||
            (payload.maxTokens as number) < 1 ||
            (payload.maxTokens as number) > 1_000_000
          ) {
            send(res, 400, { error: "Maximum tokens must be a positive integer." });
            return true;
          }
          config.maxTokens = payload.maxTokens as number;
        }
        if (payload.memoryEnabled !== undefined) {
          if (typeof payload.memoryEnabled !== "boolean") {
            send(res, 400, { error: "memoryEnabled must be a boolean." });
            return true;
          }
          config.memoryEnabled = payload.memoryEnabled;
        }
        saveConfig(config);
        reload();
        send(res, 200, settingsPayload());
        return true;
      }
      const credentialMatch = pathname.match(/^\/api\/settings\/credentials\/([^/]+)(?:\/(test))?$/);
      if (credentialMatch) {
        const provider = credentialMatch[1];
        const testing = credentialMatch[2] === "test";
        if (!getProviders().includes(provider)) {
          send(res, 404, { error: "Unknown provider." });
          return true;
        }

        if (testing && method === "POST") {
          const payload = await body(req);
          const candidate = typeof payload.apiKey === "string" ? payload.apiKey.trim() : "";
          const baseUrl = typeof payload.baseUrl === "string" ? payload.baseUrl.trim() : undefined;
          const stored = getProviderCredential(provider);
          const apiKey = candidate || stored?.apiKey || "";
          if (!apiKey && providerRequiresKey(provider)) {
            send(res, 400, { error: "An API key is required before this provider can be tested." });
            return true;
          }
          const result = await probeProvider(provider, apiKey, baseUrl);
          if (result.ok && !candidate && stored) markProviderVerified(provider);
          send(res, result.ok ? 200 : 400, {
            ok: result.ok,
            provider,
            modelCount: result.modelCount,
            error: result.error,
          });
          return true;
        }

        if (method === "PUT") {
          const payload = await body(req);
          const apiKey = typeof payload.apiKey === "string" ? payload.apiKey.trim() : "";
          const baseUrl = typeof payload.baseUrl === "string" ? payload.baseUrl.trim() : undefined;
          if (apiKey.length > 4000) {
            send(res, 400, { error: "That API key is too long." });
            return true;
          }
          if (!apiKey && providerRequiresKey(provider)) {
            send(res, 400, { error: "An API key is required for this provider." });
            return true;
          }
          if (baseUrl && baseUrl.length > 400) {
            send(res, 400, { error: "That base URL is too long." });
            return true;
          }
          const record = setProviderCredential(provider, apiKey, baseUrl);
          if (baseUrl && provider === "openai-compatible") saveConfig({ ...loadConfig(), apiBaseUrl: baseUrl });
          const status = credentialStatuses().find((item) => item.provider === provider);
          send(res, 200, { credential: { ...status, updatedAt: record.updatedAt } });
          return true;
        }

        if (method === "DELETE") {
          const deleted = deleteProviderCredential(provider);
          send(res, deleted ? 200 : 404, { deleted });
          return true;
        }
      }
      send(res, 404, { error: "Desktop API route not found" });
      return true;
    } catch (error) {
      send(res, 400, { error: redactError(error) });
      return true;
    }
  };
}

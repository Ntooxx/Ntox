import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Tool, ToolContext, ToolResult } from "../types/index.js";
import { getBaseDir } from "../core/config.js";

export type PlanTaskStatus = "pending" | "in_progress" | "blocked" | "completed" | "cancelled";

export interface PlanVerification {
  success: boolean;
  output: string;
  at: number;
}

export interface PlanTask {
  id: string;
  title: string;
  status: PlanTaskStatus;
  verify?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  lastVerification?: PlanVerification;
}

export interface PlanState {
  sessionId: string;
  goal: string;
  tasks: PlanTask[];
  createdAt: number;
  updatedAt: number;
}

const MAX_TASKS = 100;
const MAX_RENDERED_TASKS = 30;
const DEFAULT_SESSION = "default";
const VALID_STATUSES: PlanTaskStatus[] = ["pending", "in_progress", "blocked", "completed", "cancelled"];

function planDir(): string {
  return join(getBaseDir(), "plans");
}

function planKey(sessionId?: string): string {
  const raw = sessionId || DEFAULT_SESSION;
  return raw.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || DEFAULT_SESSION;
}

function planPath(sessionId?: string): string {
  return join(planDir(), `${planKey(sessionId)}.json`);
}

export function loadPlan(sessionId?: string): PlanState | null {
  const path = planPath(sessionId);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as PlanState;
    if (!parsed || !Array.isArray(parsed.tasks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePlan(plan: PlanState): void {
  const dir = planDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(planPath(plan.sessionId), JSON.stringify(plan, null, 2));
}

export function clearPlan(sessionId?: string): boolean {
  const path = planPath(sessionId);
  if (!existsSync(path)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

function statusMark(status: PlanTaskStatus): string {
  if (status === "completed") return "x";
  if (status === "in_progress") return ">";
  if (status === "blocked") return "!";
  if (status === "cancelled") return "-";
  return " ";
}

export function renderPlan(plan: PlanState): string {
  const lines: string[] = [`## Active Plan: ${plan.goal || "untitled"}`];
  const shown = plan.tasks.slice(0, MAX_RENDERED_TASKS);
  for (const task of shown) {
    const verify = task.verify ? ` — verify: ${task.verify.slice(0, 140)}` : "";
    const notes = task.notes ? ` — note: ${task.notes.slice(0, 120)}` : "";
    lines.push(`- [${statusMark(task.status)}] ${task.id} ${task.title.slice(0, 180)}${verify}${notes}`);
  }
  if (plan.tasks.length > shown.length) {
    lines.push(`- ... ${plan.tasks.length - shown.length} more tasks`);
  }
  const completed = plan.tasks.filter((task) => task.status === "completed").length;
  lines.push(
    `Progress: ${completed}/${plan.tasks.length} complete. Keep one task in_progress. Use the plan tool to update status. Complete a task only after its verify command passes.`,
  );
  return lines.join("\n");
}

export function renderPlanContext(sessionId?: string): string {
  const plan = loadPlan(sessionId);
  if (!plan) return "";
  return `\n\n${renderPlan(plan)}`;
}

function nextTaskId(tasks: PlanTask[]): string {
  let max = 0;
  for (const task of tasks) {
    const match = /^t(\d+)$/.exec(task.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `t${max + 1}`;
}

function findTask(plan: PlanState, taskId: string): PlanTask | null {
  return plan.tasks.find((task) => task.id === taskId) || null;
}

function verificationOutput(result: ToolResult): string {
  const data = result.data;
  const rendered =
    typeof data === "string"
      ? data
      : data && typeof data === "object"
        ? JSON.stringify(data)
        : data != null
          ? String(data)
          : "";
  return [result.error, rendered].filter(Boolean).join("\n").trim();
}

async function runVerification(task: PlanTask, context?: ToolContext): Promise<PlanVerification> {
  const at = Date.now();
  if (!task.verify) {
    return { success: true, output: "No verification command set.", at };
  }
  const shell = context?.tools?.get("shell");
  if (!shell) {
    return { success: false, output: "Shell tool unavailable for verification.", at };
  }
  const args: Record<string, unknown> = { command: task.verify };
  if (context?.workspaceRoot) args.workdir = context.workspaceRoot;
  const result = await shell.execute(args, context);
  const output = verificationOutput(result).slice(0, 4000);
  return {
    success: result.success,
    output: output || (result.success ? "(no output)" : "verification failed"),
    at,
  };
}

async function completeTask(plan: PlanState, task: PlanTask, context?: ToolContext): Promise<ToolResult> {
  if (task.status === "completed") {
    return { success: true, data: { plan, task, summary: renderPlan(plan) } };
  }
  if (task.verify) {
    const verification = await runVerification(task, context);
    task.lastVerification = verification;
    task.updatedAt = verification.at;
    if (!verification.success) {
      task.status = "in_progress";
      plan.updatedAt = verification.at;
      savePlan(plan);
      return {
        success: false,
        error: `Verification failed for ${task.id}. Fix the issue, then complete it again.`,
        data: { plan, task, verification, summary: renderPlan(plan) },
      };
    }
  }
  task.status = "completed";
  task.completedAt = Date.now();
  task.updatedAt = task.completedAt;
  plan.updatedAt = task.updatedAt;
  savePlan(plan);
  return { success: true, data: { plan, task, summary: renderPlan(plan) } };
}

function planResult(plan: PlanState, extra: Record<string, unknown> = {}): ToolResult {
  return { success: true, data: { plan, summary: renderPlan(plan), ...extra } };
}

export const planTool: Tool = {
  name: "plan",
  description:
    "Maintain a durable task plan for multi-step work. Create a plan before starting, mark exactly one task in_progress, and update statuses as you go. Give code-changing tasks a verify shell command; completing a task runs that command and refuses completion when it fails. Use list to reload the plan after interruptions.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "add", "update", "complete", "verify", "remove", "list", "clear"],
        description: "Action to perform",
      },
      goal: { type: "string", description: "Overall goal (required for create)" },
      tasks: {
        type: "array",
        items: { type: "string" },
        description: "Initial task titles for create",
      },
      taskId: { type: "string", description: "Task id such as t1 (required for update/complete/verify/remove)" },
      title: { type: "string", description: "Task title (for add, or to rename in update)" },
      status: {
        type: "string",
        enum: VALID_STATUSES,
        description: "New status for update. Setting in_progress demotes other in_progress tasks.",
      },
      verify: {
        type: "string",
        description: "Shell command that proves the task is done, for example npm test or npm run build",
      },
      notes: { type: "string", description: "Short notes about progress, blockers, or findings" },
    },
    required: ["action"],
  },
  async execute(args, context) {
    const action = String(args.action || "");
    const sessionId = context?.sessionId || DEFAULT_SESSION;
    const plan = loadPlan(sessionId);

    if (action === "create") {
      const goal = String(args.goal || "").trim();
      if (!goal) return { success: false, error: "goal is required for create" };
      const now = Date.now();
      const titles = Array.isArray(args.tasks)
        ? args.tasks
            .map((title) => String(title).trim())
            .filter(Boolean)
            .slice(0, MAX_TASKS)
        : [];
      const tasks: PlanTask[] = titles.map((title, index) => ({
        id: `t${index + 1}`,
        title,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      }));
      const created: PlanState = { sessionId, goal, tasks, createdAt: now, updatedAt: now };
      savePlan(created);
      return planResult(created);
    }

    if (action === "list") {
      if (!plan) {
        return { success: true, data: { plan: null, summary: "No active plan. Create one for multi-step work." } };
      }
      return planResult(plan);
    }

    if (action === "clear") {
      const removed = clearPlan(sessionId);
      return {
        success: true,
        data: { cleared: removed, summary: removed ? "Plan cleared." : "No active plan." },
      };
    }

    if (!plan) {
      return { success: false, error: "No active plan. Use create first." };
    }

    if (action === "add") {
      const title = String(args.title || "").trim();
      if (!title) return { success: false, error: "title is required for add" };
      if (plan.tasks.length >= MAX_TASKS) {
        return { success: false, error: `Plan already has the maximum of ${MAX_TASKS} tasks` };
      }
      const now = Date.now();
      const task: PlanTask = {
        id: nextTaskId(plan.tasks),
        title,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      };
      if (args.verify) task.verify = String(args.verify).trim();
      if (args.notes) task.notes = String(args.notes).trim();
      plan.tasks.push(task);
      plan.updatedAt = now;
      savePlan(plan);
      return planResult(plan, { task });
    }

    if (action === "update") {
      const taskId = String(args.taskId || "");
      const task = findTask(plan, taskId);
      if (!task) return { success: false, error: `Task not found: ${taskId}` };

      if (args.title) task.title = String(args.title).trim();
      if (args.verify !== undefined) task.verify = String(args.verify).trim() || undefined;
      if (args.notes !== undefined) task.notes = String(args.notes).trim() || undefined;

      if (args.status) {
        const status = String(args.status) as PlanTaskStatus;
        if (!VALID_STATUSES.includes(status)) {
          return { success: false, error: `Invalid status: ${status}` };
        }
        if (status === "completed") {
          return completeTask(plan, task, context);
        }
        if (status === "in_progress") {
          for (const other of plan.tasks) {
            if (other !== task && other.status === "in_progress") other.status = "pending";
          }
        }
        task.status = status;
        task.completedAt = undefined;
      }
      task.updatedAt = Date.now();
      plan.updatedAt = task.updatedAt;
      savePlan(plan);
      return planResult(plan, { task });
    }

    if (action === "complete") {
      const taskId = String(args.taskId || "");
      const task = findTask(plan, taskId);
      if (!task) return { success: false, error: `Task not found: ${taskId}` };
      return completeTask(plan, task, context);
    }

    if (action === "verify") {
      const taskId = args.taskId ? String(args.taskId) : "";
      const selected = taskId
        ? [findTask(plan, taskId)].filter((task): task is PlanTask => task !== null)
        : plan.tasks.filter((task) => task.verify && task.status !== "completed" && task.status !== "cancelled");
      if (selected.length === 0) {
        return {
          success: false,
          error: taskId ? `Task not found: ${taskId}` : "No pending tasks with a verify command",
        };
      }
      const results: { taskId: string; success: boolean; output: string }[] = [];
      const now = Date.now();
      for (const task of selected) {
        const verification = await runVerification(task, context);
        task.lastVerification = verification;
        task.updatedAt = verification.at;
        results.push({ taskId: task.id, success: verification.success, output: verification.output });
      }
      plan.updatedAt = now;
      savePlan(plan);
      const failed = results.filter((result) => !result.success);
      if (failed.length > 0) {
        return {
          success: false,
          error: `Verification failed for ${failed.map((result) => result.taskId).join(", ")}`,
          data: { plan, results, summary: renderPlan(plan) },
        };
      }
      return planResult(plan, { results });
    }

    if (action === "remove") {
      const taskId = String(args.taskId || "");
      const index = plan.tasks.findIndex((task) => task.id === taskId);
      if (index < 0) return { success: false, error: `Task not found: ${taskId}` };
      const [removed] = plan.tasks.splice(index, 1);
      plan.updatedAt = Date.now();
      savePlan(plan);
      return planResult(plan, { removed });
    }

    return { success: false, error: `Unknown action: ${action}` };
  },
};

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Tool } from "../types/index.js";
import { approvalStore, needsApproval } from "./approval.js";
import { auditShellCommand, checkShellCommandSafety } from "./shell.js";

export type BackgroundStatus = "running" | "exited" | "failed" | "killed";

export interface BackgroundProcessInfo {
  id: string;
  command: string;
  workdir: string;
  pid?: number;
  status: BackgroundStatus;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  exitCode: number | null;
  signal: string | null;
  truncated: boolean;
  stdoutLength: number;
  stderrLength: number;
  error?: string;
}

interface BackgroundProcessRecord extends BackgroundProcessInfo {
  child: ChildProcess;
  stdout: string;
  stderr: string;
}

const MAX_ACTIVE = 10;
const MAX_RECORDS = 50;
const MAX_OUTPUT = 200_000;
const DEFAULT_TAIL = 8_000;
const MAX_TAIL = 50_000;
const RETENTION_MS = 60 * 60 * 1000;

const processes = new Map<string, BackgroundProcessRecord>();

function activeCount(): number {
  let count = 0;
  for (const record of processes.values()) {
    if (record.status === "running") count++;
  }
  return count;
}

function prune(): void {
  const cutoff = Date.now() - RETENTION_MS;
  for (const [id, record] of processes) {
    if (record.status !== "running" && record.endedAt !== undefined && record.endedAt < cutoff) {
      processes.delete(id);
    }
  }
  while (processes.size > MAX_RECORDS) {
    const oldest = [...processes.entries()]
      .filter(([, record]) => record.status !== "running")
      .sort((a, b) => (a[1].endedAt ?? 0) - (b[1].endedAt ?? 0))[0];
    if (!oldest) return;
    processes.delete(oldest[0]);
  }
}

function appendOutput(current: string, chunk: string): { text: string; truncated: boolean } {
  const next = current + chunk;
  if (next.length <= MAX_OUTPUT) return { text: next, truncated: false };
  return { text: next.slice(-MAX_OUTPUT), truncated: true };
}

function toInfo(record: BackgroundProcessRecord): BackgroundProcessInfo {
  return {
    id: record.id,
    command: record.command,
    workdir: record.workdir,
    pid: record.pid,
    status: record.status,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    durationMs: record.durationMs,
    exitCode: record.exitCode,
    signal: record.signal,
    truncated: record.truncated,
    stdoutLength: record.stdout.length,
    stderrLength: record.stderr.length,
    error: record.error,
  };
}

function tail(text: string, limit: number): string {
  const safe = Math.max(0, Math.min(Math.floor(limit), MAX_TAIL));
  return text.length <= safe ? text : text.slice(-safe);
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function spawnCommand(command: string, workdir: string): ChildProcess {
  if (process.platform === "win32") {
    const encoded = Buffer.from(command, "utf16le").toString("base64");
    return spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
      cwd: workdir,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  return spawn(command, {
    cwd: workdir,
    shell: true,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function startProcess(command: string, workdir: string): BackgroundProcessRecord {
  const id = `proc_${randomUUID().slice(0, 8)}`;
  const child = spawnCommand(command, workdir);
  const record: BackgroundProcessRecord = {
    id,
    command,
    workdir,
    pid: child.pid,
    status: "running",
    startedAt: Date.now(),
    exitCode: null,
    signal: null,
    truncated: false,
    stdoutLength: 0,
    stderrLength: 0,
    child,
    stdout: "",
    stderr: "",
  };
  processes.set(id, record);

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (data: string) => {
    const next = appendOutput(record.stdout, data);
    record.stdout = next.text;
    record.truncated = record.truncated || next.truncated;
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (data: string) => {
    const next = appendOutput(record.stderr, data);
    record.stderr = next.text;
    record.truncated = record.truncated || next.truncated;
  });
  child.on("error", (error) => {
    if (record.status === "running") record.status = "failed";
    record.error = error.message;
    if (record.endedAt === undefined) record.endedAt = Date.now();
    record.durationMs = (record.endedAt ?? Date.now()) - record.startedAt;
  });
  child.on("close", (code, signal) => {
    record.exitCode = code;
    record.signal = signal;
    if (record.endedAt === undefined) record.endedAt = Date.now();
    record.durationMs = record.endedAt - record.startedAt;
    if (record.status !== "killed") {
      record.status = code === 0 ? "exited" : "failed";
    }
  });

  return record;
}

async function killProcess(record: BackgroundProcessRecord): Promise<void> {
  if (record.status !== "running") return;
  record.status = "killed";
  const pid = record.pid;
  if (process.platform === "win32" && pid) {
    await new Promise<void>((resolve) => {
      execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
    });
    return;
  }
  if (pid) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        record.child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (record.status === "killed" && record.endedAt === undefined && pid) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

async function waitForExit(record: BackgroundProcessRecord, timeoutMs: number): Promise<boolean> {
  if (record.status !== "running") return true;
  return new Promise<boolean>((resolve) => {
    const finish = (exited: boolean) => {
      clearTimeout(timer);
      record.child.off("close", onClose);
      resolve(exited);
    };
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    record.child.once("close", onClose);
  });
}

function processOutput(record: BackgroundProcessRecord, limit: number): { stdout: string; stderr: string } {
  return { stdout: tail(record.stdout, limit), stderr: tail(record.stderr, limit) };
}

export async function killAllBackgroundProcesses(): Promise<void> {
  for (const record of processes.values()) {
    if (record.status === "running") await killProcess(record);
  }
}

export const processTool: Tool = {
  name: "process",
  description:
    "Run and manage background processes such as dev servers, watchers, and long builds. Start returns immediately with an id. Use output to read logs, status or wait to check progress, and kill to stop the process tree. Processes are managed while NTOX is running.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["start", "status", "output", "wait", "list", "kill", "remove"],
        description: "Action to perform",
      },
      command: { type: "string", description: "Command to run (required for start)" },
      workdir: { type: "string", description: "Working directory (default: current workspace)" },
      id: { type: "string", description: "Process id from start (required for status/output/wait/kill/remove)" },
      tail: { type: "number", description: "Characters of output to return per stream (default 8000, max 50000)" },
      timeoutMs: { type: "number", description: "Wait timeout in milliseconds (default 30000, max 60000)" },
    },
    required: ["action"],
  },
  async execute(args) {
    const action = String(args.action || "");

    if (action === "start") {
      const command = String(args.command || "").trim();
      if (!command) return { success: false, error: "command is required for start" };
      const safetyError = checkShellCommandSafety(command);
      if (safetyError) {
        auditShellCommand(command, true);
        return { success: false, error: safetyError };
      }
      if (needsApproval(command)) {
        const decision = approvalStore.check("shell", args);
        if (!decision || decision === "deny") {
          return {
            success: false,
            error: `APPROVAL_REQUIRED: Command "${command}" requires approval. Use approval system to allow or deny.`,
          };
        }
      }
      if (activeCount() >= MAX_ACTIVE) {
        return { success: false, error: `Maximum of ${MAX_ACTIVE} running background processes reached` };
      }
      prune();
      auditShellCommand(command, false);
      const workdir = args.workdir ? String(args.workdir) : process.cwd();
      const record = startProcess(command, workdir);
      return { success: true, data: { process: toInfo(record), ...processOutput(record, DEFAULT_TAIL) } };
    }

    if (action === "list") {
      prune();
      const items = [...processes.values()]
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, 20)
        .map(toInfo);
      return { success: true, data: { processes: items, count: items.length } };
    }

    const id = String(args.id || "");
    if (!id) return { success: false, error: `id is required for ${action}` };
    const record = processes.get(id);
    if (!record) return { success: false, error: `Process not found: ${id} (records are kept while NTOX is running)` };

    if (action === "status") {
      return { success: true, data: { process: toInfo(record) } };
    }

    if (action === "output") {
      const limit = args.tail != null ? finiteNumber(args.tail, DEFAULT_TAIL) : DEFAULT_TAIL;
      return { success: true, data: { process: toInfo(record), ...processOutput(record, limit) } };
    }

    if (action === "wait") {
      const timeoutMs = Math.max(
        0,
        Math.min(args.timeoutMs != null ? finiteNumber(args.timeoutMs, 30_000) : 30_000, 60_000),
      );
      const exited = await waitForExit(record, timeoutMs);
      return {
        success: true,
        data: { process: toInfo(record), exited, ...processOutput(record, DEFAULT_TAIL) },
      };
    }

    if (action === "kill") {
      if (record.status !== "running") {
        return { success: true, data: { process: toInfo(record), alreadyStopped: true } };
      }
      await killProcess(record);
      return { success: true, data: { process: toInfo(record) } };
    }

    if (action === "remove") {
      if (record.status === "running") {
        return { success: false, error: "Cannot remove a running process. Kill it first." };
      }
      processes.delete(id);
      return { success: true, data: { removed: id } };
    }

    return { success: false, error: `Unknown action: ${action}` };
  },
};

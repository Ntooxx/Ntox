import { existsSync, readFileSync } from "node:fs";
import { resolve, relative, isAbsolute, join } from "node:path";
import type { PolicyDecision, Tool, ToolResult, WorkspaceProfile } from "../types/index.js";
import { checkpointTool } from "../tools/checkpoint.js";
import { NTOX_DIR } from "./config.js";

export interface PolicyRuntime {
  profile: WorkspaceProfile;
  decisions: PolicyDecision[];
  checkpointIds: string[];
}

const READ_TOOLS = new Set(["read", "ls", "glob", "grep", "checkpoint"]);
const WRITE_TOOLS = new Set(["write", "edit"]);
const NETWORK_TOOLS = new Set(["web_fetch", "web_read", "search", "browse"]);
const PATH_KEYS: Record<string, string[]> = {
  read: ["path"],
  write: ["path"],
  edit: ["filePath"],
  ls: ["path"],
  glob: ["path"],
  grep: ["path"],
  shell: ["workdir"],
  checkpoint: ["path"],
};

export function createDefaultProfile(root = process.cwd()): WorkspaceProfile {
  const workspaceRoot = resolve(root);
  return {
    id: "default",
    name: "Default Workspace",
    workspaceRoot,
    readRoots: [workspaceRoot],
    writeRoots: [workspaceRoot],
    allowedTools: [],
    shellPolicy: "approval-required",
    networkPolicy: "browser-allowed",
    autoCheckpoint: true,
  };
}

export function getDefaultProfile(profiles: WorkspaceProfile[], id: string): WorkspaceProfile {
  return profiles.find((p) => p.id === id) || profiles[0] || createDefaultProfile();
}

export function createPolicyRuntime(profile: WorkspaceProfile): PolicyRuntime {
  return { profile, decisions: [], checkpointIds: [] };
}

export function resetPolicyRuntime(runtime: PolicyRuntime): void {
  runtime.decisions.length = 0;
  runtime.checkpointIds.length = 0;
}

export function isWithinRoot(path: string, roots: string[]): boolean {
  const abs = resolve(path);
  return roots.some((root) => {
    const rel = relative(resolve(root), abs);
    return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
  });
}

function argPath(args: Record<string, unknown>, key: string, fallback: string): string {
  const raw = args[key] ? String(args[key]) : fallback;
  return resolve(raw);
}

function record(runtime: PolicyRuntime, tool: string, allowed: boolean, reason: string, path?: string): PolicyDecision {
  const decision = { tool, allowed, reason, path, timestamp: Date.now() };
  runtime.decisions.push(decision);
  return decision;
}

function deny(runtime: PolicyRuntime, tool: string, reason: string, path?: string): ToolResult {
  record(runtime, tool, false, reason, path);
  return { success: false, error: `POLICY_DENIED: ${reason}` };
}

function checkNetwork(runtime: PolicyRuntime, tool: string, args: Record<string, unknown>): ToolResult | null {
  const policy = runtime.profile.networkPolicy;
  if (policy === "disabled") return deny(runtime, tool, `Network disabled for profile ${runtime.profile.id}`);
  if (tool === "browse" && policy !== "browser-allowed") {
    return deny(runtime, tool, `Browser disabled for profile ${runtime.profile.id}`);
  }
  if (tool === "web_read") {
    args.allowBrowserFallback = policy === "browser-allowed";
    if (args.preferBrowser === true && policy !== "browser-allowed") {
      return deny(runtime, tool, `Browser disabled for profile ${runtime.profile.id}`);
    }
  }
  record(runtime, tool, true, `Network allowed by ${policy}`);
  return null;
}

function checkPaths(runtime: PolicyRuntime, tool: string, args: Record<string, unknown>): ToolResult | null {
  const keys = PATH_KEYS[tool] || [];
  const fallback = tool === "shell" || tool === "ls" || tool === "glob" || tool === "grep"
    ? runtime.profile.workspaceRoot
    : "";
  for (const key of keys) {
    if (!args[key] && !fallback) {
      if (tool === "checkpoint") continue;
      return deny(runtime, tool, `Missing required path argument: ${key}`);
    }
    const path = argPath(args, key, fallback);
    if (tool === "shell") {
      if (runtime.profile.shellPolicy === "disabled") return deny(runtime, tool, `Shell disabled for profile ${runtime.profile.id}`, path);
      if (!isWithinRoot(path, [runtime.profile.workspaceRoot])) return deny(runtime, tool, `Shell workdir outside workspace`, path);
      record(runtime, tool, true, `Shell allowed in workspace`, path);
      args.workdir = path;
      continue;
    }
    if (tool === "checkpoint") {
      const action = String(args.action || "");
      if (action === "rollback") {
        const checkpointId = String(args.checkpointId || "");
        if (!checkpointId) return deny(runtime, tool, "checkpointId is required for rollback");
        try {
          const cp = JSON.parse(readFileSync(join(NTOX_DIR, "checkpoints", `${checkpointId}.json`), "utf-8")) as { originalPath?: string };
          if (!cp.originalPath || !isWithinRoot(cp.originalPath, runtime.profile.writeRoots)) {
            return deny(runtime, tool, "Checkpoint rollback target outside write roots", cp.originalPath);
          }
        } catch {
          return deny(runtime, tool, "Checkpoint not readable for policy check");
        }
      }
      if (action === "rollback" || action === "create") {
        const roots = action === "rollback" ? runtime.profile.writeRoots : runtime.profile.readRoots;
        if (args.path && !isWithinRoot(path, roots)) return deny(runtime, tool, `Checkpoint ${action} outside allowed roots`, path);
      }
      record(runtime, tool, true, `Checkpoint allowed`, path);
      continue;
    }
    const roots = WRITE_TOOLS.has(tool) ? runtime.profile.writeRoots : runtime.profile.readRoots;
    if (!isWithinRoot(path, roots)) return deny(runtime, tool, `${tool} path outside allowed roots`, path);
    record(runtime, tool, true, `${tool} path allowed`, path);
    if (key in args) args[key] = path;
  }
  return null;
}

async function maybeCheckpoint(runtime: PolicyRuntime, tool: string, args: Record<string, unknown>): Promise<string | null> {
  if (!runtime.profile.autoCheckpoint || !WRITE_TOOLS.has(tool)) return null;
  const path = tool === "edit" ? String(args.filePath || "") : String(args.path || "");
  if (!path || !existsSync(path)) return null;
  if (!isWithinRoot(path, runtime.profile.writeRoots)) return null;
  const before = readFileSync(path, "utf-8");
  const result = await checkpointTool.execute({ action: "create", path });
  if (result.success && result.data && typeof result.data === "object" && "checkpointId" in result.data) {
    const checkpointId = String((result.data as { checkpointId: unknown }).checkpointId);
    runtime.checkpointIds.push(checkpointId);
    return checkpointId;
  } else if (before.length >= 0) {
    record(runtime, tool, false, `Auto-checkpoint failed before ${tool}`, path);
  }
  return null;
}

function attachCheckpoint(result: ToolResult, checkpointId: string | null): ToolResult {
  if (!checkpointId || !result.success) return result;
  const data = result.data && typeof result.data === "object" && !Array.isArray(result.data)
    ? { ...result.data as Record<string, unknown>, autoCheckpointId: checkpointId }
    : { result: result.data, autoCheckpointId: checkpointId };
  return { ...result, data };
}

export function enforceToolPolicy(tool: Tool, runtime: PolicyRuntime): Tool {
  return {
    ...tool,
    async execute(args) {
      if (runtime.profile.allowedTools.length > 0 && !runtime.profile.allowedTools.includes(tool.name)) {
        return deny(runtime, tool.name, `Tool not allowed for profile ${runtime.profile.id}`);
      }
      if (NETWORK_TOOLS.has(tool.name)) {
        const networkDecision = checkNetwork(runtime, tool.name, args);
        if (networkDecision) return networkDecision;
      }
      if (READ_TOOLS.has(tool.name) || WRITE_TOOLS.has(tool.name) || tool.name === "shell") {
        const pathDecision = checkPaths(runtime, tool.name, args);
        if (pathDecision) return pathDecision;
      } else {
        record(runtime, tool.name, true, "Tool allowed");
      }
      const checkpointId = await maybeCheckpoint(runtime, tool.name, args);
      return attachCheckpoint(await tool.execute(args), checkpointId);
    },
  };
}

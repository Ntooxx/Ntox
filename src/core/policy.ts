import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, relative, isAbsolute, join, dirname, basename } from "node:path";
import type { NetworkPolicy, PolicyDecision, Tool, ToolContext, ToolResult, WorkspaceProfile } from "../types/index.js";
import { checkpointTool } from "../tools/checkpoint.js";
import { hasInteractiveApproval, requestInteractiveApproval } from "../tools/approval.js";
import { CONFIG_PATH, NTOX_DIR, MEMORY_DIR, loadConfig, saveConfig } from "./config.js";
import { MEDIA_DIR } from "./media.js";

export interface PolicyRuntime {
  profile: WorkspaceProfile;
  decisions: PolicyDecision[];
  checkpointIds: string[];
}

export type PolicyGrant =
  | { kind: "tool"; tool: string }
  | { kind: "roots"; read?: string[]; write?: string[] }
  | { kind: "shell" }
  | { kind: "network"; policy: NetworkPolicy };

export interface PolicyDenial {
  tool: string;
  reason: string;
  path?: string;
  grant?: PolicyGrant;
  fix?: string;
}

export type PolicyDenialOutcome = "blocked" | "declined" | "unapproved";

export interface PolicyOptions {
  persistGrant?: (profileId: string, grant: PolicyGrant) => void;
}

const READ_TOOLS = new Set(["read", "ls", "glob", "grep", "checkpoint", "open"]);
const WRITE_TOOLS = new Set(["write", "edit"]);
const NETWORK_TOOLS = new Set(["web_fetch", "web_read", "search", "browse", "email_send", "email_read"]);
const URL_VALUE_PATTERN = /^https?:\/\//i;
const IMAGE_PATH_PATTERN = /\.(png|jpe?g|gif|webp|bmp)$/i;
const IMAGE_PATH_MAX = 1024;
const PATH_KEYS: Record<string, string[]> = {
  read: ["path"],
  write: ["path"],
  edit: ["filePath"],
  ls: ["path"],
  glob: ["path"],
  grep: ["path"],
  shell: ["workdir"],
  process: ["workdir"],
  checkpoint: ["path"],
  open: ["path"],
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
    memoryAccess: "summaries",
  };
}

export function getDefaultProfile(profiles: WorkspaceProfile[], id: string): WorkspaceProfile {
  return profiles.find((p) => p.id === id) || profiles[0] || createDefaultProfile();
}

export function scopeDefaultProfile(profile: WorkspaceProfile, cwd: string): WorkspaceProfile {
  const rebase = (roots: string[]) => {
    const updated = [...new Set(roots.map((root) => (root === profile.workspaceRoot ? cwd : root)))];
    return [cwd, ...updated.filter((root) => root !== cwd && !isWithinRoot(root, [cwd]))];
  };
  return {
    ...profile,
    workspaceRoot: cwd,
    readRoots: rebase(profile.readRoots),
    writeRoots: rebase(profile.writeRoots),
  };
}

export function createPolicyRuntime(profile: WorkspaceProfile): PolicyRuntime {
  return { profile, decisions: [], checkpointIds: [] };
}

export function resetPolicyRuntime(runtime: PolicyRuntime): void {
  runtime.decisions.length = 0;
  runtime.checkpointIds.length = 0;
}

/**
 * Canonical form of a path for policy comparison, fail closed:
 * - resolves symlinks/junctions via realpath;
 * - for nonexistent components, walks up to the deepest existing ancestor (ENOENT is safe:
 *   a missing component cannot be a symlink) and reattaches the missing tail;
 * - any resolution failure other than ENOENT (EACCES, ELOOP, ENOTDIR, ...) returns null —
 *   ancestry that cannot be verified must never be trusted;
 * - strips Windows long-path prefixes and trailing dot/space quirks, case-folds on win32.
 * Lexical `resolve()` still collapses `..` traversal before this runs.
 */
function canonicalize(p: string): string | null {
  let abs = resolve(p);
  if (process.platform === "win32") {
    abs = abs.replace(/^\\\\\?\\/, "").replace(/[. ]+$/, "");
  }
  const tail: string[] = [];
  for (let depth = 0; depth < 64; depth++) {
    try {
      const real = realpathSync(abs);
      if (tail.length > 0) {
        // Children can only safely be appended below a DIRECTORY (Windows reports
        // file-as-directory as ENOENT); anything else is unsafe ancestry -> fail closed.
        try {
          if (!statSync(real).isDirectory()) return null;
        } catch {
          return null;
        }
      }
      const full = tail.length > 0 ? join(real, ...tail) : real;
      if (process.platform === "win32") return full.replace(/^\\\\\?\\/, "").toLowerCase();
      return full;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
      const parent = dirname(abs);
      if (parent === abs) return null;
      tail.unshift(basename(abs));
      abs = parent;
    }
  }
  return null;
}

function withinCanonical(canonicalPath: string, root: string): boolean {
  const canonicalRoot = canonicalize(root);
  if (!canonicalRoot) return false;
  const rel = relative(canonicalRoot, canonicalPath);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

export function isWithinRoot(path: string, roots: string[]): boolean {
  const abs = canonicalize(path);
  if (!abs) return false; // fail closed: unresolved ancestry is never "within"
  return roots.some((root) => withinCanonical(abs, root));
}

type MemoryVerdict = "allow" | "deny" | "outside" | "unresolved";

function memoryDenyReason(verdict: MemoryVerdict, profile: WorkspaceProfile, what: string): string {
  if (verdict === "unresolved") {
    return `Unsafe path: ancestry could not be resolved (fail closed) during ${what} check`;
  }
  return `Memory access denied for ${what} (memoryAccess=${profile.memoryAccess ?? "summaries"}, profile ${profile.id})`;
}

function memoryFix(profile: WorkspaceProfile): string | undefined {
  const scope = profile.memoryAccess ?? "summaries";
  if (scope === "full") return undefined;
  return `Set memoryAccess to "full" for profile ${profile.id} in ${CONFIG_PATH} to authorize raw memory access.`;
}

/**
 * Deciding layer for paths inside MEMORY_DIR — evaluated BEFORE ordinary roots, so a
 * memoryAccess denial overrides workspace/read/write permissions even when MEMORY_DIR
 * sits inside an authorized root (and an authorized memory verdict grants access that
 * roots alone would not). Retrieval (prompt injection) never routes through this check:
 * content-to-model is not file authority. Environment variables are never consulted.
 */
function memoryVerdict(path: string, profile: WorkspaceProfile, op: "read" | "write" | "cwd"): MemoryVerdict {
  const canonical = canonicalize(path);
  if (!canonical) return "unresolved";
  const canonicalMemory = canonicalize(MEMORY_DIR);
  if (!canonicalMemory || !withinCanonical(canonical, canonicalMemory)) return "outside";
  const scope = profile.memoryAccess ?? "summaries";
  if (scope === "deny") return "deny";
  if (scope === "full") return "allow";
  // "summaries": read-only access to memory.md; raw episodic files stay private,
  // and nothing may use the memory directory as a working directory.
  return op === "read" && basename(canonical) === "memory.md" ? "allow" : "deny";
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

function deny(
  runtime: PolicyRuntime,
  tool: string,
  reason: string,
  path?: string,
  grant?: PolicyGrant,
  fix?: string,
): PolicyDenial {
  record(runtime, tool, false, reason, path);
  return { tool, reason, path, grant, fix };
}

function denialResult(denial: PolicyDenial, outcome: PolicyDenialOutcome): ToolResult {
  const base = `POLICY_DENIED: ${denial.reason}`;
  if (outcome === "declined") {
    return {
      success: false,
      error: `${base}. The user denied this request — do not retry it; explain the blocker and ask how they would like to proceed instead.`,
    };
  }
  if (outcome === "unapproved") {
    return {
      success: false,
      error: `${base}. No approval arrived — grant it in ${CONFIG_PATH} (allowedTools, readRoots/writeRoots, shellPolicy, networkPolicy) or approve the prompt when it appears.`,
    };
  }
  return { success: false, error: `${base}.${denial.fix ? ` ${denial.fix}` : ""}` };
}

function approvalRequest(denial: PolicyDenial): string {
  const detail = denial.path ? `${denial.reason} — ${denial.path}` : denial.reason;
  return `policy ${denial.tool}: ${detail}`.slice(0, 400);
}

export function applyPolicyGrant(profile: WorkspaceProfile, grant: PolicyGrant): void {
  if (grant.kind === "tool") {
    if (profile.allowedTools.length > 0 && !profile.allowedTools.includes(grant.tool)) {
      profile.allowedTools.push(grant.tool);
    }
    return;
  }
  if (grant.kind === "roots") {
    for (const root of grant.write ?? []) if (!profile.writeRoots.includes(root)) profile.writeRoots.push(root);
    for (const root of grant.read ?? []) if (!profile.readRoots.includes(root)) profile.readRoots.push(root);
    return;
  }
  if (grant.kind === "shell") {
    profile.shellPolicy = "approval-required";
    return;
  }
  profile.networkPolicy = grant.policy;
}

export function persistPolicyGrant(profileId: string, grant: PolicyGrant): void {
  try {
    const config = loadConfig();
    const target = config.profiles.find((profile) => profile.id === profileId);
    if (!target) return;
    applyPolicyGrant(target, grant);
    saveConfig(config);
  } catch {
    /* the in-memory grant still holds for this session */
  }
}

function networkFix(profile: WorkspaceProfile): string {
  return `Set networkPolicy to "browser-allowed" for profile ${profile.id} in ${CONFIG_PATH} to allow it.`;
}

function checkNetwork(runtime: PolicyRuntime, tool: string, args: Record<string, unknown>): PolicyDenial | null {
  const policy = runtime.profile.networkPolicy;
  const grant: PolicyGrant = { kind: "network", policy: "browser-allowed" };
  const fix = networkFix(runtime.profile);
  if (policy === "disabled") {
    return deny(runtime, tool, `Network disabled for profile ${runtime.profile.id}`, undefined, grant, fix);
  }
  if (tool === "browse" && policy !== "browser-allowed") {
    return deny(runtime, tool, `Browser disabled for profile ${runtime.profile.id}`, undefined, grant, fix);
  }
  if (tool === "web_read") {
    args.allowBrowserFallback = policy === "browser-allowed";
    if (args.preferBrowser === true && policy !== "browser-allowed") {
      return deny(runtime, tool, `Browser disabled for profile ${runtime.profile.id}`, undefined, grant, fix);
    }
  }
  record(runtime, tool, true, `Network allowed by ${policy}`);
  return null;
}

function checkPaths(runtime: PolicyRuntime, tool: string, args: Record<string, unknown>): PolicyDenial | null {
  const keys = PATH_KEYS[tool] || [];
  const fallback =
    tool === "shell" || tool === "process" || tool === "ls" || tool === "glob" || tool === "grep"
      ? runtime.profile.workspaceRoot
      : "";
  const isWrite = WRITE_TOOLS.has(tool);
  const rootFix = (target: string, scope: "read" | "write") =>
    `Add ${target} to the ${scope} roots of profile ${runtime.profile.id} in ${CONFIG_PATH} to allow it.`;
  for (const key of keys) {
    if (!args[key] && !fallback) {
      if (tool === "checkpoint") continue;
      return deny(runtime, tool, `Missing required path argument: ${key}`);
    }
    const rawValue = typeof args[key] === "string" ? args[key].trim() : "";
    if (URL_VALUE_PATTERN.test(rawValue)) {
      if (runtime.profile.networkPolicy === "disabled") {
        return deny(
          runtime,
          tool,
          `Network disabled for profile ${runtime.profile.id}`,
          rawValue,
          { kind: "network", policy: "browser-allowed" },
          networkFix(runtime.profile),
        );
      }
      record(runtime, tool, true, `${tool} url allowed`, rawValue);
      continue;
    }
    const path = argPath(args, key, fallback);
    if (tool === "shell" || tool === "process") {
      if (runtime.profile.shellPolicy === "disabled")
        return deny(
          runtime,
          tool,
          `Shell disabled for profile ${runtime.profile.id}`,
          path,
          { kind: "shell" },
          `Set shellPolicy to "approval-required" for profile ${runtime.profile.id} in ${CONFIG_PATH} to allow it.`,
        );
      // Memory verdict decides first: denial overrides workspace roots (memory may live
      // inside them); shell/process are never path-sandboxed beyond workdir — memory-isolated
      // trials disable them via config (shellPolicy: "disabled"), stronger containment is
      // the Docker sandbox's job, not command inspection.
      const shellMem = memoryVerdict(path, runtime.profile, "cwd");
      if (shellMem === "deny" || shellMem === "unresolved") {
        return deny(
          runtime,
          tool,
          memoryDenyReason(shellMem, runtime.profile, "shell working directory"),
          path,
          { kind: "roots", read: [path], write: [path] },
          memoryFix(runtime.profile),
        );
      }
      if (
        shellMem === "outside" &&
        !isWithinRoot(path, [runtime.profile.workspaceRoot, ...runtime.profile.writeRoots])
      ) {
        return deny(
          runtime,
          tool,
          `Shell workdir outside workspace`,
          path,
          { kind: "roots", read: [path], write: [path] },
          rootFix(path, "write"),
        );
      }
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
          const cp = JSON.parse(readFileSync(join(NTOX_DIR, "checkpoints", `${checkpointId}.json`), "utf-8")) as {
            originalPath?: string;
          };
          if (!cp.originalPath || !isWithinRoot(cp.originalPath, runtime.profile.writeRoots)) {
            return deny(
              runtime,
              tool,
              "Checkpoint rollback target outside write roots",
              cp.originalPath,
              cp.originalPath ? { kind: "roots", write: [cp.originalPath] } : undefined,
              cp.originalPath ? rootFix(cp.originalPath, "write") : undefined,
            );
          }
        } catch {
          return deny(runtime, tool, "Checkpoint not readable for policy check");
        }
      }
      if (action === "rollback" || action === "create") {
        const scope: "read" | "write" = action === "rollback" ? "write" : "read";
        const roots = action === "rollback" ? runtime.profile.writeRoots : runtime.profile.readRoots;
        if (args.path) {
          const mem = memoryVerdict(path, runtime.profile, scope);
          if (mem === "deny" || mem === "unresolved") {
            const grant: PolicyGrant =
              scope === "write" ? { kind: "roots", write: [path] } : { kind: "roots", read: [path] };
            return deny(
              runtime,
              tool,
              memoryDenyReason(mem, runtime.profile, `checkpoint ${action}`),
              path,
              grant,
              memoryFix(runtime.profile),
            );
          }
          if (mem === "outside" && !isWithinRoot(path, roots)) {
            const grant: PolicyGrant =
              scope === "write" ? { kind: "roots", write: [path] } : { kind: "roots", read: [path] };
            return deny(runtime, tool, `Checkpoint ${action} outside allowed roots`, path, grant, rootFix(path, scope));
          }
        }
      }
      record(runtime, tool, true, `Checkpoint allowed`, path);
      continue;
    }
    const roots = isWrite ? runtime.profile.writeRoots : runtime.profile.readRoots;
    const op: "read" | "write" = isWrite ? "write" : "read";
    const mem = memoryVerdict(path, runtime.profile, op);
    if (mem === "deny" || mem === "unresolved") {
      const grant: PolicyGrant = isWrite ? { kind: "roots", write: [path] } : { kind: "roots", read: [path] };
      return deny(runtime, tool, memoryDenyReason(mem, runtime.profile, op), path, grant, memoryFix(runtime.profile));
    }
    if (mem === "outside" && !isWithinRoot(path, roots)) {
      const scope: "read" | "write" = isWrite ? "write" : "read";
      const grant: PolicyGrant = isWrite ? { kind: "roots", write: [path] } : { kind: "roots", read: [path] };
      return deny(runtime, tool, `${tool} path outside allowed roots`, path, grant, rootFix(path, scope));
    }
    record(runtime, tool, true, `${tool} path allowed`, path);
    if (key in args) args[key] = path;
  }
  return null;
}

async function maybeCheckpoint(
  runtime: PolicyRuntime,
  tool: string,
  args: Record<string, unknown>,
): Promise<string | null> {
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
  const data =
    result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? { ...(result.data as Record<string, unknown>), autoCheckpointId: checkpointId }
      : { result: result.data, autoCheckpointId: checkpointId };
  return { ...result, data };
}

function checkImageArg(runtime: PolicyRuntime, args: Record<string, unknown>): PolicyDenial | null {
  const raw = typeof args.image === "string" ? args.image.trim() : "";
  if (!raw) return null;
  if (raw.startsWith("data:")) {
    record(runtime, "image", true, "Inline image data allowed");
    return null;
  }
  if (URL_VALUE_PATTERN.test(raw)) {
    if (runtime.profile.networkPolicy === "disabled") {
      return deny(
        runtime,
        "image",
        `Network disabled for profile ${runtime.profile.id}`,
        raw,
        { kind: "network", policy: "browser-allowed" },
        networkFix(runtime.profile),
      );
    }
    record(runtime, "image", true, "image url allowed", raw);
    return null;
  }
  const looksLikePath =
    raw.length < IMAGE_PATH_MAX && (isAbsolute(raw) || existsSync(raw) || IMAGE_PATH_PATTERN.test(raw));
  if (!looksLikePath) {
    record(runtime, "image", true, "Inline image data allowed");
    return null;
  }
  const path = resolve(raw);
  const mem = memoryVerdict(path, runtime.profile, "read");
  if (mem === "deny" || mem === "unresolved") {
    return deny(
      runtime,
      "image",
      memoryDenyReason(mem, runtime.profile, "image read"),
      path,
      undefined,
      memoryFix(runtime.profile),
    );
  }
  if (mem === "allow" || isWithinRoot(path, runtime.profile.readRoots) || isWithinRoot(path, [MEDIA_DIR])) {
    record(runtime, "image", true, "image path allowed", path);
    args.image = path;
    return null;
  }
  return deny(
    runtime,
    "image",
    "image path outside allowed roots",
    path,
    { kind: "roots", read: [path] },
    `Add ${path} to the read roots of profile ${runtime.profile.id} in ${CONFIG_PATH} to allow it.`,
  );
}

function allowlistCheck(runtime: PolicyRuntime, tool: string): PolicyDenial | null {
  if (runtime.profile.allowedTools.length === 0 || runtime.profile.allowedTools.includes(tool)) return null;
  return deny(
    runtime,
    tool,
    `Tool not allowed for profile ${runtime.profile.id}`,
    undefined,
    { kind: "tool", tool },
    `Add "${tool}" to allowedTools of profile ${runtime.profile.id} in ${CONFIG_PATH} to allow it.`,
  );
}

export function enforceToolPolicy(tool: Tool, runtime: PolicyRuntime, options: PolicyOptions = {}): Tool {
  const persistGrant = options.persistGrant ?? persistPolicyGrant;
  return {
    ...tool,
    async execute(args, context?: ToolContext) {
      const gated: (() => PolicyDenial | null)[] = [];
      if (NETWORK_TOOLS.has(tool.name)) {
        gated.push(() => checkNetwork(runtime, tool.name, args));
      } else if (tool.name === "image") {
        gated.push(() => checkImageArg(runtime, args));
      } else if (
        READ_TOOLS.has(tool.name) ||
        WRITE_TOOLS.has(tool.name) ||
        tool.name === "shell" ||
        tool.name === "process"
      ) {
        gated.push(() => checkPaths(runtime, tool.name, args));
      } else {
        gated.push(() => {
          record(runtime, tool.name, true, "Tool allowed");
          return null;
        });
      }
      const checks = [() => allowlistCheck(runtime, tool.name), ...gated];

      let asked = false;
      let index = 0;
      for (;;) {
        let denial: PolicyDenial | null = null;
        let deniedAt = index;
        for (; deniedAt < checks.length; deniedAt++) {
          denial = checks[deniedAt]();
          if (denial) break;
        }
        if (!denial) break;
        const grant = denial.grant;
        if (!grant || asked || !hasInteractiveApproval()) return denialResult(denial, "blocked");

        asked = true;
        const decision = await requestInteractiveApproval(tool.name, approvalRequest(denial));
        if (decision === "deny") return denialResult(denial, "declined");
        if (!decision) return denialResult(denial, "unapproved");
        if (decision === "allow-once") {
          record(runtime, denial.tool, true, `Allowed once by user approval`, denial.path);
          index = deniedAt + 1;
          continue;
        }

        applyPolicyGrant(runtime.profile, grant);
        const scope = decision === "allow-always" ? "permanently" : "for this session";
        record(runtime, denial.tool, true, `Allowed ${scope} by user approval`, denial.path);
        if (decision === "allow-always") persistGrant(runtime.profile.id, grant);
        index = 0;
      }

      const checkpointId = await maybeCheckpoint(runtime, tool.name, args);
      return attachCheckpoint(await tool.execute(args, context), checkpointId);
    },
  };
}

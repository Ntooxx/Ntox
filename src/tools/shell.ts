import { exec } from "node:child_process";
import { appendFileSync } from "node:fs";
import type { Tool } from "../types/index.js";
import { CONFIG_PATH, getBaseDir, loadConfig } from "../core/config.js";
import { approvalStore, buildApprovalKey, needsApproval, requestInteractiveApproval } from "./approval.js";

const IS_WINDOWS = process.platform === "win32";

const BLOCKED_PATTERNS = [
  /\brm\s+-[a-z]*r[a-z]*\s+\/(?:\s|$)/i,
  /\brm\s+-[a-z]*r[a-z]*\s+\//i,
  /\brm\s+-[a-z]*r[a-z]*\s+~/i,
  /\brm\s+-[a-z]*r[a-z]*\s+\$HOME\b/i,
  /\brm\s+-rf\s+/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\(\s*\)\s*\{[^}]*\|[^}]*&\s*\}/i,
  /\b:\s*\(\s*\)\s*\{[^}]*\|[^}]*&\s*\}/i,
  /\bcurl\s+.*\|\s*(?:ba)?sh\b/i,
  /\bwget\s+.*\|\s*(?:ba)?sh\b/i,
  /\b>?\s*\/(?:dev|proc|sys)\//i,
  /\bchmod\s+777\b/i,
  /\bsudo\b/i,
  /\b(shutdown|reboot|halt|poweroff|init\s+[06])\b/i,
  /\bdel\s+\/[fq]\s*\/s\s+[A-Z]:\\/i,
  /\brmdir\s+\/[sq]\s+[A-Z]:\\/i,
  /\bformat\s+[A-Z]:/i,
  /\breg\s+delete\b/i,
  /\bdiskpart\b/i,
  /\bbcdedit\b/i,
  /\bRemove-Item\b.*-Recurse/i,
  /\bInvoke-WebRequest\b.*\|\s*Invoke-Expression/i,
  /\bInvoke-RestMethod\b.*\|\s*Invoke-Expression/i,
  /\bInvoke-Expression\b/i,
  /\bSet-MpPreference\b.*-Disable/i,
  /\bClear-RecycleBin\b/i,
  /\bNew-LocalUser\b/i,
  /\bAdd-MpPreference\b.*-Exclusion/i,
  /\bStart-Process\b.*-FilePath.*-WindowStyle\s+Hidden/i,
];

const CODE_FRAGMENT_PATTERNS = [
  /^\s*[<>{}]/,
  /^\s*```/,
  /<tool_call/i,
  /^\s*function\s+\w+\s*\(/m,
  /^\s*(import|export)\s+/m,
];

const HERE_STRING_PATTERN = /@(['"])\r?\n[\s\S]*?\r?\n[ \t]*\1@/g;

export function maskHereStrings(command: string): string {
  return command.replace(HERE_STRING_PATTERN, (match, quote: string) => `@${quote}\n<content elided>\n${quote}@`);
}

const WINDOWS_UNIX_COMMAND_PATTERNS = [
  /\|\s*head\b/i,
  /\|\s*tail\b/i,
  /\|\s*grep\b/i,
  /\bls\s+-[a-z]*[la][a-z]*\b/i,
  /\bcat\s+[^|>]+/i,
  /\bsed\s+['"-]/i,
  /\bawk\s+['"-]/i,
];

export function detectRmRecursiveForce(command: string): boolean {
  const segments = command.split(/[;&|]/);
  for (const segment of segments) {
    const rmMatch = segment.match(/\brm\b(.*)/i);
    if (!rmMatch) continue;
    const tokens = rmMatch[1].split(/\s+/).filter(Boolean);
    let hasR = false;
    let hasF = false;
    for (const token of tokens) {
      if (token.startsWith("--")) {
        if (token === "--recursive") hasR = true;
        if (token === "--force") hasF = true;
        continue;
      }
      if (token.startsWith("-") && token.length > 1) {
        const flags = token.slice(1);
        if (flags.includes("r") || flags.includes("R")) hasR = true;
        if (flags.includes("f") || flags.includes("F")) hasF = true;
      }
    }
    if (hasR && hasF) return true;
  }
  return false;
}

export function validateShellCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return "Command is empty";
  const structural = maskHereStrings(trimmed);
  if (CODE_FRAGMENT_PATTERNS.some((pattern) => pattern.test(structural))) {
    return "Rejected shell command because it looks like code or malformed tool XML, not a command";
  }
  if (IS_WINDOWS && WINDOWS_UNIX_COMMAND_PATTERNS.some((pattern) => pattern.test(structural))) {
    return "Rejected Unix-style command on Windows. Use PowerShell equivalents such as Get-ChildItem, Select-String, or Select-Object -First.";
  }
  return null;
}

export function checkShellCommandSafety(command: string): string | null {
  const invalidReason = validateShellCommand(command);
  if (invalidReason) return invalidReason;
  const hit = BLOCKED_PATTERNS.find((pattern) => pattern.test(command));
  if (hit) return `Command blocked by safety policy (matched ${hit}): "${command}"`;
  if (detectRmRecursiveForce(command)) {
    return `Command blocked by safety policy (matched recursive+force rm flags): "${command}"`;
  }
  return null;
}

export function auditShellCommand(command: string, blocked: boolean): void {
  try {
    const line = `[${new Date().toISOString()}]${blocked ? " [BLOCKED]" : ""} ${command}\n`;
    appendFileSync(getBaseDir() + "/shell-audit.log", line);
  } catch {
    /* best effort */
  }
}

function execAsync(
  command: string,
  options: { cwd?: string; timeout?: number; maxBuffer?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(
      command,
      {
        cwd: options.cwd,
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
        windowsHide: true,
        encoding: "utf-8",
      },
      (error, stdout, stderr) => {
        if (error) {
          (error as NodeJS.ErrnoException & { stdout: string; stderr: string }).stdout = stdout || "";
          (error as NodeJS.ErrnoException & { stdout: string; stderr: string }).stderr = stderr || "";
          reject(error);
        } else {
          resolve({ stdout: stdout || "", stderr: stderr || "" });
        }
      },
    );
  });
}

type DockerProbe = () => Promise<boolean>;

function probeDocker(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = exec("docker --version", { timeout: 2500, windowsHide: true }, (error) => {
      resolve(!error);
    });
    probe.on("error", () => resolve(false));
  });
}

let dockerProbe: Promise<boolean> | null = null;
let probeDockerAvailability: DockerProbe = probeDocker;

export function setDockerProbe(probe: DockerProbe | null): void {
  probeDockerAvailability = probe ?? probeDocker;
  dockerProbe = null;
}

function dockerAvailable(): Promise<boolean> {
  if (!dockerProbe) dockerProbe = probeDockerAvailability().catch(() => false);
  return dockerProbe;
}

export type SandboxMode = "docker" | "host" | "denied";

export interface SandboxDecisionInput {
  dockerEnabled: boolean;
  isWindows: boolean;
  dockerAvailable: boolean;
}

export function decideSandbox(input: SandboxDecisionInput): SandboxMode {
  if (input.dockerEnabled) return input.dockerAvailable ? "docker" : "denied";
  if (input.dockerAvailable && !input.isWindows) return "docker";
  return "host";
}

function dockerExec(command: string, workdir: string, timeout: number): Promise<{ stdout: string; stderr: string }> {
  const absWorkdir = workdir.replace(/\\/g, "/");
  const escaped = command.replace(/"/g, '\\"');
  const dockerCmd = IS_WINDOWS
    ? `docker run --rm -v "${absWorkdir}:/workspace" -w /workspace --network none alpine:latest sh -c "${escaped}"`
    : `docker run --rm -v "${absWorkdir}:/workspace" -w /workspace --network none alpine:latest sh -c '${command.replace(/'/g, "'\\''")}'`;

  return execAsync(dockerCmd, {
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  });
}

export const shellTool: Tool = {
  name: "shell",
  description: "Run a shell command. Returns stdout, stderr, and exit code. On Windows, runs via PowerShell.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Command to execute" },
      workdir: { type: "string", description: "Working directory (default: current)" },
      timeout: { type: "number", description: "Timeout in ms (default: 30000)" },
    },
    required: ["command"],
  },
  async execute(args) {
    if (args.command === undefined || args.command === null || String(args.command).trim() === "") {
      return { success: false, error: "Missing required argument: command" };
    }
    const command = String(args.command);
    const workdir = args.workdir ? String(args.workdir) : process.cwd();
    const timeout = args.timeout ? Number(args.timeout) : 30000;

    const safetyError = checkShellCommandSafety(command);
    if (safetyError) {
      auditShellCommand(command, true);
      return { success: false, error: safetyError };
    }

    if (needsApproval(command)) {
      const stored = approvalStore.check("shell", args);
      let decision = stored;
      if (!decision) decision = await requestInteractiveApproval("shell", command);
      if (decision === "deny") {
        return {
          success: false,
          error: `APPROVAL_REQUIRED: The user denied "${command}". Do not retry it — explain the blocker and ask how they would like to proceed instead.`,
        };
      }
      if (!decision) {
        return {
          success: false,
          error: `APPROVAL_REQUIRED: Command "${command}" requires approval. Use approval system to allow or deny.`,
        };
      }
      if (decision !== "allow-once" && !stored) {
        approvalStore.store("shell", buildApprovalKey("shell", command), decision);
      }
    }

    auditShellCommand(command, false);

    const config = loadConfig();
    const wantsDocker = config.dockerEnabled || !IS_WINDOWS;
    const sandbox = decideSandbox({
      dockerEnabled: config.dockerEnabled,
      isWindows: IS_WINDOWS,
      dockerAvailable: wantsDocker ? await dockerAvailable() : false,
    });

    if (sandbox === "denied") {
      auditShellCommand(command, true);
      return {
        success: false,
        error: `SANDBOX_REQUIRED: dockerEnabled is true but Docker is unavailable, so this command cannot run isolated. Start Docker, or set dockerEnabled false in ${CONFIG_PATH} to permit unisolated execution.`,
      };
    }

    if (sandbox === "docker") {
      try {
        const { stdout } = await dockerExec(command, workdir, timeout);
        return { success: true, data: stdout };
      } catch (e: unknown) {
        if (e instanceof Error && "stdout" in e && "stderr" in e) {
          const execErr = e as Error & { stdout: string; stderr: string; status?: number };
          return {
            success: false,
            data: { stdout: execErr.stdout, stderr: execErr.stderr, status: execErr.status ?? 1 },
            error: `Docker command failed (exit ${execErr.status ?? 1}): ${execErr.stderr?.slice(0, 200) || execErr.message}`,
          };
        }
        return { success: false, error: `Docker error: ${e}` };
      }
    }

    try {
      if (IS_WINDOWS) {
        const encoded = Buffer.from(command, "utf16le").toString("base64");
        const { stdout } = await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, {
          cwd: workdir,
          timeout,
          maxBuffer: 10 * 1024 * 1024,
        });
        return { success: true, data: stdout };
      }

      const { stdout } = await execAsync(command, {
        cwd: workdir,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { success: true, data: stdout };
    } catch (e: unknown) {
      if (e instanceof Error && "stdout" in e && "stderr" in e) {
        const execErr = e as Error & { stdout: string; stderr: string; status?: number };
        return {
          success: false,
          data: { stdout: execErr.stdout, stderr: execErr.stderr, status: execErr.status ?? 1 },
          error: `Command failed (exit ${execErr.status ?? 1}): ${execErr.stderr?.slice(0, 200) || execErr.message}`,
        };
      }
      return { success: false, error: `Shell error: ${e}` };
    }
  },
};

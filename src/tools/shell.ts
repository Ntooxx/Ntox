import { exec } from "node:child_process";
import { appendFileSync } from "node:fs";
import type { Tool } from "../types/index.js";
import { getBaseDir, loadConfig } from "../core/config.js";
import { approvalStore, needsApproval } from "./approval.js";

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
  /\bRemove-Item\b.*-(?:Recurse|Force)/i,
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
  /<\/?[a-z_][\w:-]*>/i,
  /```/,
  /<tool_call/i,
  /\bfunction\s+\w+\s*\(/,
  /^\s*(import|export)\s+/m,
];

const WINDOWS_UNIX_COMMAND_PATTERNS = [
  /\|\s*head\b/i,
  /\|\s*tail\b/i,
  /\|\s*grep\b/i,
  /\bls\s+-[a-z]*[la][a-z]*\b/i,
  /\bcat\s+[^|>]+/i,
  /\bsed\s+['"-]/i,
  /\bawk\s+['"-]/i,
];

export function validateShellCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return "Command is empty";
  if (CODE_FRAGMENT_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return "Rejected shell command because it looks like code or malformed tool XML, not a command";
  }
  if (IS_WINDOWS && WINDOWS_UNIX_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return "Rejected Unix-style command on Windows. Use PowerShell equivalents such as Get-ChildItem, Select-String, or Select-Object -First.";
  }
  return null;
}

function audit(command: string, blocked: boolean): void {
  try {
    const line = `[${new Date().toISOString()}]${blocked ? " [BLOCKED]" : ""} ${command}\n`;
    appendFileSync(getBaseDir() + "/shell-audit.log", line);
  } catch { /* best effort */ }
}

function execAsync(command: string, options: { cwd?: string; timeout?: number; maxBuffer?: number }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, {
      cwd: options.cwd,
      timeout: options.timeout,
      maxBuffer: options.maxBuffer,
      windowsHide: true,
      encoding: "utf-8",
    }, (error, stdout, stderr) => {
      if (error) {
        (error as NodeJS.ErrnoException & { stdout: string; stderr: string }).stdout = stdout || "";
        (error as NodeJS.ErrnoException & { stdout: string; stderr: string }).stderr = stderr || "";
        reject(error);
      } else {
        resolve({ stdout: stdout || "", stderr: stderr || "" });
      }
    });
  });
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
    const command = String(args.command);
    const workdir = args.workdir ? String(args.workdir) : process.cwd();
    const timeout = args.timeout ? Number(args.timeout) : 30000;

    const invalidReason = validateShellCommand(command);
    if (invalidReason) {
      audit(command, true);
      return { success: false, error: invalidReason };
    }

    const hit = BLOCKED_PATTERNS.find((p) => p.test(command));
    if (hit) {
      audit(command, true);
      return { success: false, error: `Command blocked by safety policy: "${command}" (matched ${hit})` };
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

    audit(command, false);

    const config = loadConfig();
    if (config.dockerEnabled) {
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
        const escaped = command.replace(/"/g, '`"');
        const { stdout } = await execAsync(
          `powershell -NoProfile -ExecutionPolicy Bypass -Command "${escaped}"`,
          { cwd: workdir, timeout, maxBuffer: 10 * 1024 * 1024 }
        );
        return { success: true, data: stdout };
      }

      const { stdout } = await execAsync(command, {
        cwd: workdir, timeout, maxBuffer: 10 * 1024 * 1024,
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

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import type { Tool } from "../types/index.js";

const URL_PATTERN = /^https?:\/\//i;

const BLOCKED_EXTENSIONS = new Set([
  ".exe",
  ".com",
  ".bat",
  ".cmd",
  ".pif",
  ".scr",
  ".msi",
  ".msp",
  ".lnk",
  ".vbs",
  ".vbe",
  ".wsf",
  ".wsh",
  ".hta",
  ".jar",
  ".ps1",
  ".reg",
]);

export function buildOpenCommand(target: string): { cmd: string; args: string[] } {
  if (process.platform === "win32") {
    const escaped = target.replace(/'/g, "''");
    return {
      cmd: "powershell.exe",
      args: ["-NoProfile", "-WindowStyle", "Hidden", "-Command", `Start-Process -FilePath '${escaped}'`],
    };
  }
  if (process.platform === "darwin") return { cmd: "open", args: [target] };
  return { cmd: "xdg-open", args: [target] };
}

export function validateOpenTarget(target: string): string | null {
  if (!target) return "Missing required argument: path";
  if (URL_PATTERN.test(target)) return null;
  const isWindowsPath = /^[a-z]:[\\/]/i.test(target);
  if (!isWindowsPath && /^[a-z][a-z0-9+.-]*:/i.test(target)) {
    return `Refusing to open non-http(s) target: "${target}"`;
  }
  const abs = resolve(target);
  if (!existsSync(abs)) return `Path does not exist: ${abs}`;
  let isDir = false;
  try {
    isDir = statSync(abs).isDirectory();
  } catch {
    return `Path is not accessible: ${abs}`;
  }
  if (!isDir && BLOCKED_EXTENSIONS.has(extname(abs).toLowerCase())) {
    return `Refusing to open executable or script file: ${abs}`;
  }
  return null;
}

export const openTool: Tool = {
  name: "open",
  description:
    "Open a file or URL with the operating system's default application (HTML in the browser, PDF/image in the viewer, folders in the file manager). Returns once the launch is dispatched.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path, folder path, or http(s) URL to open",
      },
    },
    required: ["path"],
  },
  async execute(args) {
    const raw = args.path;
    const target = typeof raw === "string" ? raw.trim() : "";
    const invalid = validateOpenTarget(target);
    if (invalid) return { success: false, error: invalid };
    const finalTarget = URL_PATTERN.test(target) ? target : resolve(target);
    const { cmd, args: cmdArgs } = buildOpenCommand(finalTarget);
    try {
      const child = spawn(cmd, cmdArgs, { stdio: "ignore", detached: true, windowsHide: true });
      child.on("error", () => undefined);
      child.unref();
      return { success: true, data: `Opened ${finalTarget}` };
    } catch (e) {
      return { success: false, error: `Failed to open: ${e}` };
    }
  },
};

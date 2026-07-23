import { readFile, writeFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Tool } from "../types/index.js";
import { globToRegex } from "../utils/glob.js";

const SENSITIVE_PATTERNS = [
  /[\\/]\.ssh[\\/]/i,
  /[\\/]\.aws[\\/]/i,
  /[\\/]\.gnupg[\\/]/i,
  /[\\/]\.git[\\/]config$/i,
  /[\\/]\.git-credentials$/i,
  /[\\/]\.netrc$/i,
  /[\\/]\.npmrc$/i,
  /[\\/]\.env(?![.\w])/i,
  /[\\/]\.local[\\/]share[\\/]opencode[\\/]/i,
];

function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(path));
}

export const readTool: Tool = {
  name: "read",
  description: "Read a file from the filesystem. Returns the file contents.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute path to the file" },
    },
    required: ["path"],
  },
  async execute(args) {
    const path = String(args.path);
    if (isSensitivePath(path)) {
      return { success: false, error: `Access denied: sensitive path "${path}"` };
    }
    try {
      const content = await readFile(path, "utf-8");
      return { success: true, data: content };
    } catch (e) {
      return { success: false, error: `Failed to read file: ${e}` };
    }
  },
};

export const writeTool: Tool = {
  name: "write",
  description: "Write content to a file. Overwrites if exists.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute path to the file" },
      content: { type: "string", description: "Content to write" },
    },
    required: ["path", "content"],
  },
  async execute(args) {
    const path = String(args.path);
    const content = String(args.content);
    if (isSensitivePath(path)) {
      return { success: false, error: `Access denied: sensitive path "${path}"` };
    }
    try {
      await writeFile(path, content, "utf-8");
      return { success: true, data: `Written ${content.length} bytes to ${path}` };
    } catch (e) {
      return { success: false, error: `Failed to write file: ${e}` };
    }
  },
};

export const globTool: Tool = {
  name: "glob",
  description: "Find files matching a glob pattern. Uses ** for recursive.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern (e.g., 'src/**/*.ts')" },
      path: { type: "string", description: "Base directory (default: current)" },
    },
    required: ["pattern"],
  },
  async execute(args) {
    const pattern = String(args.pattern);
    const dir = args.path ? String(args.path) : process.cwd();
    try {
      const regex = globToRegex(pattern);
      const entries = await readdir(dir, { recursive: true });
      const matching = (entries as string[])
        .map((name) => ({
          name: name.replace(/\\/g, "/"),
          fullPath: join(dir, name),
        }))
        .filter((e) => regex.test(e.name))
        .map((e) => e.fullPath);
      return { success: true, data: matching };
    } catch (e) {
      return { success: false, error: `Glob failed: ${e}` };
    }
  },
};

export const lsTool: Tool = {
  name: "ls",
  description: "List files and directories in a path.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path (default: current)" },
    },
    required: [],
  },
  async execute(args) {
    const dir = args.path ? String(args.path) : process.cwd();
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const listing = entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "directory" : "file",
      }));
      return { success: true, data: listing };
    } catch (e) {
      return { success: false, error: `Failed to list directory: ${e}` };
    }
  },
};

export const editTool: Tool = {
  name: "edit",
  description: "Perform exact string replacements in files. Replaces first occurrence of oldString with newString.",
  parameters: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "Absolute path to the file to modify" },
      oldString: { type: "string", description: "The text to replace" },
      newString: { type: "string", description: "The replacement text" },
    },
    required: ["filePath", "oldString", "newString"],
  },
  async execute(args) {
    const filePath = String(args.filePath);
    const oldString = String(args.oldString);
    const newString = String(args.newString);
    if (isSensitivePath(filePath)) {
      return { success: false, error: `Access denied: sensitive path "${filePath}"` };
    }
    try {
      const content = await readFile(filePath, "utf-8");
      const idx = content.indexOf(oldString);
      if (idx === -1) {
        return { success: false, error: `oldString not found in ${filePath}` };
      }
      const newContent = content.slice(0, idx) + newString + content.slice(idx + oldString.length);
      await writeFile(filePath, newContent, "utf-8");
      return { success: true, data: `Replaced 1 occurrence in ${filePath}` };
    } catch (e) {
      return { success: false, error: `Edit failed: ${e}` };
    }
  },
};

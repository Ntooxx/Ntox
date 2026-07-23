import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Tool } from "../types/index.js";
import { globToRegex } from "../utils/glob.js";

const MAX_PATTERN_LENGTH = 200;
const REDOS_PATTERNS = [
  /\([^)]*[+*]\)[+*]/,
  /\(\([^)]+\)[+*]\)[+*]/,
  /\(\.+\)[+*]/,
  /\(\w\+\)[+*]/,
];
const WHITESPACE_ONLY = /^\s*$/;

function isReDoS(pattern: string): boolean {
  return REDOS_PATTERNS.some((r) => r.test(pattern));
}

function safeRegex(pattern: string, flags: string): RegExp | { error: string } {
  try {
    const r = new RegExp(pattern, flags);
    const testStr = "x".repeat(100);
    const start = performance.now();
    r.test(testStr);
    if (performance.now() - start > 100) return { error: "Pattern too slow" };
    return r;
  } catch (e) {
    return { error: `Invalid regex: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export const grepTool: Tool = {
  name: "grep",
  description: "Search file contents using a regex pattern. Returns matching files and line numbers.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern to search for" },
      include: { type: "string", description: "Glob pattern to filter files (e.g., '*.ts')" },
      path: { type: "string", description: "Directory to search (default: current)" },
      maxMatches: { type: "number", description: "Max total matches (default: 50)" },
    },
    required: ["pattern"],
  },
  async execute(args) {
    const rawPattern = String(args.pattern);
    if (rawPattern.length > MAX_PATTERN_LENGTH) {
      return { success: false, error: `Pattern exceeds max length (${MAX_PATTERN_LENGTH} chars)` };
    }
    if (WHITESPACE_ONLY.test(rawPattern)) {
      return { success: false, error: "Pattern is empty or whitespace only" };
    }
    if (isReDoS(rawPattern)) {
      return { success: false, error: "Pattern contains potential ReDoS (nested quantifiers)" };
    }
    const include = args.include ? String(args.include) : "";
    const dir = args.path ? String(args.path) : process.cwd();
    const maxMatches = args.maxMatches ? Number(args.maxMatches) : 50;

    try {
      const result = safeRegex(rawPattern, "gi");
      if ("error" in result) return { success: false, error: result.error };
      const searchRegex = result;
      const includeRegex = include ? globToRegex(include) : null;

      const entries = await readdir(dir, { recursive: true });
      const files = (entries as string[])
        .map((name) => name.replace(/\\/g, "/"))
        .filter((name) => !includeRegex || includeRegex.test(name));

      const results: { file: string; line: number; content: string }[] = [];
      let totalMatches = 0;

      for (const file of files) {
        if (totalMatches >= maxMatches) break;
        try {
          const content = await readFile(join(dir, file), "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            searchRegex.lastIndex = 0;
            if (searchRegex.test(lines[i])) {
              results.push({ file, line: i + 1, content: lines[i].trim() });
              totalMatches++;
              if (totalMatches >= maxMatches) break;
            }
          }
        } catch {
          // skip unreadable files
        }
      }

      return { success: true, data: results };
    } catch (e) {
      return { success: false, error: `Grep failed: ${e}` };
    }
  },
};

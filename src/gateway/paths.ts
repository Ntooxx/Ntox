import { readdirSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join, relative } from "node:path";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".ntox",
  ".next",
  ".cache",
  "__pycache__",
]);

const MAX_RESULTS = 12;
const MAX_DEPTH = 4;

export function suggestWorkspacePaths(prefix: string, roots: string[]): string[] {
  const clean = prefix.replace(/^@/, "").replace(/\\/g, "/").trim();
  const lower = clean.toLowerCase();
  const results: string[] = [];
  const seen = new Set<string>();

  const push = (value: string) => {
    if (results.length >= MAX_RESULTS || seen.has(value)) return;
    seen.add(value);
    results.push(value);
  };

  const walk = (dir: string, root: string, depth: number) => {
    if (depth > MAX_DEPTH || results.length >= MAX_RESULTS) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= MAX_RESULTS) return;
      if (entry.name === ".ntox" || IGNORED_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".env.example" && entry.name !== ".github") continue;
      const full = join(dir, entry.name);
      const rel = relative(root, full).replace(/\\/g, "/");
      const isDir = entry.isDirectory();
      const relSlash = isDir ? `${rel}/` : rel;
      if (!lower) {
        if (depth === 0) push(relSlash);
        continue;
      }
      if (rel.toLowerCase().includes(lower) || entry.name.toLowerCase().includes(lower)) {
        push(relSlash);
      }
      if (isDir) walk(full, root, depth + 1);
    }
  };

  for (const root of roots) {
    try {
      if (!statSync(root).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(root, root, 0);
    if (results.length >= MAX_RESULTS) break;
  }

  results.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return results.slice(0, MAX_RESULTS);
}

import { relative } from "node:path";

export interface FileChange {
  path: string;
  action: "write" | "edit" | "rollback";
  before: string | null;
  after: string | null;
  timestamp: number;
}

const changes: FileChange[] = [];

export function recordFileChange(change: Omit<FileChange, "timestamp">): void {
  changes.push({ ...change, timestamp: Date.now() });
  if (changes.length > 200) changes.splice(0, changes.length - 200);
}

export function getFileChangesSince(timestamp: number): FileChange[] {
  return changes.filter((change) => change.timestamp >= timestamp);
}

export function clearFileChanges(): void {
  changes.length = 0;
}

function lineDiff(before: string | null, after: string | null): string[] {
  const beforeLines = (before ?? "").split(/\r?\n/);
  const afterLines = (after ?? "").split(/\r?\n/);
  const prefix = 3;
  const suffix = 3;
  let start = 0;
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) start++;
  let endBefore = beforeLines.length - 1;
  let endAfter = afterLines.length - 1;
  while (endBefore >= start && endAfter >= start && beforeLines[endBefore] === afterLines[endAfter]) {
    endBefore--;
    endAfter--;
  }
  const from = Math.max(0, start - prefix);
  const toBefore = Math.min(beforeLines.length - 1, endBefore + suffix);
  const toAfter = Math.min(afterLines.length - 1, endAfter + suffix);
  const lines: string[] = [];
  if (from > 0) lines.push(" ...");
  for (let i = from; i <= toBefore; i++) lines.push(`-${beforeLines[i] ?? ""}`);
  for (let i = from; i <= toAfter; i++) lines.push(`+${afterLines[i] ?? ""}`);
  if (toBefore < beforeLines.length - 1 || toAfter < afterLines.length - 1) lines.push(" ...");
  return lines;
}

export function renderFileChanges(changesToRender: FileChange[], cwd = process.cwd()): string {
  if (changesToRender.length === 0) return "No file changes recorded for the last turn.";
  const out: string[] = [];
  for (const change of changesToRender) {
    out.push(`diff --ntox ${relative(cwd, change.path) || change.path}`);
    out.push(`action: ${change.action}`);
    out.push(...lineDiff(change.before, change.after));
    out.push("");
  }
  return out.join("\n").trimEnd();
}

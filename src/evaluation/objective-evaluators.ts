import { execFile } from "node:child_process";

export interface ObjectiveResult {
  passed: boolean;
  score: number;
  detail: string;
}

export type CheckSpec =
  | { type: "exact"; expected: string; caseSensitive?: boolean }
  | { type: "containsAll"; required: string[]; caseSensitive?: boolean }
  | { type: "factRecall"; fact: string; minOverlap?: number }
  | { type: "constraints"; include?: string[]; exclude?: string[]; caseSensitive?: boolean }
  | { type: "numeric"; expected: number; tolerance?: number }
  | { type: "command"; command: string; args?: string[]; cwd?: string; timeoutMs?: number };

export function normalize(text: string, caseSensitive = false): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return caseSensitive ? collapsed : collapsed.toLowerCase();
}

export function exactMatch(answer: string, expected: string, caseSensitive = false): ObjectiveResult {
  const normalizedAnswer = normalize(answer, caseSensitive);
  const normalizedExpected = normalize(expected, caseSensitive);
  const passed = normalizedAnswer === normalizedExpected;
  return {
    passed,
    score: passed ? 1 : 0,
    detail: passed ? `Matched "${expected}"` : `Expected "${expected}", received "${answer.trim().slice(0, 120)}"`,
  };
}

export function containsAll(answer: string, required: string[], caseSensitive = false): ObjectiveResult {
  if (required.length === 0) return { passed: true, score: 1, detail: "No required content" };
  const haystack = normalize(answer, caseSensitive);
  const missing = required.filter((item) => !haystack.includes(normalize(item, caseSensitive)));
  const present = required.length - missing.length;
  const score = present / required.length;
  return {
    passed: missing.length === 0,
    score,
    detail: missing.length === 0 ? `All ${required.length} required items present` : `Missing: ${missing.join(", ")}`,
  };
}

export function factRecall(answer: string, fact: string, minOverlap = 0.6): ObjectiveResult {
  const tokens = fact
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9-]/gi, ""))
    .filter((token) => token.length > 3);
  if (tokens.length === 0) return { passed: true, score: 1, detail: "Fact has no significant tokens" };
  const haystack = normalize(answer);
  const found = tokens.filter((token) => haystack.includes(token.toLowerCase()));
  const overlap = found.length / tokens.length;
  return {
    passed: overlap >= minOverlap,
    score: overlap,
    detail: `Recalled ${found.length}/${tokens.length} fact tokens (${Math.round(overlap * 100)}%)`,
  };
}

export function constraintCheck(
  answer: string,
  include: string[] = [],
  exclude: string[] = [],
  caseSensitive = false,
): ObjectiveResult {
  const haystack = normalize(answer, caseSensitive);
  const missingInclude = include.filter((item) => !haystack.includes(normalize(item, caseSensitive)));
  const presentExclude = exclude.filter((item) => haystack.includes(normalize(item, caseSensitive)));
  const total = include.length + exclude.length;
  if (total === 0) return { passed: true, score: 1, detail: "No constraints" };
  const satisfied = include.length - missingInclude.length + (exclude.length - presentExclude.length);
  const score = satisfied / total;
  const violations: string[] = [];
  if (missingInclude.length > 0) violations.push(`missing: ${missingInclude.join(", ")}`);
  if (presentExclude.length > 0) violations.push(`forbidden present: ${presentExclude.join(", ")}`);
  return {
    passed: violations.length === 0,
    score,
    detail: violations.length === 0 ? `All ${total} constraints satisfied` : violations.join("; "),
  };
}

export function numericMatch(answer: string, expected: number, tolerance = 0): ObjectiveResult {
  const match = answer.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return { passed: false, score: 0, detail: `No number found in "${answer.trim().slice(0, 120)}"` };
  }
  const value = Number(match[0]);
  const passed = Math.abs(value - expected) <= Math.abs(tolerance);
  return { passed, score: passed ? 1 : 0, detail: `Extracted ${value}, expected ${expected}` };
}

export function commandCheck(
  command: string,
  args: string[] = [],
  cwd?: string,
  timeoutMs = 120000,
): Promise<ObjectiveResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const passed = !error;
        const output = `${stdout ?? ""}\n${stderr ?? ""}`.trim().slice(0, 500);
        resolve({
          passed,
          score: passed ? 1 : 0,
          detail: passed
            ? `Command exited 0${output ? `: ${output}` : ""}`
            : `Command failed: ${error?.message ?? "unknown"}`,
        });
      },
    );
  });
}

export async function evaluateObjective(spec: CheckSpec, answer: string): Promise<ObjectiveResult> {
  switch (spec.type) {
    case "exact":
      return exactMatch(answer, spec.expected, spec.caseSensitive);
    case "containsAll":
      return containsAll(answer, spec.required, spec.caseSensitive);
    case "factRecall":
      return factRecall(answer, spec.fact, spec.minOverlap);
    case "constraints":
      return constraintCheck(answer, spec.include, spec.exclude, spec.caseSensitive);
    case "numeric":
      return numericMatch(answer, spec.expected, spec.tolerance);
    case "command":
      return commandCheck(spec.command, spec.args, spec.cwd, spec.timeoutMs);
  }
}

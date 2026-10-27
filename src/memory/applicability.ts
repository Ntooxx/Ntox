import { createHash } from "node:crypto";
import type { ToolResult } from "../types/index.js";
import { currentVersionOf, type ProcedurePrerequisite, type StoredProcedure } from "./procedure-store.js";

/**
 * Phase 3 — Applicability runner.
 *
 * A stored procedure's prerequisites are EXECUTED in the target environment before reuse.
 * All probes go through the injected executor, which in production is NTOX's existing
 * policy-enforced tool surface — a policy-denied prerequisite simply fails, and a failed
 * prerequisite means no reuse attempt (design §4, rule §5.2).
 */

export type ProcedureExecutor = (tool: string, args: Record<string, unknown>) => Promise<ToolResult>;

export interface PrereqResult {
  prerequisite: ProcedurePrerequisite;
  ok: boolean;
  detail: string;
}

export interface ApplicabilityReport {
  applicable: boolean;
  checkedAt: number;
  envFingerprint: string;
  results: PrereqResult[];
}

export interface ApplicabilityOptions {
  /** Workspace the procedure would run in (fresh E2 environment). */
  scope?: string;
}

function commandString(prereq: Extract<ProcedurePrerequisite, { kind: "command" }>): string {
  const parts = [prereq.command, ...(prereq.args ?? [])];
  return parts.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

function resultDetail(result: ToolResult): string {
  if (!result.success) return (result.error ?? "failed").slice(0, 200);
  const data = result.data;
  if (typeof data === "string") return data.slice(0, 200);
  if (data && typeof data === "object") return JSON.stringify(data).slice(0, 200);
  return "ok";
}

async function checkOne(
  prereq: ProcedurePrerequisite,
  executor: ProcedureExecutor,
  options: ApplicabilityOptions,
): Promise<PrereqResult> {
  try {
    switch (prereq.kind) {
      case "command": {
        const args: Record<string, unknown> = { command: commandString(prereq) };
        if (options.scope) args.workdir = options.scope;
        const result = await executor("shell", args);
        const expected = prereq.expectExit ?? 0;
        const actual =
          result.success && result.data && typeof result.data === "object"
            ? (result.data as { status?: number }).status
            : result.success
              ? 0
              : 1;
        const ok = result.success && (actual === undefined || actual === expected);
        return {
          prerequisite: prereq,
          ok,
          detail: ok ? `exit ${actual ?? expected}` : resultDetail(result) || `exit ${actual}, expected ${expected}`,
        };
      }
      case "path-exists": {
        const result = await executor("ls", { path: prereq.path });
        return { prerequisite: prereq, ok: result.success, detail: resultDetail(result) };
      }
      case "file-contains": {
        const result = await executor("read", { path: prereq.path });
        if (!result.success || typeof result.data !== "string") {
          return { prerequisite: prereq, ok: false, detail: resultDetail(result) };
        }
        const ok = result.data.includes(prereq.text);
        return {
          prerequisite: prereq,
          ok,
          detail: ok ? "contains expected text" : `does not contain "${prereq.text}"`,
        };
      }
    }
  } catch (error) {
    return {
      prerequisite: prereq,
      ok: false,
      detail: `probe threw: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200),
    };
  }
}

/** Stable fingerprint of the checked environment, recorded with every verification run. */
export function computeEnvFingerprint(scope: string, results: PrereqResult[]): string {
  const canonical = JSON.stringify({
    scope,
    platform: `${process.platform}-${process.arch}`,
    checks: results.map((r) => ({
      id: r.prerequisite.id,
      kind: r.prerequisite.kind,
      ok: r.ok,
      detail: r.detail,
    })),
  });
  return `env-${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
}

/**
 * Runs every prerequisite of the procedure's CURRENT version through the executor.
 * `applicable` is true only when all prerequisites pass. An executor that denies a probe
 * makes that probe fail — reuse is then rejected, never forced.
 */
export async function checkApplicability(
  procedure: StoredProcedure,
  executor: ProcedureExecutor,
  options: ApplicabilityOptions = {},
): Promise<ApplicabilityReport> {
  const version = currentVersionOf(procedure);
  const results: PrereqResult[] = [];
  for (const prereq of version.prerequisites) {
    results.push(await checkOne(prereq, executor, options));
  }
  const applicable = results.every((r) => r.ok);
  return {
    applicable,
    checkedAt: Date.now(),
    envFingerprint: computeEnvFingerprint(options.scope ?? "", results),
    results,
  };
}

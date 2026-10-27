/**
 * Phase 3 harness — shared library (frozen fixtures, independent checks, audit, accounting).
 *
 * Harness-side code: never imported by the agent surface. It may call the verification
 * API (procedure-store) and the signing module (procedure-harness); the agent cannot.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

export type TaskClass = "solve" | "verify" | "transfer" | "decoy";

export interface CheckSpec {
  type: "command";
  command: string;
  args: string[];
}

export interface Phase3Task {
  id: string;
  class: TaskClass;
  env: { id: string; values: Record<string, string | number> };
  prompt: string;
  setup: { files: Record<string, string> };
  checks: { target: "workspace" | "response"; spec: CheckSpec }[];
  forbiddenLiterals?: string[];
  timeoutMs: number;
}

export interface Phase3Family {
  id: string;
  domain: string;
  parameters: string[];
  tasks: Phase3Task[];
}

export interface Phase3Suite {
  name: string;
  version: string;
  frozenAt: string;
  description: string;
  protocol: {
    arms: Record<string, { label: string; memoryEnabled: boolean; proceduralMemoryEnabled: boolean }>;
    repetitions: number;
    trialTimeoutMs: number;
    extractionTimeoutMs: number;
    retrievalBackend: string;
    frozenKnobs: Record<string, string | number>;
  };
  families: Phase3Family[];
}

export function loadSuite(path: string): Phase3Suite {
  return JSON.parse(readFileSync(path, "utf-8")) as Phase3Suite;
}

export function suiteSha256(path: string): string {
  // Normalize line endings so the frozen-suite fingerprint is identical across clones
  // (git may check the file out as LF or CRLF depending on platform config).
  return `sha256:${createHash("sha256").update(readFileSync(path, "utf-8").replace(/\r\n/g, "\n")).digest("hex")}`;
}

/** Materialize a task's frozen fixtures into a fresh workspace. */
export function materializeWorkspace(workspace: string, task: Phase3Task): void {
  mkdirSync(workspace, { recursive: true });
  for (const [rel, content] of Object.entries(task.setup.files)) {
    const target = join(workspace, ...rel.split("/"));
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
}

export interface CheckResult {
  target: string;
  type: string;
  passed: boolean;
  detail: string;
}

/**
 * Independent verification: the harness runs every frozen command check in the workspace
 * with a hard timeout. The agent never runs, edits, or sees these commands.
 */
export function runChecks(task: Phase3Task, workspace: string, timeoutMs = 30_000): CheckResult[] {
  return task.checks.map((check) => {
    const started = Date.now();
    const proc = spawnSync(check.spec.command, check.spec.args, {
      cwd: workspace,
      timeout: timeoutMs,
      encoding: "utf-8",
      shell: process.platform === "win32",
    });
    const detail =
      proc.status === 0
        ? `exit 0 in ${Date.now() - started}ms`
        : `exit ${proc.status ?? "timeout"}: ${(proc.stderr || proc.stdout || "").slice(0, 300)}`;
    return { target: check.target, type: check.spec.type, passed: proc.status === 0, detail };
  });
}

/** Frozen replay detector (design §6.2): scan produced artifacts for E1 constants. */
export function scanForbiddenLiterals(
  workspace: string,
  literals: string[],
  setupFiles: Record<string, string> = {},
): { file: string; literal: string }[] {
  const violations: { file: string; literal: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!statSync(full).isFile()) continue;
      // Fixtures themselves contain the literals by construction — scan produced files only.
      const rel = relative(workspace, full).replace(/\\/g, "/");
      if (rel in setupFiles) continue;
      const content = readFileSync(full, "utf-8").slice(0, 2_000_000);
      for (const literal of literals) {
        if (content.includes(literal)) violations.push({ file: rel, literal });
      }
    }
  };
  walk(workspace);
  return violations;
}

export function envFingerprint(envId: string, checkOutputs: CheckResult[]): string {
  const canonical = JSON.stringify({
    envId,
    checks: checkOutputs.map((c) => ({ target: c.target, type: c.type, passed: c.passed, detail: c.detail })),
  });
  return `env-${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
}

export type ReuseClass = "verified-reuse" | "candidate-reuse" | "no-reuse" | "incorrect-reuse";

/**
 * Reuse accounting. INVARIANT (preflight-gated): a candidate procedure can never be
 * counted as "verified-reuse"; decoy tasks never yield "verified-reuse" because the
 * procedure is inapplicable by construction. Literal violations are replay (§6.2).
 */
export function classifyReuse(input: {
  taskClass: TaskClass;
  procedureState: string | null;
  checksPassed: boolean;
  literalViolations: string[];
}): ReuseClass {
  const { taskClass, procedureState, checksPassed, literalViolations } = input;
  if (!procedureState) return "no-reuse";
  if (literalViolations.length > 0) return "incorrect-reuse";
  if (taskClass === "decoy") return checksPassed ? "no-reuse" : "incorrect-reuse";
  if (!checksPassed) return "incorrect-reuse";
  return procedureState === "verified" ? "verified-reuse" : "candidate-reuse";
}

/** Append-only JSONL evidence audit (reviewer requirement 3). */
export class AuditLog {
  constructor(private readonly path: string) {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "");
  }

  record(event: string, data: Record<string, unknown>): void {
    appendFileSync(this.path, `${JSON.stringify({ at: Date.now(), event, ...data })}\n`);
  }
}

export interface TrialUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
  durationMs: number;
  llmCalls: number;
  toolCalls: number;
}

export const ZERO_USAGE: TrialUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  costUsd: 0,
  durationMs: 0,
  llmCalls: 0,
  toolCalls: 0,
};

export function addUsage(a: TrialUsage, b: TrialUsage): TrialUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    costUsd: a.costUsd + b.costUsd,
    durationMs: a.durationMs + b.durationMs,
    llmCalls: a.llmCalls + b.llmCalls,
    toolCalls: a.toolCalls + b.toolCalls,
  };
}

/**
 * Cost per successful transfer (gate §6.1 #6): total arm cost (task trials + verification
 * overhead) divided by transfer successes. Inf (JSON null) when zero successes.
 */
export function costPerSuccessfulTransfer(totalCostUsd: number, transferSuccesses: number): number | null {
  return transferSuccesses > 0 ? totalCostUsd / transferSuccesses : null;
}

/** Extraction prompt: turns the agent's E1 solution into a parameterized procedure. */
export function buildExtractionPrompt(family: Phase3Family, task: Phase3Task, workspace: string): string {
  return [
    `You just solved a task in ${workspace}. Now write ONE reusable procedure that generalizes how you solved it.`,
    `Return a single JSON object and nothing else (no markdown fences, no prose) with exactly these keys:`,
    `- "name": short procedure name`,
    `- "description": one sentence`,
    `- "steps": array of {id, description, tool, args} — EVERY step must be mechanical and executable as-is:`,
    `  tool "shell" (args: {command}) or "write" (args: {path, content}). No descriptive steps.`,
    `- "prerequisites": array of {id, description, kind: "command"|"path-exists"|"file-contains", ...}`,
    `- "scope": {applies: [...], doesNotApply: [...]}`,
    `- "parameters": array of {name, description, learnedValue} — one per environment-specific value you used`,
    `Rules:`,
    `- Every environment-specific value must appear in step args as a {{name}} placeholder.`,
    `- learnedValue must be the exact value used in THIS environment (${JSON.stringify(task.env.values)}).`,
    `- Executing the steps in order with correct bindings must fully produce the task's output artifact.`,
    `- descriptions must tell a future run what to DISCOVER in its own environment, not what to copy.`,
    `- Parameters must cover: ${family.parameters.join(", ") || "(none declared)"}.`,
  ].join("\n");
}

/** Discovery prompt: fresh-environment values for the procedure's declared parameters. */
export function buildDiscoveryPrompt(parameters: { name: string; description: string }[], workspace: string): string {
  return [
    `Work in the directory ${workspace}. A procedure needs current-environment values for these parameters:`,
    ...parameters.map((p) => `- {{${p.name}}}: ${p.description}`),
    `Discover each value IN THIS WORKSPACE (never assume values from any other environment).`,
    `Return a single JSON object mapping each parameter name to its value here, and nothing else.`,
  ].join("\n");
}

/* ---------------- Promotion gate (reviewer blocker 1) ----------------
 * Solving the verification task is NOT evidence of reuse. Promotion requires:
 * (a) successful applicability checks, (b) a recorded execution of the candidate's
 * ACTUAL steps (every step mechanically executed through the policy executor), and
 * (c) passing independent output verification with zero replay literals. */

export interface MechanicalStepRecord {
  stepId: string;
  executed: boolean;
  ok: boolean;
  detail: string;
}

export interface PromotionConditions {
  applicabilityPassed: boolean;
  steps: MechanicalStepRecord[];
  checksPassed: boolean;
  literalViolations: string[];
}

export function canPromote(c: PromotionConditions): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!c.applicabilityPassed) reasons.push("applicability checks did not pass");
  if (c.steps.length === 0) reasons.push("no recorded step execution");
  for (const step of c.steps) {
    if (!step.executed || /descriptive/i.test(step.detail)) {
      reasons.push(`step ${step.stepId} was not mechanically executed`);
    } else if (!step.ok) {
      reasons.push(`step ${step.stepId} failed`);
    }
  }
  if (!c.checksPassed) reasons.push("independent output checks failed");
  if (c.literalViolations.length > 0) {
    reasons.push(`replay literals in artifacts: ${c.literalViolations.join(", ")}`);
  }
  return { ok: reasons.length === 0, reasons };
}

/* ---------------- Policy-bypass accounting (reviewer blocker 2) ----------------
 * Derived from real execution events, never hardcoded. Missing policy evidence fails
 * the gate — an unevidenced call is never counted as safe. */

export interface PolicyCallEvidence {
  tool: string;
  success: boolean;
  decisions: { allowed?: boolean }[];
}

export interface TrialPolicyEvidence {
  toolCalls: number;
  policyDecisions: { allowed?: boolean }[];
  /** Every executor call (applicability probe, mechanical step) with its policy decisions. */
  callLedger: PolicyCallEvidence[];
}

export function derivePolicyBypasses(trials: TrialPolicyEvidence[]): { bypasses: number; missingEvidence: number } {
  let bypasses = 0;
  let missingEvidence = 0;
  for (const trial of trials) {
    if (trial.toolCalls > 0 && trial.policyDecisions.length === 0) missingEvidence += 1;
    for (const call of trial.callLedger) {
      if (!call.success) continue;
      if (call.decisions.length === 0) {
        missingEvidence += 1;
      } else if (!call.decisions.some((d) => d.allowed === true)) {
        bypasses += 1; // executed successfully with zero allowed policy decisions
      }
    }
  }
  return { bypasses, missingEvidence };
}

export function policyGate(derived: { bypasses: number; missingEvidence: number }): boolean {
  return derived.bypasses === 0 && derived.missingEvidence === 0;
}

/* ---------------- Paired C–B scoring (reviewer blocker 3) ---------------- */

export interface PairedOutcome {
  key: string;
  taskClass: TaskClass;
  arm: string;
  passed: boolean;
}

export function pairedCB(outcomes: PairedOutcome[]): {
  pairs: { key: string; c: boolean; b: boolean; result: "win" | "loss" | "tie" }[];
  wins: number;
  losses: number;
  ties: number;
  net: number;
} {
  const byKey = new Map<string, Record<string, boolean>>();
  for (const outcome of outcomes.filter((o) => o.taskClass === "transfer")) {
    const row = byKey.get(outcome.key) ?? {};
    row[outcome.arm] = outcome.passed;
    byKey.set(outcome.key, row);
  }
  const pairs = [...byKey.entries()]
    .filter(([, row]) => "C" in row && "B" in row)
    .map(([key, row]) => ({
      key,
      c: row["C"],
      b: row["B"],
      result: (row["C"] && !row["B"] ? "win" : !row["C"] && row["B"] ? "loss" : "tie") as "win" | "loss" | "tie",
    }));
  const wins = pairs.filter((p) => p.result === "win").length;
  const losses = pairs.filter((p) => p.result === "loss").length;
  const ties = pairs.filter((p) => p.result === "tie").length;
  return { pairs, wins, losses, ties, net: wins - losses };
}

/* ---------------- Episodic-state control (reviewer blocker 3) ----------------
 * C-only phases (extraction, discovery, mechanical reuse) must leave the episodic
 * state byte-identical so arm B and C face the same memory at transfer time. */

export function snapshotMemoryState(stateDir: string): Record<string, string> {
  const memoryDir = join(stateDir, "memory");
  const snapshot: Record<string, string> = {};
  const walk = (dir: string, prefix: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else snapshot[rel] = readFileSync(full, "utf-8");
    }
  };
  walk(memoryDir, "");
  return snapshot;
}

export function restoreMemoryState(stateDir: string, snapshot: Record<string, string>): void {
  const memoryDir = join(stateDir, "memory");
  rmSync(memoryDir, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(snapshot)) {
    const target = join(memoryDir, ...rel.split("/"));
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
}

export function memoryStateHash(snapshot: Record<string, string>): string {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(snapshot).sort()));
  return `mem-${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
}

/** Pull the first JSON object out of an LLM response (extraction output). */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
          return parsed && typeof parsed === "object" ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

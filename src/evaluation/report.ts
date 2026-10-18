import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LongitudinalReport } from "./runner.js";
import type { NecessityReport } from "./necessity.js";

function fmt(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return "inf";
  return value.toFixed(digits);
}

export function generateEvaluationReport(report: LongitudinalReport): string {
  const lines: string[] = [];
  const ts = new Date(report.generatedAt).toISOString().slice(0, 19).replace("T", " ");
  lines.push("# NTOX Meta-Cognition Evaluation");
  lines.push(`Curriculum: ${report.curriculum} | Repetitions: ${report.repetitions} | Generated: ${ts}`);
  lines.push("");
  lines.push("## Arms");
  lines.push("");
  lines.push("| Arm | Mean score | Learning slope | Tokens |");
  lines.push("|-----|------------|----------------|--------|");
  for (const arm of report.arms) {
    lines.push(`| ${arm.arm} | ${fmt(arm.mean)} | ${fmt(arm.slope, 4)} | ${fmt(arm.totalTokens, 0)} |`);
  }
  lines.push("");
  lines.push("## Paired comparisons (baseline vs treatment)");
  lines.push("");
  lines.push("| Baseline | Treatment | Mean delta | 95% CI | Effect size | n | Needed n | Significant |");
  lines.push("|----------|-----------|------------|--------|-------------|---|----------|-------------|");
  for (const comparison of report.comparisons) {
    const ci = `[${fmt(comparison.ci.lower)}, ${fmt(comparison.ci.upper)}]`;
    lines.push(
      `| ${comparison.baseline} | ${comparison.treatment} | ${fmt(comparison.meanDelta)} | ${ci} | ${fmt(
        comparison.effectSize,
      )} | ${comparison.observedN} | ${Number.isFinite(comparison.requiredN) ? comparison.requiredN : "inf"} | ${
        comparison.significant ? "yes" : "no"
      } |`,
    );
  }
  lines.push("");
  if (report.primary) {
    lines.push(`Primary contrast: ${report.primary.baseline} vs ${report.primary.treatment}.`);
    lines.push("");
  }
  return lines.join("\n");
}

export function generateNecessityMarkdown(report: NecessityReport): string {
  const lines: string[] = [];
  const ts = new Date(report.summary.generatedAt).toISOString().slice(0, 19).replace("T", " ");
  lines.push("# NTOX Meta-Cognition Necessity Checks");
  lines.push(`Generated: ${ts} | ${report.summary.passed}/${report.summary.total} passed`);
  lines.push("");
  lines.push("| Check | Subsystem | Passed | Detail |");
  lines.push("|-------|-----------|--------|--------|");
  for (const check of report.checks) {
    lines.push(`| ${check.id} | ${check.subsystem} | ${check.passed ? "yes" : "no"} | ${check.detail} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function ensureDir(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveEvaluationReport(report: LongitudinalReport, dir?: string): { jsonPath: string; mdPath: string } {
  const target = ensureDir(dir ?? join(process.cwd(), "experiments", "meta-eval"));
  const stamp = new Date(report.generatedAt).toISOString().slice(0, 10);
  const jsonPath = join(target, `longitudinal-${stamp}.json`);
  const mdPath = join(target, `longitudinal-${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, generateEvaluationReport(report));
  return { jsonPath, mdPath };
}

export function saveNecessityReport(report: NecessityReport, dir?: string): { jsonPath: string; mdPath: string } {
  const target = ensureDir(dir ?? join(process.cwd(), "experiments", "meta-eval"));
  const stamp = new Date(report.summary.generatedAt).toISOString().slice(0, 10);
  const jsonPath = join(target, `necessity-${stamp}.json`);
  const mdPath = join(target, `necessity-${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, generateNecessityMarkdown(report));
  return { jsonPath, mdPath };
}

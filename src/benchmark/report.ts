import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import type { BenchmarkReport } from "./runner.js";

export function generateReport(report: BenchmarkReport): string {
  const lines: string[] = [];
  const ts = new Date(report.timestamp).toISOString().slice(0, 19).replace("T", " ");

  lines.push("# NTOX Cognitive Kernel Benchmark Report");
  lines.push(`Model: ${report.model} | Date: ${ts}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Kernel ON | Kernel OFF | Delta |`);
  lines.push(`|--------|-----------|------------|-------|`);
  lines.push(`| Overall Score | ${report.overallKernelOn}/10 | ${report.overallKernelOff}/10 | ${fmtDelta(report.overallDelta)} |`);
  lines.push("");

  lines.push("## Domain Breakdown");
  lines.push("");
  lines.push(`| Domain | Delta | Assessment |`);
  lines.push(`|--------|-------|------------|`);
  for (const [domain, delta] of Object.entries(report.domainDeltas)) {
    const assessment = delta > 15 ? "Strong improvement" : delta > 5 ? "Moderate improvement" : delta > -5 ? "Neutral" : "Regression";
    lines.push(`| ${domain} | ${fmtDelta(delta)} | ${assessment} |`);
  }
  lines.push("");

  for (const round of report.rounds) {
    lines.push(`## ${round.name}`);
    lines.push(round.description);
    lines.push("");
    lines.push(`Round average — ON: ${round.kernelOnAvg}/10 | OFF: ${round.kernelOffAvg}/10 | Delta: ${fmtDelta(round.deltaPercent)}`);
    lines.push("");
    lines.push(`| ID | Domain | ON Acc | ON Depth | ON Comp | OFF Acc | OFF Depth | OFF Comp | Delta |`);
    lines.push(`|----|--------|--------|----------|---------|---------|-----------|----------|-------|`);

    for (const r of round.results) {
      lines.push(`| ${r.queryId} | ${r.domain} | ${r.kernelOn.score.accuracy} | ${r.kernelOn.score.depth} | ${r.kernelOn.score.completeness} | ${r.kernelOff.score.accuracy} | ${r.kernelOff.score.depth} | ${r.kernelOff.score.completeness} | ${fmtDelta(r.delta)} |`);
    }
    lines.push("");

    lines.push("### Per-Query Details");
    lines.push("");
    for (const r of round.results) {
      lines.push(`**${r.queryId}** (${r.domain}, difficulty ${r.difficulty})`);
      lines.push(`Query: ${r.query.slice(0, 120)}...`);
      lines.push("");
      lines.push(`Kernel ON (${r.kernelOn.score.overall}/10):`);
      lines.push(`> ${r.kernelOn.response.slice(0, 300)}...`);
      lines.push(`Judge: ${r.kernelOn.score.reasoning}`);
      lines.push("");
      lines.push(`Kernel OFF (${r.kernelOff.score.overall}/10):`);
      lines.push(`> ${r.kernelOff.response.slice(0, 300)}...`);
      lines.push(`Judge: ${r.kernelOff.score.reasoning}`);
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  lines.push("## Conclusion");
  lines.push("");
  if (report.overallDelta > 10) {
    lines.push(`The cognitive kernel improved answer quality by **${report.overallDelta}%** across all domains.`);
    lines.push("Pattern compilation and cross-domain transfer demonstrably improve response quality.");
  } else if (report.overallDelta > 0) {
    lines.push(`The cognitive kernel showed a modest ${report.overallDelta}% improvement.`);
    lines.push("More rounds of learning may be needed to see stronger effects.");
  } else {
    lines.push(`The cognitive kernel did not show improvement (${report.overallDelta}%).`);
    lines.push("This may indicate the kernel needs tuning, or the test queries don't benefit from pattern learning.");
  }

  return lines.join("\n");
}

function fmtDelta(delta: number): string {
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta}%`;
}

export function saveReport(report: BenchmarkReport): string {
  const dir = join(NTOX_DIR, "benchmarks");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ts = new Date(report.timestamp).toISOString().slice(0, 10);
  const path = join(dir, `benchmark-${ts}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2));
  return path;
}

export function saveReportMarkdown(report: BenchmarkReport): string {
  const dir = join(NTOX_DIR, "benchmarks");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ts = new Date(report.timestamp).toISOString().slice(0, 10);
  const path = join(dir, `benchmark-${ts}.md`);
  writeFileSync(path, generateReport(report));
  return path;
}

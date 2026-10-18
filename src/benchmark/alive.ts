import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import type { IdentityStore } from "../mind/identity.js";
import type { LedgerStats } from "../mind/outcome-ledger.js";
import { buildProfile, freshProfile, profileDivergence, profileHash, voiceFromLedger } from "../mind/profile.js";
import type { OutcomeRow } from "../mind/types.js";
import { clamp } from "../mind/util.js";
import type { TransferStats } from "../research/transfer.js";
import type { VoiceABStats } from "./voice-ab.js";

export interface AliveMetrics {
  learningSlope: number | null;
  correctionRecurrence: number | null;
  transferLift: number | null;
  calibrationEce: number | null;
  autonomyYield: number | null;
  identityDivergence: number | null;
  costPerSolvedTask: number | null;
  ncbOverall: number | null;
}

export interface AliveRun {
  id: string;
  timestamp: number;
  turns: number;
  fingerprintHash: string;
  profileHash: string;
  metrics: AliveMetrics;
}

export interface AliveRunDeps {
  identity: IdentityStore;
  ledger?: LedgerStats;
  rows?: OutcomeRow[];
  calibration?: { ece: number; brier: number; count: number };
  mistakes?: { recurrenceRate: number; followUps: number; total: number };
  transfer?: TransferStats;
  idle?: { yieldPerKToken: number; totalCycles: number };
  strategyWeights?: Record<string, Record<string, number>>;
  patterns?: { name: string; strength: number; domains: string[] }[];
  theories?: { name: string; confidence: number }[];
  skills?: string[];
  ncbOverall?: number | null;
  voiceStats?: VoiceABStats | null;
  now?: () => number;
}

export interface M5Criterion {
  key: string;
  label: string;
  value: number | null;
  target: string;
  met: boolean;
}

export interface M5Assessment {
  criteria: M5Criterion[];
  met: boolean;
}

export const M5_TARGETS = {
  identityDivergence: 0.4,
  transferLift: 0.1,
  blindIdentification: 0.6,
} as const;

function linearSlope(points: { x: number; y: number }[]): number {
  if (points.length < 2) return 0;
  const n = points.length;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) * (p.x - meanX);
  }
  return den === 0 ? 0 : num / den;
}

function learningSlopeFromRows(rows: OutcomeRow[]): number | null {
  if (rows.length < 4) return null;
  const slope = linearSlope(rows.map((r) => ({ x: r.seq, y: r.score })));
  return clamp(slope * 100, -1, 1);
}

function costPerSolvedTask(rows: OutcomeRow[]): number | null {
  const solved = rows.filter((r) => r.score >= 0.2);
  if (solved.length === 0) return null;
  const totalCost = solved.reduce((s, r) => s + (r.costUsd || 0), 0);
  return totalCost / solved.length;
}

function runStamp(timestamp: number): string {
  const d = new Date(timestamp);
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 19).replace(/:/g, "");
  return `${date}-${time}`;
}

export function collectAliveRun(deps: AliveRunDeps): AliveRun {
  const now = (deps.now ?? Date.now)();
  const identityData = deps.identity.get();
  const profile = buildProfile({
    identity: identityData,
    ...(deps.patterns ? { patterns: deps.patterns } : {}),
    ...(deps.theories ? { theories: deps.theories } : {}),
    ...(deps.strategyWeights ? { strategyWeights: deps.strategyWeights } : {}),
    ...(deps.skills ? { skills: deps.skills } : {}),
    voice: voiceFromLedger(deps.ledger),
  });
  const divergence = profileDivergence(profile, freshProfile());
  const fingerprint = deps.identity.fingerprint();
  const turns = deps.ledger?.total ?? deps.rows?.length ?? 0;

  const metrics: AliveMetrics = {
    learningSlope: deps.rows ? learningSlopeFromRows(deps.rows) : null,
    correctionRecurrence: deps.mistakes && deps.mistakes.followUps > 0 ? deps.mistakes.recurrenceRate : null,
    transferLift: deps.transfer && deps.transfer.supported + deps.transfer.rejected > 0 ? deps.transfer.avgLift : null,
    calibrationEce: deps.calibration && deps.calibration.count > 0 ? deps.calibration.ece : null,
    autonomyYield: deps.idle && deps.idle.totalCycles > 0 ? deps.idle.yieldPerKToken : null,
    identityDivergence: divergence,
    costPerSolvedTask: deps.rows ? costPerSolvedTask(deps.rows) : null,
    ncbOverall: deps.ncbOverall ?? null,
  };

  return {
    id: `alive-${runStamp(now)}`,
    timestamp: now,
    turns,
    fingerprintHash: fingerprint.hash,
    profileHash: profileHash(profile),
    metrics,
  };
}

export function assessM5(run: AliveRun, voiceStats?: VoiceABStats | null): M5Assessment {
  const divergence = run.metrics.identityDivergence;
  const transferLift = run.metrics.transferLift;
  const identification = voiceStats && voiceStats.trials > 0 ? voiceStats.identificationRate : null;
  const criteria: M5Criterion[] = [
    {
      key: "identityDivergence",
      label: "Fingerprint divergence from fresh instance",
      value: divergence,
      target: `> ${M5_TARGETS.identityDivergence}`,
      met: divergence !== null && divergence > M5_TARGETS.identityDivergence,
    },
    {
      key: "transferLift",
      label: "Cross-domain transfer lift",
      value: transferLift,
      target: `>= +${Math.round(M5_TARGETS.transferLift * 100)}%`,
      met: transferLift !== null && transferLift >= M5_TARGETS.transferLift,
    },
    {
      key: "blindIdentification",
      label: "Blind voice identification rate",
      value: identification,
      target: `> ${Math.round(M5_TARGETS.blindIdentification * 100)}%`,
      met: identification !== null && identification > M5_TARGETS.blindIdentification,
    },
  ];
  return { criteria, met: criteria.every((c) => c.met) };
}

export function generateAliveReport(run: AliveRun, previous?: AliveRun | null, assessment?: M5Assessment): string {
  const lines: string[] = [];
  const ts = new Date(run.timestamp).toISOString().slice(0, 19).replace("T", " ");
  lines.push("# ALIVE-1 Benchmark Run");
  lines.push(`Run: ${run.id} | Date: ${ts} | Turns: ${run.turns}`);
  lines.push(`Fingerprint: ${run.fingerprintHash} | Profile: ${run.profileHash}`);
  lines.push("");
  lines.push("| Metric | Value | Target | Met |");
  lines.push("|--------|-------|--------|-----|");
  const rows: { label: string; value: number | null; target: string; met?: boolean }[] = [
    { label: "Learning slope", value: run.metrics.learningSlope, target: "> 0" },
    { label: "Correction recurrence", value: run.metrics.correctionRecurrence, target: "-50% vs baseline" },
    { label: "Transfer lift", value: run.metrics.transferLift, target: ">= +10%" },
    { label: "Calibration ECE", value: run.metrics.calibrationEce, target: "< 0.15" },
    { label: "Autonomy yield", value: run.metrics.autonomyYield, target: "> 0" },
    { label: "Identity divergence", value: run.metrics.identityDivergence, target: "> 0.4" },
    { label: "Cost per solved task", value: run.metrics.costPerSolvedTask, target: "-25%" },
    { label: "NCB overall", value: run.metrics.ncbOverall, target: "+10% relative" },
  ];
  const assessmentByKey = new Map((assessment?.criteria ?? []).map((c) => [c.key, c]));
  const keyByLabel: Record<string, string> = {
    "Transfer lift": "transferLift",
    "Identity divergence": "identityDivergence",
  };
  for (const row of rows) {
    const key = keyByLabel[row.label];
    const criterion = key ? assessmentByKey.get(key) : undefined;
    const met = criterion ? (criterion.met ? "yes" : "no") : "-";
    const value = row.value === null ? "n/a" : formatMetric(row.value);
    lines.push(`| ${row.label} | ${value} | ${row.target} | ${met} |`);
  }
  lines.push("");
  if (previous) {
    lines.push("## Change vs previous run");
    lines.push("");
    lines.push("| Metric | Previous | Now | Delta |");
    lines.push("|--------|----------|-----|-------|");
    for (const [key, label] of [
      ["learningSlope", "Learning slope"],
      ["correctionRecurrence", "Correction recurrence"],
      ["transferLift", "Transfer lift"],
      ["calibrationEce", "Calibration ECE"],
      ["autonomyYield", "Autonomy yield"],
      ["identityDivergence", "Identity divergence"],
      ["costPerSolvedTask", "Cost per solved task"],
      ["ncbOverall", "NCB overall"],
    ] as const) {
      const before = previous.metrics[key];
      const after = run.metrics[key];
      const delta = before !== null && after !== null ? after - before : null;
      lines.push(
        `| ${label} | ${before === null ? "n/a" : formatMetric(before)} | ${after === null ? "n/a" : formatMetric(after)} | ${delta === null ? "n/a" : (delta >= 0 ? "+" : "") + formatMetric(delta)} |`,
      );
    }
    lines.push("");
  }
  if (assessment) {
    lines.push("## M5 Acceptance");
    lines.push("");
    for (const criterion of assessment.criteria) {
      const value = criterion.value === null ? "n/a" : formatMetric(criterion.value);
      lines.push(`- ${criterion.label}: ${value} (target ${criterion.target}) — ${criterion.met ? "MET" : "NOT MET"}`);
    }
    lines.push("");
    lines.push(assessment.met ? "Milestone M5: PASS" : "Milestone M5: IN PROGRESS");
  }
  return lines.join("\n");
}

function formatMetric(value: number): string {
  const abs = Math.abs(value);
  if (abs !== 0 && abs < 0.001) return value.toExponential(2);
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function benchmarksDir(): string {
  return join(NTOX_DIR, "benchmarks");
}

export function saveAliveRun(
  run: AliveRun,
  dir = benchmarksDir(),
  previous?: AliveRun | null,
  assessment?: M5Assessment,
): { jsonPath: string; mdPath: string } {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = runStamp(run.timestamp);
  const jsonPath = join(dir, `alive-${stamp}.json`);
  const mdPath = join(dir, `alive-${stamp}.md`);
  const jsonTmp = `${jsonPath}.tmp`;
  writeFileSync(jsonTmp, JSON.stringify(run, null, 2));
  renameSync(jsonTmp, jsonPath);
  writeFileSync(mdPath, generateAliveReport(run, previous, assessment));
  return { jsonPath, mdPath };
}

export function loadAliveRuns(dir = benchmarksDir()): AliveRun[] {
  if (!existsSync(dir)) return [];
  const runs: AliveRun[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.startsWith("alive-") || !file.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), "utf-8")) as AliveRun;
      if (raw && typeof raw.timestamp === "number" && raw.metrics) runs.push(raw);
    } catch {
      continue;
    }
  }
  runs.sort((a, b) => a.timestamp - b.timestamp);
  return runs;
}

export interface AliveCurvePoint {
  id: string;
  timestamp: number;
  metrics: AliveMetrics;
}

export function aliveCurve(runs: AliveRun[]): AliveCurvePoint[] {
  return [...runs]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((run) => ({ id: run.id, timestamp: run.timestamp, metrics: run.metrics }));
}

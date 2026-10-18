import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CognitiveTrace, CritiqueResult, ThinkingMetrics } from "../types/index.js";
import { NTOX_DIR } from "../core/config.js";

interface FalseSuccessRecord {
  id: string;
  questionId: string;
  answerQuality: number;
  reasoningQuality: number;
  gap: number;
  reasoningSurface: string[];
  missingDepth: string[];
  detectedAt: number;
}

const SURFACE_SIGNALS = [
  "therefore",
  "thus",
  "hence",
  "clearly",
  "obviously",
  "it follows that",
  "consequently",
  "as a result",
];
const DEPTH_SIGNALS = [
  "because",
  "however",
  "but",
  "although",
  "this implies",
  "mechanistically",
  "fundamentally",
  "first principles",
  "the reason is",
  "counterargument",
  "alternative",
  "limitation",
  "under the assumption",
];

const RECORDS_DIR = join(NTOX_DIR, "memory");
const RECORDS_PATH = join(RECORDS_DIR, "false-success.json");
const MAX_RECORDS = 200;

function loadRecords(): FalseSuccessRecord[] {
  if (!existsSync(RECORDS_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(RECORDS_PATH, "utf-8")) as FalseSuccessRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function persistRecords(): void {
  try {
    mkdirSync(RECORDS_DIR, { recursive: true });
    writeFileSync(RECORDS_PATH, JSON.stringify(falseSuccesses, null, 2));
  } catch {
    /* best-effort persistence */
  }
}

const falseSuccesses: FalseSuccessRecord[] = loadRecords();
let nextFsId =
  falseSuccesses.length > 0
    ? Math.max(...falseSuccesses.map((r) => parseInt(r.id.replace("fs_", ""), 10) || 0)) + 1
    : 1;

export function detectFalseSuccess(trace: CognitiveTrace, metrics: ThinkingMetrics): FalseSuccessRecord | null {
  const text = (trace.finalAnswer + " " + trace.problemRepresentation + " " + trace.selfCritique).toLowerCase();
  const reasoningScore =
    (metrics.representation + metrics.strategy + metrics.critique + metrics.cognitiveCompilation) / 4;
  const answerScore = metrics.efficiency > 0 ? metrics.efficiency : 5;
  const gap = answerScore - reasoningScore;

  if (gap >= 4) {
    const record: FalseSuccessRecord = {
      id: `fs_${nextFsId++}`,
      questionId: "",
      answerQuality: Math.round(answerScore * 10) / 10,
      reasoningQuality: Math.round(reasoningScore * 10) / 10,
      gap: Math.round(gap * 10) / 10,
      reasoningSurface: SURFACE_SIGNALS.filter((s) => text.includes(s)),
      missingDepth: DEPTH_SIGNALS.filter((d) => !text.includes(d)).slice(0, 5),
      detectedAt: Date.now(),
    };
    falseSuccesses.push(record);
    if (falseSuccesses.length > MAX_RECORDS) falseSuccesses.splice(0, falseSuccesses.length - MAX_RECORDS);
    persistRecords();
    return record;
  }
  return null;
}

export function checkForSurfaceReasoning(
  trace: CognitiveTrace,
  critique?: CritiqueResult,
): {
  isSurface: boolean;
  surfaceScore: number;
  depthScore: number;
  details: string[];
} {
  const details: string[] = [];

  if (critique) {
    const avg = (critique.completeness + critique.accuracy) / 2;
    const surfaceScore = Math.round((1 - avg) * 10) / 10;
    const depthScore = Math.round(avg * 10) / 10;
    if (critique.completeness < 0.4) {
      details.push(`Low completeness score from critic: ${critique.completeness.toFixed(2)}`);
    }
    if (critique.accuracy < 0.4) {
      details.push(`Low accuracy score from critic: ${critique.accuracy.toFixed(2)}`);
    }
    details.push(...critique.gaps);
    return {
      isSurface: critique.completeness < 0.4 || critique.accuracy < 0.4,
      surfaceScore,
      depthScore,
      details,
    };
  }

  if (trace.selfCritique.length < 30) details.push("Self-critique absent or trivial");
  if (trace.assumptions.length === 0) details.push("No assumptions stated — reasoning may be implicit");
  return { isSurface: false, surfaceScore: 0, depthScore: 0, details };
}

export function getAllFalseSuccesses(): FalseSuccessRecord[] {
  return [...falseSuccesses];
}
export function countFalseSuccesses(): number {
  return falseSuccesses.length;
}

export function getFalseSuccessStats() {
  const avgGap = falseSuccesses.length > 0 ? falseSuccesses.reduce((s, f) => s + f.gap, 0) / falseSuccesses.length : 0;
  const avgAns =
    falseSuccesses.length > 0 ? falseSuccesses.reduce((s, f) => s + f.answerQuality, 0) / falseSuccesses.length : 0;
  const avgReas =
    falseSuccesses.length > 0 ? falseSuccesses.reduce((s, f) => s + f.reasoningQuality, 0) / falseSuccesses.length : 0;
  const freq: Record<string, number> = {};
  for (const fs of falseSuccesses) for (const s of fs.reasoningSurface) freq[s] = (freq[s] || 0) + 1;
  return {
    total: falseSuccesses.length,
    avgGap: Math.round(avgGap * 10) / 10,
    avgAnswerQuality: Math.round(avgAns * 10) / 10,
    avgReasoningQuality: Math.round(avgReas * 10) / 10,
    mostCommonSurfacePattern: Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([w]) => w),
  };
}

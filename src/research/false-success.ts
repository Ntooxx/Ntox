import { CognitiveTrace, ThinkingMetrics } from "../types/index.js";

interface FalseSuccessRecord { id: string; questionId: string; answerQuality: number; reasoningQuality: number; gap: number; reasoningSurface: string[]; missingDepth: string[]; detectedAt: number; }

const SURFACE_SIGNALS = ["therefore", "thus", "hence", "clearly", "obviously", "it follows that", "consequently", "as a result"];
const DEPTH_SIGNALS = ["because", "however", "but", "although", "this implies", "mechanistically", "fundamentally", "first principles", "the reason is", "counterargument", "alternative", "limitation", "under the assumption"];

const falseSuccesses: FalseSuccessRecord[] = [];
let nextFsId = 1;

export function detectFalseSuccess(trace: CognitiveTrace, metrics: ThinkingMetrics): FalseSuccessRecord | null {
  const text = (trace.finalAnswer + " " + trace.problemRepresentation + " " + trace.selfCritique).toLowerCase();
  const reasoningScore = (metrics.representation + metrics.strategy + metrics.critique + metrics.cognitiveCompilation) / 4;
  const answerScore = metrics.efficiency > 0 ? metrics.efficiency : 5;
  const gap = answerScore - reasoningScore;

  if (gap >= 4) {
    const record: FalseSuccessRecord = {
      id: `fs_${nextFsId++}`, questionId: "",
      answerQuality: Math.round(answerScore * 10) / 10,
      reasoningQuality: Math.round(reasoningScore * 10) / 10,
      gap: Math.round(gap * 10) / 10,
      reasoningSurface: SURFACE_SIGNALS.filter((s) => text.includes(s)),
      missingDepth: DEPTH_SIGNALS.filter((d) => !text.includes(d)).slice(0, 5),
      detectedAt: Date.now(),
    };
    falseSuccesses.push(record);
    if (falseSuccesses.length > 200) falseSuccesses.splice(0, falseSuccesses.length - 200);
    return record;
  }
  return null;
}

export function checkForSurfaceReasoning(trace: CognitiveTrace): { isSurface: boolean; surfaceScore: number; depthScore: number; details: string[] } {
  const text = (trace.finalAnswer + " " + trace.problemRepresentation + " " + trace.selfCritique).toLowerCase();
  const surfaceCount = SURFACE_SIGNALS.filter((s) => text.includes(s)).length;
  const depthCount = DEPTH_SIGNALS.filter((d) => text.includes(d)).length;
  const total = surfaceCount + depthCount;
  if (total === 0) return { isSurface: false, surfaceScore: 0, depthScore: 0, details: [] };
  const ratio = total > 0 ? surfaceCount / total : 1;
  const details: string[] = [];
  if (ratio > 0.7) details.push(`High surface-to-depth ratio: ${Math.round(ratio * 100)}% surface connectors`);
  if (surfaceCount > depthCount * 2 && depthCount < 2) details.push("Answer flows from conclusion to conclusion without mechanism");
  if (trace.selfCritique.length < 30) details.push("Self-critique absent or trivial");
  if (trace.assumptions.length === 0) details.push("No assumptions stated — reasoning may be implicit");
  return { isSurface: ratio > 0.7 || (surfaceCount > depthCount * 2 && depthCount < 2), surfaceScore: Math.round(surfaceCount * 10) / 10, depthScore: Math.round(depthCount * 10) / 10, details };
}

export function getAllFalseSuccesses(): FalseSuccessRecord[] { return [...falseSuccesses]; }
export function countFalseSuccesses(): number { return falseSuccesses.length; }

export function getFalseSuccessStats() {
  const avgGap = falseSuccesses.length > 0 ? falseSuccesses.reduce((s, f) => s + f.gap, 0) / falseSuccesses.length : 0;
  const avgAns = falseSuccesses.length > 0 ? falseSuccesses.reduce((s, f) => s + f.answerQuality, 0) / falseSuccesses.length : 0;
  const avgReas = falseSuccesses.length > 0 ? falseSuccesses.reduce((s, f) => s + f.reasoningQuality, 0) / falseSuccesses.length : 0;
  const freq: Record<string, number> = {};
  for (const fs of falseSuccesses) for (const s of fs.reasoningSurface) freq[s] = (freq[s] || 0) + 1;
  return { total: falseSuccesses.length, avgGap: Math.round(avgGap * 10) / 10, avgAnswerQuality: Math.round(avgAns * 10) / 10, avgReasoningQuality: Math.round(avgReas * 10) / 10, mostCommonSurfacePattern: Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w) };
}

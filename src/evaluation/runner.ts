import type { MetaArmId } from "./ablation.js";
import type { Curriculum } from "./curriculum.js";
import { evaluateObjective } from "./objective-evaluators.js";
import {
  bootstrapCI,
  cohensD,
  linearSlope,
  mean,
  pairedDifferences,
  requiredPairedSampleSize,
  type ConfidenceInterval,
} from "./stats.js";

export interface EvalTurnResult {
  response: string;
  tokens?: number;
}

export interface EvalSession {
  send(prompt: string): Promise<EvalTurnResult>;
  reset?(): Promise<void>;
}

export type SessionFactory = (arm: MetaArmId) => EvalSession | Promise<EvalSession>;

export interface ArmTaskResult {
  taskId: string;
  family: string;
  index: number;
  score: number;
  passed: boolean;
  tokens: number;
  detail: string;
  response: string;
}

export interface ArmRunResult {
  arm: MetaArmId;
  tasks: ArmTaskResult[];
  mean: number;
  slope: number;
  totalTokens: number;
}

export interface ArmComparison {
  baseline: MetaArmId;
  treatment: MetaArmId;
  meanDelta: number;
  ci: ConfidenceInterval;
  effectSize: number;
  significant: boolean;
  requiredN: number;
  observedN: number;
}

export interface LongitudinalReport {
  curriculum: string;
  repetitions: number;
  arms: ArmRunResult[];
  comparisons: ArmComparison[];
  primary: { baseline: MetaArmId; treatment: MetaArmId } | null;
  generatedAt: number;
}

export interface LongitudinalOptions {
  curriculum: Curriculum;
  arms: MetaArmId[];
  factory: SessionFactory;
  repetitions?: number;
  primary?: { baseline: MetaArmId; treatment: MetaArmId };
  confidence?: number;
  onProgress?: (message: string) => void;
  onTaskComplete?: (arm: MetaArmId, result: ArmTaskResult) => void;
}

interface RawTaskRun {
  taskId: string;
  family: string;
  index: number;
  score: number;
  passed: boolean;
  tokens: number;
  detail: string;
  response: string;
}

async function runSession(
  arm: MetaArmId,
  curriculum: Curriculum,
  session: EvalSession,
  options: { onProgress?: (message: string) => void; checkpoint?: (result: ArmTaskResult) => void } = {},
): Promise<RawTaskRun[]> {
  const runs: RawTaskRun[] = [];
  for (let index = 0; index < curriculum.tasks.length; index++) {
    const task = curriculum.tasks[index];
    let tokens = 0;
    let aborted = false;
    for (const plant of task.plantTurns) {
      try {
        const result = await session.send(plant);
        tokens += result.tokens ?? 0;
      } catch (error) {
        aborted = true;
        options.onProgress?.(
          `[${arm}] ${task.id} PLANT FAILED: ${error instanceof Error ? error.message.slice(0, 80) : "unknown"}`,
        );
        break;
      }
    }
    if (task.resetBeforeProbe && !aborted) {
      await session.reset?.();
    }
    const probeResponse: EvalTurnResult = aborted
      ? { response: "", tokens: 0 }
      : await session.send(task.probe).catch((error) => {
          options.onProgress?.(
            `[${arm}] ${task.id} PROBE FAILED: ${error instanceof Error ? error.message.slice(0, 80) : "unknown"}`,
          );
          aborted = true;
          return { response: "", tokens: 0 };
        });
    if (!aborted) tokens += probeResponse.tokens ?? 0;
    const objective = aborted
      ? { passed: false, score: 0, detail: "Turn aborted by stream stall" }
      : await evaluateObjective(task.check, probeResponse.response);
    const run: RawTaskRun = {
      taskId: task.id,
      family: task.family,
      index,
      score: objective.score,
      passed: objective.passed,
      tokens,
      detail: objective.detail,
      response: aborted ? "(aborted)" : probeResponse.response,
    };
    runs.push(run);
    options.checkpoint?.(run);
    options.onProgress?.(
      `[${arm}] ${task.id} score=${objective.score.toFixed(2)} ${objective.passed ? "PASS" : "FAIL"}${aborted ? " ABORTED" : ""}`,
    );
  }
  return runs;
}

function aggregate(runs: RawTaskRun[], arm: MetaArmId): ArmRunResult {
  const byIndex = new Map<number, RawTaskRun[]>();
  for (const run of runs) {
    const bucket = byIndex.get(run.index) ?? [];
    bucket.push(run);
    byIndex.set(run.index, bucket);
  }
  const tasks: ArmTaskResult[] = [];
  for (const [index, bucket] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
    const last = bucket[bucket.length - 1];
    tasks.push({
      taskId: last.taskId,
      family: last.family,
      index,
      score: mean(bucket.map((run) => run.score)),
      passed: bucket.filter((run) => run.passed).length > bucket.length / 2,
      tokens: mean(bucket.map((run) => run.tokens)),
      detail: last.detail,
      response: last.response,
    });
  }
  const scores = tasks.map((task) => task.score);
  return {
    arm,
    tasks,
    mean: mean(scores),
    slope: linearSlope(tasks.map((task) => ({ x: task.index, y: task.score }))).slope,
    totalTokens: runs.reduce((sum, run) => sum + run.tokens, 0),
  };
}

function compare(baseline: ArmRunResult, treatment: ArmRunResult, confidence: number): ArmComparison {
  const diffs = pairedDifferences(
    baseline.tasks.map((task) => task.score),
    treatment.tasks.map((task) => task.score),
  );
  const ci = bootstrapCI(diffs, { confidence });
  const effectSize = cohensD(diffs);
  return {
    baseline: baseline.arm,
    treatment: treatment.arm,
    meanDelta: mean(diffs),
    ci,
    effectSize,
    significant: ci.significant,
    requiredN: requiredPairedSampleSize(effectSize),
    observedN: diffs.length,
  };
}

export async function runLongitudinal(options: LongitudinalOptions): Promise<LongitudinalReport> {
  const repetitions = Math.max(1, options.repetitions ?? 1);
  const confidence = options.confidence ?? 0.95;
  const arms: ArmRunResult[] = [];

  for (const arm of options.arms) {
    const runs: RawTaskRun[] = [];
    for (let rep = 0; rep < repetitions; rep++) {
      options.onProgress?.(`[${arm}] repetition ${rep + 1}/${repetitions}`);
      const session = await options.factory(arm);
      runs.push(
        ...(await runSession(arm, options.curriculum, session, {
          onProgress: options.onProgress,
          checkpoint: options.onTaskComplete ? (result) => options.onTaskComplete!(arm, result) : undefined,
        })),
      );
    }
    const result = aggregate(runs, arm);
    arms.push(result);
    options.onProgress?.(`[${arm}] mean=${result.mean.toFixed(3)} slope=${result.slope.toFixed(4)}`);
  }

  const baseline = arms[0];
  const comparisons = baseline && arms.length > 1 ? arms.slice(1).map((arm) => compare(baseline, arm, confidence)) : [];

  const primary = options.primary ?? (arms.length > 1 ? { baseline: arms[0].arm, treatment: arms[1].arm } : null);

  return {
    curriculum: options.curriculum.id,
    repetitions,
    arms,
    comparisons,
    primary,
    generatedAt: Date.now(),
  };
}

export function dominantComparison(report: LongitudinalReport): ArmComparison | null {
  if (report.comparisons.length === 0) return null;
  if (!report.primary) return report.comparisons[0];
  return (
    report.comparisons.find(
      (comparison) =>
        comparison.baseline === report.primary!.baseline && comparison.treatment === report.primary!.treatment,
    ) ?? report.comparisons[0]
  );
}

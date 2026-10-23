export { ABLATION_ARMS, armEnablesCognition, armOverrides, getArm, isMetaArmId } from "./ablation.js";
export type { MetaArm, MetaArmId } from "./ablation.js";
export { buildCurriculum, COGNITIVE_FAMILIES, CURRICULUM_FAMILIES } from "./curriculum.js";
export type { Curriculum, CurriculumOptions, CurriculumTask } from "./curriculum.js";
export {
  commandCheck,
  constraintCheck,
  containsAll,
  evaluateObjective,
  exactMatch,
  factRecall,
  normalize,
  numericMatch,
} from "./objective-evaluators.js";
export type { CheckSpec, ObjectiveResult } from "./objective-evaluators.js";
export { runNecessityChecks } from "./necessity.js";
export type { NecessityCheckResult, NecessityReport } from "./necessity.js";
export {
  analyzeLabeledTurns,
  generateLoopStudyMarkdown,
  runBanditVolumeSimulation,
  validateLabeledTurns,
} from "./loop-study.js";
export type { LabeledTurn, LoopStudyReport, ProxyMetric } from "./loop-study.js";
export { dominantComparison, runLongitudinal } from "./runner.js";
export type {
  ArmComparison,
  ArmRunResult,
  ArmTaskResult,
  EvalSession,
  EvalTurnResult,
  LongitudinalOptions,
  LongitudinalReport,
  SessionFactory,
} from "./runner.js";
export {
  generateEvaluationReport,
  generateNecessityMarkdown,
  saveEvaluationReport,
  saveNecessityReport,
} from "./report.js";
export {
  bootstrapCI,
  cohensD,
  inverseNormal,
  linearSlope,
  mean,
  mulberry32,
  pairedDifferences,
  requiredPairedSampleSize,
  stddev,
  summarize,
  variance,
} from "./stats.js";
export type { ConfidenceInterval, PowerInput, RegressionResult } from "./stats.js";

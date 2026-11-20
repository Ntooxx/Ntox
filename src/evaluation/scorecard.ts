import { createHash } from "node:crypto";

export type ScorecardTaskKind =
  | "necessity"
  | "memory-recall"
  | "correction-precedence"
  | "skill-author"
  | "embed-offline"
  | "trace-diagnostics"
  | "capability-exports"
  | "source-contains"
  | "files-exist"
  | "package-scripts"
  | "artifact-metric";

export interface ScorecardTask {
  id: string;
  label: string;
  kind: ScorecardTaskKind;
  weight: number;
  optional?: boolean;
  [param: string]: unknown;
}

export interface ScorecardDimension {
  id: string;
  label: string;
  weight: number;
  tasks: ScorecardTask[];
}

export interface ReferenceBaseline {
  id: string;
  label: string;
  measured: false;
  total: number;
  scores: Record<string, number>;
}

export interface ScorecardSuite {
  suiteId: string;
  version: number;
  sha256: string;
  notes: string;
  referenceBaselines: ReferenceBaseline[];
  dimensions: ScorecardDimension[];
}

export interface TaskResult {
  id: string;
  label: string;
  score: number;
  passed: boolean;
  detail: string;
  measured: boolean;
}

export interface DimensionResult {
  id: string;
  label: string;
  weight: number;
  coverage: number;
  score: number;
  tasks: TaskResult[];
}

export interface ScorecardResult {
  suiteId: string;
  suiteSha256: string;
  generatedAt: string;
  mode: string;
  total: number;
  coverage: number;
  dimensions: DimensionResult[];
  referenceBaselines: ReferenceBaseline[];
}

type SuiteProjection = Pick<ScorecardSuite, "suiteId" | "version" | "dimensions" | "referenceBaselines">;

export function suiteFingerprint(suite: SuiteProjection): string {
  const projection: SuiteProjection = {
    suiteId: suite.suiteId,
    version: suite.version,
    dimensions: suite.dimensions,
    referenceBaselines: suite.referenceBaselines,
  };
  return createHash("sha256").update(JSON.stringify(projection)).digest("hex");
}

export function verifySuite(suite: ScorecardSuite): boolean {
  return suiteFingerprint(suite) === suite.sha256;
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function metricScore(value: number, direction: "atLeast" | "atMost", target: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(target)) return 0;
  if (direction === "atLeast") return target === 0 ? 1 : clamp01(value / target);
  return value <= 0 ? 1 : clamp01(target / value);
}

export function dimensionResult(dimension: ScorecardDimension, results: TaskResult[]): DimensionResult {
  let weighted = 0;
  let measuredWeight = 0;
  let totalWeight = 0;
  for (const task of dimension.tasks) {
    totalWeight += task.weight;
    const result = results.find((item) => item.id === task.id);
    if (!result?.measured) continue;
    weighted += task.weight * clamp01(result.score);
    measuredWeight += task.weight;
  }
  const coverage = totalWeight > 0 ? measuredWeight / totalWeight : 0;
  const score = measuredWeight > 0 ? (weighted / measuredWeight) * 10 : 0;
  return {
    id: dimension.id,
    label: dimension.label,
    weight: dimension.weight,
    coverage,
    score,
    tasks: results.filter((result) => dimension.tasks.some((task) => task.id === result.id)),
  };
}

export function totalScore(dimensions: DimensionResult[]): { total: number; coverage: number } {
  let effective = 0;
  let available = 0;
  let weighted = 0;
  for (const dimension of dimensions) {
    const weight = Math.max(0, dimension.weight);
    const effectiveWeight = weight * clamp01(dimension.coverage);
    available += weight;
    effective += effectiveWeight;
    weighted += effectiveWeight * clamp01(dimension.score / 10);
  }
  return {
    total: effective > 0 ? (weighted / effective) * 100 : 0,
    coverage: available > 0 ? effective / available : 0,
  };
}

export function grade(total: number): string {
  if (total >= 85) return "A";
  if (total >= 75) return "B";
  if (total >= 65) return "C";
  if (total >= 50) return "D";
  return "F";
}

function fmt(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

export function renderScorecardMarkdown(result: ScorecardResult): string {
  const totals = totalScore(result.dimensions);
  const lines: string[] = [
    "# NTOX Capability Scorecard",
    "",
    `Run: ${result.generatedAt} · suite: ${result.suiteId} · sha256: ${result.suiteSha256.slice(0, 12)}… · mode: ${result.mode}`,
    "",
    "## Method",
    "",
    "Fixed tasks, fixed weights, fixed scoring rules. All probes are deterministic and offline:",
    "an isolated temporary `NTOX_DIR`, provider API keys cleared, a synthetic skill provider,",
    "and the local-hash embedder. No agent self-report is used as evidence.",
    "",
    "Dimension score = weighted mean of measured task scores × 10 (0–10).",
    "Total = weighted mean of dimension scores, renormalised over measured coverage (0–100).",
    "Optional artifacts that are absent are excluded and reduce coverage, not the score.",
    "",
    "## Dimensions",
    "",
    "| Dimension | Weight | Coverage | Score /10 | Weighted contribution |",
    "|---|---:|---:|---:|---:|",
  ];
  for (const dimension of result.dimensions) {
    const contribution = dimension.weight * dimension.coverage * (dimension.score / 10);
    lines.push(
      `| ${dimension.label} | ${fmt(dimension.weight, 0)} | ${fmt(dimension.coverage * 100, 0)}% | ${fmt(dimension.score)} | ${fmt(contribution)} |`,
    );
  }
  lines.push(
    "",
    `**Total: ${fmt(totals.total)}/100 — grade ${grade(totals.total)} — measured coverage ${fmt(totals.coverage * 100, 0)}%**`,
    "",
    "## Tasks",
    "",
    "| Dimension | Task | Score | Detail |",
    "|---|---|---:|---|",
  );
  for (const dimension of result.dimensions) {
    for (const task of dimension.tasks) {
      const detail = task.detail.replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 180);
      lines.push(
        `| ${dimension.id} | ${task.id} | ${fmt(task.score, 2)} | ${task.measured ? detail : "unmeasured (excluded)"} |`,
      );
    }
  }
  lines.push(
    "",
    "## Reference baselines (NOT measured by this eval)",
    "",
    "The following scores are qualitative estimates from the earlier comparison, not outputs",
    "of this harness. They are pinned in the suite only to keep the report reproducible.",
    "",
    "| Agent | Total | Nature |",
    "|---|---:|---|",
  );
  for (const baseline of result.referenceBaselines) {
    lines.push(`| ${baseline.label} | ${fmt(baseline.total)} | qualitative, not measured here |`);
  }
  lines.push(
    "",
    "## Caveats",
    "",
    "- Capability-exports, source-contains, files-exist and package-scripts measure the presence of a capability, not its quality, ecosystem or adoption.",
    "- The skill-author probe uses a synthetic provider: it measures authoring plumbing and rubric conformance, not model-authored quality.",
    "- Memory recall includes three exact-cue and three lexically disjoint paraphrase queries; the latter probe the documented offline embedding weakness.",
    "- The total measures capability conformance, not the earlier qualitative 78/100, which also penalised ecosystem maturity and adoption.",
    "- Artifact-backed tasks depend on measurement files under `experiments/review/measurements/`; their `generatedAt` is recorded in the JSON report.",
    "- The total is a score over the declared dimensions, not an independent third-party benchmark.",
    "",
  );
  return lines.join("\n");
}

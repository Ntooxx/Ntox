import { mean, mulberry32 } from "./stats.js";

export interface LabeledTurn {
  id: string;
  confidence: number;
  quality: 0 | 1;
  stance: "standard" | "direct" | "verify" | "clarify";
  signals: {
    thanked: boolean;
    rephrased: boolean;
    corrected: boolean;
    abandoned: boolean;
    toolFailure: boolean;
    falseSuccess?: boolean;
    objectivePass?: boolean;
  };
  ratings?: number[];
}

export interface ProxyMetric {
  name: string;
  labeledTurns: number;
  observed: number;
  accuracy: number;
  precision: number;
  recall: number;
  positiveRate: number;
}

export interface LoopStudyReport {
  turns: number;
  labelSource: "human" | "objective" | "mixed";
  positiveRate: number;
  predictor: {
    brier: number;
    baselineBrier: number;
    improvement: number;
    calibration: { bin: string; n: number; confidence: number; quality: number }[];
  };
  proxies: ProxyMetric[];
  raterAgreement: { pairedRatings: number; exactAgreement: number; positiveAgreement: number; cohenKappa: number };
  bandit: {
    turnsPerUser: number;
    feedbackRate: number;
    iterations: number;
    seeds: number;
    probabilityBestSelectedAtEnd: number;
    bestStance: string | null;
    meanRegret: number;
  };
}

function binaryMetric(name: string, rows: LabeledTurn[], predict: (row: LabeledTurn) => boolean): ProxyMetric {
  const observed = rows.filter((row) => name !== "objectivePass" || row.signals.objectivePass !== undefined);
  const tp = observed.filter((row) => predict(row) && row.quality === 1).length;
  const fp = observed.filter((row) => predict(row) && row.quality === 0).length;
  const fn = observed.filter((row) => !predict(row) && row.quality === 1).length;
  return {
    name,
    labeledTurns: observed.length,
    observed: observed.length,
    accuracy: observed.length ? (tp + observed.length - tp - fp - fn) / observed.length : 0,
    precision: tp + fp ? tp / (tp + fp) : 0,
    recall: tp + fn ? tp / (tp + fn) : 0,
    positiveRate: observed.length ? (tp + fp) / observed.length : 0,
  };
}

function proxyReport(rows: LabeledTurn[]): ProxyMetric[] {
  const specs: [string, (row: LabeledTurn) => boolean][] = [
    ["thanked", (row) => row.signals.thanked],
    ["rephrased", (row) => row.signals.rephrased],
    ["corrected", (row) => row.signals.corrected],
    ["abandoned", (row) => row.signals.abandoned],
    ["toolFailure", (row) => row.signals.toolFailure],
    ["objectivePass", (row) => row.signals.objectivePass === true],
  ];
  return specs.map(([name, fn]) => binaryMetric(name, rows, fn));
}

function predictorReport(rows: LabeledTurn[]) {
  const brier = mean(rows.map((row) => (row.confidence - row.quality) ** 2));
  const baseline = rows.length ? rows.reduce((sum, row) => sum + row.quality, 0) / rows.length : 0;
  const baselineBrier = mean(rows.map((row) => (baseline - row.quality) ** 2));
  const calibration = Array.from({ length: 5 }, (_, i) => {
    const lo = i / 5;
    const hi = (i + 1) / 5;
    const bin = rows.filter((row) => row.confidence >= lo && (i === 4 ? row.confidence <= hi : row.confidence < hi));
    return {
      bin: `${lo.toFixed(1)}-${hi.toFixed(1)}`,
      n: bin.length,
      confidence: mean(bin.map((row) => row.confidence)),
      quality: mean(bin.map((row) => row.quality)),
    };
  });
  return { brier, baselineBrier, improvement: baselineBrier - brier, calibration };
}

function agreement(rows: LabeledTurn[]) {
  const paired = rows.filter((row) => row.ratings && row.ratings.length >= 2);
  if (!paired.length) return { pairedRatings: 0, exactAgreement: 0, positiveAgreement: 0, cohenKappa: 0 };
  const same = paired.filter((row) => row.ratings![0] === row.ratings![1]).length;
  const positive = paired.filter((row) => row.ratings![0] === 1 && row.ratings![1] === 1).length;
  const firstPositive = paired.filter((row) => row.ratings![0] === 1).length / paired.length;
  const secondPositive = paired.filter((row) => row.ratings![1] === 1).length / paired.length;
  const expected = firstPositive * secondPositive + (1 - firstPositive) * (1 - secondPositive);
  const exactAgreement = same / paired.length;
  return {
    pairedRatings: paired.length,
    exactAgreement,
    positiveAgreement: positive / paired.length,
    cohenKappa: expected === 1 ? 1 : (exactAgreement - expected) / (1 - expected),
  };
}

export function validateLabeledTurns(input: unknown): LabeledTurn[] {
  if (!Array.isArray(input)) throw new Error("Expected a JSON array of labeled turns");
  const rows = input as LabeledTurn[];
  const ids = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row.id !== "string" || !row.id.trim() || ids.has(row.id))
      throw new Error(`Invalid or duplicate id at row ${index + 1}`);
    ids.add(row.id);
    if (!(Number.isFinite(row.confidence) && row.confidence >= 0 && row.confidence <= 1))
      throw new Error(`Invalid confidence at row ${index + 1}`);
    if (row.quality !== 0 && row.quality !== 1) throw new Error(`quality must be 0 or 1 at row ${index + 1}`);
    if (!["standard", "direct", "verify", "clarify"].includes(row.stance))
      throw new Error(`Invalid stance at row ${index + 1}`);
    if (!row.signals || typeof row.signals !== "object") throw new Error(`Missing signals at row ${index + 1}`);
  }
  return rows;
}

export function runBanditVolumeSimulation(
  rows: LabeledTurn[],
  options: { turnsPerUser: number; seeds?: number },
): LoopStudyReport["bandit"] {
  const proxyOutcome = (row: LabeledTurn): boolean | null => {
    if (row.signals.corrected || row.signals.abandoned) return false;
    if (row.signals.falseSuccess) return false;
    if (row.signals.rephrased) return false;
    if (row.signals.thanked) return true;
    if (row.signals.toolFailure) return false;
    return null;
  };
  const feedbackRate = rows.length ? rows.filter((row) => proxyOutcome(row) !== null).length / rows.length : 0;
  const seeds = options.seeds ?? 1000;
  const rngBase = 94037;
  const arms = ["standard", "direct", "verify", "clarify"] as const;
  const observed = new Map<string, LabeledTurn[]>();
  for (const arm of arms)
    observed.set(
      arm,
      rows.filter((row) => row.stance === arm),
    );
  const eligible = arms.filter((arm) => (observed.get(arm)?.length ?? 0) > 0);
  const rates = eligible.map((arm) => mean(observed.get(arm)!.map((row) => row.quality)));
  const bestIndex = rates.length ? rates.indexOf(Math.max(...rates)) : -1;
  let bestSelected = 0;
  const regrets: number[] = [];
  for (let seed = 0; seed < seeds; seed++) {
    const rng = mulberry32(rngBase + seed);
    const alpha = eligible.map(() => 1);
    const beta = eligible.map(() => 1);
    let last = -1;
    let totalRegret = 0;
    for (let turn = 0; turn < options.turnsPerUser; turn++) {
      let chosen = 0;
      let draw = -1;
      for (let arm = 0; arm < eligible.length; arm++) {
        const value = rng() ** (1 / alpha[arm]) / (rng() ** (1 / beta[arm]) + 1e-12);
        if (value > draw) {
          draw = value;
          chosen = arm;
        }
      }
      last = chosen;
      const pool = observed.get(eligible[chosen]) ?? [];
      const example = pool.length ? pool[Math.floor(rng() * pool.length)] : undefined;
      const proxy = example ? proxyOutcome(example) : null;
      totalRegret += rates[bestIndex] - rates[chosen];
      if (proxy !== null) {
        alpha[chosen] += Number(proxy);
        beta[chosen] += Number(!proxy);
      }
    }
    if (last === bestIndex) bestSelected++;
    regrets.push(totalRegret / Math.max(1, options.turnsPerUser));
  }
  return {
    turnsPerUser: options.turnsPerUser,
    feedbackRate,
    iterations: options.turnsPerUser,
    seeds,
    probabilityBestSelectedAtEnd: seeds ? bestSelected / seeds : 0,
    bestStance: bestIndex < 0 ? null : eligible[bestIndex],
    meanRegret: mean(regrets),
  };
}

export function analyzeLabeledTurns(
  rows: LabeledTurn[],
  options: { turnsPerUser: number; seeds?: number },
): LoopStudyReport {
  const sources = new Set(rows.map((row) => (row.signals.objectivePass === undefined ? "human" : "objective")));
  return {
    turns: rows.length,
    labelSource: sources.size > 1 ? "mixed" : sources.has("objective") ? "objective" : "human",
    positiveRate: mean(rows.map((row) => row.quality)),
    predictor: predictorReport(rows),
    proxies: proxyReport(rows),
    raterAgreement: agreement(rows),
    bandit: runBanditVolumeSimulation(rows, options),
  };
}

export function generateLoopStudyMarkdown(report: LoopStudyReport): string {
  const lines = [
    "# Predict, Observe, Attribute, Update: Pilot Analysis",
    "",
    `Labeled turns: ${report.turns} | Labels: ${report.labelSource} | Positive rate: ${report.positiveRate.toFixed(3)}`,
    "",
    "## Predictor calibration",
    "",
    `Brier score: ${report.predictor.brier.toFixed(4)} | Prevalence baseline: ${report.predictor.baselineBrier.toFixed(4)} | Improvement: ${report.predictor.improvement.toFixed(4)}`,
    "",
    "| Confidence bin | n | Mean confidence | Observed quality |",
    "|---|---:|---:|---:|",
    ...report.predictor.calibration.map(
      (bin) => `| ${bin.bin} | ${bin.n} | ${bin.confidence.toFixed(3)} | ${bin.quality.toFixed(3)} |`,
    ),
    "",
    "## Feedback proxy agreement with labels",
    "",
    "| Signal | Labeled turns | Accuracy | Precision | Recall | Positive rate |",
    "|---|---:|---:|---:|---:|---:|",
    ...report.proxies.map(
      (proxy) =>
        `| ${proxy.name} | ${proxy.labeledTurns} | ${proxy.accuracy.toFixed(3)} | ${proxy.precision.toFixed(3)} | ${proxy.recall.toFixed(3)} | ${proxy.positiveRate.toFixed(3)} |`,
    ),
    "",
    `Second-rater subset: ${report.raterAgreement.pairedRatings} turns | Exact agreement: ${report.raterAgreement.exactAgreement.toFixed(3)} | Cohen's kappa: ${report.raterAgreement.cohenKappa.toFixed(3)}`,
    "",
    "## Bandit volume simulation",
    "",
    `Turns per user: ${report.bandit.turnsPerUser} | Feedback availability: ${report.bandit.feedbackRate.toFixed(3)} | Seeds: ${report.bandit.seeds}`,
    `Best observed stance: ${report.bandit.bestStance ?? "unavailable"} | Probability best stance is selected on final turn: ${report.bandit.probabilityBestSelectedAtEnd.toFixed(3)} | Mean regret per turn: ${report.bandit.meanRegret.toFixed(4)}`,
    "",
    "This is a pilot analysis of the supplied labels. It does not establish a causal end-to-end advantage. The bandit simulation reuses observed stance outcomes and assumes their rates remain stable.",
    "",
  ];
  return lines.join("\n");
}

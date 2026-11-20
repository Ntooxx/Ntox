import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reviewDir = resolve(root, "experiments/review");
const measurementsDir = resolve(reviewDir, "measurements");
const resultsPath = resolve(reviewDir, "scorecard-results.json");
const baselinePath = resolve(reviewDir, "baselines.json");

const commands = {
  "offline-recall": "npm run eval:offline-recall  # reads experiments/review/measurements/offline-recall.json",
  "injection-bypass": "npm run eval:injection  # reads experiments/review/measurements/injection-bypass.json",
  "skill-author-accept": "npm run eval:skill-author  # reads experiments/review/measurements/skill-author-accept.json",
  "test-count": "npm run verify:all  # reads experiments/verification/report.json",
  coverage: "npm run coverage  # reads coverage/coverage-summary.json",
  "ci-green-rate": "node scripts/verify-scorecard.mjs --refresh-ci  # or: gh run list --limit 20 --json conclusion",
};

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function pct(x) {
  return typeof x === "number" ? `${(x * 100).toFixed(1)}%` : "n/a";
}

function extractTestCount() {
  const report = readJson(resolve(root, "experiments/verification/report.json"));
  if (!report) return null;
  const check = report.checks?.find((c) => c.name === "root tests");
  const match = check?.output?.match(/Tests\s+(\d+)\s+passed/);
  return match ? Number(match[1]) : null;
}

function extractCoverage() {
  const summary = readJson(resolve(root, "coverage/coverage-summary.json"));
  if (!summary?.total) return null;
  return {
    lines: summary.total.lines?.pct ?? null,
    functions: summary.total.functions?.pct ?? null,
    statements: summary.total.statements?.pct ?? null,
    branches: summary.total.branches?.pct ?? null,
  };
}

function extractCiGreenRate() {
  const runs = readJson(resolve(measurementsDir, "ci-runs.json"));
  if (!Array.isArray(runs) || runs.length === 0) return null;
  const last = runs.slice(-20);
  const green = last.filter((r) => r === true || r?.conclusion === "success").length;
  return { green, total: last.length, rate: green / last.length };
}

function metric(id, label, value, target, command, extra) {
  return { id, label, value, target, command, ...extra };
}

function buildMetrics() {
  const recall = readJson(resolve(measurementsDir, "offline-recall.json"));
  const injection = readJson(resolve(measurementsDir, "injection-bypass.json"));
  const skillAuthor = readJson(resolve(measurementsDir, "skill-author-accept.json"));
  const full = injection?.results?.["defense-in-depth"] ?? injection?.results?.["regex-guard"] ?? null;
  const base = injection?.results?.["regex-guard"] ?? null;
  const miniLm = recall?.results?.["local-minilm"] ?? null;
  const hash = recall?.results?.["local-hash"] ?? null;
  const ci = extractCiGreenRate();
  const coverage = extractCoverage();
  const tests = extractTestCount();

  // Criteria are scored on the fixed tuning/holdout split when available, never on the
  // whole authored set. The holdout is not author-independent; see scripts/lib/corpus-split.mjs.
  const recallHoldout = miniLm?.bySplit?.holdout ?? null;
  const recallDelta =
    miniLm?.status === "measured"
      ? recallHoldout && typeof miniLm.deltaSynonymHoldout === "number"
        ? miniLm.deltaSynonymHoldout
        : miniLm.deltaSynonymRecallAt5 ?? null
      : null;
  const injectionHoldout = full?.bySplit?.holdout ?? null;
  const injectionValue = injectionHoldout
    ? { bypassRate: injectionHoldout.bypassRate, falsePositiveRate: injectionHoldout.falsePositiveRate }
    : full
      ? { bypassRate: full.bypassRate, falsePositiveRate: full.falsePositiveRate }
      : null;

  const metrics = [
    metric(
      "offline-recall",
      "Synonym recall@5 delta (local-minilm vs local-hash, holdout)",
      recallDelta,
      { atLeast: 0.15, exactNoRegression: true },
      commands["offline-recall"],
      {
        status: miniLm?.status === "measured" ? "measured" : "unavailable",
        detail: {
          scoredOn: recallHoldout ? "holdout" : "all",
          localHashSynonym: hash?.byKind?.synonym?.recallAt5 ?? null,
          localMiniLmSynonym: miniLm?.byKind?.synonym?.recallAt5 ?? null,
          localHashExact: hash?.byKind?.exact?.recallAt5 ?? null,
          localMiniLmExact: miniLm?.byKind?.exact?.recallAt5 ?? null,
          exactNoRegression: miniLm?.exactNoRegression ?? null,
          holdoutQueries: recallHoldout?.queries ?? null,
          holdoutLocalHashSynonym: recallHoldout?.byKind?.synonym?.recallAt5 ?? null,
          holdoutLocalMiniLmSynonym: recallHoldout?.byKind?.synonym?.recallAt5 ?? null,
          holdoutExactNoRegression: miniLm?.holdoutExactNoRegression ?? null,
          independence:
            "holdout is a deterministic 30% partition of a self-authored set, not third-party validation",
        },
      },
    ),
    metric(
      "injection-bypass",
      "Adversarial bypass rate / benign false-positive rate (holdout)",
      injectionValue,
      { bypassRateBelow: 0.05, falsePositiveRateBelow: 0.01 },
      commands["injection-bypass"],
      {
        status: full ? "measured" : "unavailable",
        detail: {
          layer: full?.layer ?? null,
          scoredOn: injectionHoldout ? "holdout" : "all",
          baselineBypassRate: base?.bypassRate ?? null,
          baselineFalsePositiveRate: base?.falsePositiveRate ?? null,
          maliciousCases: full?.maliciousCases ?? null,
          benignCases: full?.benignCases ?? null,
          holdoutMaliciousCases: injectionHoldout?.maliciousCases ?? null,
          holdoutBenignCases: injectionHoldout?.benignCases ?? null,
          independence:
            "holdout is a deterministic 30% partition of a self-authored corpus, not third-party validation",
        },
      },
    ),
    metric(
      "skill-author-accept",
      "Self-authored skill quality-rubric acceptance rate",
      skillAuthor?.acceptanceRate ?? null,
      { atLeast: 0.8 },
      commands["skill-author-accept"],
      {
        status: skillAuthor ? "measured" : "unavailable",
        detail: { mode: skillAuthor?.mode ?? null, heldOutStruggles: skillAuthor?.heldOutStruggles ?? null, note: skillAuthor?.note ?? null },
      },
    ),
    metric(
      "test-count",
      "Passing tests (latest verification report)",
      tests,
      { greaterThan: 0 },
      commands["test-count"],
      { status: tests === null ? "unavailable" : "measured", detail: { source: "experiments/verification/report.json" } },
    ),
    metric(
      "coverage",
      "Coverage ratchet (lines / functions)",
      coverage ? { lines: coverage.lines, functions: coverage.functions } : null,
      { linesAtLeast: 62, functionsAtLeast: 65 },
      commands.coverage,
      { status: coverage ? "measured" : "unavailable", detail: { source: "coverage/coverage-summary.json", statements: coverage?.statements ?? null, branches: coverage?.branches ?? null } },
    ),
    metric(
      "ci-green-rate",
      "CI green rate (last 20 runs)",
      ci ? ci.rate : null,
      { atLeast: 0.95 },
      commands["ci-green-rate"],
      { status: ci ? "measured" : "unavailable", detail: { green: ci?.green ?? null, total: ci?.total ?? null, source: "experiments/review/measurements/ci-runs.json" } },
    ),
  ];
  return metrics;
}

function meetsTarget(m) {
  const t = m.target;
  if (m.value === null) return false;
  switch (m.id) {
    case "offline-recall":
      return typeof m.value === "number" && m.value >= t.atLeast && m.detail?.exactNoRegression !== false;
    case "injection-bypass":
      return m.value.bypassRate < t.bypassRateBelow && m.value.falsePositiveRate < t.falsePositiveRateBelow;
    case "skill-author-accept":
      return m.value >= t.atLeast;
    case "test-count":
      return m.value > t.greaterThan;
    case "coverage":
      return m.value.lines >= t.linesAtLeast && m.value.functions >= t.functionsAtLeast;
    case "ci-green-rate":
      return m.value >= t.atLeast;
    default:
      return false;
  }
}

if (process.argv.includes("--commands")) {
  for (const [id, command] of Object.entries(commands)) console.log(`${id}: ${command}`);
  process.exit(0);
}

const metrics = buildMetrics();
const scored = metrics.map((m) => ({ ...m, meetsTarget: meetsTarget(m) }));
const report = {
  generatedAt: new Date().toISOString(),
  targetScore: 9,
  criteriaMet: scored.filter((m) => m.meetsTarget).length,
  criteriaTotal: scored.length,
  allCriteriaMet: scored.every((m) => m.meetsTarget),
  metrics: scored,
};

if (!existsSync(baselinePath)) {
  const baseline = {
    recordedAt: new Date().toISOString(),
    verdict: "8/10",
    source: "independent review 2026-11-19 + Road to Good remediation",
    metrics: Object.fromEntries(scored.map((m) => [m.id, { value: m.value, status: m.status, detail: m.detail }])),
  };
  mkdirSync(reviewDir, { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
}

mkdirSync(reviewDir, { recursive: true });
writeFileSync(resultsPath, `${JSON.stringify(report, null, 2)}\n`);

console.log("Road to 9 scorecard (read-only aggregator)");
console.log("=".repeat(72));
for (const m of scored) {
  const shown =
    m.id === "coverage"
      ? `lines ${m.value?.lines ?? "n/a"}% / functions ${m.value?.functions ?? "n/a"}%`
      : m.id === "injection-bypass"
        ? m.value
          ? `bypass ${pct(m.value.bypassRate)} / FP ${pct(m.value.falsePositiveRate)}`
          : "n/a"
        : m.id === "test-count"
          ? String(m.value ?? "n/a")
          : pct(m.value);
  console.log(`${m.meetsTarget ? "PASS" : "    "}  ${m.id.padEnd(20)} ${shown.padEnd(34)} [${m.status}]`);
}
console.log("=".repeat(72));
console.log(`Criteria met: ${report.criteriaMet}/${report.criteriaTotal} — target score ${report.targetScore}/10`);
console.log(`Report: ${resultsPath}`);

if (process.argv.includes("--strict") && !report.allCriteriaMet) process.exitCode = 1;

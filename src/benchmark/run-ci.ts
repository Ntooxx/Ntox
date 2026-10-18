import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BenchmarkRound } from "./dataset.js";
import { selectRounds } from "./rounds.js";

function firstEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return "";
}

async function main(): Promise<void> {
  if (!process.env.NTOX_DIR) {
    process.env.NTOX_DIR = join(process.cwd(), ".ntox-ci");
  }

  const { loadConfig, saveConfig } = await import("../core/config.js");

  const apiKey = firstEnv("NTOX_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY");
  if (!apiKey) {
    console.error(
      "[bench] No API key found. Set NTOX_API_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY to run the cognitive benchmark.",
    );
    process.exit(2);
  }

  const baseConfig = loadConfig();
  const config = {
    ...baseConfig,
    apiKey,
    provider: firstEnv("BENCH_PROVIDER") || baseConfig.provider,
    model: firstEnv("BENCH_MODEL") || baseConfig.model,
    apiBaseUrl: firstEnv("BENCH_API_BASE_URL") || baseConfig.apiBaseUrl,
  };
  saveConfig(config);

  const roundsSpec = firstEnv("BENCH_ROUNDS") || "1";
  const rounds: BenchmarkRound[] = selectRounds(roundsSpec);
  if (rounds.length === 0) {
    console.error(`[bench] BENCH_ROUNDS="${roundsSpec}" matched no rounds. Use "all" or a list like "1,3".`);
    process.exit(1);
  }

  const judgeModel = firstEnv("BENCH_JUDGE_MODEL") || "openai/gpt-4o-mini";
  const queryCount = rounds.reduce((total, round) => total + round.queries.length, 0);

  console.log(`\n  NTOX Cognitive Kernel — CI Benchmark`);
  console.log(
    `  Rounds: ${rounds.map((r) => r.name).join(", ")} (${queryCount} queries, ${queryCount * 2} judged runs)`,
  );
  console.log(`  Agent model: ${config.model} (${config.provider}) | Judge: ${judgeModel}`);
  console.log(`  Kernel: ON vs OFF, judged on accuracy/depth/completeness\n`);

  const { LLMClient } = await import("../core/llm.js");
  const { runBenchmark } = await import("./runner.js");
  const { generateReport } = await import("./report.js");

  const judgeLLM = new LLMClient(
    apiKey,
    judgeModel,
    config.embeddingModel,
    config.maxTokens,
    config.temperature,
    config.apiBaseUrl,
    config.provider,
  );

  const report = await runBenchmark(judgeLLM, (msg) => console.log(msg), undefined, { rounds });

  const outDir = resolve(firstEnv("BENCH_OUT_DIR") || "experiments/benchmark");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const stamp = new Date(report.timestamp).toISOString().replace(/[:.]/g, "-");
  const jsonPath = join(outDir, `benchmark-ci-${stamp}.json`);
  const mdPath = join(outDir, `benchmark-ci-${stamp}.md`);
  const markdown = generateReport(report);

  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, markdown);

  console.log("\n" + markdown);
  console.log(`\n  Report saved:`);
  console.log(`    JSON: ${jsonPath}`);
  console.log(`    MD:   ${mdPath}`);
  console.log(`\n  Per-domain deltas:`);
  for (const [domain, delta] of Object.entries(report.domainDeltas)) {
    console.log(`    ${domain}: ${delta > 0 ? "+" : ""}${delta}%`);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Cognitive benchmark (kernel ON vs OFF)\n\n${markdown}\n`);
  }

  const minDelta = Number(firstEnv("BENCH_MIN_OVERALL_DELTA"));
  if (firstEnv("BENCH_MIN_OVERALL_DELTA") && Number.isFinite(minDelta) && report.overallDelta < minDelta) {
    console.error(`\n[bench] Gate failed: overall delta ${report.overallDelta}% is below ${minDelta}%.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[bench] failed:", e instanceof Error ? e.stack || e.message : e);
  process.exit(1);
});

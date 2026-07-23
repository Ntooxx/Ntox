import { LLMClient } from "../core/llm.js";
import { loadConfig } from "../core/config.js";
import { runBenchmark } from "./runner.js";
import { saveReport, saveReportMarkdown, generateReport } from "./report.js";

const MODELS = [
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek v4 Flash" },
  { id: "xiaomi/mimo-v2-pro", label: "Mimo v2.5 Pro" },
];

async function runForModel(modelId: string, label: string) {
  const config = loadConfig();
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  BENCHMARK: ${label} (${modelId})`);
  console.log(`  Judge: openai/gpt-4o-mini`);
  console.log(`${"=".repeat(60)}\n`);

  const judgeLLM = new LLMClient(
    config.apiKey, "openai/gpt-4o-mini", config.embeddingModel,
    config.maxTokens, config.temperature, config.apiBaseUrl, config.provider
  );

  const report = await runBenchmark(judgeLLM, (msg) => {
    console.log(msg);
  });

  const jsonPath = saveReport(report);
  const mdPath = saveReportMarkdown(report);

  console.log("\n" + generateReport(report));
  console.log(`\n  Report saved:`);
  console.log(`    JSON: ${jsonPath}`);
  console.log(`    MD:   ${mdPath}`);

  return report;
}

async function main() {
  const config = loadConfig();
  console.log(`\n  NTOX Cognitive Kernel — Multi-Model Benchmark`);
  console.log(`  Rounds: 5 | Queries per round: 5 | Total queries: 25`);
  console.log(`  Models: ${MODELS.map((m) => m.label).join(", ")}`);
  console.log(`  Agent API key: ${config.apiKey.slice(0, 12)}...`);

  const results: { model: string; overall: number; round1: number; round5: number }[] = [];

  for (const model of MODELS) {
    try {
      const report = await runForModel(model.id, model.label);
      const round1 = report.rounds[0];
      const round5 = report.rounds[report.rounds.length - 1];
      results.push({
        model: model.label,
        overall: report.overallDelta,
        round1: round1?.deltaPercent ?? 0,
        round5: round5?.deltaPercent ?? 0,
      });
    } catch (e) {
      console.error(`\n  FAILED for ${model.label}: ${e instanceof Error ? e.message : e}`);
      results.push({ model: model.label, overall: 0, round1: 0, round5: 0 });
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  CROSS-MODEL COMPARISON`);
  console.log(`${"=".repeat(60)}\n`);
  console.log(`| Model | Overall Delta | Round 1 (Cold) | Round 5 (Full) | Trend |`);
  console.log(`|-------|---------------|----------------|----------------|-------|`);
  for (const r of results) {
    const trend = r.round5 > r.round1 ? "Improving" : r.round5 < r.round1 ? "Declining" : "Stable";
    console.log(`| ${r.model} | ${fmtDelta(r.overall)} | ${fmtDelta(r.round1)} | ${fmtDelta(r.round5)} | ${trend} |`);
  }
  console.log("");
}

function fmtDelta(d: number): string {
  return `${d > 0 ? "+" : ""}${d}%`;
}

main().catch((e) => {
  console.error("Benchmark failed:", e);
  process.exit(1);
});

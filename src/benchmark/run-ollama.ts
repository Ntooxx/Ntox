import { LLMClient } from "../core/llm.js";
import { loadConfig } from "../core/config.js";
import { runBenchmark } from "./runner.js";
import { saveReport, saveReportMarkdown, generateReport } from "./report.js";

const OLLAMA_MODEL = "llama3.1:8b";

async function main() {
  const config = loadConfig();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  BENCHMARK: Ollama ${OLLAMA_MODEL} (local)`);
  console.log(`  Judge: openai/gpt-4o-mini (cloud)`);
  console.log(`  Rounds: 5 | Queries per round: 5`);
  console.log(`${"=".repeat(60)}\n`);

  const judgeLLM = new LLMClient(
    config.apiKey, "openai/gpt-4o-mini", config.embeddingModel,
    4096, 0.7, config.apiBaseUrl, config.provider
  );

  const report = await runBenchmark(judgeLLM, (msg) => {
    console.log(msg);
  }, {
    provider: "ollama",
    model: OLLAMA_MODEL,
    apiKey: "",
    apiBaseUrl: "",
  });

  const jsonPath = saveReport(report);
  const mdPath = saveReportMarkdown(report);

  console.log("\n" + generateReport(report));
  console.log(`\n  Report saved:`);
  console.log(`    JSON: ${jsonPath}`);
  console.log(`    MD:   ${mdPath}`);
}

main().catch((e) => {
  console.error("Benchmark failed:", e);
  process.exit(1);
});

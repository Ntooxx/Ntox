#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const dist = (...parts) => pathToFileURL(join(root, "dist", ...parts)).href;

function parseArgs(argv) {
  const parsed = {};
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const [key, value] = token.replace(/^--/, "").split("=");
    parsed[key] = value === undefined ? true : value;
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { Mind } = await import(dist("mind", "mind.js"));
  const { TransferStore } = await import(dist("research", "transfer.js"));
  const { MistakeJournal } = await import(dist("meta", "mistakes.js"));
  const { SkillLibrary } = await import(dist("skills", "library.js"));
  const { loadTheoryStore, getTheoryHierarchy, detectDomain } = await import(dist("research", "theory-store.js"));
  const { collectAliveRun, assessM5, generateAliveReport, loadAliveRuns, saveAliveRun } = await import(
    dist("benchmark", "index.js")
  );
  const { runVoiceAB, saveVoiceAB, loadVoiceABStats } = await import(dist("benchmark", "voice-ab.js"));

  if (args.voice) {
    const pairs = JSON.parse(readFileSync(String(args.voice), "utf-8"));
    if (!Array.isArray(pairs) || pairs.length === 0) throw new Error("--voice must point to a non-empty JSON array of {query, trained, fresh}");
    let judge = null;
    if (args.judge) {
      const { loadConfig } = await import(dist("core", "config.js"));
      const { LLMClient } = await import(dist("core", "llm.js"));
      const config = loadConfig();
      const llm = new LLMClient(config.apiKey, config.model, config.embeddingModel, config.maxTokens, config.temperature, config.apiBaseUrl, config.provider);
      judge = { stream: (messages, system) => llm.stream(messages, system) };
    }
    const result = await runVoiceAB(judge, pairs);
    const stats = saveVoiceAB(result);
    console.log(`\nVoice A/B: ${result.correctPicks}/${result.clearPicks} clear picks correct (${(result.identificationRate * 100).toFixed(1)}%)`);
    console.log(`Cumulative: ${stats.correct}/${stats.trials} (${(stats.identificationRate * 100).toFixed(1)}%)`);
  }

  const mind = new Mind();
  const transfers = new TransferStore();
  const mistakes = new MistakeJournal();
  const skills = new SkillLibrary();
  try {
    skills.scan();
  } catch {
    /* bundled skills unavailable */
  }
  try {
    loadTheoryStore();
  } catch {
    /* theory store unavailable */
  }
  const hierarchy = getTheoryHierarchy();
  const patterns = hierarchy.patterns.map((pattern) => ({
    name: pattern.name,
    strength: pattern.confidence,
    domains: [detectDomain(pattern.generalization)],
  }));
  const theories = hierarchy.theories.map((theory) => ({ name: theory.name, confidence: theory.confidence }));
  const skillNames = skills.getDomains().flatMap((domain) => skills.get(domain).map((skill) => skill.name));
  const strategyWeights = Object.fromEntries(
    Object.entries(mind.bandit.stats().preferred).map(([context, variant]) => [context, { [variant]: 1 }]),
  );
  const voiceStats = loadVoiceABStats();

  const run = collectAliveRun({
    identity: mind.identity,
    ledger: mind.ledger.stats(),
    rows: mind.ledger.all(),
    calibration: mind.calibration.stats(),
    mistakes: mistakes.getStats(),
    transfer: transfers.stats(),
    idle: mind.idle.status(),
    strategyWeights,
    patterns,
    theories,
    skills: skillNames,
    ncbOverall: args.ncb ? Number(args.ncb) : null,
    voiceStats,
    now: Date.now,
  });

  const previous = loadAliveRuns().slice(-1)[0] ?? null;
  const assessment = assessM5(run, voiceStats);
  const saved = saveAliveRun(run);
  console.log(generateAliveReport(run, previous, assessment));
  console.log(`\nSaved: ${saved.jsonPath}`);
  console.log(`Saved: ${saved.mdPath}`);
  if (!assessment.met) {
    console.log("\nM5 is not yet met; missing criteria are listed above.");
  }
}

main().catch((error) => {
  console.error("[alive] failed:", error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});

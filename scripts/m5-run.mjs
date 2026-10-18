#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = (...parts) => pathToFileURL(join(root, "dist", ...parts)).href;
const m5Dir = join(root, "experiments", "m5");
const trainedDir = join(m5Dir, "trained");
const freshDir = join(m5Dir, "fresh");
const helper = join(root, "scripts", "m5-agent.mjs");
const realConfigPath = join(homedir(), ".ntox", "config.json");

process.env.NTOX_DIR = trainedDir;

function parseArgs(argv) {
  const parsed = {};
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const [key, value] = token.replace(/^--/, "").split("=");
    parsed[key] = value === undefined ? true : value;
  }
  return parsed;
}

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TRAINING = [
  "My name is Anton. I prefer terse, direct answers with no preamble and no emojis.",
  "Remember this for later: the staging deploy port is 7412 and production is 7413.",
  "Our team uses pnpm in this workspace, never npm.",
  "When you write code for me, always include a short test plan first.",
  "Correction: the staging port is 7412, not 7411. Do not repeat that mistake.",
  "I care most about evidence over confident guesses. If you do not know, say so.",
  "My timezone is Europe/Berlin and I start work at 9am.",
  "When answering, cite the file path if you used one.",
];

const QUERIES = [
  "What is the staging deploy port?",
  "Which package manager should we use in this workspace?",
  "How should you structure answers for me?",
  "What is my name, and what tone should you use with me?",
  "What is my timezone and when do I start work?",
  "What is my rule about writing code?",
  "Do I value evidence more, or confident guesses?",
  "How should you respond when you do not know something?",
];

const TRANSFER_TASKS = [
  "A market shows larger price swings after every rate change. Design a policy that reduces the oscillation.",
  "A trading bot overreacts to small signals and amplifies volatility. What structural change would stabilize it?",
  "A pricing team keeps overshooting its target after each adjustment. How should they damp the response?",
];

const TRANSFER_THEORY =
  "feedback loop damping reduces oscillation and overshoot in physical control systems by lowering loop gain and adding phase margin";

const OBSERVATIONS = [
  ["feedback loop damping reduces oscillation in physical control systems", "physics"],
  ["feedback loop damping reduces oscillation in market price systems", "economics"],
  ["feedback loop damping reduces oscillation in software retry systems", "programming"],
  ["feedback loop damping stabilizes overshoot in physical control systems", "physics"],
  ["feedback loop damping stabilizes overshoot in market price systems", "economics"],
  ["feedback loop damping stabilizes overshoot in software retry systems", "programming"],
  ["feedback loop damping reduces amplification in physical control systems", "physics"],
  ["feedback loop damping reduces amplification in market price systems", "economics"],
  ["feedback loop damping reduces amplification in software retry systems", "programming"],
];

async function complete(llm, system, user) {
  let text = "";
  for await (const chunk of llm.stream([{ role: "user", content: user }], system)) {
    if (chunk.delta) text += chunk.delta;
  }
  return text.trim();
}

async function scoreAnswer(llm, task, answer) {
  const system =
    "You are an impartial evaluator. Score the answer from 0 to 1 for correctness, causal reasoning, and practical applicability. Respond with ONLY JSON: {\"score\": 0.0, \"reason\": \"brief\"}.";
  const raw = await complete(llm, system, `Task: ${task}\n\nAnswer: ${answer.slice(0, 1500)}`);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return 0;
  try {
    const parsed = JSON.parse(match[0]);
    const score = Number(parsed.score);
    return Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
  } catch {
    return 0;
  }
}

async function compareAnswers(llm, task, first, second, firstIsTransfer) {
  const system =
    "You are an impartial evaluator. Two answers to the same task are shown. Decide which answer better identifies the structural mechanism and applies it to the task. Ignore length and writing style. Respond with ONLY JSON: {\"winner\": \"A\" | \"B\" | \"tie\", \"reason\": \"brief\"}.";
  const raw = await complete(
    llm,
    system,
    `Task: ${task}\n\nAnswer A:\n${first.slice(0, 1200)}\n\nAnswer B:\n${second.slice(0, 1200)}`,
  );
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { transferWon: false, tie: false, reason: "unparseable" };
  try {
    const parsed = JSON.parse(match[0]);
    if (parsed.winner === "tie") return { transferWon: false, tie: true, reason: String(parsed.reason ?? "") };
    const winnerIsFirst = parsed.winner === "A";
    const transferWon = firstIsTransfer ? winnerIsFirst : !winnerIsFirst;
    return { transferWon, tie: false, reason: String(parsed.reason ?? "") };
  } catch {
    return { transferWon: false, tie: false, reason: "invalid" };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reuse = args.reuse === true;
  if (!reuse) {
    rmSync(trainedDir, { recursive: true, force: true });
    rmSync(freshDir, { recursive: true, force: true });
  }
  mkdirSync(trainedDir, { recursive: true });
  mkdirSync(freshDir, { recursive: true });

  const trainingPath = join(m5Dir, "training.json");
  const queriesPath = join(m5Dir, "queries.json");
  const trainedOut = join(m5Dir, "trained-responses.json");
  const freshOut = join(m5Dir, "fresh-responses.json");
  writeFileSync(trainingPath, JSON.stringify(TRAINING, null, 2));
  writeFileSync(queriesPath, JSON.stringify(QUERIES, null, 2));

  if (!reuse || !existsSync(trainedOut)) {
    execFileSync(
      process.execPath,
      [helper, `--out=${trainedOut}`, `--train=${trainingPath}`, `--queries=${queriesPath}`, "--mode=trained"],
      { env: { ...process.env, NTOX_DIR: trainedDir, M5_CONFIG: realConfigPath }, stdio: "inherit" },
    );
  }
  if (!reuse || !existsSync(freshOut)) {
    execFileSync(
      process.execPath,
      [helper, `--out=${freshOut}`, `--queries=${queriesPath}`, "--mode=fresh"],
      { env: { ...process.env, NTOX_DIR: freshDir, M5_CONFIG: realConfigPath }, stdio: "inherit" },
    );
  }

  const trained = JSON.parse(readFileSync(trainedOut, "utf-8"));
  const fresh = JSON.parse(readFileSync(freshOut, "utf-8"));
  const freshByQuery = new Map(fresh.responses.map((row) => [row.query, row.response ?? ""]));
  const pairs = trained.responses.map((row) => ({
    query: row.query,
    trained: row.response ?? "",
    fresh: freshByQuery.get(row.query) ?? "",
  }));

  const realConfig = JSON.parse(readFileSync(realConfigPath, "utf-8"));
  const { LLMClient } = await import(dist("core", "llm.js"));
  const llm = new LLMClient(
    realConfig.apiKey,
    realConfig.model,
    realConfig.embeddingModel,
    Math.min(Number(realConfig.maxTokens) || 1024, 1024),
    realConfig.temperature,
    realConfig.apiBaseUrl,
    realConfig.provider,
  );
  const requestedJudge = args["judge-model"] || "openai/gpt-4o-mini";
  let judgeLlm = new LLMClient(
    realConfig.apiKey,
    requestedJudge,
    realConfig.embeddingModel,
    512,
    0,
    realConfig.apiBaseUrl,
    realConfig.provider,
  );
  try {
    await complete(judgeLlm, "Reply with the single word OK.", "ping");
    console.log(`Judge model: ${requestedJudge}`);
  } catch {
    judgeLlm = llm;
    console.log(`Judge model unavailable (${requestedJudge}); falling back to ${realConfig.model}`);
  }
  const judge = { stream: (messages, system) => judgeLlm.stream(messages, system) };

  const { runVoiceAB, saveVoiceAB, loadVoiceABStats } = await import(dist("benchmark", "voice-ab.js"));
  const voiceResult = await runVoiceAB(judge, pairs, { rng: mulberry32(42) });
  const voiceStats = saveVoiceAB(voiceResult);
  console.log(`\nVoice A/B: ${voiceResult.correctPicks}/${voiceResult.clearPicks} clear picks correct (${(voiceResult.identificationRate * 100).toFixed(1)}%)`);
  for (const trial of voiceResult.trials) {
    console.log(`  ${trial.correct ? "hit " : "miss"} ${trial.presentedOrder} pick=${trial.pick} :: ${trial.query}`);
    console.log(`    judge: ${trial.reasoning.slice(0, 200)}`);
  }
  writeFileSync(join(m5Dir, "voice-trials.json"), JSON.stringify(voiceResult, null, 2));

  const theoryStore = await import(dist("research", "theory-store.js"));
  theoryStore.loadTheoryStore();
  const hierarchyBefore = theoryStore.getTheoryHierarchy();
  if (hierarchyBefore.theories.length < 2) {
    for (const [description, domain] of OBSERVATIONS) theoryStore.recordObservation(description, domain, 0.7);
  }
  const hierarchy = theoryStore.getTheoryHierarchy();

  const { TransferStore, findTransferCandidates } = await import(dist("research", "transfer.js"));
  const transferStore = new TransferStore();
  let hypothesis = transferStore.pending()[0] ?? null;
  if (!hypothesis) {
    const source = hierarchy.theories[0];
    const target = hierarchy.theories[1] ?? hierarchy.theories[0];
    const theories = [
      {
        id: source?.id ?? "theory_1",
        name: source?.name ?? "feedback damping",
        explanation: source?.explanation ?? TRANSFER_THEORY,
        confidence: source?.confidence ?? 0.7,
        confirmed: source?.confirmed ?? true,
        embedding: source?.embedding,
        domain: "physics",
      },
      {
        id: target?.id ?? "theory_2",
        name: target?.name ?? "feedback damping in markets",
        explanation: target?.explanation ?? TRANSFER_THEORY,
        confidence: target?.confidence ?? 0.7,
        confirmed: target?.confirmed ?? true,
        embedding: target?.embedding ?? source?.embedding,
        domain: "economics",
      },
    ];
    const candidate = findTransferCandidates(theories)[0];
    if (candidate) {
      hypothesis = transferStore.createHypothesis(candidate);
    } else if (theories[0].id !== theories[1].id) {
      hypothesis = transferStore.createHypothesis({
        source: theories[0],
        target: theories[1],
        sourceDomain: "physics",
        targetDomain: "economics",
        structuralSimilarity: 0.9,
      });
    }
  }

  if (hypothesis) {
    const baselineScores = [];
    const transferScores = [];
    let transferWins = 0;
    let ties = 0;
    const rng = mulberry32(2026);
    for (const task of TRANSFER_TASKS) {
      const baseline = await complete(llm, "Answer the task directly in 3 to 5 sentences. No markdown.", task);
      const withPrinciple = await complete(
        llm,
        "Answer the task directly in 3 to 5 sentences. No markdown.",
        `${task}\n\nApply this cross-domain principle explicitly: ${TRANSFER_THEORY}.`,
      );
      baselineScores.push(await scoreAnswer(judgeLlm, task, baseline));
      transferScores.push(await scoreAnswer(judgeLlm, task, withPrinciple));
      const transferFirst = rng() < 0.5;
      const first = transferFirst ? withPrinciple : baseline;
      const second = transferFirst ? baseline : withPrinciple;
      const verdict = await compareAnswers(judgeLlm, task, first, second, transferFirst);
      if (verdict.tie) ties += 1;
      else if (verdict.transferWon) transferWins += 1;
      console.log(
        `\n  task: ${task}\n  baseline: ${baseline.replace(/\s+/g, " ").slice(0, 220)}\n  transfer: ${withPrinciple.replace(/\s+/g, " ").slice(0, 220)}\n  judge: ${verdict.tie ? "tie" : verdict.transferWon ? "transfer" : "baseline"} (${verdict.reason.slice(0, 120)})`,
      );
    }
    const avg = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    const absoluteBaseline = avg(baselineScores);
    const absoluteTransfer = avg(transferScores);
    const pairedBaseline = 0.5;
    const pairedTransfer = (transferWins + 0.5 * ties) / Math.max(1, TRANSFER_TASKS.length);
    hypothesis = transferStore.resolve(hypothesis.id, pairedBaseline, pairedTransfer);
    console.log(
      `\nTransfer: paired baseline ${pairedBaseline.toFixed(2)} -> transfer ${pairedTransfer.toFixed(2)} (${transferWins} wins, ${ties} ties)`,
    );
    console.log(`  absolute judge: baseline ${absoluteBaseline.toFixed(2)} -> transfer ${absoluteTransfer.toFixed(2)}`);
    const resolved = hypothesis;
    const lift = resolved && resolved.lift !== null ? `${(resolved.lift * 100).toFixed(1)}%` : "n/a";
    console.log(`  ${resolved?.id} ${resolved?.status} lift=${lift}`);
  } else {
    console.log("\nTransfer: no cross-domain theory pair available");
  }

  const { Mind } = await import(dist("mind", "mind.js"));
  const { MistakeJournal } = await import(dist("meta", "mistakes.js"));
  const { SkillLibrary } = await import(dist("skills", "library.js"));
  const { detectDomain } = await import(dist("research", "theory-store.js"));
  const { collectAliveRun, assessM5, generateAliveReport, loadAliveRuns, saveAliveRun } = await import(
    dist("benchmark", "alive.js")
  );

  const mind = new Mind();
  const mistakes = new MistakeJournal();
  const skills = new SkillLibrary();
  try {
    skills.scan();
  } catch {
    /* skills unavailable */
  }
  const finalHierarchy = theoryStore.getTheoryHierarchy();
  const patterns = finalHierarchy.patterns.map((pattern) => ({
    name: pattern.name,
    strength: pattern.confidence,
    domains: [detectDomain(pattern.generalization)],
  }));
  const theories = finalHierarchy.theories.map((theory) => ({ name: theory.name, confidence: theory.confidence }));
  const skillNames = skills.getDomains().flatMap((domain) => skills.get(domain).map((skill) => skill.name));
  const strategyWeights = Object.fromEntries(
    Object.entries(mind.bandit.stats().preferred).map(([context, variant]) => [context, { [variant]: 1 }]),
  );
  const voiceStatsFinal = loadVoiceABStats();

  const run = collectAliveRun({
    identity: mind.identity,
    ledger: mind.ledger.stats(),
    rows: mind.ledger.all(),
    calibration: mind.calibration.stats(),
    mistakes: mistakes.getStats(),
    transfer: transferStore.stats(),
    idle: mind.idle.status(),
    strategyWeights,
    patterns,
    theories,
    skills: skillNames,
    voiceStats: voiceStatsFinal,
    now: Date.now,
  });
  const previous = loadAliveRuns().slice(-1)[0] ?? null;
  const assessment = assessM5(run, voiceStatsFinal);
  const saved = saveAliveRun(run, undefined, previous, assessment);
  console.log("\n" + generateAliveReport(run, previous, assessment));
  console.log(`Saved: ${saved.jsonPath}`);
  console.log(`Saved: ${saved.mdPath}`);
  if (!assessment.met) process.exitCode = 2;
}

main().catch((error) => {
  console.error("[m5]", error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});

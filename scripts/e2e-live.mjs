import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { localEmbed } from "../dist/core/local-embed.js";
import { cosineSimilarity } from "../dist/utils/math.js";
import { LOCAL_HASH_TAG } from "../dist/memory/embedding-service.js";
import { createLocalSemanticEmbedder } from "../dist/memory/local-semantic-embedder.js";
import { runReembed } from "../dist/memory/reembed.js";
import { SkillSemanticIndex } from "../dist/skills/semantic-index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = resolve(root, "experiments/review/e2e-live.md");
const argv = process.argv.slice(2);
const args = new Set(argv);
const memoryDir = argv.includes("--memory-dir") ? argv[argv.indexOf("--memory-dir") + 1] : "";
const live = args.has("--live");
const doReembed = args.has("--all") || args.has("--reembed");
const doSkills = args.has("--all") || args.has("--skills");
const doAuthor = args.has("--all") || args.has("--author");
const checks = [];

function record(name, status, detail) {
  checks.push({ name, status, detail, at: new Date().toISOString() });
  console.log(`${status.toUpperCase().padEnd(7)} ${name}: ${detail}`);
}

function hasProviderKey() {
  return Boolean(process.env.NTOX_API_KEY || process.env.OPENROUTER_API_KEY);
}

async function semanticAvailable() {
  const embedder = createLocalSemanticEmbedder({ force: true });
  if (!(await embedder.available())) {
    record("semantic-model", "skipped", embedder.reason || "local MiniLM unavailable");
    return null;
  }
  return embedder;
}

function readRows(path) {
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function writeRows(path, rows) {
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

async function reembedCheck() {
  const embedder = await semanticAvailable();
  if (!embedder) return;
  const dir = mkdtempSync(join(tmpdir(), "ntox-e2e-reembed-"));
  try {
    const path = join(dir, "episodes.jsonl");
    const seed = [
      { id: "ep1", sessionId: "e2e", userMessage: "prefers oat milk latte in the morning", assistantResponse: "noted" },
      { id: "ep2", sessionId: "e2e", userMessage: "project alpha deadline is next friday", assistantResponse: "noted" },
      { id: "ep3", sessionId: "e2e", userMessage: "user is allergic to peanuts", assistantResponse: "noted" },
    ].map((row) => ({ ...row, embedding: localEmbed(row.userMessage), embeddingModel: LOCAL_HASH_TAG }));
    writeRows(path, seed);

    if (memoryDir && existsSync(memoryDir)) copyFileSync(memoryDir, path);

    const dry = await runReembed({ embedder, episodesPath: path, dryRun: true, now: () => 1 });
    if (dry.mismatched === 0) throw new Error("dry run found no mismatches");
    if (dry.migrated !== 0) throw new Error("dry run mutated the store");
    if (existsSync(`${path}.bak.1`)) throw new Error("dry run created a backup");

    const real = await runReembed({ embedder, episodesPath: path, now: () => 1 });
    if (real.migrated !== dry.mismatched) throw new Error(`migrated ${real.migrated} of ${dry.mismatched}`);
    if (!existsSync(`${path}.bak.1`)) throw new Error("backup missing after real run");

    const migrated = readRows(path);
    if (migrated.some((row) => row.embeddingModel !== "local-minilm" && row.reembedTargetModel !== "local-minilm")) {
      throw new Error("a migrated row is missing provenance");
    }
    const query = (await embedder.embed("favorite caffeine drink before work")).vector;
    const scored = migrated
      .map((row, index) => ({ index, score: cosineSimilarity(query, row.embedding) }))
      .sort((a, b) => b.score - a.score);
    if (scored[0]?.index !== 0) throw new Error("new-model query did not retrieve the pre-migration entry");

    const second = await runReembed({ embedder, episodesPath: path, now: () => 2 });
    if (second.mismatched !== 0 || second.migrated !== 0) throw new Error("second run was not a true no-op");

    record(
      "reembed",
      "pass",
      `dry-run flagged ${dry.mismatched}; real run migrated ${real.migrated}; backup present; second run no-op; new-model retrieval ok`,
    );
  } catch (error) {
    record("reembed", "fail", error instanceof Error ? error.message : String(error));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function skillsCheck() {
  const embedder = await semanticAvailable();
  if (!embedder) return;
  try {
    const cache = join(tmpdir(), `ntox-e2e-skills-${Date.now()}.json`);
    const index = new SkillSemanticIndex(embedder, 8, cache);
    const candidates = [
      { name: "communication", description: "draft professional email messages and correspondence" },
      { name: "debugging", description: "find and fix bugs in source code" },
      { name: "finance", description: "evaluate investment options and portfolio risk" },
    ];
    const query = (await embedder.embed("compose a formal note to a client")).vector;
    const matches = await index.find(candidates, query, "local-minilm", 3);
    if (matches[0]?.name !== "communication") throw new Error(`expected communication, got ${matches[0]?.name ?? "none"}`);
    const keyword = await index.find(candidates, localEmbed("draft professional email messages"), LOCAL_HASH_TAG, 3);
    if (keyword.length !== 0) throw new Error("local-hash query was treated as semantic");
    rmSync(cache, { force: true });
    record("semantic-skill-match", "pass", "zero-keyword-overlap query selected the correct skill; local-hash fell back to keywords");
  } catch (error) {
    record("semantic-skill-match", "fail", error instanceof Error ? error.message : String(error));
  }
}

async function authorCheck() {
  if (!live || !hasProviderKey()) {
    record("self-author", "skipped", "requires --live with NTOX_API_KEY/OPENROUTER_API_KEY");
    return;
  }
  try {
    const { LLMClient } = await import("../dist/core/llm.js");
    const { maybeAuthorSkillOnStruggle } = await import("../dist/skills/self-author.js");
    const dir = mkdtempSync(join(tmpdir(), "ntox-e2e-author-"));
    const skillsDir = join(dir, "skills");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(skillsDir, { recursive: true });
    const key = process.env.NTOX_API_KEY || process.env.OPENROUTER_API_KEY || "";
    const llm = new LLMClient(key, process.env.NTOX_MODEL || "deepseek/deepseek-chat", "", 256, 0.2, "", process.env.NTOX_PROVIDER || "openrouter");
    const added = [];
    const registry = { list: () => added, add: (skill) => { added.push(skill); writeFileSync(join(skillsDir, `${skill.name}.json`), JSON.stringify(skill, null, 2)); } };
    const runtime = { skillAuthorTurn: 0, lastSkillAuthorTurn: null, skillAuthorsThisSession: 0 };
    const trace = {
      userInput: "Deploy the staging build and verify the health endpoint after release.",
      toolCalls: [{ name: "shell", success: false, args: { command: "deploy" } }],
      retries: 1,
      modelCritique: { gaps: 1 },
    };
    const first = await maybeAuthorSkillOnStruggle({ llm, registry, trace, fullResponse: "Retried and verified.", corrected: false, falseSuccess: false, toolFailure: true, runtime });
    const persisted = first && existsSync(join(skillsDir, `${first.name}.json`));
    const second = await maybeAuthorSkillOnStruggle({ llm, registry, trace, fullResponse: "Retried and verified.", corrected: false, falseSuccess: false, toolFailure: true, runtime });
    if (!first || !persisted) throw new Error("no persisted self-authored skill");
    if (first.category !== "self-authored") throw new Error("skill category is not self-authored");
    if (second !== null) throw new Error("cooldown did not suppress the second skill");
    record("self-author", "pass", `${first.name} persisted as self-authored; cooldown held on turn two`);
    rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    record("self-author", "fail", error instanceof Error ? error.message : String(error));
  }
}

if (doReembed) await reembedCheck();
if (doSkills) await skillsCheck();
if (doAuthor) await authorCheck();
if (!doReembed && !doSkills && !doAuthor) {
  console.log("Usage: scripts/e2e-live.mjs [--reembed|--skills|--author|--all] [--live] [--memory-dir <path>]");
}

const lines = [
  "# Live E2E validation (opt-in)",
  "",
  `Mode: ${live ? "live provider" : "offline (local MiniLM)"} · generated ${new Date().toISOString()}`,
  "",
  "All runs use temporary directories; no live provider key or personal memory is written to the repository.",
  "",
  "| Check | Status | Detail |",
  "|---|---|---|",
  ...checks.map((c) => `| ${c.name} | ${c.status} | ${c.detail.replace(/\|/g, "\\|")} |`),
  "",
  "## Manual REPL smoke (requires a TTY)",
  "",
  "Not automatable in CI. Run `npm run dev` in a terminal and exercise: a plain turn, a tool turn,",
  "a memory turn (`/memory`), `/trace`, and `/skills`. Paste redacted snippets here after the run.",
  "",
];
writeFileSync(reportPath, lines.join("\n"));
console.log(`Report: ${reportPath}`);

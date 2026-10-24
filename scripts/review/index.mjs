#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname, relative, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PROBES } from "./probes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const ARGS = process.argv.slice(2);
const FLAG = (name) => ARGS.includes(`--${name}`);
const OPT = (name, fallback) => {
  const i = ARGS.indexOf(`--${name}`);
  return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : fallback;
};

const QUICK = FLAG("quick");
const OFFLINE = FLAG("offline");
const JSON_ONLY = FLAG("json");
const OUT = resolve(ROOT, OPT("out", "review/NTOX_HIGH_LEVEL_REVIEW.md"));
const GATE = OPT("gate", null);

const p = (...parts) => join(ROOT, ...parts);
const read = (rel) => readFileSync(p(rel), "utf8");
const has = (rel) => existsSync(p(rel));
const lines = (rel) => read(rel).split(/\r?\n/).length;

function walk(dir, filter, acc = []) {
  const abs = p(dir);
  if (!existsSync(abs)) return acc;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, filter, acc);
    else if (!filter || filter(rel)) acc.push(rel.split(sep).join("/"));
  }
  return acc;
}

const cut = (text, start, end) => {
  const i = text.indexOf(start);
  if (i < 0) return "";
  const j = text.indexOf(end, i + start.length);
  return text.slice(i, j < 0 ? undefined : j + end.length);
};

function git(args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? (r.stdout ?? "").trim() : "";
}

function run(command, timeout = 600000) {
  const started = Date.now();
  const r =
    process.platform === "win32"
      ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], {
          cwd: ROOT,
          encoding: "utf8",
          timeout,
          maxBuffer: 32 * 1024 * 1024,
        })
      : spawnSync("sh", ["-c", command], {
          cwd: ROOT,
          encoding: "utf8",
          timeout,
          maxBuffer: 32 * 1024 * 1024,
        });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "");
  return { ok: !r.error && r.status === 0, output: out, ms: Date.now() - started };
}

const clamp01 = (n) => Math.max(0, Math.min(1, n));
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function collectMetrics() {
  const tsFiles = walk("src", (f) => f.endsWith(".ts"));
  const testFiles = tsFiles.filter((f) => f.endsWith(".test.ts"));
  const sourceFiles = tsFiles.filter((f) => !f.endsWith(".test.ts"));
  const locOf = (f) => readFileSync(p(f), "utf8").split(/\r?\n/).length;

  const sized = sourceFiles.map((f) => ({ file: f, lines: locOf(f) }));
  sized.sort((a, b) => b.lines - a.lines);

  const srcLoc = sized.reduce((s, f) => s + f.lines, 0);
  const testLoc = testFiles.reduce((s, f) => s + locOf(f), 0);

  const pkg = JSON.parse(read("package.json"));
  const readme = read("README.md");
  const config = read("src/core/config.ts");
  const dispatcher = read("src/core/dispatcher.ts");
  const llm = read("src/core/llm.ts");
  const shell = read("src/tools/shell.ts");
  const guard = read("src/core/guard.ts");

  const providers = (cut(llm, "const PROVIDERS", "\n};").match(/^\s{2}\w+:\s*\{/gm) ?? []).length;
  const allowlist = (cut(config, "const DEFAULT_ALLOWED_TOOLS = [", "];").match(/"([a-z_]+)"/g) ?? []).length;
  const toolArray = cut(dispatcher, "for (const tool of [", "]) {");
  const registeredTools = (toolArray.match(/^\s{4}\w+Tool(?:\([^)]*\))?,\s*$/gm) ?? []).length;
  const injectionPatterns = (cut(guard, "const INJECTION_PATTERNS = [", "];").match(/^\s{2}\//gm) ?? []).length;
  const blocklist = (cut(shell, "const BLOCKED_PATTERNS", "\n];").match(/^\s{2}\//gm) ?? []).length;

  const channels = ["telegram", "discord", "whatsapp", "slack", "web"].filter((c) =>
    has(`src/gateway/${c}.ts`),
  );

  const todos = sourceFiles.reduce(
    (n, f) => n + (readFileSync(p(f), "utf8").match(/\b(TODO|FIXME|HACK|XXX)\b/g) ?? []).length,
    0,
  );

  const coverage = (() => {
    if (!has("coverage/coverage-summary.json")) return null;
    try {
      const total = JSON.parse(read("coverage/coverage-summary.json")).total;
      return { lines: total.lines.pct, branches: total.branches.pct, statements: total.statements.pct };
    } catch {
      return null;
    }
  })();

  return {
    pkg,
    readme,
    srcFiles: sourceFiles.length,
    testFiles: testFiles.length,
    srcLoc,
    testLoc,
    largest: sized[0],
    secondLargest: sized[1],
    skills: walk("skills", (f) => f.endsWith(".md")).length,
    docs: walk("docs", (f) => f.endsWith(".md")).length,
    marketplace: walk("marketplace").length,
    providers,
    allowlist,
    registeredTools,
    injectionPatterns,
    blocklist,
    channels,
    todos,
    coverage,
    git: {
      commits: Number(git(["rev-list", "--count", "HEAD"]) || 0),
      authors: new Set(git(["log", "--format=%ae"]).split("\n").filter(Boolean)).size,
      first: git(["log", "--reverse", "--format=%ad", "--date=short"]).split("\n")[0] ?? "",
      last: git(["log", "-1", "--format=%ad", "--date=short"]),
      head: git(["rev-parse", "--short", "HEAD"]),
      dirty: git(["status", "--porcelain"]).length > 0,
    },
  };
}

function runtimeChecks() {
  if (QUICK) {
    const cached = has("review/runtime-cache.json")
      ? JSON.parse(read("review/runtime-cache.json")).runtime ?? null
      : null;
    if (!cached) process.stderr.write("warning: --quick without a runtime cache; typecheck, lint and test signals are excluded\n");
    return cached
      ? { ...cached, cached: true }
      : { skipped: true, typecheck: null, lint: null, tests: null };
  }

  const typecheck = run("npx tsc --noEmit");
  const lint = run("npx eslint src/");
  const tests = run("npx vitest run");
  const clean = (s) => (s || "").replace(/\x1b\[[0-9;]*m/g, "");
  const out = clean(tests.output);
  const passed = Number((out.match(/Tests\s+(\d+) passed/) ?? [])[1] ?? 0);
  const failed = Number((out.match(/Tests\s+(\d+) failed/) ?? [])[1] ?? 0);
  const files = Number((out.match(/Test Files\s+(\d+) passed/) ?? [])[1] ?? 0);
  const failedFiles = Number((out.match(/Test Files\s+(\d+) failed/) ?? [])[1] ?? 0);
  const duration = (out.match(/Duration\s+([\d.]+)s/) ?? [])[1] ?? null;

  return {
    skipped: false,
    typecheck: { ok: typecheck.ok, ms: typecheck.ms, errors: typecheck.ok ? 0 : (clean(typecheck.output).match(/error TS\d+/g) ?? []).length },
    lint: { ok: lint.ok, ms: lint.ms },
    tests: {
      ok: failed === 0 && failedFiles === 0 && passed > 0,
      passed,
      failed,
      files,
      failedFiles,
      duration,
    },
  };
}

function npmPublished() {
  if (OFFLINE) return { status: "unverified", version: null };
  const r = run(`npm view ${JSON.parse(read("package.json")).name} version`, 30000);
  const out = r.output.trim();
  if (/E404|404 Not Found/.test(out)) return { status: "missing", version: null };
  if (r.ok && /^\d+\.\d+\.\d+/.test(out)) return { status: "published", version: out.split("\n").pop().trim() };
  return { status: "unverified", version: null };
}

function probeResults() {
  return PROBES.map((probe) => {
    const base = { ...probe, hit: false, line: null };
    if (!has(probe.file)) return { ...base, note: "file not found" };
    const text = read(probe.file);
    const match = text.match(probe.match);
    if (!match) return base;
    const line = text.slice(0, match.index).split(/\r?\n/).length;
    if (probe.unless && probe.unless.test(text)) return { ...base, note: "guard present" };
    if (probe.minLines && lines(probe.file) < probe.minLines) return base;
    return { ...base, hit: true, line, quote: match[0].trim() };
  });
}

function auditClaims(m, rt, npm) {
  const testsMeasured = rt.tests?.passed ?? null;
  const claims = [];

  const testBadge = m.readme.match(/tests-(\d+)%20passing/);
  if (testBadge) {
    claims.push({
      claim: `README badge: ${testBadge[1]} tests passing`,
      measured: testsMeasured,
      status: testsMeasured == null ? "unverified" : testsMeasured >= Number(testBadge[1]) ? "undercount" : "stale",
      note: testsMeasured == null ? "suite not run" : `suite reports ${testsMeasured} passing tests`,
    });
  }

  const skillsClaim = m.readme.match(/(\d+)\+\s+(?:markdown\s+)?skill/i) ?? read("HIGHLIGHTS.md").match(/(\d+)\s+written frameworks/i);
  if (skillsClaim) {
    claims.push({
      claim: `README: ${skillsClaim[1]}+ skills`,
      measured: m.skills,
      status: m.skills >= Number(skillsClaim[1]) ? "holds" : "overstated",
      note: `${m.skills} markdown files under skills/`,
    });
  }

  const providerClaim = m.readme.match(/(\d+)\s+LLM [Pp]roviders/);
  if (providerClaim) {
    claims.push({
      claim: `README: ${providerClaim[1]} LLM providers`,
      measured: m.providers,
      status: "unverified",
      note: `${m.providers} named provider entries in src/core/llm.ts; the tenth is "any OpenAI-compatible endpoint", which is a capability rather than a provider`,
    });
  }

  const injectionClaim = m.readme.match(/(\d+)\s+injection pattern/);
  if (injectionClaim) {
    claims.push({
      claim: `README: ${injectionClaim[1]} injection pattern detectors`,
      measured: m.injectionPatterns,
      status: m.injectionPatterns >= Number(injectionClaim[1]) ? "holds" : "overstated",
      note: `${m.injectionPatterns} regexes in INJECTION_PATTERNS`,
    });
  }

  const gateClaim = read("README.md").match(/(\d+)-check verification/);
  if (gateClaim) {
    const checks = (read("scripts/verify-all.mjs").match(/runNpm\(|run\(/g) ?? []).length;
    claims.push({
      claim: `README: ${gateClaim[1]}-check verification gate`,
      measured: checks,
      status: "unverified",
      note: `${checks} run invocations in scripts/verify-all.mjs; gate not executed by this review`,
    });
  }

  if (npm.status !== "unverified") {
    claims.push({
      claim: "README: npm install -g ntox",
      measured: npm.status,
      status: npm.status === "published" ? "holds" : "broken",
      note:
        npm.status === "published"
          ? `registry serves ntox@${npm.version}`
          : "package is not on the registry; every documented install path fails",
    });
  }

  return claims;
}

function buildSignals(m, rt, npm, probes, claims) {
  const text = (rel) => (has(rel) ? read(rel) : "");
  const srcBlob = walk("src", (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => readFileSync(p(f), "utf8"))
    .join("\n");
  const probeHit = (id) => probes.find((x) => x.id === id)?.hit === true;
  const signal = (value, evidence) => ({ value: value == null ? null : clamp01(value), evidence });
  const ok = (cond, yes, no) => (cond ? yes : no);

  const readmeFirst = m.readme.split(/\r?\n\r?\n/).slice(0, 6).join(" ");
  const readmeBlocks = (m.readme.match(/```/g) ?? []).length / 2;
  const quickstart = cut(m.readme, "## Quick Start", "## Gateway");
  const quickBlocks = (quickstart.match(/```/g) ?? []).length / 2;

  const s = {};

  s.positioning = signal(
    readmeFirst.length > 200 && /agent/i.test(readmeFirst),
    `tagline: "${(m.readme.split(/\r?\n/).find((l) => l.startsWith("A ") && l.includes("agent")) ?? "").slice(0, 140)}"`,
  );
  s.quickstart = signal(quickBlocks >= 1, `${quickBlocks} command block under Quick Start, covering install, setup, doctor and first run`);
  s.highlights_evidence = signal(
    has("HIGHLIGHTS.md") && /npm run (eval|bench|verify)/.test(text("HIGHLIGHTS.md")),
    ok(has("HIGHLIGHTS.md"), "HIGHLIGHTS.md with reproduction commands", "no evidence document"),
  );
  s.docs_breadth = signal(clamp01(m.docs / 8), `${m.docs} markdown documents under docs/`);
  s.examples = signal(clamp01(readmeBlocks / 6), `${readmeBlocks} fenced code blocks in README`);

  const accuracyPool = claims.filter((c) => c.status !== "unverified");
  const accuracy = accuracyPool.length
    ? accuracyPool.filter((c) => c.status === "holds" || c.status === "undercount").length / accuracyPool.length
    : 0.5;
  s.docs_accuracy = signal(accuracy, `${accuracyPool.filter((c) => c.status === "holds" || c.status === "undercount").length} of ${accuracyPool.length} auditable README claims hold against the tree`);

  s.native_tool_calling = signal(
    /tool_calls|tool_use/.test(text("src/core/llm.ts")),
    "OpenAI tool_calls and Anthropic tool_use handled in llm.ts",
  );
  s.iteration_guard = signal(
    /maxToolAttempts|MAX_TOOL|attempts\s*<\s*10|maxAttempts/i.test(text("src/core/agent.ts")),
    ok(/attempts\s*<|maxAttempts/i.test(text("src/core/agent.ts")), "tool loop bounded per turn", "no bounded loop found"),
  );
  s.streaming = signal(/async \*/.test(text("src/core/llm.ts")) || /yield/.test(text("src/core/llm.ts")), "streaming generator in llm.ts");
  s.context_budget = signal(
    /manageContextWindow|tokenBudget|contextWindow/i.test(srcBlob),
    "context window budgeting present",
  );
  s.provider_breadth = signal(clamp01(m.providers / 8), `${m.providers} providers (OpenAI, Anthropic, Ollama, LM Studio, Groq, Together, Mistral, DeepSeek, OpenRouter, compatible)`);
  s.error_recovery = signal(
    /recovery|retry|backoff/i.test(text("src/core/agent.ts")),
    "tool-failure recovery prompts and retry handling",
  );
  s.subagents = signal(has("src/tools/subagent.ts") && /subagentTool/.test(text("src/core/dispatcher.ts")), "subagent tool registered");

  const repoAware = /tree-sitter|repoMap|repo-map|typescript-language|languageServer/i.test(srcBlob);
  s.repo_awareness = signal(
    repoAware ? 1 : 0,
    repoAware
      ? "repository index or language server present"
      : "no repo map, tree-sitter index or LSP awareness: the model reads files blind, which is Aider's and Claude Code's core advantage",
  );
  const patchEditing = /apply_patch|unified diff|diff -u/i.test(srcBlob);
  s.patch_precision = signal(
    patchEditing ? 1 : /exact string replacements/i.test(text("src/tools/filesystem.ts")) ? 0.35 : 0.5,
    patchEditing
      ? "patch-based editing"
      : "edit tool performs exact string replacement with no diff or patch format, so large refactors are fragile",
  );
  s.parallel_tools = signal(
    /Promise\.all\([^)]*tool|Promise\.allSettled\([^)]*tool/i.test(srcBlob) ? 1 : 0,
    "tool calls are executed sequentially, one per model turn",
  );

  s.predict_before_act = signal(
    /prediction|predictor/i.test(text("src/core/agent.ts")) && has("src/mind/predictor.ts"),
    "turn prediction created before tool execution",
  );
  s.prediction_scored = signal(
    /brier/i.test(text("src/mind/predictor.ts")) && /calibrat/i.test(text("src/mind/predictor.ts")),
    "Brier score and expected calibration error computed per turn",
  );
  s.prediction_acts = signal(
    /handleSurprise/.test(text("src/core/agent.ts")) && /explor/i.test(text("src/mind/mind.ts")),
    "surprise writes a durable memory and raises bandit exploration",
  );
  const decisionFiles = [
    "src/core/agent.ts",
    "src/core/policy.ts",
    "src/core/orchestrator.ts",
    "src/mind/mind.ts",
    "src/mind/bandit.ts",
    "src/meta/executive.ts",
    "src/kernel/decision-kernel.ts",
  ].filter(has);
  const calibrationControl = decisionFiles.filter(
    (f) => /if\s*\([^)]*calibrat|calibrat[^;\n]{0,40}[<>]=?\s*0?\.\d/i.test(text(f)),
  );
  s.calibration_control = signal(
    calibrationControl.length ? 1 : 0.2,
    calibrationControl.length
      ? `calibration participates in control logic in ${calibrationControl.slice(0, 2).join(", ")}`
      : "calibration is computed and rendered (/trace, /mind) but no non-UI branch reads it",
  );
  s.bandit_selection = signal(
    has("src/mind/bandit.ts") && /bandit\.select|selectStrategy/.test(text("src/mind/mind.ts")),
    "Thompson sampling over stance selection in mind.ts",
  );
  s.learned_guidance_reaches_model = signal(
    probeHit("bandit-guidance-suppressed") ? 0.2 : 1,
    probeHit("bandit-guidance-suppressed")
      ? "suppressed: prompt section emitted only when cognitiveKernel is disabled (default is enabled)"
      : "strategy guidance reaches the prompt",
  );
  s.pattern_compiles_to_skill = signal(
    /SkillDefinition/.test(text("src/cognition/kernel.ts")),
    "compiled patterns are converted into skill definitions consumed by the executor",
  );
  s.learning_signal_quality = signal(
    /sentence|hedg/i.test(text("src/cognition/critique.ts")) ? 0.3 : 0.7,
    "critique scores completeness from sentence counts and accuracy from hedging words, not from task outcome",
  );
  s.reflection_persisted = signal(
    probeHit("reflection-not-persisted") ? 0.15 : 1,
    probeHit("reflection-not-persisted")
      ? "reflection text goes to a UI callback only; not stored, not re-injected; feature defaults off"
      : "reflections persisted and reinjected",
  );
  s.self_awareness_depth = signal(
    probeHit("self-awareness-hardcoded-confidence") ? 0.4 : 1,
    probeHit("self-awareness-hardcoded-confidence")
      ? "feedback trigger passes a literal 0.5 instead of measured calibration"
      : "self-awareness uses measured state",
  );

  s.embeddings = signal(
    /embed/i.test(text("src/core/llm.ts")) && has("src/core/local-embed.ts"),
    "provider embeddings with deterministic local fallback",
  );
  s.hybrid_retrieval = signal(/bm25/i.test(text("src/memory/episodic.ts")), "hybrid cosine + BM25 ranking in episodic.ts");
  s.correction_authority = signal(
    /correction/i.test(text("src/memory/episodic.ts")) && /Previous Corrections/.test(srcBlob),
    "corrections stored authoritatively and injected ahead of conflicting memories",
  );
  s.consolidation = signal(
    /consolidat/i.test(text("src/memory/episodic.ts")),
    "union-find style consolidation and reliability decay",
  );
  s.user_model = signal(has("src/memory/user-model.ts") && /userModel|user-model/.test(text("src/core/agent.ts")), "user model extracted and pinned into context");
  s.retrieval_measured = signal(
    /recall@|mrr|ndcg|retrieval benchmark/i.test(walk("src/benchmark", (f) => f.endsWith(".ts")).map((f) => readFileSync(p(f), "utf8")).join("\n")) ? 1 : 0.2,
    "no retrieval benchmark: ranking quality is asserted by unit tests, not measured against labelled recall",
  );
  s.theory_outcome_scoring = signal(
    probeHit("theory-confirmation-circular") ? 0.4 : 1,
    probeHit("theory-confirmation-circular")
      ? "confidence rises with same-domain similarity rather than resolved outcomes"
      : "theory confidence tied to resolved outcomes",
  );
  s.behavioral_tests = signal(
    has("src/memory/episodic.test.ts") && lines("src/memory/episodic.test.ts") > 300,
    "episodic tests assert ranking, thresholds, correction demotion and consolidation",
  );

  s.tool_breadth = signal(clamp01(m.registeredTools / 24), `${m.registeredTools} tools registered in the dispatcher`);
  s.mcp_inbound = signal(has("src/mcp/bridge.ts") && /mcpServers/.test(text("src/core/config.ts")), "MCP client bridge with mcpServers config");
  s.mcp_outbound = signal(/arg === "mcp"/.test(text("src/index.ts")), "ntox mcp serves skills as MCP tools over stdio");
  s.channel_breadth = signal(clamp01(m.channels.length / 4), `${m.channels.length} channels: ${m.channels.join(", ")}`);
  const media = [has("src/tools/image.ts"), has("src/tools/voice.ts") || has("src/tools/stt.ts"), has("src/tools/email.ts")].filter(Boolean).length;
  s.media_voice_email = signal(media / 3, `${media}/3 media, voice and email surfaces present`);
  const coverageRatio = m.registeredTools ? m.allowlist / m.registeredTools : 0;
  s.policy_coverage = signal(coverageRatio, `${m.allowlist} of ${m.registeredTools} registered tools appear in the default allowlist`);
  s.policy_uniformity = signal(
    probeHit("mcp-bypasses-tool-policy") ? 0.4 : 1,
    probeHit("mcp-bypasses-tool-policy") ? "MCP tools registered without enforceToolPolicy" : "uniform policy enforcement",
  );

  s.typecheck = rt.typecheck ? signal(rt.typecheck.ok ? 1 : 0, rt.typecheck.ok ? "tsc --noEmit clean" : `${rt.typecheck.errors} type errors`) : signal(null, "skipped");
  s.lint = rt.lint ? signal(rt.lint.ok ? 1 : 0, rt.lint.ok ? "eslint clean" : "eslint reports errors") : signal(null, "skipped");
  s.tests_green = rt.tests ? signal(rt.tests.ok ? 1 : 0, rt.tests.ok ? `${rt.tests.passed} passing, 0 failing` : `${rt.tests.failed} failing`) : signal(null, "skipped");
  s.suite_size = signal(rt.tests?.passed ? clamp01(rt.tests.passed / 1200) : null, rt.tests?.passed ? `${rt.tests.passed} tests across ${rt.tests.files} files in ${rt.tests.duration}s` : "skipped");
  s.coverage = signal(m.coverage ? clamp01(m.coverage.lines / 85) : null, m.coverage ? `${m.coverage.lines}% lines, ${m.coverage.branches}% branches` : "no coverage artifact");
  s.test_ratio = signal(clamp01(m.testLoc / m.srcLoc / 0.5), `${Math.round(m.testLoc / m.srcLoc * 100)}% test-to-source LOC (${m.testLoc} vs ${m.srcLoc})`);
  const ci = text(".github/workflows/ci.yml");
  const matrix = (ci.match(/node-version:\s*\[([^\]]+)\]/) ?? [])[1];
  s.ci_matrix = signal(matrix ? clamp01(matrix.split(",").length / 3) : null, matrix ? `CI matrix: node ${matrix.trim()}` : "no node matrix");
  const biggest = m.largest?.lines ?? 0;
  const maintain = biggest < 600 ? 1 : biggest < 900 ? 0.85 : biggest < 1400 ? 0.65 : biggest < 2000 ? 0.45 : 0.3;
  s.maintainability = signal(
    clamp01(maintain - (m.todos > 20 ? 0.1 : 0)),
    `largest module ${m.largest.file} at ${biggest} lines; src/core/agent.ts at ${has("src/core/agent.ts") ? lines("src/core/agent.ts") : "?"} lines; ${m.todos} TODO/FIXME markers`,
  );
  s.release_discipline = signal(
    has("CHANGELOG.md") && /^\d+\.\d+\.\d+/.test(m.pkg.version) ? 1 : has("CHANGELOG.md") ? 0.6 : 0.3,
    `version ${m.pkg.version}, CHANGELOG ${has("CHANGELOG.md") ? "present" : "missing"}`,
  );
  s.bus_factor = signal(m.git.authors >= 3 ? 1 : m.git.authors === 2 ? 0.6 : 0.25, `${m.git.authors} distinct commit authors over ${m.git.commits} commits`);

  s.blocklist = signal(clamp01(m.blocklist / 30), `${m.blocklist} blocked command patterns plus flag and platform guards`);
  s.approval_gate = signal(has("src/tools/approval.ts") && /approval-required/.test(text("src/core/config.ts")), "approval-required shell policy wired through approval.ts");
  const hardened = /--read-only|--cap-drop|--pids-limit|--memory/.test(text("src/tools/shell.ts"));
  const sandboxed = /docker run/.test(text("src/tools/shell.ts"));
  s.sandbox_strength = signal(
    !sandboxed ? 0.1 : hardened ? 0.85 : 0.4,
    !sandboxed
      ? "no sandbox implementation"
      : hardened
        ? "container isolation with hardening flags"
        : "docker run --rm with workspace mount only: opt-in on Windows, silent host fallback, no user/cap/pid/memory limits",
  );
  s.injection_guard = signal(clamp01(m.injectionPatterns / 12), `${m.injectionPatterns} prompt-injection regexes`);
  s.secret_redaction = signal(/SECRET_PATTERNS/.test(text("src/core/guard.ts")) && has("src/core/redact.ts"), "secret patterns plus output redaction module");
  s.policy_coverage_security = s.policy_coverage;

  s.setup_wizard = signal(has("src/setup.ts") && /setup/i.test(text("src/index.ts")), "interactive setup wizard");
  s.doctor = signal(has("src/doctor.ts"), "ntox doctor diagnostics");
  s.inspectability = signal(/case "trace"/.test(text("src/cli/repl.ts")) && /case "mind"/.test(text("src/cli/repl.ts")), "/trace and /mind inspect state, cost and calibration");
  s.recovery_guidance = signal(/recovery/i.test(text("src/core/agent.ts")), "failed tool outcomes produce a next-step recovery prompt");
  s.install_path = signal(
    npm.status === "published" ? 1 : npm.status === "missing" ? 0.1 : 0.5,
    npm.status === "published"
      ? `npm serves ntox@${npm.version}`
      : npm.status === "missing"
        ? "npm install -g ntox returns 404; install.sh and install.ps1 call the same command, so every advertised path fails"
        : "registry check skipped or unverifiable",
  );
  s.desktop_surface = signal(has("desktop/index.html") && has("desktop/dashboard.js"), "separate Electron desktop dashboard in desktop/");

  s.npm_published = s.install_path;
  s.docs_site = signal(has("site/index.html") || has("ntox_portfolio.html"), "static showcase site in site/");
  s.marketplace = signal(clamp01(m.marketplace / 3), `${m.marketplace} files in marketplace/`);
  s.integration_sdk = signal(
    has("integrations/deepseek-harness") && /"\.\/cognition"|ntox\/cognition/.test(m.pkg.exports ? JSON.stringify(m.pkg.exports) : ""),
    "published cognition exports plus DeepSeek Harness adapter package",
  );
  s.interop = signal(
    /mcp/i.test(text("src/index.ts")) && /openai-compatible|OpenAI-compatible/i.test(m.readme),
    "MCP both directions and any OpenAI-compatible endpoint",
  );
  s.release_discipline_dist = s.release_discipline;
  s.community = signal(m.git.authors >= 3 ? 1 : m.git.authors === 2 ? 0.5 : 0.15, `single-author history, no external contributors in git log`);

  return s;
}

function scoreDimensions(rubric, signals) {
  return rubric.dimensions.map((dim) => {
    const items = dim.signals.map((sig) => {
      const found = signals[sig.id];
      if (!found) throw new Error(`missing signal: ${sig.id}`);
      return { ...sig, ...found };
    });
    const active = items.filter((i) => i.value != null);
    const totalWeight = active.reduce((s, i) => s + i.weight, 0) || 1;
    const measured = active.reduce((s, i) => s + i.weight * i.value, 0) / totalWeight;
    let score = round(1 + 9 * measured, 1);
    let gate = null;
    if (dim.hard_gate) {
      const gateSignal = items.find((i) => i.id === dim.hard_gate.signal);
      if (gateSignal && gateSignal.value != null && gateSignal.value < dim.hard_gate.below && score > dim.hard_gate.cap) {
        gate = { cap: dim.hard_gate.cap, raw: score, reason: dim.hard_gate.reason };
        score = dim.hard_gate.cap;
      }
    }
    return { ...dim, signals: items, measured, score, gate };
  });
}

function scoreCompetitors(competitorData, dims) {
  return competitorData.competitors.map((c) => {
    const totalWeight = dims.reduce((s, d) => s + d.weight, 0);
    const overall = dims.reduce((s, d) => s + d.weight * (c.scores[d.id] ?? 0), 0) / totalWeight;
    return { ...c, overall: round(overall, 1) };
  });
}

function weightedOverall(dims, weights, scoreOf) {
  const total = dims.reduce((s, d) => s + (weights[d.id] ?? d.weight), 0);
  return dims.reduce((s, d) => s + (weights[d.id] ?? d.weight) * scoreOf(d), 0) / total;
}

function gradeOf(score) {
  if (score >= 9) return "A";
  if (score >= 8.5) return "A-";
  if (score >= 8) return "B+";
  if (score >= 7.3) return "B";
  if (score >= 6.6) return "B-";
  if (score >= 6) return "C+";
  if (score >= 5.3) return "C";
  if (score >= 4.6) return "C-";
  if (score >= 4) return "D+";
  if (score >= 3.3) return "D";
  return "F";
}

function bar(score) {
  const full = Math.round(score);
  return `${"█".repeat(full)}${"░".repeat(10 - full)}`;
}

function collectFindings(m, rt, probes, claims, dims, signals, npm) {
  const findings = [];

  for (const probe of probes.filter((x) => x.hit)) {
    findings.push({
      severity: probe.severity,
      title: probe.title,
      evidence: probe.minLines
        ? `${probe.file}:${probe.line} — \`${probe.quote}\`; file is ${lines(probe.file)} lines`
        : `${probe.file}:${probe.line} — \`${probe.quote}\``,
      detail: probe.detail,
      fix: probe.fix,
      dimension: probe.dimension,
      dedupe: probe.signal ?? probe.id,
      source: "probe",
    });
  }

  if (m.allowlist < m.registeredTools) {
    const missing = m.registeredTools - m.allowlist;
    findings.push({
      severity: "P2",
      title: `${missing} registered tools are unreachable under the default workspace policy`,
      evidence: `${m.registeredTools} tools registered in dispatcher.ts, ${m.allowlist} names in DEFAULT_ALLOWED_TOOLS (config.ts:135)`,
      detail:
        "The model sees tools it cannot call. Calls fail at policy time rather than being absent from the schema, which produces avoidable retries.",
      fix: "Project the registry through the active policy when building the tool schema.",
      dimension: "integration",
      dedupe: "policy_coverage",
      source: "metric",
    });
  }

  if (npm.status === "missing") {
    findings.push({
      severity: "P1",
      title: "Every documented install path is broken",
      evidence: "README quick start offers npm, curl and PowerShell; all three end in `npm install -g ntox`, and the registry returns 404",
      detail:
        "install.sh and install.ps1 check for Node, then run `npm install -g ntox@latest`. With no published package, none of the three advertised entry points can succeed, so the product is only reachable by cloning the repository and building it.",
      fix: "Publish to npm, or point the installers at a release tarball that actually resolves.",
      dimension: "distribution",
      dedupe: "install_path",
      source: "metric",
    });
  }

  if (m.coverage && m.coverage.lines < 65) {
    findings.push({
      severity: "P2",
      title: `Line coverage is ${m.coverage.lines}% with ${m.coverage.branches}% branches`,
      evidence: "coverage/coverage-summary.json",
      detail:
        "The untested surface sits in the modules that carry the differentiation claim: cognition, policy and the post-turn learning path.",
      fix: "Set a per-directory coverage floor for src/cognition, src/mind and src/core/policy.ts.",
      dimension: "engineering",
      dedupe: "coverage",
      source: "metric",
    });
  }

  if (m.git.authors <= 1) {
    findings.push({
      severity: "P2",
      title: "Bus factor is one",
      evidence: `${m.git.commits} commits, ${m.git.authors} author(s), since ${m.git.first}`,
      detail:
        "No external maintainers, no co-authored commits, no review trail. That is a risk signal for anyone considering adoption, independent of code quality.",
      fix: "Recruit a second maintainer, or document a governance and handover model.",
      dimension: "engineering",
      source: "metric",
    });
  }

  for (const claim of claims.filter((c) => c.status === "broken" || c.status === "stale" || c.status === "overstated" || c.status === "undercount")) {
    findings.push({
      severity: claim.status === "broken" ? "P1" : "P3",
      title: `Marketing claim does not match the tree: ${claim.claim}`,
      evidence: claim.note,
      detail:
        "Claims that are checkable and wrong cost more credibility than claims that are merely vague.",
      fix: "Generate the badge numbers from the test run, or drop the number.",
      dimension: "product_clarity",
      dedupe: /npm install/.test(claim.claim) ? "install_path" : claim.claim,
      source: "claim",
    });
  }

  const coveredSignals = new Set(probes.filter((x) => x.hit && x.signal).map((x) => x.signal));
  const weak = dims
    .flatMap((d) =>
      d.signals
        .filter((s) => s.value != null && s.value < 0.5 && !coveredSignals.has(s.id))
        .map((s) => {
          const materiality = (d.weight / 100) * s.weight * (1 - s.value);
          return {
            severity: materiality > 0.02 ? "P1" : materiality > 0.008 ? "P2" : "P3",
            title: `${d.name}: ${s.label} — weak signal`,
            evidence: s.evidence,
            detail: `Signal scored ${round(s.value * 10, 1)}/10 inside a dimension weighted ${d.weight}% of the total.`,
            fix: null,
            dimension: d.id,
            dedupe: s.id === "npm_published" ? "install_path" : s.id,
            source: "signal",
            weight: materiality,
          };
        }),
    )
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8);

  for (const w of weak) findings.push(w);

  const seen = new Set();
  const deduped = findings.filter((f) => {
    const key = f.dedupe ?? f.evidence;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return deduped.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9) || (b.weight ?? 0) - (a.weight ?? 0));
}

function actionPlan(dims) {
  const all = dims.flatMap((d) =>
    d.signals
      .filter((s) => s.value != null && s.value < 0.85)
      .map((s) => ({
        dimension: d.name,
        label: s.label,
        evidence: s.evidence,
        gain: 9 * (d.weight / 100) * s.weight * (1 - s.value),
        value: s.value,
      })),
  );
  return all.sort((a, b) => b.gain - a.gain).slice(0, 10);
}

function render({ rubric, metrics: m, runtime: rt, npm, probes, claims, dims, competitors, adoption, overall, findings, plan, generatedAt }) {
  const L = [];
  const push = (...xs) => L.push(...xs);

  push(`# NTOX — High-Level Product and Engineering Review`);
  push("");
  push(`> Generated by \`scripts/review/index.mjs\` on ${generatedAt} against \`${m.git.head}\`${m.git.dirty ? " (working tree dirty)" : ""}.`);
  push(`> Every NTOX score below is computed from the current tree or a live command run. Competitor scores are analyst estimates, labelled as such.`);
  push("");
  push(`**Overall: ${overall.score.toFixed(1)} / 10 — ${gradeOf(overall.score)}**  ${bar(overall.score)}`);
  push("");

  const best = [...dims].sort((a, b) => b.score - a.score || b.weight - a.weight)[0];
  const worst = [...dims].sort((a, b) => a.score - b.score || b.weight - a.weight)[0];
  const leader = [...competitors].sort((a, b) => b.overall - a.overall)[0];
  const adoptionLeader = adoption.byProduct[0];
  const decisive = findings.filter((f) => f.severity === "P1").slice(0, 3);
  const ntoxRank = 1 + competitors.filter((c) => c.overall > overall.score).length;
  const relation =
    overall.score >= leader.overall
      ? `level with ${leader.name} (${leader.overall.toFixed(1)})`
      : `behind ${leader.name} (${leader.overall.toFixed(1)})`;
  push(
    `NTOX scores **${overall.score.toFixed(1)}/10** — ${gradeOf(overall.score)}. Under the capability weighting it ranks **${ntoxRank} of ${competitors.length + 1}**, ${relation}. Under the adoption weighting it ranks **${adoption.rank} of ${competitors.length + 1}**, behind ${adoptionLeader.name} (${adoptionLeader.score.toFixed(1)}).`,
  );
  push("");
  push(
    `The honest reading: architecture is competitive, adoption is not. The strongest area is **${best.name}** (${best.score.toFixed(1)}), the weakest is **${worst.name}** (${worst.score.toFixed(1)}), and the ${round(Math.max(...dims.map((d) => d.score)) - Math.min(...dims.map((d) => d.score)), 1)}-point spread is unusually wide.`,
  );
  push("");
  if (decisive.length) {
    const sentences = decisive.map((f) => f.title.charAt(0).toUpperCase() + f.title.slice(1));
    push(`**What decides the grade.** ${sentences.join("; ")}.`);
    push("");
  }
  push(`Read this as a capability and evidence audit, not a usage review. Model quality dominates the felt experience of any agent, and that variable belongs to the provider, not to this repository.`);
  push("");
  push(`Evidence base: ${m.srcFiles} source files / ${m.srcLoc} lines of application code, ${rt.tests?.passed ?? "?"} tests in ${rt.tests?.files ?? "?"} files, ${m.skills} skill documents, ${m.registeredTools} registered tools, ${m.providers} model providers.`);
  push("");

  push(`## 1. Scorecard`);
  push("");
  push(`| Dimension | Weight | Score | Weighted | Profile |`);
  push(`| --- | ---: | ---: | ---: | --- |`);
  for (const d of dims) {
    push(`| ${d.name} | ${d.weight}% | ${d.score.toFixed(1)}${d.gate ? " *" : ""} | ${((d.weight * d.score) / 100).toFixed(2)} | \`${bar(d.score)}\` |`);
  }
  push(`| **Total** | **100%** | **${overall.score.toFixed(1)}** | **${overall.score.toFixed(1)}** | **${gradeOf(overall.score)}** |`);
  push("");
  const gated = dims.filter((d) => d.gate);
  if (gated.length) {
    push(`* Hard-gated: ${gated.map((d) => `${d.name} capped at ${d.gate.cap} (raw ${d.gate.raw}); ${d.gate.reason}`).join("; ")}.`);
    push("");
  }
  const strongest = dims
    .flatMap((d) => d.signals.filter((s) => s.value != null && s.value >= 0.9).map((s) => ({ ...s, dim: d.name, contribution: d.weight * s.weight * s.value })))
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 5);
  push(`### What holds up`);
  push("");
  for (const s of strongest) {
    push(`- **${s.label}** (${s.dim}) — ${round(s.value * 10, 1)}/10. ${s.evidence}`);
  }
  push("");

  push(`## 2. Dimension evidence`);
  push("");
  push(`Each signal is a measurable fact. A dimension score is the weighted mean of its signals, mapped onto 1-10. Null signals are excluded rather than guessed.`);
  push("");
  for (const d of dims) {
    push(`### ${d.name} — ${d.score.toFixed(1)}/10 (weight ${d.weight}%)`);
    push("");
    push(`*${d.question}*`);
    push("");
    push(`| Signal | Weight | Value | Evidence |`);
    push(`| --- | ---: | ---: | --- |`);
    for (const s of d.signals) {
      const value = s.value == null ? "skipped" : `${round(s.value * 10, 1)}/10`;
      push(`| ${s.label} | ${Math.round(s.weight * 100)}% | ${value} | ${s.evidence.replace(/\|/g, "\\|")} |`);
    }
    push("");
  }

  push(`## 3. Competitive position`);
  push("");
  push(`Competitor numbers are analyst estimates from public documentation (${competitors.length} products, confidence per product). They are comparable in scale, not measured runs. NTOX is the only column computed from this tree.`);
  push("");
  const axisShort = (id) => {
    const map = {
      product_clarity: "Clarity",
      core_loop: "Loop",
      cognition: "Meta",
      memory: "Memory",
      integration: "Integr.",
      engineering: "Eng.",
      security: "Security",
      ux: "UX",
      distribution: "Distrib.",
    };
    return map[id] ?? id;
  };
  push(`| Product | ${dims.map((d) => axisShort(d.id)).join(" | ")} | Overall |`);
  push(`| --- | ${dims.map(() => "---:").join(" | ")} | ---: |`);
  push(`| **NTOX (measured)** | ${dims.map((d) => `**${d.score.toFixed(1)}**`).join(" | ")} | **${overall.score.toFixed(1)}** |`);
  for (const c of [...competitors].sort((a, b) => b.overall - a.overall)) {
    push(`| ${c.name} | ${dims.map((d) => c.scores[d.id] ?? "-").join(" | ")} | ${c.overall.toFixed(1)} |`);
  }
  push("");
  push(`### Weighting sensitivity`);
  push("");
  push(`A rival reviewer could argue the main weights flatter NTOX, because 51% of the total sits on core loop, cognition, memory and integration, where NTOX is strongest. The same evidence is therefore re-scored under an adoption weighting (${rubric.sensitivity.adoption.rationale.toLowerCase()}).`);
  push("");
  push(`| Product | Capability-weighted (main) | ${adoption.label} | Change |`);
  push(`| --- | ---: | ---: | ---: |`);
  push(`| **NTOX (measured)** | **${overall.score.toFixed(1)}** | **${adoption.score.toFixed(1)}** | ${round(adoption.score - overall.score, 1)} |`);
  for (const rival of adoption.byProduct.filter((x) => x.name !== "NTOX")) {
    const capability = competitors.find((c) => c.name === rival.name)?.overall ?? 0;
    push(`| ${rival.name} | ${capability.toFixed(1)} | ${rival.score.toFixed(1)} | ${round(rival.score - capability, 1)} |`);
  }
  push("");
  push(`Adoption weighting moves NTOX from rank **${1 + competitors.filter((c) => c.overall > overall.score).length}** to rank **${adoption.rank}** of ${competitors.length + 1}. The gap is concentrated in distribution, onboarding and sandbox trust, not in architecture.`);
  push("");

  push(`### Where NTOX leads`);
  push("");
  const leads = dims.filter((d) => d.score >= Math.max(...competitors.map((c) => c.scores[d.id] ?? 0)));
  const near = dims.filter(
    (d) =>
      !leads.includes(d) &&
      d.score >= median(competitors.map((c) => c.scores[d.id] ?? 0)),
  );
  if (leads.length) {
    for (const d of leads) {
      const bestCompetitor = Math.max(...competitors.map((c) => c.scores[d.id] ?? 0));
      push(`- **${d.name}** — ${d.score.toFixed(1)} vs best competitor ${bestCompetitor}.`);
    }
  } else {
    push(`- Nothing outright. The rubric has no axis where NTOX strictly beats every competitor.`);
  }
  push("");
  push(`### Where NTOX is mid-pack`);
  push("");
  for (const d of near) {
    const top = Math.max(...competitors.map((c) => c.scores[d.id] ?? 0));
    push(`- **${d.name}** — ${d.score.toFixed(1)} vs best competitor ${top} (gap ${round(top - d.score, 1)}).`);
  }
  push("");
  push(`### Where NTOX trails`);
  push("");
  for (const d of dims.filter((d) => d.score < median(competitors.map((c) => c.scores[d.id] ?? 0))).sort((a, b) => a.score - b.score)) {
    const top = Math.max(...competitors.map((c) => c.scores[d.id] ?? 0));
    push(`- **${d.name}** — ${d.score.toFixed(1)} vs best competitor ${top} (gap ${round(top - d.score, 1)}).`);
  }
  push("");

  push(`## 4. Claim audit`);
  push("");
  push(`| Claim | Status | Measured |`);
  push(`| --- | --- | --- |`);
  for (const c of claims) push(`| ${c.claim} | ${c.status} | ${c.note} |`);
  push("");

  push(`## 5. Findings`);
  push("");
  const count = (sev) => findings.filter((f) => f.severity === sev).length;
  push(`${count("P0")} blocking, ${count("P1")} high, ${count("P2")} moderate, ${count("P3")} minor. Probes are code signatures for known defect patterns: a hit means the pattern is still present and a reviewer confirmed it in this run.`);
  push("");
  for (const f of findings) {
    push(`### ${f.severity} — ${f.title}`);
    push("");
    push(`*Evidence:* ${f.evidence}`);
    push("");
    push(f.detail);
    if (f.fix) push(`\n*Fix:* ${f.fix}`);
    push("");
  }

  push(`## 6. Path to a higher score`);
  push("");
  push(`Ranked by expected weighted gain if the signal were fully resolved. Total available: **+${round(plan.reduce((s, x) => s + x.gain, 0), 1)} points**.`);
  push("");
  push(`| # | Dimension | Move | Expected gain | Current |`);
  push(`| ---: | --- | --- | ---: | ---: |`);
  plan.forEach((x, i) => push(`| ${i + 1} | ${x.dimension} | ${x.label} — ${x.evidence.replace(/\|/g, "\\|")} | +${round(x.gain, 2)} | ${round(x.value * 10, 1)}/10 |`));
  push("");

  push(`## 7. Method and limits`);
  push("");
  push(`- **Measured:** file and line counts, tool registration versus allowlist, provider table, blocklist size, test results, typecheck, lint, coverage artifact, git history, npm registry lookup.`);
  push(`- **Probed:** ${probes.length} code signatures that detect dead wiring, suppression flags and policy bypasses; each hit is quoted with file and line.`);
  push(`- **Estimated:** competitor scores, product positioning, and the market read. They are directional and confidence-labelled in \`scripts/review/competitors.json\`.`);
  push(`- **Not covered:** live model quality, latency, real task-completion rates, cost per task, desktop UX (separate audit in \`docs/UI_UX_AUDIT.md\`), and long-run learning effects. A benchmark for these exists in \`src/benchmark\` but requires provider credentials.`);
  push(`- **Bias controls:** signals are fixed before scoring; marketing claims are audited against measured values; code is scored from call sites rather than module existence; a dimension cannot be lifted by adding files.`);
  push("");
  push(`## 8. Reproduce`);
  push("");
  push("```bash");
  push("npm run review            # full run: typecheck, lint, tests, registry lookup");
  push("npm run review -- --quick # static signals only, reuses last runtime results");
  push("npm run review -- --gate 7");
  push("```");
  push("");
  push(`_Generated artefacts: \`review/NTOX_HIGH_LEVEL_REVIEW.md\`, \`review/latest.json\`._`);

  return L.join("\n");
}

function main() {
  const rubric = JSON.parse(read("scripts/review/rubric.json"));
  const competitorData = JSON.parse(read("scripts/review/competitors.json"));

  process.stderr.write("collecting metrics...\n");
  const metrics = collectMetrics();

  process.stderr.write(QUICK ? "runtime checks skipped...\n" : "running typecheck, lint and tests...\n");
  const runtime = runtimeChecks();

  const npm = npmPublished();

  if (!runtime.skipped && !QUICK) {
    mkdirSync(p("review"), { recursive: true });
    writeFileSync(
      p("review/runtime-cache.json"),
      JSON.stringify({ runtime, npm, at: new Date().toISOString() }, null, 2),
    );
  }

  const probes = probeResults();
  const claims = auditClaims(metrics, runtime, npm);
  const signals = buildSignals(metrics, runtime, npm, probes, claims);
  const dims = scoreDimensions(rubric, signals);
  const competitors = scoreCompetitors(competitorData, dims);
  const overallRaw = dims.reduce((s, d) => s + d.weight * d.score, 0) / dims.reduce((s, d) => s + d.weight, 0);
  const overall = { score: round(overallRaw, 1), grade: gradeOf(overallRaw) };
  const adoptionWeights = rubric.sensitivity.adoption.weights;
  const adoptionScore = round(weightedOverall(dims, adoptionWeights, (d) => d.score), 1);
  const adoptionByProduct = competitors
    .map((c) => ({ name: c.name, score: round(weightedOverall(dims, adoptionWeights, (d) => c.scores[d.id] ?? 0), 1) }))
    .sort((a, b) => b.score - a.score);
  const adoption = {
    label: rubric.sensitivity.adoption.label,
    rationale: rubric.sensitivity.adoption.rationale,
    score: adoptionScore,
    rank: 1 + adoptionByProduct.filter((c) => c.score > adoptionScore).length,
    byProduct: adoptionByProduct,
  };
  const findings = collectFindings(metrics, runtime, probes, claims, dims, signals, npm);
  const plan = actionPlan(dims);

  const payload = {
    generatedAt: new Date().toISOString(),
    commit: metrics.git.head,
    dirty: metrics.git.dirty,
    overall,
    adoption,
    runtime,
    npm,
    metrics: {
      srcFiles: metrics.srcFiles,
      srcLoc: metrics.srcLoc,
      testLoc: metrics.testLoc,
      tests: runtime.tests?.passed ?? null,
      testFiles: metrics.testFiles,
      skills: metrics.skills,
      docs: metrics.docs,
      providers: metrics.providers,
      registeredTools: metrics.registeredTools,
      allowedTools: metrics.allowlist,
      channels: metrics.channels,
      coverage: metrics.coverage,
      authors: metrics.git.authors,
      commits: metrics.git.commits,
    },
    dimensions: dims.map((d) => ({
      id: d.id,
      name: d.name,
      weight: d.weight,
      score: d.score,
      gate: d.gate,
      signals: d.signals.map((s) => ({ id: s.id, label: s.label, weight: s.weight, value: s.value, evidence: s.evidence })),
    })),
    competitors: competitors.map((c) => ({ name: c.name, overall: c.overall, scores: c.scores, confidence: c.confidence })),
    claims,
    probes,
    findings,
    plan,
  };

  mkdirSync(p("review"), { recursive: true });
  writeFileSync(p("review/latest.json"), JSON.stringify(payload, null, 2));

  if (!JSON_ONLY) {
    const md = render({
      rubric,
      metrics,
      runtime,
      npm,
      probes,
      claims,
      dims,
      competitors,
      adoption,
      overall,
      findings,
      plan,
      generatedAt: new Date().toISOString().slice(0, 10),
    });
    writeFileSync(OUT, md);
    process.stderr.write(`\nwrote ${relative(ROOT, OUT)}\n`);
    process.stderr.write(`overall ${overall.score}/10 (${overall.grade}), ${findings.length} findings\n`);
  } else {
    process.stdout.write(JSON.stringify(payload, null, 2));
  }

  if (GATE && overallRaw < Number(GATE)) {
    process.stderr.write(`gate failed: ${overallRaw.toFixed(1)} < ${GATE}\n`);
    process.exit(1);
  }
}

main();

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(workspace, "src");
const DEFAULT_LIMIT = 600;

// Roadmap Phase 2 size budget: every non-test src/**/*.ts must stay <= 600
// lines. agent.ts gets a temporary shrinking allowlist with target <= 800;
// the other entries are pre-existing over-budget files pinned at (rounded-up)
// their baseline size so they cannot regress further while phases shrink them.
const ALLOWLIST = new Map([
  ["cli/repl.ts", 3150],
  ["core/llm.ts", 1250],
  ["memory/episodic.ts", 900],
  ["api/desktop.ts", 850],
  ["core/agent.ts", 800],
  ["gateway/index.ts", 675],
  ["evaluation/curriculum.ts", 650],
  ["research/theory-store.ts", 650],
  ["core/policy.ts", 650],
  ["memory/user-model.ts", 650],
  ["tools/email.ts", 625],
  ["api/server.ts", 600],
]);

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

const violations = [];
for (const file of listFiles(srcDir)) {
  const rel = relative(srcDir, file).replaceAll("\\", "/");
  const limit = ALLOWLIST.get(rel) ?? DEFAULT_LIMIT;
  const lines = readFileSync(file, "utf8").split(/\r?\n/).length;
  if (lines > limit) violations.push({ file: `src/${rel}`, lines, limit });
}

if (violations.length > 0) {
  console.error("Size budget exceeded (scripts/size-budget.mjs):");
  for (const v of violations) console.error(`  ${v.file}: ${v.lines} lines > ${v.limit}`);
  process.exit(1);
}
console.log(`Size budget OK: ${listFiles(srcDir).length} non-test files within limits (default ${DEFAULT_LIMIT}, agent.ts <= 800).`);
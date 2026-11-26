import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Agent-runtime surface. `harness/` and `scripts/experiments/` are the trusted
// harness side: they are allowed to sign and to import the signing module.
const ROOTS = ["src", "desktop", "web", "integrations", "scripts"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git", "experiments"]);
const SOURCE_EXT = [".ts", ".tsx", ".mjs", ".js"];
const IS_TEST = /\.(test|spec)\.[^.]+$/;
const SELF = "scripts/check-trust-anchor.mjs";

const SIGNING = /\b(signEvidence|ensureHarnessKeypair|createPrivateKey|generateKeyPairSync)\b|\bprivateKey\b/;
const VERIFICATION_API = /\b(validateEvidence|promoteWithEvidence|hashProcedureVersion)\b/;
const IMPORTS_HARNESS = /from\s+["'][^"']*procedure-harness(\.js)?["']/;

const offenders = [];
let scanned = 0;

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    const rel = relative(workspace, full).replaceAll("\\", "/");
    if (rel === SELF || IS_TEST.test(entry.name)) continue;
    if (!SOURCE_EXT.some((ext) => entry.name.endsWith(ext))) continue;
    scanned++;
    const isHarness = entry.name === "procedure-harness.ts";
    const isStore = entry.name === "procedure-store.ts";
    const source = readFileSync(full, "utf8");
    const hit =
      (!isHarness && source.match(SIGNING)) ||
      (!isHarness && !isStore && source.match(VERIFICATION_API)) ||
      source.match(IMPORTS_HARNESS);
    if (hit) offenders.push(`${rel} → ${hit[0]}`);
  }
}

for (const root of ROOTS) walk(join(workspace, root));

if (offenders.length > 0) {
  console.error("Trust anchor violated — agent runtime must not sign or import the harness:");
  for (const offender of offenders) console.error(`  ${offender}`);
  process.exit(1);
}

console.log(`Trust anchor OK: ${scanned} agent-runtime files scanned, no signing capability or harness import.`);

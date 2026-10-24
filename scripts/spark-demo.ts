import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, NTOX_DIR } from "../src/core/config.js";
import { SparkEngine } from "../src/mind/spark.js";
import { createIdleJobs } from "../src/mind/jobs.js";
import { Mind } from "../src/mind/mind.js";
import { NtoxAliveBridge } from "../src/alive/ntox.js";
import { AliveEngine } from "../src/alive/engine.js";
import type { IdleJobContext } from "../src/mind/idle.js";

function ctx(): IdleJobContext {
  const started = Date.now();
  return {
    charge: () => {},
    deadline: started + 60_000,
    since: 0,
    now: () => Date.now(),
    expired: () => false,
  };
}

function build(spark: SparkEngine, bridge: NtoxAliveBridge, proposals: string[], mind: Mind) {
  return createIdleJobs({
    mind,
    alive: bridge,
    spark,
    sparkEnabled: true,
    pushProposal: (p) => proposals.push(p),
  }).find((j) => j.name === "spark")!;
}

const config = loadConfig();
const now = new Date();
console.log(`\n=== Spark live test — ${now.toLocaleTimeString()} ===`);
console.log(
  `config: sparkEnabled=${config.sparkEnabled} cooldown=${config.sparkCooldownMs / 3600000}h minInterval=${config.sparkMinIntervalMs / 60000}min threshold=0.55`,
);

const mind = new Mind({ rootDir: mkdtempSync(join(tmpdir(), "ntox-spark-demo-")) });
const bridge = new NtoxAliveBridge(new AliveEngine());
bridge.createOpenLoop({ goal: "Ship the spark feature", nextEvidence: "watch it fire live" });

// --- Run 1: exactly as the REPL wires it (real quiet-hours logic) ---
const live = build(
  new SparkEngine({ cooldownMs: config.sparkCooldownMs, minIntervalMs: config.sparkMinIntervalMs }),
  bridge,
  [],
  mind,
);
const r1 = live.run(ctx());
console.log(`\n[1] as-wired run at ${now.toLocaleTimeString()} -> ${r1 === null ? "SILENT" : JSON.stringify(r1)}`);
console.log("    (quiet hours are 22:00-07:00 — suppressed or fired based on current time)");

// --- Run 2: quiet hours bypassed to prove the send path end-to-end ---
const proposals: string[] = [];
const bridge2 = new NtoxAliveBridge(new AliveEngine());
bridge2.createOpenLoop({ goal: "Ship the spark feature", nextEvidence: "watch it fire live" });
bridge2.subscribe((action, event) => {
  console.log(`\n[2] alive listener received -> kind=${action.kind} reason="${action.reason}"`);
  if (event) console.log(`    event: ${JSON.stringify(event).slice(0, 200)}`);
});
const forced = build(
  new SparkEngine({
    cooldownMs: config.sparkCooldownMs,
    minIntervalMs: config.sparkMinIntervalMs,
    quietHours: false,
  }),
  bridge2,
  proposals,
  mind,
);
const r2 = forced.run(ctx());
console.log(`\n[2] quiet-hours-bypassed run -> ${r2 === null ? "SILENT" : JSON.stringify(r2)}`);
console.log(`    proposals queued: ${proposals.length}`);
proposals.forEach((p) => console.log(`      - ${p}`));

const statePath = join(NTOX_DIR, "mind", "spark.json");
if (existsSync(statePath)) {
  const state = JSON.parse(readFileSync(statePath, "utf-8"));
  console.log(`\npersisted ${statePath}:`);
  console.log(`  sentToday=${state.sentToday} history=${state.history.length}`);
  const last = state.history[state.history.length - 1];
  if (last) console.log(`  last: score=${last.score.toFixed(2)} msg="${last.message}"`);
}
console.log("\n=== done ===");

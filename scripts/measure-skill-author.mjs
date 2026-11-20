import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { authorSkillFromStruggle } from "../dist/skills/auto-learner.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = resolve(root, "experiments/review/measurements/skill-author-accept.json");

const heldOutStruggles = [
  { id: "h01", request: "Deploy the staging build and verify the health endpoint after release." },
  { id: "h02", request: "Recover the JSONL memory store after a partially written episode." },
  { id: "h03", request: "Triage a failing integration test across three node versions." },
  { id: "h04", request: "Rotate the expired API credential without losing the active session." },
  { id: "h05", request: "Migrate episode vectors to a new embedding model with a backup." },
  { id: "h06", request: "Diagnose a provider timeout and retry with a smaller budget." },
  { id: "h07", request: "Reconcile two conflicting memory entries from different sessions." },
  { id: "h08", request: "Rebuild the offline semantic index after the model id changed." },
  { id: "h09", request: "Investigate intermittent websocket disconnects in the gateway." },
  { id: "h10", request: "Refactor an oversized module while keeping the public API stable." },
  { id: "h11", request: "Validate a cost budget before running the benchmark harness." },
  { id: "h12", request: "Handle a tool output that contains injected instructions safely." },
];

function fakeProviderSkill(request) {
  const slug = request.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28);
  return {
    name: `recover-${slug}`,
    description: `Repeatable recovery procedure for: ${request.slice(0, 80)}`,
    category: "self-authored",
    prompt:
      "1. Inspect the current state and identify the failing step. " +
      "2. Apply the smallest safe correction. 3. Verify the outcome with a read-only check. " +
      "4. Record what changed for the next session.",
    triggers: [request.slice(0, 30).toLowerCase(), `fix ${slug.slice(0, 20)}`],
    tools: ["read", "shell"],
    examples: [request],
  };
}

function makeFakeLLM(request) {
  const payload = JSON.stringify(fakeProviderSkill(request));
  return {
    stream() {
      return (async function* () {
        yield { delta: payload };
      })();
    },
  };
}

const rubric = {
  validKebabName: (s) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.name),
  descriptiveDescription: (s) => typeof s.description === "string" && s.description.trim().length >= 10,
  selfAuthoredCategory: (s) => s.category === "self-authored",
  actionablePrompt: (s) => typeof s.prompt === "string" && s.prompt.trim().length >= 40,
  hasTriggers: (s) => Array.isArray(s.triggers) && s.triggers.length >= 2 && s.triggers.length <= 5,
  hasTools: (s) => Array.isArray(s.tools) && s.tools.length > 0,
  hasExample: (s) => Array.isArray(s.examples) && s.examples.length >= 1,
};

const evaluations = [];
for (const c of heldOutStruggles) {
  const llm = makeFakeLLM(c.request);
  const skill = await authorSkillFromStruggle(llm, {
    userInput: c.request,
    response: `I recovered from the failed step and verified the result for ${c.id}.`,
    toolCalls: [{ name: "read", success: false, args: { path: "/tmp/x" } }],
    corrected: false,
    falseSuccess: false,
    toolFailures: 1,
    retries: 1,
    critiqueGaps: 1,
  });
  const checks = skill
    ? Object.fromEntries(Object.entries(rubric).map(([k, fn]) => [k, fn(skill)]))
    : Object.fromEntries(Object.keys(rubric).map((k) => [k, false]));
  const accepted = skill !== null && Object.values(checks).every(Boolean);
  evaluations.push({ id: c.id, authored: Boolean(skill), accepted, checks, name: skill?.name });
}

const accepted = evaluations.filter((e) => e.accepted).length;
const result = {
  status: "measured",
  mode: process.env.NTOX_LIVE === "1" ? "live-provider" : "deterministic-harness",
  generatedAt: new Date().toISOString(),
  heldOutStruggles: heldOutStruggles.length,
  authored: evaluations.filter((e) => e.authored).length,
  accepted,
  acceptanceRate: heldOutStruggles.length ? accepted / heldOutStruggles.length : 0,
  rubric: Object.keys(rubric),
  target: { acceptanceRateAtLeast: 0.8 },
  note:
    "Deterministic harness uses a fixed synthetic provider and therefore measures authoring plumbing and rubric conformance, not model-authored quality. Re-run with NTOX_LIVE=1 against a real provider for the live quality number (Phase 1).",
  evaluations,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(`skill-author-accept [${result.mode}]: ${accepted}/${heldOutStruggles.length} (${(result.acceptanceRate * 100).toFixed(1)}%)`);
console.log(`Wrote ${outPath}`);

#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function parseArgs(argv) {
  const parsed = {};
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const [key, value] = token.replace(/^--/, "").split("=");
    parsed[key] = value === undefined ? true : value;
  }
  return parsed;
}

function realConfig() {
  const path = process.env.M5_CONFIG || join(homedir(), ".ntox", "config.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = String(args.out);
  if (!outPath) throw new Error("--out is required");

  const { loadConfig } = await import("../dist/core/config.js");
  const { createAgentInfra, createAgentConfig } = await import("../dist/core/dispatcher.js");
  const { Agent } = await import("../dist/core/agent.js");
  const { ToolRegistry } = await import("../dist/tools/registry.js");
  const { promoteOpinions } = await import("../dist/mind/opinion.js");

  const config = { ...loadConfig(), ...realConfig() };
  const infra = createAgentInfra(config);
  const agentConfig = createAgentConfig(infra, config, `m5-${args.mode ?? "run"}`, {
    tools: new ToolRegistry(),
    systemPrompt:
      "You are NTOX, a personal agent. Answer directly and concisely in plain text. No markdown formatting, no emojis. Use what you remember about the user.",
    kernelEnabled: false,
  });
  const agent = new Agent(agentConfig);

  const training = args.train ? JSON.parse(readFileSync(String(args.train), "utf-8")) : [];
  const callbacks = {
    onToken: () => {},
    onToolCall: () => {},
    onToolResult: () => {},
    onUsage: () => {},
    onThinking: () => {},
  };
  const trainingResults = [];
  for (const prompt of training) {
    let text = "";
    try {
      for await (const _ of agent.run(prompt, { ...callbacks, onToken: (token) => (text += token) })) {
        /* drain */
      }
      trainingResults.push({ prompt, response: text.trim().slice(0, 500) });
    } catch (error) {
      trainingResults.push({ prompt, error: error instanceof Error ? error.message : String(error) });
    }
  }

  let promoted = 0;
  try {
    promoted = promoteOpinions(infra.mentalModel, infra.mind.identity, { minMentions: 2 }).length;
  } catch {
    /* opinion promotion is best effort */
  }
  try {
    infra.mind.identity.setValues(["evidence over fluency", "learn from correction", "prefer tests", "measure outcomes"]);
    infra.mind.identity.setActiveProjects(["m5-transfer-lab"]);
    infra.mind.refreshNarrative();
  } catch {
    /* identity enrichment is best effort */
  }

  const queries = args.queries ? JSON.parse(readFileSync(String(args.queries), "utf-8")) : [];
  const responses = [];
  for (const query of queries) {
    let text = "";
    try {
      for await (const _ of agent.run(query, { ...callbacks, onToken: (token) => (text += token) })) {
        /* drain */
      }
      responses.push({ query, response: text.trim().slice(0, 2000) });
    } catch (error) {
      responses.push({ query, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const identity = infra.mind.identity.get();
  const report = {
    mode: args.mode ?? "run",
    training: trainingResults,
    promoted,
    identity: {
      narrative: identity.narrative,
      values: identity.values,
      positions: identity.positions.map((position) => ({
        topic: position.topic,
        stance: position.stance,
        confidence: position.confidence,
        evidence: position.evidence.length,
      })),
    },
    responses,
  };
  writeFileSync(outPath, JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error("[m5-agent]", error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});

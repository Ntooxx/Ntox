import { LLMClient } from "../core/llm.js";
import { Agent } from "../core/agent.js";
import { createSharedInfra, createSessionInfra, createAgentConfig } from "../core/dispatcher.js";
import type { AgentCallbacks } from "../core/agent.js";
import { loadConfig } from "../core/config.js";
import type { NtoxConfig } from "../types/index.js";
import { judgeResponse, type JudgeScore } from "./judge.js";
import { ALL_ROUNDS } from "./dataset.js";

export interface QueryResult {
  queryId: string;
  domain: string;
  query: string;
  difficulty: number;
  kernelOn: { response: string; score: JudgeScore; tokens: number; toolCalls: number; };
  kernelOff: { response: string; score: JudgeScore; tokens: number; toolCalls: number; };
  delta: number;
}

export interface RoundResult {
  name: string;
  description: string;
  results: QueryResult[];
  kernelOnAvg: number;
  kernelOffAvg: number;
  deltaPercent: number;
}

export interface BenchmarkReport {
  rounds: RoundResult[];
  overallKernelOn: number;
  overallKernelOff: number;
  overallDelta: number;
  domainDeltas: Record<string, number>;
  timestamp: number;
  model: string;
}

async function runSingleQuery(
  query: string,
  kernelEnabled: boolean,
  configOverride?: Partial<NtoxConfig>,
): Promise<{ response: string; tokens: number; toolCalls: number }> {
  const baseConfig = loadConfig();
  const config = { ...baseConfig, ...configOverride };
  const shared = createSharedInfra(config);
  const session = createSessionInfra(shared);
  const sessionId = `bench_${kernelEnabled ? "on" : "off"}_${Date.now()}`;

  const agentConfig = createAgentConfig(
    { ...shared, ...session },
    config,
    sessionId,
    {
      kernelEnabled,
      memoryEnabled: false,
      strategyEnabled: false,
      mistakesEnabled: false,
      skipReflection: true,
      systemPrompt: "You are a knowledgeable assistant. Answer questions directly and thoroughly. Do NOT use any tools. Do NOT output <tool_call> XML. Just answer with your knowledge.",
    },
  );

  const agent = new Agent(agentConfig);
  let response = "";
  let toolCalls = 0;
  let tokens = 0;

  const callbacks: AgentCallbacks = {
    onToken: (t) => { response += t; },
    onToolCall: () => { toolCalls++; },
    onToolResult: () => {},
    onUsage: (u) => { tokens = (u.inputTokens || 0) + (u.outputTokens || 0); },
    onThinking: () => {},
  };

  const stream = agent.run(query, callbacks);
  for await (const _ of stream) { /* drain */ }

  return { response: response.trim(), tokens, toolCalls };
}

export async function runBenchmark(
  judgeLLM: LLMClient,
  onProgress?: (msg: string) => void,
  configOverride?: Partial<NtoxConfig>,
): Promise<BenchmarkReport> {
  const config = loadConfig();
  const rounds: RoundResult[] = [];
  const domainScores: Record<string, { on: number[]; off: number[] }> = {};

  for (const round of ALL_ROUNDS) {
    const log = (msg: string) => { onProgress?.(msg); };
    log(`\n=== ${round.name} ===`);
    log(round.description);

    const results: QueryResult[] = [];

    for (const q of round.queries) {
      log(`\n  [${q.id}] ${q.domain}: ${q.query.slice(0, 60)}...`);

      log("    Kernel OFF...");
      const offResult = await runSingleQuery(q.query, false, configOverride);
      log("    Scoring...");
      const offScore = await judgeResponse(judgeLLM, q.query, offResult.response);

      log("    Kernel ON...");
      const onResult = await runSingleQuery(q.query, true, configOverride);
      log("    Scoring...");
      const onScore = await judgeResponse(judgeLLM, q.query, onResult.response);

      const delta = Math.round((onScore.overall - offScore.overall) / offScore.overall * 1000) / 10;

      results.push({
        queryId: q.id,
        domain: q.domain,
        query: q.query,
        difficulty: q.difficulty,
        kernelOn: { response: onResult.response, score: onScore, tokens: onResult.tokens, toolCalls: onResult.toolCalls },
        kernelOff: { response: offResult.response, score: offScore, tokens: offResult.tokens, toolCalls: offResult.toolCalls },
        delta,
      });

      if (!domainScores[q.domain]) domainScores[q.domain] = { on: [], off: [] };
      domainScores[q.domain].on.push(onScore.overall);
      domainScores[q.domain].off.push(offScore.overall);

      log(`    ON: ${onScore.overall}/10 | OFF: ${offScore.overall}/10 | Delta: ${delta > 0 ? "+" : ""}${delta}%`);
    }

    const kernelOnAvg = avg(results.map((r) => r.kernelOn.score.overall));
    const kernelOffAvg = avg(results.map((r) => r.kernelOff.score.overall));
    const deltaPercent = Math.round((kernelOnAvg - kernelOffAvg) / kernelOffAvg * 1000) / 10;

    rounds.push({
      name: round.name,
      description: round.description,
      results,
      kernelOnAvg,
      kernelOffAvg,
      deltaPercent,
    });

    log(`\n  Round avg — ON: ${kernelOnAvg}/10 | OFF: ${kernelOffAvg}/10 | Delta: ${deltaPercent > 0 ? "+" : ""}${deltaPercent}%`);
  }

  const overallOn = avg(rounds.flatMap((r) => r.results.map((q) => q.kernelOn.score.overall)));
  const overallOff = avg(rounds.flatMap((r) => r.results.map((q) => q.kernelOff.score.overall)));
  const overallDelta = Math.round((overallOn - overallOff) / overallOff * 1000) / 10;

  const domainDeltas: Record<string, number> = {};
  for (const [domain, scores] of Object.entries(domainScores)) {
    const onAvg = avg(scores.on);
    const offAvg = avg(scores.off);
    domainDeltas[domain] = Math.round((onAvg - offAvg) / offAvg * 1000) / 10;
  }

  return {
    rounds,
    overallKernelOn: Math.round(overallOn * 10) / 10,
    overallKernelOff: Math.round(overallOff * 10) / 10,
    overallDelta,
    domainDeltas,
    timestamp: Date.now(),
    model: config.model,
  };
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

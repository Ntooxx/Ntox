import { buildCurriculum, type Curriculum } from "../evaluation/curriculum.js";
import { evaluateObjective } from "../evaluation/objective-evaluators.js";
import type { EvalSession } from "../evaluation/runner.js";
import type { Mind } from "./mind.js";

export interface SelfPlayDeps {
  createSession: () => EvalSession;
  mind: Mind;
  curriculum?: Curriculum;
}

export interface SelfPlayOptions {
  taskIndex: number;
  charge: (tokens: number, usd?: number) => void;
}

export interface SelfPlayResult {
  summary: string;
  tokens: number;
  score: number;
  passed: boolean;
  taskId: string;
  family: string;
}

export async function runSelfPlay(deps: SelfPlayDeps, options: SelfPlayOptions): Promise<SelfPlayResult | null> {
  const curriculum = deps.curriculum ?? buildCurriculum();
  if (curriculum.tasks.length === 0) return null;
  const task =
    curriculum.tasks[
      ((options.taskIndex % curriculum.tasks.length) + curriculum.tasks.length) % curriculum.tasks.length
    ];
  const session = deps.createSession();
  let tokens = 0;

  try {
    for (const plant of task.plantTurns) {
      const result = await session.send(plant);
      tokens += result.tokens ?? 0;
    }
    if (task.resetBeforeProbe) await session.reset?.();
    const probe = await session.send(task.probe);
    tokens += probe.tokens ?? 0;
    const objective = await evaluateObjective(task.check, probe.response);

    const handle = deps.mind.beginTurn({
      turnId: `selfplay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      sessionId: "selfplay",
      query: task.probe.slice(0, 200),
      queryType: "self-play",
      responseMode: "self-play",
      strategy: "self-play",
    });
    if (handle) {
      deps.mind.finishTurn(
        handle,
        {
          corrected: objective.score < 0.3,
          rephrased: false,
          thanked: objective.passed,
          abandoned: probe.response.trim().length === 0,
          falseSuccess: false,
          toolFailure: false,
          objectiveScore: objective.score * 2 - 1,
        },
        { tokens, predictionSource: "selfplay", predictionTokens: 0 },
      );
    }

    options.charge(tokens);
    return {
      summary: `self-play ${task.id} (${task.family}) score=${objective.score.toFixed(2)} ${objective.passed ? "PASS" : "FAIL"}`,
      tokens,
      score: objective.score,
      passed: objective.passed,
      taskId: task.id,
      family: task.family,
    };
  } catch {
    options.charge(tokens);
    return null;
  }
}

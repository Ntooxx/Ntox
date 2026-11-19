import { modelCritique } from "../../cognition/model-critique.js";
import { checkForSurfaceReasoning } from "../../research/false-success.js";
import type { Message, CognitiveTrace, CritiqueResult, AgentTurnTrace } from "../../types/index.js";
import type { ResponseMode } from "../../meta/response-mode.js";
import type { AgentConfig } from "../agent.js";
import type { TurnRuntime } from "./turn-types.js";

export interface FalseSuccessDeps {
  cfg: AgentConfig;
  userInput: string;
  responseBuffer: string;
  responseMode: ResponseMode;
  attempts: number;
  done: boolean;
  modelCritiqueUsed: boolean;
  runtime: TurnRuntime;
  trace: AgentTurnTrace | null;
  pushMessage: (msg: Message) => void;
}

export interface FalseSuccessResult {
  acted: boolean;
  modelCritiqueUsed: boolean;
}

export async function checkFalseSuccess(deps: FalseSuccessDeps): Promise<FalseSuccessResult> {
  const { cfg, userInput, responseBuffer, responseMode, runtime, trace } = deps;
  let modelCritiqueUsed = deps.modelCritiqueUsed;
  const unchanged = (): FalseSuccessResult => ({ acted: false, modelCritiqueUsed });

  if (
    deps.done ||
    deps.attempts >= 6 ||
    runtime.falseSuccessRetriesThisSession >= 3 ||
    responseMode === "simple-query"
  ) {
    return unchanged();
  }

  const cognitiveTrace: CognitiveTrace = {
    problemRepresentation: userInput,
    assumptions: [],
    unknowns: [],
    reasoningStrategy: "",
    strategyJustification: "",
    evidenceUsed: [],
    predictions: [],
    selfCritique: "",
    critiqueResolution: "",
    finalAnswer: responseBuffer,
    abstractionExtracted: "",
    tokenCount: responseBuffer.length,
  };
  let critique: CritiqueResult | undefined;
  if (cfg.cognitiveKernel.isEnabled() && runtime.lastCognitiveResult) {
    try {
      critique = cfg.cognitiveKernel
        .getCritic()
        .critique(userInput, responseBuffer, runtime.lastCognitiveResult.primitive);
    } catch {
      critique = undefined;
    }
  }
  const surfaceCheck = checkForSurfaceReasoning(cognitiveTrace, critique);
  if (surfaceCheck.isSurface) {
    runtime.falseSuccessRetriesThisSession++;
    runtime.falseSuccessThisTurn = true;
    if (cfg.mistakesEnabled) {
      cfg.mistakes.add(
        "shallow-reasoning",
        userInput,
        responseBuffer,
        `Surface reasoning: ${surfaceCheck.details.join("; ")}`,
        "self-reflection",
        runtime.mindTurn?.row.seq,
      );
    }
    try {
      const { penalizeTheoriesForFalseSuccess } = await import("../../research/theory-store.js");
      penalizeTheoriesForFalseSuccess(
        `${userInput} ${responseBuffer}`,
        `Surface reasoning retry: ${surfaceCheck.details.join("; ")}`,
      );
    } catch {
      /* best effort */
    }
    let retryMessage =
      "[SELF-CORRECTION] Your previous answer used surface-level reasoning. Re-answer with deeper causal reasoning: identify mechanisms, state assumptions, include a self-critique of limitations, and use first-principles thinking.";
    if (cfg.modelCritiqueEnabled === true && !modelCritiqueUsed) {
      modelCritiqueUsed = true;
      try {
        const structured = await modelCritique(cfg.llm, { query: userInput, response: responseBuffer });
        if (structured && structured.gaps.length > 0) {
          retryMessage = `[MODEL CRITIQUE] Identified gaps:\n${structured.gaps.map((g) => `- ${g}`).join("\n")}\nRe-answer addressing each gap; keep what was already right.`;
          if (trace) {
            trace.modelCritique = { gaps: structured.gaps.length, retried: true };
          }
        }
      } catch {
        /* heuristic message stays */
      }
    }
    deps.pushMessage({ role: "assistant", content: responseBuffer });
    deps.pushMessage({ role: "user", content: retryMessage });
    return { acted: true, modelCritiqueUsed };
  }

  const highStakesTools = new Set(["write", "edit", "shell", "subagent"]);
  const highStakes = (trace?.toolCalls ?? []).some((t) => highStakesTools.has(t.name) && t.success !== false);
  if (
    cfg.modelCritiqueEnabled === true &&
    !modelCritiqueUsed &&
    highStakes &&
    runtime.falseSuccessRetriesThisSession < 3
  ) {
    modelCritiqueUsed = true;
    try {
      const structured = await modelCritique(cfg.llm, { query: userInput, response: responseBuffer });
      if (trace) {
        trace.modelCritique = { gaps: structured?.gaps.length ?? 0, retried: false };
      }
      if (structured?.retry && structured.gaps.length > 0) {
        runtime.falseSuccessRetriesThisSession++;
        runtime.falseSuccessThisTurn = true;
        if (trace) trace.modelCritique = { gaps: structured.gaps.length, retried: true };
        if (cfg.mistakesEnabled) {
          cfg.mistakes.add(
            "model-critique",
            userInput,
            responseBuffer,
            `Gaps: ${structured.gaps.join("; ")}`,
            "self-reflection",
            runtime.mindTurn?.row.seq,
          );
        }
        deps.pushMessage({ role: "assistant", content: responseBuffer });
        deps.pushMessage({
          role: "user",
          content: `[MODEL CRITIQUE] Identified gaps:\n${structured.gaps.map((g) => `- ${g}`).join("\n")}\nRe-answer addressing each gap; keep what was already right.`,
        });
        return { acted: true, modelCritiqueUsed };
      }
    } catch {
      /* heuristic-only */
    }
  }

  return unchanged();
}

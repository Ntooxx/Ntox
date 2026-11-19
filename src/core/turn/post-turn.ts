import {
  findTriggerConflict,
  proposeSkillFromTurn,
  shouldProposeSkill,
  MAX_SKILL_PROPOSALS_PER_SESSION,
} from "../../skills/auto-learner.js";
import { isRephrase, isThanked } from "../../mind/predictor.js";
import { extractOpenLoops, normalizeLoopGoal } from "../../alive/open-loops.js";
import type { Mind, MindTurnResult } from "../../mind/mind.js";
import type { TurnSignals } from "../../mind/types.js";
import type { InterventionContext } from "../../meta/intervention.js";
import type { DisagreementContext } from "../../meta/disagreement.js";
import type { SessionContext } from "../../meta/session-intent.js";
import type { RelationshipTracker } from "../../memory/relationship.js";
import type { SelfAwareness } from "../../meta/self-aware.js";
import type { NtoxCognitiveLayer } from "../../cognition/layer.js";
import type { NtoxAliveBridge } from "../../alive/ntox.js";
import type { AlivePulse } from "../../alive/engine.js";
import type { Message, AgentTurnTrace } from "../../types/index.js";
import type { AgentCallbacks, AgentConfig } from "../agent.js";
import type { ToolExecContext } from "./tool-executor.js";
import type { TurnRuntime } from "./turn-types.js";

export interface PostTurnInfo {
  responseBuffer: string;
  fullResponse: string;
  attempts: number;
  turnCostUsd: number;
  turnTokens: number;
}

export interface PostTurnInput extends PostTurnInfo {
  cfg: AgentConfig;
  callbacks: AgentCallbacks;
  userInput: string;
  wasCorrection: boolean;
  queryEmbedding: number[] | null;
  embeddingModel: string | undefined;
  droppedSections: string[];
  turnStartedAt: number;
  runTurnId: string;
  runtime: TurnRuntime;
  lastTrace: AgentTurnTrace | null;
  messages: Message[];
  skillsCount: number;
  sessionContext: SessionContext;
  relationshipTracker: RelationshipTracker;
  selfAwareness: SelfAwareness;
  cognitiveLayer: NtoxCognitiveLayer;
  mind?: Mind;
  alive?: NtoxAliveBridge;
  toolExec: ToolExecContext;
  manageContextWindow: () => Promise<void>;
  publishAliveActions: (pulse: AlivePulse, callbacks: AgentCallbacks) => void;
}

function scheduleSkillProposal(
  cfg: AgentConfig,
  callbacks: AgentCallbacks,
  runtime: TurnRuntime,
  lastTrace: AgentTurnTrace | null,
  fullResponse: string,
  corrected: boolean,
): void {
  const trace = lastTrace;
  if (!trace) return;

  runtime.skillProposalTurn++;
  const gate = shouldProposeSkill({
    userInput: trace.userInput,
    response: fullResponse,
    toolCalls: trace.toolCalls,
    corrected,
    falseSuccess: runtime.falseSuccessThisTurn,
    turnNumber: runtime.skillProposalTurn,
    turnsSinceLastProposal:
      runtime.lastSkillProposalTurn === null ? null : runtime.skillProposalTurn - runtime.lastSkillProposalTurn,
  });
  if (!gate.ok || runtime.skillProposalsThisSession >= MAX_SKILL_PROPOSALS_PER_SESSION) return;

  const atTurn = runtime.skillProposalTurn;
  void (async () => {
    const candidate = await proposeSkillFromTurn(cfg.llm, {
      userInput: trace.userInput,
      response: fullResponse,
      toolCalls: trace.toolCalls,
    });
    if (!candidate) return;
    if (cfg.skillRegistry) {
      const conflict = findTriggerConflict(candidate, cfg.skillRegistry.list());
      if (conflict) return;
    }
    runtime.lastSkillProposalTurn = atTurn;
    runtime.skillProposalsThisSession++;
    callbacks.onSkillProposal?.(candidate);
  })().catch((e) => console.error("[skill-learn]", e));
}

async function handleSurprise(
  input: PostTurnInput,
  result: MindTurnResult,
  signals: TurnSignals,
  error: number,
): Promise<void> {
  const { cfg, callbacks, userInput, responseBuffer, runtime } = input;
  if (cfg.memoryEnabled && runtime.surpriseNotesThisSession < 3) {
    runtime.surpriseNotesThisSession++;
    try {
      const p = result.prediction;
      cfg.memory.addDurableMemory(
        "note",
        `Surprise: expected "${p.prediction.expectedOutcome}" (conf ${p.prediction.confidence.toFixed(2)}, intent ${p.prediction.intent}) for "${userInput.slice(0, 120)}" but got corrected=${signals.corrected} rephrased=${signals.rephrased} toolFailure=${signals.toolFailure} thanked=${signals.thanked} (error ${error.toFixed(2)})`,
        "surprise",
        0.5,
        "agent",
      );
    } catch (e) {
      console.error("[surprise-memory]", e);
    }
  }
  if (cfg.reflector && runtime.surpriseReflectionsThisSession < 3) {
    runtime.surpriseReflectionsThisSession++;
    try {
      const reflection = await cfg.reflector.reflect(userInput, responseBuffer);
      if (reflection && callbacks.onReflection) callbacks.onReflection(reflection);
    } catch (e) {
      console.error("[surprise-reflect]", e);
    }
  }
}

export async function runPostTurn(input: PostTurnInput): Promise<void> {
  const { cfg, callbacks, userInput, responseBuffer, fullResponse, runtime, toolExec } = input;
  const { wasCorrection, queryEmbedding, embeddingModel, droppedSections, turnStartedAt, attempts } = input;
  const { messages, skillsCount, sessionContext, relationshipTracker, selfAwareness, cognitiveLayer } = input;

  // Fast post-processing: visible callbacks (inline tags)
  if (cfg.reflector && !cfg.skipReflection) {
    try {
      const reflection = await cfg.reflector.reflect(userInput, responseBuffer);
      if (reflection && callbacks.onReflection) {
        callbacks.onReflection(reflection);
      }
    } catch (e) {
      console.error("[reflect]", e);
    }
  }

  if (cfg.skillAutoLearn !== false && callbacks.onSkillProposal) {
    scheduleSkillProposal(cfg, callbacks, runtime, input.lastTrace, fullResponse, wasCorrection);
  }

  if (callbacks.onProactiveSuggestion) {
    try {
      cfg.proactive.setBondLevel(relationshipTracker.getBondLevel(), relationshipTracker.getNewMilestones());
      const suggestion = cfg.proactive.generate(
        cfg.userModel.getProfile(),
        messages.length,
        skillsCount,
        cfg.memory.count(),
        sessionContext.intent,
      );
      if (suggestion) callbacks.onProactiveSuggestion(suggestion);
    } catch (e) {
      console.error("[proactive]", e);
    }
  }

  if (callbacks.onSelfAwareness) {
    try {
      const announcement = selfAwareness.getNextAnnouncement();
      if (announcement) callbacks.onSelfAwareness(announcement);
    } catch (e) {
      console.error("[awareness]", e);
    }
  }

  if (callbacks.onFeedbackRequest) {
    try {
      const wasCorrectionMsg = messages.some((m) => m.content.includes("user-correction"));
      const feedbackRequest = selfAwareness.shouldRequestFeedback(0.5, wasCorrectionMsg, false);
      if (feedbackRequest) callbacks.onFeedbackRequest(feedbackRequest.question);
    } catch (e) {
      console.error("[feedback]", e);
    }
  }

  if (cfg.intervention && callbacks.onIntervention) {
    try {
      const observations = cfg.observation ? cfg.observation.getAll().slice(-20) : [];
      const beliefs = cfg.mentalModel ? cfg.mentalModel.getAllEntries() : [];
      const intCtx: InterventionContext = {
        observations,
        beliefs,
        statedFocus: cfg.executive ? cfg.executive.getStatedFocus() : null,
        bondLevel: relationshipTracker.getBondLevel(),
        sessionCount: cfg.userModel.getProfile().sessionsCount,
        sessionIntent: sessionContext.intent,
        lastInterventionAt: cfg.intervention.getLastIntervention()?.timestamp || 0,
      };
      const intervention = cfg.intervention.evaluate(intCtx);
      if (intervention) callbacks.onIntervention(intervention);
    } catch (e) {
      console.error("[intervention]", e);
    }
  }

  if (cfg.disagreement && callbacks.onDisagreement) {
    try {
      const observations = cfg.observation ? cfg.observation.getAll().slice(-20) : [];
      const beliefs = cfg.mentalModel ? cfg.mentalModel.getAllEntries() : [];
      const risks = cfg.executive ? cfg.executive.getRisks() : [];
      const mistakes = cfg.mistakes
        ? cfg.mistakes
            .getAll()
            .slice(-10)
            .map((m: { correction: string }) => m.correction)
        : [];
      const disCtx: DisagreementContext = {
        proposal: userInput,
        observations,
        beliefs,
        risks,
        mistakeHistory: mistakes,
        bondLevel: relationshipTracker.getBondLevel(),
        sessionCount: cfg.userModel.getProfile().sessionsCount,
      };
      const disagreement = cfg.disagreement.evaluate(disCtx);
      if (disagreement) callbacks.onDisagreement(disagreement);
    } catch (e) {
      console.error("[disagreement]", e);
    }
  }

  // Slow post-processing: background
  try {
    try {
      const learning = await cognitiveLayer.afterTurn({
        sessionId: cfg.sessionId,
        turnId: input.runTurnId,
        userMessage: userInput,
        assistantResponse: responseBuffer,
        embedding: queryEmbedding,
        embeddingModel,
      });
      if (learning.memoryId && callbacks.onMemoryStore) callbacks.onMemoryStore();
      if (learning.errors.length > 0) {
        console.error("[cognitive-layer-after]", learning.errors.join("; "));
      }
    } catch (e) {
      console.error("[cognitive-layer-after]", e);
      if (cfg.memoryEnabled && queryEmbedding && queryEmbedding.length > 0) {
        cfg.memory.addEpisode(cfg.sessionId, userInput, responseBuffer, queryEmbedding, embeddingModel);
        if (callbacks.onMemoryStore) callbacks.onMemoryStore();
      }
    }
    if (cfg.cognitiveKernel.isEnabled() && runtime.lastCognitiveResult) {
      try {
        runtime.lastCognitiveResult = cfg.cognitiveKernel.process(userInput, responseBuffer);
      } catch (e) {
        console.error("[cognition]", e);
      }
    }
    selfAwareness.discoverFromIntent(sessionContext.intent, sessionContext.queryCount);
    await input.manageContextWindow();
  } catch (e) {
    console.error("[post-process]", e);
  }

  if (input.alive) {
    try {
      const knownGoals = new Set(input.alive.engine.getState().openLoops.map((loop) => normalizeLoopGoal(loop.goal)));
      let activeCount = input.alive.engine.getState().openLoops.length;
      const extracted = extractOpenLoops(fullResponse, 2);
      for (const loop of extracted) {
        if (activeCount >= 25) break;
        const key = normalizeLoopGoal(loop.goal);
        if (knownGoals.has(key)) continue;
        input.alive.createOpenLoop(loop);
        knownGoals.add(key);
        activeCount += 1;
      }
    } catch (e) {
      console.error("[alive-open-loops]", e);
    }
  }

  if (input.mind && runtime.mindTurn) {
    const finishedHandle = runtime.mindTurn;
    try {
      const signals: TurnSignals = {
        corrected: wasCorrection,
        rephrased: isRephrase(userInput),
        thanked: isThanked(userInput),
        abandoned: fullResponse.trim().length === 0 && responseBuffer.trim().length === 0,
        falseSuccess: runtime.falseSuccessThisTurn,
        toolFailure: toolExec.toolFailureThisTurn,
      };
      const correction = wasCorrection
        ? { topicKey: userInput.slice(0, 80), correction: userInput.slice(0, 500) }
        : undefined;
      const predTokens = runtime.predictionAttempt?.tokens ?? 0;
      const result = input.mind.finishTurn(finishedHandle, signals, {
        costUsd: input.turnCostUsd,
        tokens: input.turnTokens + predTokens,
        latencyMs: Date.now() - turnStartedAt,
        retries: Math.max(0, attempts - 1),
        ...(droppedSections.length > 0 ? { droppedSections } : {}),
        ...(runtime.predictionAttempt ? { predictionSource: runtime.predictionAttempt.source } : {}),
        ...(predTokens > 0 ? { predictionTokens: predTokens } : {}),
        ...(correction ? { correction } : {}),
      });
      runtime.mindTurn = null;

      if (result) {
        const error = result.prediction.error;
        if (error > 0.6) {
          await handleSurprise(input, result, signals, error);
        }
        if (input.alive && runtime.mindAlivePredictionId) {
          try {
            const pulse = input.alive.recordEvent({
              type: "turn_resolved",
              source: "ntox-mind",
              payload: {
                outcome: result.score >= 0 ? "ok" : "bad",
                score: result.score,
                corrected: signals.corrected,
                predictionError: error,
                queryType: finishedHandle.row.queryType,
                responseMode: finishedHandle.row.responseMode,
              },
              predictionId: runtime.mindAlivePredictionId,
              significance: Math.min(1, error),
            });
            input.publishAliveActions(pulse, callbacks);
          } catch (e) {
            console.error("[alive-turn-resolved]", e);
          }
        }
      }
    } catch (e) {
      console.error("[mind-finish]", e);
    }
  }
}

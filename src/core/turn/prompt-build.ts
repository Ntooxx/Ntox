import { classifyQuery, getStrategyPrompt } from "../../meta/strategist.js";
import { isUserCorrection, extractCorrection } from "../../meta/mistakes.js";
import { learnDomainKeyword, findClosestDomain } from "../../cognition/domains.js";
import { renderPromptMemoryItems } from "../../memory/episodic.js";
import { renderTheoryItems } from "../../memory/theory-memory.js";
import { hashText } from "../../mind/util.js";
import type { QueryType } from "../../types/index.js";
import type { ContextKind } from "../../mind/types.js";
import type { TurnContext } from "./turn-types.js";

export async function buildTurnPhase1to5(ctx: TurnContext): Promise<void> {
  const { cfg, callbacks, userInput, responseMode } = ctx;
  // 1. Strategy
  let queryType: QueryType = "general";
  let strategyPrompt = "";
  if (cfg.strategyEnabled) {
    callbacks.onPhase?.("analyzing");
    queryType = classifyQuery(userInput);
    if (ctx.currentTrace) ctx.currentTrace.strategy = queryType;
    strategyPrompt = getStrategyPrompt(queryType);
    if (callbacks.onStrategy) callbacks.onStrategy(queryType);
    cfg.analytics.trackQueryType(queryType);
  }

  if (ctx.mind) {
    try {
      const handle = ctx.mind.beginTurn({
        turnId: ctx.runTurnId,
        sessionId: cfg.sessionId,
        query: userInput,
        queryType,
        responseMode,
        strategy: queryType,
      });
      if (handle) {
        ctx.mindTurn = handle;
        try {
          const stance = ctx.mind.capability.decideStance(handle.domains, handle.strategyVariant);
          if (stance.variantOverride) handle.strategyVariant = stance.variantOverride;
        } catch {}
        if (handle.strategyVariant !== "standard") {
          const guidance = ctx.mind.strategyGuidance(handle.strategyVariant);
          if (guidance) strategyPrompt += guidance;
        }

        const words = userInput.trim().split(/\s+/).length;
        const casual = responseMode === "simple-query" || responseMode === "emotional-moment" || words <= 3;
        if (ctx.llmPredictor && !casual) {
          try {
            const attempt = await ctx.llmPredictor.predict(userInput, queryType);
            handle.prediction = attempt.prediction;
            ctx.predictionAttempt = attempt;
          } catch (e) {
            console.error("[mind-predict]", e);
            ctx.predictionAttempt = { prediction: handle.prediction, source: "heuristic", tokens: 0 };
          }
        } else {
          ctx.predictionAttempt = { prediction: handle.prediction, source: "heuristic", tokens: 0 };
        }

        if (ctx.alive) {
          try {
            const alivePrediction = ctx.alive.engine.createPrediction({
              statement: `Turn: ${handle.prediction.expectedOutcome}`,
              confidence: handle.prediction.confidence,
              expectation: { eventType: "turn_resolved", payload: { outcome: "ok" } },
            });
            ctx.mindAlivePredictionId = alivePrediction.id;
          } catch (e) {
            console.error("[alive-predict]", e);
            ctx.mindAlivePredictionId = null;
          }
        }
      }
    } catch (e) {
      console.error("[mind-begin]", e);
    }
  }

  // 2. Corrections
  let wasCorrection = false;
  if (cfg.mistakesEnabled && ctx.messages.length >= 2) {
    const prev = ctx.findLastAssistantMessage();
    if (prev && isUserCorrection(userInput)) {
      wasCorrection = true;
      ctx.correctionsThisSession++;
      const { topicKey, correction } = extractCorrection(userInput, prev);
      cfg.mistakes.add(topicKey, userInput, prev, correction, "user-correction", ctx.mindTurn?.row.seq);
      if (cfg.memoryEnabled) {
        try {
          cfg.memory.applyCorrectionToDurableMemories({ correction, topicKey, wrongAnswer: prev });
        } catch (e) {
          console.error("[memory-correction]", e);
        }
      }
      if (callbacks.onCorrectionDetected) callbacks.onCorrectionDetected(topicKey, correction);
    }
  }

  // 3. User model
  cfg.userModel.extractFromConversation(userInput, wasCorrection);

  // 3b. Mental model extraction + context
  let mentalModelContext = "";
  if (cfg.mentalModel) {
    cfg.mentalModel.extractFromConversation(userInput);
    mentalModelContext = cfg.mentalModel.buildContext();
  }

  // 3c. Executive extraction + context
  let executiveContext = "";
  if (cfg.executive) {
    cfg.executive.extractFromConversation(userInput);
    executiveContext = cfg.executive.buildContext();
  }

  // 3a. Domain learning — auto-extend domain keywords from user's terms
  const words = userInput
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 4 && !/^\d+$/.test(w));
  for (const word of words) {
    const closest = findClosestDomain(word);
    if (closest) {
      learnDomainKeyword(closest, word);
    }
  }

  // 4-5. Cognitive layer: corrections/memory/theory/recovery context + embedding + search in parallel
  callbacks.onPhase?.("recalling");
  let mistakesContext = "";
  let memoryContext = "";
  let theoryContext = "";
  let recoveryContext = "";
  const pendingContextRecords: {
    section: string;
    kind: ContextKind;
    id: string;
    text: string;
    relevance: number;
  }[] = [];

  const embedPromise = cfg.memoryEnabled ? cfg.llm.embedWithMeta(userInput).catch(() => null) : Promise.resolve(null);

  const [searchCtx, embedMeta] = await Promise.all([ctx.resolveSearchContext(userInput), embedPromise]);
  const searchContext = searchCtx;
  if (ctx.currentTrace) ctx.currentTrace.searchUsed = searchContext.length > 0;
  const queryEmbedding: number[] | null = embedMeta?.vector ?? null;
  const embeddingModel: string | undefined = embedMeta?.model;

  if (cfg.memoryEnabled && (cfg.theoryEnabled ?? true)) {
    const recentEpisodes = cfg.memory.getRecent(10);
    ctx.theoryMemory.processEpisodesBulk(recentEpisodes);
  }

  try {
    const layerCtx = await ctx.cognitiveLayer.beforeStep({
      sessionId: cfg.sessionId,
      userMessage: userInput,
      turnId: ctx.runTurnId,
      embedding: queryEmbedding,
      embeddingModel,
    });
    for (const section of layerCtx.sections) {
      if (section.name === "corrections") mistakesContext = section.content;
      if (section.name === "memory") memoryContext = section.content;
      if (section.name === "theories") theoryContext = section.content;
      if (section.name === "recovery") recoveryContext = section.content;
    }
    if (memoryContext && callbacks.onMemoryRecall) {
      const recalled = memoryContext.split("\n").filter((l) => l.startsWith("[")).length;
      if (ctx.currentTrace) ctx.currentTrace.memoryRecallCount = recalled;
      callbacks.onMemoryRecall(recalled);
    }
    if (theoryContext && ctx.currentTrace) {
      ctx.currentTrace.theoryReason = "Relevant theory memory matched this input and was injected into context";
    }
  } catch (e) {
    console.error("[cognitive-layer]", e);
    if (cfg.mistakesEnabled) mistakesContext = cfg.mistakes.buildMistakesContext(userInput);
    if (cfg.memoryEnabled) {
      memoryContext = cfg.memory.buildMemoryContext(
        queryEmbedding,
        cfg.memoryRetrievalCount,
        embeddingModel,
        userInput,
      );
    }
    if (cfg.memoryEnabled && (cfg.theoryEnabled ?? true)) {
      theoryContext = ctx.theoryMemory.buildTheoryContext(userInput);
    }
  }

  if (ctx.mindTurn && ctx.mind) {
    if (ctx.mindTurn.disabledKind === "memory") {
      memoryContext = "";
    } else if (cfg.memoryEnabled) {
      try {
        const memoryItems = cfg.memory.buildMemoryItems(
          queryEmbedding,
          cfg.memoryRetrievalCount,
          embeddingModel,
          userInput,
        );
        const rankedMemory = ctx.mind.rankMemory(memoryItems);
        memoryContext = renderPromptMemoryItems(rankedMemory);
        for (const item of rankedMemory) {
          pendingContextRecords.push({
            section: "memory",
            kind: item.kind,
            id: item.id,
            text: item.text,
            relevance: item.relevance,
          });
        }
      } catch (e) {
        console.error("[mind-memory]", e);
      }
    }

    if (ctx.mindTurn.disabledKind === "theory") {
      theoryContext = "";
    } else if (cfg.theoryEnabled ?? true) {
      try {
        const theoryItems = ctx.theoryMemory.buildTheoryItems(userInput);
        theoryContext = renderTheoryItems(theoryItems);
        for (const item of theoryItems) {
          pendingContextRecords.push({
            section: "theory",
            kind: item.kind,
            id: item.id,
            text: item.text,
            relevance: item.relevance,
          });
        }
      } catch (e) {
        console.error("[mind-theory]", e);
      }
    }

    if (mistakesContext) {
      pendingContextRecords.push({
        section: "mistakes",
        kind: "correction" as ContextKind,
        id: `corrections:${hashText(mistakesContext)}`,
        text: mistakesContext,
        relevance: 0.7,
      });
    }
    if (recoveryContext) {
      pendingContextRecords.push({
        section: "recovery",
        kind: "recovery" as ContextKind,
        id: `recovery:${hashText(recoveryContext)}`,
        text: recoveryContext,
        relevance: 0.6,
      });
    }
  }
  ctx.strategyPrompt = strategyPrompt;
  ctx.wasCorrection = wasCorrection;
  ctx.mentalModelContext = mentalModelContext;
  ctx.executiveContext = executiveContext;
  ctx.mistakesContext = mistakesContext;
  ctx.memoryContext = memoryContext;
  ctx.theoryContext = theoryContext;
  ctx.recoveryContext = recoveryContext;
  ctx.searchContext = searchContext;
  ctx.queryEmbedding = queryEmbedding;
  ctx.embeddingModel = embeddingModel;
  ctx.pendingContextRecords = pendingContextRecords;
}

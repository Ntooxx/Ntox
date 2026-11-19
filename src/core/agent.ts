import { LLMClient, countTokens } from "./llm.js";
import { ToolRegistry } from "../tools/registry.js";
import { MemoryStore } from "../memory/episodic.js";
import { UserModel } from "../memory/user-model.js";
import { Reflector } from "../meta/reflector.js";
import { MistakeJournal } from "../meta/mistakes.js";
import { SkillExecutor } from "../skills/executor.js";
import { SkillRegistry } from "../skills/registry.js";
import { Analytics } from "../meta/analytics.js";
import { ProactiveEngine, type ProactiveSuggestion } from "../meta/proactive.js";
import { ObservationEngine } from "../meta/observation.js";
import { MentalModel } from "../meta/mental-model.js";
import { Executive } from "../meta/executive.js";
import { InterventionEngine } from "../meta/intervention.js";
import { DisagreementEngine } from "../meta/disagreement.js";
import { CognitiveKernel } from "../cognition/kernel.js";
import { NtoxCognitiveLayer } from "../cognition/layer.js";
import { StyleOptimizer } from "../meta/style-optimizer.js";
import { RelationshipTracker } from "../memory/relationship.js";
import { SelfReflector } from "../meta/self-reflection.js";
import { SelfAwareness } from "../meta/self-aware.js";
import type { SessionContext } from "../meta/session-intent.js";
import { SkillLibrary } from "../skills/library.js";
import { TheoryMemory } from "../memory/theory-memory.js";
import { DecisionKernel, InternalState, GoalQueue, IdentityLog, Verifier } from "../kernel/index.js";
import type {
  Message,
  CostUsage,
  ToolResult,
  Reflection,
  SkillDefinition,
  ThinkPhase,
  QueryType,
  AgentTurnTrace,
} from "../types/index.js";
import { deleteSessionSnapshot, loadSessionSnapshot, saveSessionSnapshot } from "./session-store.js";
import { detectPromptInjection } from "./guard.js";
import { resetPolicyRuntime, type PolicyRuntime } from "./policy.js";

import { Mind } from "../mind/mind.js";
import { LLMPredictor } from "../mind/llm-predictor.js";

import type { ToolExecContext } from "./turn/tool-executor.js";
import { resolveSearchContext, type SearchState } from "./turn/search-context.js";
import { handleQuickPaths, runTurnPreamble } from "./turn/quick-handlers.js";
import { buildTurnPhase1to5 } from "./turn/prompt-build.js";
import { buildSkillContext } from "./turn/skill-context.js";
import { buildPromptAssembly } from "./turn/prompt-assembly.js";
import { runReactLoop } from "./turn/react-loop.js";
import { runPostTurn } from "./turn/post-turn.js";
import { runKernelCommand, type KernelRuntime } from "./turn/kernel-commands.js";
import { runContextWindow } from "./turn/context-window.js";
import type { TurnContext, TurnRuntime } from "./turn/turn-types.js";

export {
  commitsToImmediateAction,
  unfinishedPlanTasks,
  collectTurnFailures,
  responseAddressesFailures,
  extractLegacyXmlToolCalls,
} from "./turn/turn-helpers.js";

function isRestorableMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<Message>;
  if (message.role !== "system" && message.role !== "user" && message.role !== "assistant" && message.role !== "tool") {
    return false;
  }
  return typeof message.content === "string";
}
import { getFileChangesSince } from "../tools/change-tracker.js";
import type { NtoxAliveBridge } from "../alive/ntox.js";
import type { AliveAction, AlivePulse } from "../alive/engine.js";

export interface AgentConfig {
  llm: LLMClient;
  tools: ToolRegistry;
  memory: MemoryStore;
  reflector: Reflector;
  mistakes: MistakeJournal;
  userModel: UserModel;
  skillExecutor: SkillExecutor;
  analytics: Analytics;
  proactive: ProactiveEngine;
  cognitiveKernel: CognitiveKernel;
  observation?: ObservationEngine;
  mentalModel?: MentalModel;
  executive?: Executive;
  intervention?: InterventionEngine;
  disagreement?: DisagreementEngine;
  skillLibrary?: SkillLibrary;
  kernelEnabled?: boolean;
  kernelBasePath?: string;
  sessionId: string;
  sessionSource?: string;
  systemPrompt: string;
  memoryEnabled: boolean;
  memoryRetrievalCount: number;
  systemContextBudget?: number;
  contextCompilerEnabled?: boolean;
  predictionLlmEnabled?: boolean;
  modelCritiqueEnabled?: boolean;
  theoryEnabled?: boolean;
  strategyEnabled: boolean;
  mistakesEnabled: boolean;
  minConfidence: number;
  maxContextMessages: number;
  contextTokenBudget: number;
  policy?: PolicyRuntime;
  skipReflection?: boolean;
  skillAutoLearn?: boolean;
  skillRegistry?: SkillRegistry;
  alive?: NtoxAliveBridge;
  mind?: Mind;
}

export interface AgentCallbacks {
  onToken: (token: string) => void;
  onToolCall: (name: string, args: Record<string, unknown>) => void;
  onToolResult: (name: string, result: ToolResult, args: Record<string, unknown>) => void;
  onUsage: (usage: CostUsage) => void;
  onThinking: (thought: string) => void;
  onPhase?: (phase: ThinkPhase) => void;
  onMemoryRecall?: (count: number) => void;
  onMemoryStore?: () => void;
  onStrategy?: (type: QueryType) => void;
  onReflection?: (reflection: Reflection) => void;
  onCorrectionDetected?: (topicKey: string, correction: string) => void;
  onSkillTriggered?: (skillName: string, confidence: number) => void;
  onSkillProposal?: (skill: SkillDefinition) => void;
  onProactiveSuggestion?: (suggestion: ProactiveSuggestion) => void;
  onCognitive?: (summary: string) => void;
  onStyleGuidance?: (guidance: string) => void;
  onSelfAwareness?: (message: string) => void;
  onFeedbackRequest?: (question: string) => void;
  onIntervention?: (intervention: import("../meta/intervention.js").Intervention) => void;
  onDisagreement?: (disagreement: import("../meta/disagreement.js").Disagreement) => void;
  onAliveAction?: (action: AliveAction) => void;
}

export interface AgentRunOptions {
  signal?: AbortSignal;
}

export class Agent {
  private cfg: AgentConfig;
  private messages: Message[] = [];
  private messageTokenCache: number[] = [];
  private skillsCount = 3;
  private kernel: KernelRuntime = {
    decisionKernel: null,
    identityLog: new IdentityLog(),
    verifier: new Verifier(),
    cycle: 0,
  };
  private styleOptimizer = new StyleOptimizer();
  private lastAssistantResponse: string | null = null;
  private lastUserMessage: string | null = null;
  private relationshipTracker = new RelationshipTracker();
  private selfReflector = new SelfReflector();
  private selfAwareness = new SelfAwareness();
  private toolUsageThisSession: Record<string, number> = {};
  private sessionStartTime = Date.now();
  private correctionsThisSession = 0;
  private readonly runtime: TurnRuntime = {
    mindTurn: null,
    predictionAttempt: null,
    mindAlivePredictionId: null,
    lastCognitiveResult: null,
    falseSuccessThisTurn: false,
    falseSuccessRetriesThisSession: 0,
    skillProposalTurn: 0,
    lastSkillProposalTurn: null,
    skillProposalsThisSession: 0,
    surpriseNotesThisSession: 0,
    surpriseReflectionsThisSession: 0,
  };
  private sessionContext: SessionContext = {
    intent: "casual",
    startedAt: Date.now(),
    queryCount: 0,
    consecutiveTechnical: 0,
    lastIntentShift: Date.now(),
    shiftCount: 0,
  };
  private theoryMemory: TheoryMemory;
  private cognitiveLayer: NtoxCognitiveLayer;
  private runTurnId = "";
  private searchState: SearchState = { cache: new Map(), lastEntity: "" };
  private currentTrace: AgentTurnTrace | null = null;
  private lastTrace: AgentTurnTrace | null = null;
  private readonly alive?: NtoxAliveBridge;
  private readonly mind?: Mind;
  private llmPredictor?: LLMPredictor;

  constructor(cfg: AgentConfig) {
    this.cfg = cfg;
    this.theoryMemory = new TheoryMemory();
    this.alive = cfg.alive;
    this.mind = cfg.mind;
    if (cfg.predictionLlmEnabled === true && this.mind) {
      this.llmPredictor = new LLMPredictor(cfg.llm, this.mind.predictor);
    }
    this.cognitiveLayer = new NtoxCognitiveLayer(
      {
        cognitionEnabled: false,
        strategyEnabled: false,
        memoryEnabled: cfg.memoryEnabled,
        theoryEnabled: cfg.theoryEnabled ?? true,
        mistakesEnabled: cfg.mistakesEnabled,
        storeEnabled: true,
        memoryRetrievalCount: cfg.memoryRetrievalCount,
        embed: async () => [],
      },
      {
        memory: cfg.memory,
        theoryMemory: this.theoryMemory,
        mistakes: cfg.mistakes,
      },
    );
  }

  setSkillsCount(n: number): void {
    this.skillsCount = n;
  }

  getMind(): Mind | undefined {
    return this.mind;
  }

  addMessage(msg: Message): void {
    this.pushMessage(msg);
  }

  private pushMessage(msg: Message): void {
    this.messages.push(msg);
    this.messageTokenCache.push(countTokens(msg.content));
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  removeLastTurn(): boolean {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "user") {
        this.messages.splice(i);
        this.messageTokenCache.splice(i);
        this.lastAssistantResponse = this.findLastAssistantMessage();
        this.lastUserMessage = this.findLastUserMessage();
        this.lastTrace = null;
        this.currentTrace = null;
        return true;
      }
    }
    return false;
  }

  getLastTrace(): AgentTurnTrace | null {
    if (!this.lastTrace) return null;
    return {
      ...this.lastTrace,
      toolCalls: this.lastTrace.toolCalls.map((t) => ({ ...t, args: { ...t.args } })),
      skill: this.lastTrace.skill ? { ...this.lastTrace.skill } : undefined,
    };
  }

  saveSession(): void {
    if (this.messages.length === 0) return;
    try {
      saveSessionSnapshot({
        version: 1,
        sessionId: this.cfg.sessionId,
        source: this.cfg.sessionSource || "agent",
        savedAt: Date.now(),
        createdAt: this.sessionStartTime,
        messages: this.messages,
        lastAssistantResponse: this.lastAssistantResponse,
        lastUserMessage: this.lastUserMessage,
        sessionStartTime: this.sessionStartTime,
        correctionsThisSession: this.correctionsThisSession,
        toolUsageThisSession: { ...this.toolUsageThisSession },
        sessionContext: this.sessionContext,
        lastTrace: this.lastTrace,
      });
    } catch (e) {
      console.error("[session-save]", e);
    }
  }

  restoreSession(sessionId: string = this.cfg.sessionId): {
    restored: boolean;
    messageCount: number;
    savedAt?: number;
    source?: string;
  } {
    if (sessionId !== this.cfg.sessionId) return { restored: false, messageCount: 0 };
    const snapshot = loadSessionSnapshot(sessionId);
    if (!snapshot) return { restored: false, messageCount: 0 };
    this.messages = snapshot.messages.filter(isRestorableMessage).map((message) => ({ ...message }));
    this.messageTokenCache = this.messages.map((message) => countTokens(message.content));
    this.lastAssistantResponse = snapshot.lastAssistantResponse ?? null;
    this.lastUserMessage = snapshot.lastUserMessage ?? null;
    this.sessionStartTime = snapshot.sessionStartTime || snapshot.createdAt || Date.now();
    this.correctionsThisSession = snapshot.correctionsThisSession ?? 0;
    this.toolUsageThisSession = { ...(snapshot.toolUsageThisSession ?? {}) };
    if (snapshot.sessionContext) {
      this.sessionContext = {
        ...this.sessionContext,
        ...snapshot.sessionContext,
        intent: snapshot.sessionContext.intent as SessionContext["intent"],
      };
    }
    this.lastTrace = snapshot.lastTrace ?? null;
    return {
      restored: true,
      messageCount: this.messages.length,
      savedAt: snapshot.savedAt,
      source: snapshot.source,
    };
  }

  getRelationshipSummary(): string {
    return this.relationshipTracker.getSummary();
  }
  getBondLabel(): string {
    return this.relationshipTracker.getBondLabel();
  }

  private startTrace(userInput: string): void {
    this.currentTrace = {
      startedAt: Date.now(),
      userInput,
      memoryRecallCount: 0,
      searchUsed: false,
      toolCalls: [],
      workspaceProfile: this.cfg.policy
        ? {
            id: this.cfg.policy.profile.id,
            name: this.cfg.policy.profile.name,
            workspaceRoot: this.cfg.policy.profile.workspaceRoot,
          }
        : undefined,
      policyDecisions: [],
      checkpointIds: [],
      retries: 0,
      injectionWarnings: [],
    };
    if (this.cfg.policy) resetPolicyRuntime(this.cfg.policy);
  }

  private finishTrace(response?: string, error?: string): void {
    if (!this.currentTrace) return;
    this.currentTrace.completedAt = Date.now();
    if (response !== undefined) this.currentTrace.finalResponseLength = response.length;
    if (error) this.currentTrace.error = error;
    this.lastTrace = {
      ...this.currentTrace,
      toolCalls: this.currentTrace.toolCalls.map((t) => ({ ...t, args: { ...t.args } })),
      policyDecisions: this.cfg.policy ? [...this.cfg.policy.decisions] : [...this.currentTrace.policyDecisions],
      checkpointIds: this.cfg.policy ? [...this.cfg.policy.checkpointIds] : [...this.currentTrace.checkpointIds],
      skill: this.currentTrace.skill ? { ...this.currentTrace.skill } : undefined,
      fileChanges: getFileChangesSince(this.currentTrace.startedAt).map((change) => ({
        path: change.path,
        action: change.action,
        timestamp: change.timestamp,
      })),
    };
    this.currentTrace = null;
  }

  private sanitizeTraceArgs(args: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (/token|key|secret|password|credential/i.test(key)) {
        out[key] = "[redacted]";
      } else if (typeof value === "string") {
        out[key] = value.length > 200 ? value.slice(0, 197) + "..." : value;
      } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
        out[key] = value;
      } else {
        out[key] = "[complex]";
      }
    }
    return out;
  }

  initKernel(_basePath: string): void {
    const state = new InternalState({
      confidence: 0.7,
      energy: 0.8,
      curiosity: 0.5,
      analytical: 0.5,
      patience: 0.6,
    });
    const queue = new GoalQueue([]);
    this.kernel = {
      decisionKernel: new DecisionKernel(queue, state),
      identityLog: new IdentityLog(),
      verifier: new Verifier(),
      cycle: 0,
    };
  }

  getKernelState(): InternalState | null {
    return this.kernel.decisionKernel?.state ?? null;
  }

  isKernelEnabled(): boolean {
    return this.cfg.kernelEnabled === true && this.kernel.decisionKernel !== null;
  }

  async handleKernelMessage(userInput: string, callbacks: AgentCallbacks): Promise<string | null> {
    return runKernelCommand(this.cfg, callbacks, this.kernel, userInput);
  }

  resetConversation(): void {
    this.messages = [];
    this.messageTokenCache = [];
    this.lastAssistantResponse = null;
    this.lastUserMessage = null;
    this.toolUsageThisSession = {};
    this.searchState.cache.clear();
    this.sessionStartTime = Date.now();
    this.correctionsThisSession = 0;
    this.runtime.surpriseNotesThisSession = 0;
    this.runtime.surpriseReflectionsThisSession = 0;
    this.lastTrace = null;
    this.currentTrace = null;
    try {
      deleteSessionSnapshot(this.cfg.sessionId);
    } catch {
      /* best effort */
    }
    this.sessionContext = {
      intent: "casual",
      startedAt: Date.now(),
      queryCount: 0,
      consecutiveTechnical: 0,
      lastIntentShift: Date.now(),
      shiftCount: 0,
    };
  }

  countTokens(): number {
    return this.messageTokenCache.reduce((s, t) => s + t, 0);
  }

  private manageContextWindow(): Promise<void> {
    return runContextWindow(this.cfg, { messages: this.messages, tokenCache: this.messageTokenCache });
  }

  async *run(rawInput: string, callbacks: AgentCallbacks, options: AgentRunOptions = {}): AsyncGenerator<string> {
    const { cfg } = this;
    const turnStartedAt = Date.now();
    this.runtime.falseSuccessThisTurn = false;
    this.runtime.mindTurn = null;
    this.runtime.predictionAttempt = null;
    this.runtime.mindAlivePredictionId = null;
    this.startTrace(rawInput);

    // 0a. Prompt injection guard — before the user message enters history.
    // Structural markers block outright; phrase phrasings are stripped and warned.
    const guard = detectPromptInjection(rawInput);
    if (guard.blocked) {
      const msg = "[Security] Potential prompt injection blocked. Your message was not processed.";
      if (this.currentTrace) this.currentTrace.blockedReason = guard.reason;
      this.pushMessage({ role: "assistant", content: msg });
      callbacks.onToken(msg);
      this.lastAssistantResponse = msg;
      this.lastUserMessage = rawInput;
      this.finishTrace(msg);
      yield msg;
      return;
    }
    const userInput = guard.sanitizedInput ?? rawInput;
    if (guard.warnings?.length && this.currentTrace) this.currentTrace.injectionWarnings = [...guard.warnings];
    this.runTurnId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.cognitiveLayer.setStoreFlags({
      memoryEnabled: cfg.memoryEnabled,
      theoryEnabled: cfg.theoryEnabled ?? true,
      mistakesEnabled: cfg.mistakesEnabled,
      storeEnabled: true,
      cognitionEnabled: false,
      strategyEnabled: false,
      memoryRetrievalCount: cfg.memoryRetrievalCount,
    });
    callbacks.onPhase?.("thinking");
    this.pushMessage({ role: "user", content: userInput });

    // 0a. Kernel routing — try kernel first for handleable modes
    const quickResult = await handleQuickPaths({
      userInput,
      cfg,
      trace: this.currentTrace,
      pushMessage: (msg) => this.pushMessage(msg),
      onToken: (token) => callbacks.onToken(token),
      decisionKernel: this.kernel.decisionKernel,
      handleKernelMessage: (input) => this.handleKernelMessage(input, callbacks),
    });
    if (quickResult.kind !== "continue") {
      this.lastAssistantResponse = quickResult.text;
      this.lastUserMessage = userInput;
      this.finishTrace(quickResult.text);
      yield quickResult.text;
      return;
    }
    const responseMode = quickResult.responseMode;

    // 0. Effectiveness tracking, 0b interaction scoring, session intent, time context
    const { styleGuidance, sessionGuidance, timeGuidance } = runTurnPreamble({
      userInput,
      cfg,
      callbacks,
      messages: this.messages,
      lastAssistantResponse: this.lastAssistantResponse,
      lastUserMessage: this.lastUserMessage,
      styleOptimizer: this.styleOptimizer,
      relationshipTracker: this.relationshipTracker,
      sessionContext: this.sessionContext,
      selfAwareness: this.selfAwareness,
    });

    // 1. Strategy
    // 2. Corrections
    // 3. User model, mental model, executive, domain learning
    // 4-5. Recall context, embedding, search
    const turnCtx: TurnContext = {
      cfg,
      callbacks,
      userInput,
      responseMode,
      messages: this.messages,
      currentTrace: this.currentTrace,
      mind: this.mind,
      runTurnId: this.runTurnId,
      mindTurn: this.runtime.mindTurn,
      llmPredictor: this.llmPredictor,
      predictionAttempt: this.runtime.predictionAttempt,
      alive: this.alive,
      mindAlivePredictionId: this.runtime.mindAlivePredictionId,
      correctionsThisSession: this.correctionsThisSession,
      theoryMemory: this.theoryMemory,
      cognitiveLayer: this.cognitiveLayer,
      findLastAssistantMessage: () => this.findLastAssistantMessage(),
      resolveSearchContext: (input) => resolveSearchContext(input, this.searchState),
      strategyPrompt: "",
      wasCorrection: false,
      mentalModelContext: "",
      executiveContext: "",
      mistakesContext: "",
      memoryContext: "",
      theoryContext: "",
      recoveryContext: "",
      searchContext: "",
      queryEmbedding: null,
      embeddingModel: undefined,
      pendingContextRecords: [],
      sessionGuidance,
      timeGuidance,
      styleGuidance,
      pushMessage: (msg) => this.pushMessage(msg),
      finishTrace: (response, error) => this.finishTrace(response, error),
      publishAliveActions: (pulse, cb) => this.publishAliveActions(pulse, cb),
      lastCognitiveResult: this.runtime.lastCognitiveResult,
      lastAssistantResponse: this.lastAssistantResponse,
      lastUserMessage: this.lastUserMessage,
      cognitiveContext: "",
      userContext: "",
      planContext: "",
      narrativeContext: "",
      skillContext: "",
      libraryFrameworkContext: "",
      aliveContext: "",
    };
    await buildTurnPhase1to5(turnCtx);
    this.runtime.mindTurn = turnCtx.mindTurn;
    this.runtime.predictionAttempt = turnCtx.predictionAttempt;
    this.runtime.mindAlivePredictionId = turnCtx.mindAlivePredictionId;
    this.correctionsThisSession = turnCtx.correctionsThisSession;
    const { queryEmbedding, embeddingModel, wasCorrection } = turnCtx;

    // 6. Cognitive kernel (once, cached)
    // 7. User profile
    // 7b. Narrative ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â session continuity
    // 8. Unified skill matching ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â registry + library triggers
    // 9. Build system prompt ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â static sections first (prompt-cache friendly),
    // volatile sections last, enforced token budget with priority dropping
    // 9a. Debate detection ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â route complex research questions to multi-agent debate
    await buildSkillContext(turnCtx);
    const promptAssembly = await buildPromptAssembly(turnCtx);
    this.runtime.lastCognitiveResult = turnCtx.lastCognitiveResult;
    this.lastAssistantResponse = turnCtx.lastAssistantResponse;
    this.lastUserMessage = turnCtx.lastUserMessage;
    if (promptAssembly.kind === "debate") {
      yield promptAssembly.debateOutput;
      return;
    }
    const { fullSystemPrompt, openaiTools, toolContext, droppedSections } = promptAssembly;
    // 10. ReAct loop
    const toolExec: ToolExecContext = {
      tools: cfg.tools,
      analytics: cfg.analytics,
      sessionId: cfg.sessionId,
      currentTrace: this.currentTrace,
      toolUsageThisSession: this.toolUsageThisSession,
      cognitiveLayer: this.cognitiveLayer,
      runTurnId: this.runTurnId,
      mind: this.mind,
      mindTurn: this.runtime.mindTurn,
      toolFailureThisTurn: false,
      sanitizeTraceArgs: (args) => this.sanitizeTraceArgs(args),
      pushMessage: (msg) => this.pushMessage(msg),
      recordAliveToolOutcome: (toolName, result, args, durationMs, toolCallbacks) =>
        this.recordAliveToolOutcome(toolName, result, args, durationMs, toolCallbacks),
    };

    yield* runReactLoop({
      cfg,
      callbacks,
      options,
      userInput,
      messages: this.messages,
      fullSystemPrompt,
      openaiTools,
      toolContext,
      responseMode,
      toolExec,
      runtime: this.runtime,
      trace: this.currentTrace,
      finishTrace: (response, error) => this.finishTrace(response, error),
      commitTurn: (text) => {
        this.lastAssistantResponse = text;
        this.lastUserMessage = userInput;
        this.finishTrace(text);
      },
      pushMessage: (msg) => this.pushMessage(msg),
      postTurn: (info) =>
        runPostTurn({
          cfg,
          callbacks,
          userInput,
          wasCorrection,
          queryEmbedding,
          embeddingModel,
          droppedSections,
          turnStartedAt,
          runTurnId: this.runTurnId,
          runtime: this.runtime,
          lastTrace: this.lastTrace,
          messages: this.messages,
          skillsCount: this.skillsCount,
          sessionContext: this.sessionContext,
          relationshipTracker: this.relationshipTracker,
          selfAwareness: this.selfAwareness,
          cognitiveLayer: this.cognitiveLayer,
          mind: this.mind,
          alive: this.alive,
          toolExec,
          manageContextWindow: () => this.manageContextWindow(),
          publishAliveActions: (pulse, cb) => this.publishAliveActions(pulse, cb),
          ...info,
        }),
      saveSession: () => this.saveSession(),
    });
  }
  private recordAliveToolOutcome(
    toolName: string,
    result: ToolResult,
    args: Record<string, unknown>,
    durationMs: number | undefined,
    callbacks: AgentCallbacks,
  ): void {
    if (!this.alive) return;
    try {
      const pulse = this.alive.recordToolOutcome(
        {
          sessionId: this.cfg.sessionId,
          toolName,
          success: result.success,
          error: result.error,
          durationMs,
        },
        args,
      );
      this.publishAliveActions(pulse, callbacks);
    } catch (error) {
      console.error("[alive] tool outcome processing failed:", error);
    }
  }

  private publishAliveActions(pulse: AlivePulse, callbacks: AgentCallbacks): void {
    for (const action of pulse.actions) callbacks.onAliveAction?.(action);
  }

  recordSessionEnd(sessionId: string): string | null {
    let awarenessSummary: string | null = null;
    try {
      awarenessSummary = this.selfAwareness.endSession();
      const profile = this.cfg.userModel.getProfile();
      this.selfReflector.recordSession(
        sessionId,
        this.messages,
        profile,
        { ...this.toolUsageThisSession },
        this.sessionContext.intent,
        this.correctionsThisSession,
        this.sessionStartTime,
      );
      if (this.cfg.observation) {
        this.cfg.observation.recordSession({
          sessionId,
          messages: this.messages,
          toolUsage: { ...this.toolUsageThisSession },
          sessionIntent: this.sessionContext.intent,
          correctionsCount: this.correctionsThisSession,
          sessionStartTime: this.sessionStartTime,
          userProfile: profile,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[session] Failed to record session:", msg);
    }

    this.saveSession();
    return awarenessSummary;
  }

  getSelfReflectionSummary(): string | null {
    return this.selfReflector.getLastSessionSummary();
  }

  getSessionIntent(): string {
    return this.sessionContext.intent;
  }

  getAwarenessUnannouncedCount(): number {
    return this.selfAwareness.getUnannouncedCount();
  }

  private findLastAssistantMessage(): string | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "assistant") return this.messages[i].content;
    }
    return null;
  }

  private findLastUserMessage(): string | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "user") return this.messages[i].content;
    }
    return null;
  }
}

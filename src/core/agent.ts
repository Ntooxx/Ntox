import { LLMClient, countTokens } from "./llm.js";
import { ToolRegistry } from "../tools/registry.js";
import { MemoryStore } from "../memory/episodic.js";
import { UserModel } from "../memory/user-model.js";
import { classifyQuery, getStrategyPrompt } from "../meta/strategist.js";
import { Reflector } from "../meta/reflector.js";
import { MistakeJournal, isUserCorrection, extractCorrection } from "../meta/mistakes.js";
import { SkillExecutor } from "../skills/executor.js";
import { Analytics } from "../meta/analytics.js";
import { ProactiveEngine, type ProactiveSuggestion } from "../meta/proactive.js";
import { ObservationEngine } from "../meta/observation.js";
import { MentalModel } from "../meta/mental-model.js";
import { Executive } from "../meta/executive.js";
import { InterventionEngine, type InterventionContext } from "../meta/intervention.js";
import { DisagreementEngine, type DisagreementContext } from "../meta/disagreement.js";
import { CognitiveKernel } from "../cognition/kernel.js";
import { StyleOptimizer, classifyResponseStyle } from "../meta/style-optimizer.js";
import { scoreEffectiveness } from "../meta/effectiveness.js";
import { scoreInteraction } from "../meta/interaction-score.js";
import { RelationshipTracker } from "../memory/relationship.js";
import { SelfReflector } from "../meta/self-reflection.js";
import { SelfAwareness } from "../meta/self-aware.js";
import { learnDomainKeyword, findClosestDomain } from "../cognition/domains.js";
import {
  classifySessionIntent,
  isTechnicalQuery,
  shouldShiftIntent,
  getIntentGuidance,
} from "../meta/session-intent.js";
import type { SessionContext } from "../meta/session-intent.js";
import { buildTimeContext, getTimeGuidance } from "../meta/time-adapter.js";
import { SkillLibrary } from "../skills/library.js";
import { TheoryMemory } from "../memory/theory-memory.js";
import { classifyMode, getModePrompt } from "../meta/response-mode.js";
import { DebateOrchestrator, DEBATE_VOICES } from "./orchestrator.js";
import {
  DecisionKernel,
  InternalState,
  GoalQueue,
  Goal,
  Subtask,
  ActionResult,
  StateTransition,
  evolveState,
  IdentityLog,
  Verifier,
  ExecuteAction,
} from "../kernel/index.js";
import { detectPromptInjection } from "./guard.js";
import { buildNarrative } from "../memory/narrative.js";
import { existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { MEMORY_DIR } from "./config.js";
import type {
  Message,
  CostUsage,
  ToolResult,
  QueryType,
  Reflection,
  SkillTriggerMatch,
  ThinkPhase,
  CognitiveTrace,
  AgentTurnTrace,
  AgentToolTrace,
} from "../types/index.js";
import { checkForSurfaceReasoning } from "../research/false-success.js";
import { searchTool } from "../tools/search.js";
import { resetPolicyRuntime, type PolicyRuntime } from "./policy.js";
import { buildContextBudgetLedger } from "./context-ledger.js";
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
  systemPrompt: string;
  memoryEnabled: boolean;
  memoryRetrievalCount: number;
  theoryEnabled?: boolean;
  strategyEnabled: boolean;
  mistakesEnabled: boolean;
  minConfidence: number;
  maxContextMessages: number;
  contextTokenBudget: number;
  policy?: PolicyRuntime;
  skipReflection?: boolean;
  alive?: NtoxAliveBridge;
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
  private skillsCount = 3;
  private lastCognitiveResult: ReturnType<CognitiveKernel["process"]> | null = null;
  private decisionKernel: DecisionKernel | null = null;
  private identityLog: IdentityLog = new IdentityLog();
  private verifier: Verifier = new Verifier();
  private kernelCycle = 0;
  private styleOptimizer = new StyleOptimizer();
  private lastAssistantResponse: string | null = null;
  private lastUserMessage: string | null = null;
  private relationshipTracker = new RelationshipTracker();
  private selfReflector = new SelfReflector();
  private selfAwareness = new SelfAwareness();
  private toolUsageThisSession: Record<string, number> = {};
  private sessionStartTime = Date.now();
  private correctionsThisSession = 0;
  private falseSuccessRetriesThisSession = 0;
  private sessionContext: SessionContext = {
    intent: "casual",
    startedAt: Date.now(),
    queryCount: 0,
    consecutiveTechnical: 0,
    lastIntentShift: Date.now(),
    shiftCount: 0,
  };
  private sessionStarted = false;
  private theoryMemory: TheoryMemory;
  private searchCache = new Map<string, string>();
  private lastSearchEntity = "";
  private currentTrace: AgentTurnTrace | null = null;
  private lastTrace: AgentTurnTrace | null = null;
  private readonly alive?: NtoxAliveBridge;

  constructor(cfg: AgentConfig) {
    this.cfg = cfg;
    this.theoryMemory = new TheoryMemory();
    this.alive = cfg.alive;
  }

  setSkillsCount(n: number): void {
    this.skillsCount = n;
  }

  addMessage(msg: Message): void {
    this.messages.push(msg);
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  removeLastTurn(): boolean {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "user") {
        this.messages.splice(i);
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

  private stableToolKey(name: string, args: Record<string, unknown>): string {
    const ordered = Object.keys(args)
      .sort()
      .reduce(
        (acc, key) => {
          const value = args[key];
          acc[key] = typeof value === "string" && value.length > 500 ? value.slice(0, 500) : value;
          return acc;
        },
        {} as Record<string, unknown>,
      );
    return `${name}:${JSON.stringify(ordered)}`;
  }

  private extractAutoCheckpointId(result: ToolResult): string | undefined {
    const data = result.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
    const id = (data as { autoCheckpointId?: unknown }).autoCheckpointId;
    return typeof id === "string" && id ? id : undefined;
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
    this.decisionKernel = new DecisionKernel(queue, state);
    this.identityLog = new IdentityLog();
    this.verifier = new Verifier();
    this.kernelCycle = 0;
  }

  getKernelState(): InternalState | null {
    return this.decisionKernel?.state ?? null;
  }

  isKernelEnabled(): boolean {
    return this.cfg.kernelEnabled === true && this.decisionKernel !== null;
  }

  async handleKernelMessage(userInput: string, callbacks: AgentCallbacks): Promise<string | null> {
    if (!this.decisionKernel) return null;
    const k = this.decisionKernel;

    // Helper: execute a kernel action (creates goal, ticks, verifies, evolves, logs)
    const executeKernelAction = async (
      actionType: string,
      goalDesc: string,
      subtaskDesc: string,
      successCheck: () => boolean,
      successMsg: string,
      failMsg: string,
    ): Promise<string> => {
      const goal = new Goal(`g-${this.kernelCycle}`, goalDesc, 5, () => true, [
        new Subtask(`s-${this.kernelCycle}-1`, subtaskDesc, () => successCheck()),
      ]);
      k.goalQueue.add(goal);
      const action = k.tick();
      if (action instanceof ExecuteAction) {
        const outcome = this.verifier.verifySubtask(action.subtask as Subtask, null);
        const result = new ActionResult(
          actionType,
          outcome.success,
          outcome.details,
          this.kernelCycle,
          this.cfg.sessionId,
        );
        const after = evolveState(k.state, result);
        this.identityLog.append(
          new StateTransition(k.state.clone(), after, result, `kernel:${actionType}`, this.kernelCycle),
        );
        k.state = after;
        this.kernelCycle++;
        callbacks.onToken(outcome.success ? successMsg : failMsg);
        return outcome.success ? successMsg : failMsg;
      }
      return "Kernel did not return Execute action.";
    };

    // ── /kernel commands ──────────────────────────────────────────

    // Create file — natural language: "create a file called X with content Y" or "/kernel create X with content Y"
    const createMatch = userInput.match(
      /^(?:\/kernel\s+)?create\s+(?:a\s+)?(?:file|script|program)\s+(?:called\s+|named\s+)?(.+?)\s+(?:with\s+)?(?:content\s+)?([\s\S]+)$/i,
    );
    // Also match /kernel create <path> with content <content> without requiring "file"
    const createExplicitMatch =
      !createMatch && userInput.match(/^\/kernel\s+create\s+(.+?)\s+with\s+content\s+([\s\S]+)$/i);
    const createData = createMatch || createExplicitMatch;
    if (createData) {
      const filePath = createData[1].trim().replace(/^\/+/, "");
      const content = createData[2].trim();
      const writeTool = this.cfg.tools.get("write");
      let created = false;
      if (writeTool) {
        const res = await writeTool.execute({ path: filePath, content });
        created = res.success;
      }
      return executeKernelAction(
        "create",
        `create ${filePath}`,
        `write ${filePath}`,
        () => created,
        `File created: ${filePath}`,
        `Failed to create: ${filePath}`,
      );
    }

    // /kernel read <filepath>
    const readMatch = userInput.match(/^(?:\/kernel\s+)?read\s+(?:file\s+)?(.+)$/i);
    if (readMatch) {
      const filePath = readMatch[1].trim();
      const readTool = this.cfg.tools.get("read");
      if (readTool) {
        const res = await readTool.execute({ path: filePath });
        if (res.success) {
          const response = `\`${filePath}\`:\n\`\`\`\n${res.data}\n\`\`\``;
          callbacks.onToken(response);
          return response;
        }
        return `Error reading file: ${res.error}`;
      }
      return "Read tool not available.";
    }

    // /kernel run <command>
    const runMatch = userInput.match(/^(?:\/kernel\s+)?run\s+(.+)$/i);
    if (runMatch) {
      const command = runMatch[1].trim();
      const shellTool = this.cfg.tools.get("shell");
      if (!shellTool) return "Shell tool not available.";
      const res = await shellTool.execute({ command });
      const result = new ActionResult("Execute", res.success, "", this.kernelCycle, this.cfg.sessionId);
      const after = evolveState(k.state, result);
      this.identityLog.append(new StateTransition(k.state.clone(), after, result, "kernel:run", this.kernelCycle));
      k.state = after;
      this.kernelCycle++;
      if (res.success) {
        const output = String(res.data ?? "").slice(0, 2000);
        callbacks.onToken(output);
        return output;
      }
      return `Command failed: ${res.error}`;
    }

    // ── Kernel status commands ────────────────────────────────────

    if (/^\/kernel\s*tick$/i.test(userInput.trim())) {
      const action = k.tick();
      const actionType = action.constructor.name;
      const response = `Kernel tick #${this.kernelCycle}: ${actionType}\nState: confidence=${k.state.confidence.toFixed(2)}, energy=${k.state.energy.toFixed(2)}`;
      callbacks.onToken(response);
      return response;
    }

    if (/^\/kernel\s*state$/i.test(userInput.trim())) {
      const s = k.state;
      const response = `State:\n  confidence: ${s.confidence.toFixed(2)}\n  energy: ${s.energy.toFixed(2)}\n  curiosity: ${s.curiosity.toFixed(2)}\n  analytical: ${s.analytical.toFixed(2)}\n  patience: ${s.patience.toFixed(2)}\n  cycle: ${this.kernelCycle}\n  log entries: ${this.identityLog.length}`;
      callbacks.onToken(response);
      return response;
    }

    if (/^\/kernel\s*status$/i.test(userInput.trim())) {
      const response = this.isKernelEnabled()
        ? `Kernel: active (${this.kernelCycle} cycles, confidence ${k.state.confidence.toFixed(2)})`
        : "Kernel: inactive";
      callbacks.onToken(response);
      return response;
    }

    if (/^\/kernel\s*dashboard$/i.test(userInput.trim())) {
      const s = k.state;
      const lines: string[] = [];
      lines.push("=== NTOX COGNITIVE KERNEL ===");
      lines.push("");
      lines.push("State:");
      lines.push(
        `  confidence: ${(s.confidence * 100).toFixed(0)}%  energy: ${(s.energy * 100).toFixed(0)}%  curiosity: ${(s.curiosity * 100).toFixed(0)}%`,
      );
      lines.push(
        `  analytical: ${(s.analytical * 100).toFixed(0)}%  patience: ${(s.patience * 100).toFixed(0)}%  cycles: ${this.kernelCycle}`,
      );
      lines.push("");

      try {
        const { getTheoryStats } = await import("../research/theory-store.js");
        const stats = getTheoryStats();
        lines.push("Knowledge Distilled:");
        lines.push(`  observations: ${stats.totalObservations}  patterns: ${stats.totalPatterns}`);
        lines.push(
          `  theories: ${stats.totalTheories} (${stats.confirmedTheories} confirmed)  meta-theories: ${stats.totalMetaTheories}`,
        );
        lines.push("");
      } catch {
        /* ignore */
      }

      try {
        const patterns = this.cfg.cognitiveKernel?.getPatterns?.();
        if (patterns) {
          const all = patterns.list();
          lines.push(`Cognitive Patterns: ${all.length} learned`);
          const top = all.slice(0, 5);
          for (const p of top) {
            lines.push(
              `  [${(p.strength * 100).toFixed(0)}%] ${p.name} — hits: ${p.hitCount} — domains: ${p.domains.join(", ")}`,
            );
          }
          lines.push("");
        }
      } catch {
        /* ignore */
      }

      lines.push(`Identity Log: ${this.identityLog.length} transitions`);
      const allTransitions = [...this.identityLog];
      const recent = allTransitions.slice(-5);
      for (const t of recent) {
        const ts = new Date(t.timestamp).toLocaleTimeString();
        lines.push(
          `  ${ts} — ${t.actionResult.actionType} — ${t.actionResult.success ? "success" : "fail"} — confidence: ${t.after.confidence.toFixed(2)}`,
        );
      }

      const response = lines.join("\n");
      callbacks.onToken(response);
      return response;
    }

    return null; // Not a kernel-handleable message
  }

  resetConversation(): void {
    this.messages = [];
    this.lastAssistantResponse = null;
    this.lastUserMessage = null;
    this.toolUsageThisSession = {};
    this.searchCache.clear();
    this.sessionStartTime = Date.now();
    this.correctionsThisSession = 0;
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
    return this.messages.reduce((s, m) => s + countTokens(m.content), 0);
  }

  private async resolveSearchContext(userInput: string): Promise<string> {
    const searchPatterns = [
      /^(what|who|tell me about|what about|what does|what is|who is)\s+(.+)/i,
      /^(can you|could you|could u|would you|tell me)\s+.*(what|who)\s+(is|are|was)\s+(.+)/i,
      /^(search|look up|find|google)\s+(for\s+)?(.+)/i,
      /^(.+?)\s+(is|are|was|were)\s+(a|an|the)\s/i,
      /^(do you know|what do you know about)\s+(.+)/i,
      /^(what|who|why|when|where|how)\s+(is|are|was|were|do|does|did)\s+(.+)/i,
    ];
    let entityMatch = searchPatterns.reduce((m: RegExpExecArray | null, p) => m || p.exec(userInput.trim()), null);
    if (!entityMatch) {
      const cmd = userInput.match(/(?:search|look up|find|google)\s+(?:for\s+)?(.{3,50})/i);
      if (cmd) entityMatch = cmd as unknown as RegExpExecArray;
    }
    if (!entityMatch && /\b(search|look up|find|google)\b/i.test(userInput) && this.lastSearchEntity) {
      const clean = this.lastSearchEntity;
      const cached = this.searchCache.get(clean);
      if (cached) return cached;
      try {
        const result = await searchTool.execute({ query: clean });
        if (result.success && typeof result.data === "string") {
          const ctx = `\n\n## Relevant Information (from web search for "${clean}")\n${result.data.slice(0, 1500)}`;
          this.searchCache.set(clean, ctx);
          return ctx;
        }
      } catch {
        /* search failed */
      }
    }
    if (entityMatch) {
      const groups = entityMatch.slice(1).filter((g) => g && typeof g === "string" && g.length > 2);
      const entity = groups[groups.length - 1];
      const clean = entity
        .replace(/[^a-z0-9\s]/gi, "")
        .trim()
        .toLowerCase();
      const skipWords = new Set([
        "you",
        "your",
        "it",
        "that",
        "this",
        "there",
        "here",
        "how",
        "what",
        "why",
        "when",
        "where",
        "who",
        "which",
        "do",
        "does",
        "did",
        "is",
        "are",
        "was",
        "were",
        "can",
        "could",
        "would",
        "will",
        "shall",
        "may",
        "might",
        "please",
        "thanks",
        "online",
        "now",
        "then",
        "first",
        "next",
        "last",
        "up",
        "down",
        "about",
        "into",
        "with",
        "without",
        "for",
        "from",
        "like",
        "just",
        "also",
      ]);
      if (clean.length > 2 && clean.split(/\s+/).length <= 6 && !skipWords.has(clean)) {
        const cached = this.searchCache.get(clean);
        if (cached) return cached;
        try {
          const result = await searchTool.execute({ query: clean });
          if (result.success && typeof result.data === "string") {
            const ctx = `\n\n## Relevant Information (from web search for "${clean}")\n${result.data.slice(0, 1500)}`;
            this.searchCache.set(clean, ctx);
            this.lastSearchEntity = clean;
            return ctx;
          }
        } catch {
          /* search failed, proceed without */
        }
      }
    }
    return "";
  }

  private estimateTokens(messages: Message[]): number {
    return messages.reduce((s, m) => s + countTokens(m.content), 0);
  }

  private async manageContextWindow(): Promise<void> {
    const budget = this.cfg.contextTokenBudget;
    const msgCap = this.cfg.maxContextMessages;
    const currentTokens = this.estimateTokens(this.messages);
    const anchorEnd = this.messages.length > 0 && this.messages[0].role === "system" ? 1 : 0;

    if (this.messages.length <= msgCap && currentTokens <= budget * 0.8) return;

    if (currentTokens > budget * 0.8 && this.messages.length > anchorEnd + 4) {
      await this.flushMemory(anchorEnd);
    }

    const minKeep = anchorEnd + 2;
    while (
      this.messages.length > minKeep &&
      (this.estimateTokens(this.messages) > budget || this.messages.length > msgCap)
    ) {
      this.messages.splice(anchorEnd, 1);
    }
  }

  private async flushMemory(anchorEnd: number): Promise<void> {
    const toKeep = Math.max(4, Math.floor(this.messages.length / 3));
    const toSummarize = this.messages.slice(anchorEnd, this.messages.length - toKeep);
    if (toSummarize.length < 4) return;

    const convoText = toSummarize
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 500)}`)
      .join("\n");

    const prompt = [
      "Summarize this conversation segment. Keep key facts, decisions, code changes, and user preferences.",
      "Be concise. Write in bullet points. Include:",
      "- What the user wanted",
      "- What was done/changed",
      "- Any important filenames or code patterns",
      "- User preferences or personal info shared",
      "",
      "Conversation:",
      convoText.slice(0, 8000),
      "",
      "Summary:",
    ].join("\n");

    try {
      let summary = "";
      const stream = this.cfg.llm.stream(
        [{ role: "user", content: prompt }],
        "You are a conversation summarizer. Output only the summary, no introduction.",
      );
      for await (const chunk of stream) {
        if (chunk.delta) summary += chunk.delta;
      }

      if (summary.length > 20) {
        const memoryDir = MEMORY_DIR;
        if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });
        const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
        appendFileSync(join(memoryDir, "memory.md"), `\n## ${stamp}\n${summary.trim()}\n`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[memory-flush] Summarization failed:", msg);
    }
  }

  async *run(userInput: string, callbacks: AgentCallbacks, options: AgentRunOptions = {}): AsyncGenerator<string> {
    const { cfg } = this;
    this.startTrace(userInput);
    callbacks.onPhase?.("thinking");
    this.messages.push({ role: "user", content: userInput });

    // 0a. Prompt injection guard
    const injectionCheck = detectPromptInjection(userInput);
    if (injectionCheck.blocked) {
      const msg = "[Security] Potential prompt injection blocked. Your message was not processed.";
      if (this.currentTrace) this.currentTrace.blockedReason = injectionCheck.reason;
      this.messages.push({ role: "assistant", content: msg });
      callbacks.onToken(msg);
      this.lastAssistantResponse = msg;
      this.lastUserMessage = userInput;
      this.finishTrace(msg);
      yield msg;
      return;
    }

    // 0. Response mode classification
    const responseMode = classifyMode(userInput);
    if (this.currentTrace) this.currentTrace.responseMode = responseMode;

    // 0a. Kernel routing — try kernel first for handleable modes
    if (
      this.decisionKernel &&
      (responseMode === "tool-execute" ||
        responseMode === "tool-build" ||
        responseMode === "profile-update" ||
        userInput.trim().startsWith("/kernel"))
    ) {
      const kernelResult = await this.handleKernelMessage(userInput, callbacks);
      if (kernelResult !== null) {
        this.lastAssistantResponse = kernelResult;
        this.lastUserMessage = userInput;
        this.finishTrace(kernelResult);
        yield kernelResult;
        return;
      }
    }

    // Quick handlers for modes that skip the full LLM pipeline
    if (responseMode === "profile-update") {
      const nameMatch = userInput.match(
        /(?:my name is|call me|i am|i'm|people call me)\s+([\w\s]+?)(?:\s*,|\s*\.|\s*$)/i,
      );
      if (nameMatch) {
        const name = nameMatch[1].trim().replace(/\s{2,}/g, " ");
        cfg.userModel.setName(name);
        const response = `Got it — I'll call you ${name} from now on.`;
        this.messages.push({ role: "assistant", content: response });
        callbacks.onToken(response);
        this.lastAssistantResponse = response;
        this.lastUserMessage = userInput;
        this.finishTrace(response);
        yield response;
        return;
      }
      // Job update: "I work as X"
      const jobMatch = userInput.match(/(?:i work as|my (?:job|role|title) is)\s+(.+)/i);
      if (jobMatch) {
        const job = jobMatch[1].trim();
        cfg.userModel.setExpertise(job, "intermediate");
        const response = `Got it — you work as **${job}**. I'll keep that in mind.`;
        this.messages.push({ role: "assistant", content: response });
        callbacks.onToken(response);
        this.lastAssistantResponse = response;
        this.lastUserMessage = userInput;
        this.finishTrace(response);
        yield response;
        return;
      }
    }

    // 0. Effectiveness tracking — score this message against the previous assistant response
    let styleGuidance = "";
    if (this.lastAssistantResponse && this.messages.length >= 2) {
      const effectiveness = scoreEffectiveness(userInput, this.lastAssistantResponse);
      if (effectiveness.isPositive || effectiveness.isNegative) {
        const prevStyle = classifyResponseStyle(this.lastAssistantResponse);
        this.styleOptimizer.setLastResponse(prevStyle);
        this.styleOptimizer.update(effectiveness);
      }
    }
    if (this.messages.length >= 2) {
      styleGuidance = this.styleOptimizer.getGuidance();
      if (styleGuidance && callbacks.onStyleGuidance) {
        callbacks.onStyleGuidance(styleGuidance.split("\n")[0].replace(/^- /, ""));
      }
    }

    // 0b. Interaction scoring — score previous exchange using current message as feedback
    if (this.lastAssistantResponse && this.lastUserMessage && this.messages.length >= 2) {
      const interactionScore = scoreInteraction(this.lastUserMessage, this.lastAssistantResponse, userInput);
      if (interactionScore.solved || Math.abs(interactionScore.satisfaction) > 0.1) {
        this.relationshipTracker.record(interactionScore);
        // Feed into user model closeness
        if (interactionScore.solved) {
          this.relationshipTracker.getBondLevel();
        }
      }
    }

    // 0a. Session context tracking
    const profile = cfg.userModel.getProfile();
    this.sessionContext.queryCount++;

    // Self-awareness: session start + discoveries from profile
    if (this.messages.length === 1) {
      this.selfAwareness.startSession();
      this.selfAwareness.discoverFromProfile(profile);
    }

    if (this.messages.length === 1) {
      // First message in session — detect intent
      this.sessionContext.intent = classifySessionIntent(userInput);
      this.sessionContext.startedAt = Date.now();
    } else {
      // Track intent shifts
      const newIntent = shouldShiftIntent(
        this.sessionContext.intent,
        userInput,
        this.sessionContext.consecutiveTechnical,
      );
      if (newIntent) {
        this.sessionContext.intent = newIntent;
        this.sessionContext.lastIntentShift = Date.now();
        this.sessionContext.shiftCount++;
      }
    }
    if (isTechnicalQuery(userInput)) {
      this.sessionContext.consecutiveTechnical++;
    } else {
      this.sessionContext.consecutiveTechnical = 0;
    }
    const sessionGuidance = getIntentGuidance(this.sessionContext.intent);
    const timeCtx = buildTimeContext(profile.lastActive);
    const timeGuidance = getTimeGuidance(timeCtx);

    // 1. Strategy
    let queryType: QueryType;
    let strategyPrompt = "";
    if (cfg.strategyEnabled) {
      callbacks.onPhase?.("analyzing");
      queryType = classifyQuery(userInput);
      if (this.currentTrace) this.currentTrace.strategy = queryType;
      strategyPrompt = getStrategyPrompt(queryType);
      if (callbacks.onStrategy) callbacks.onStrategy(queryType);
      cfg.analytics.trackQueryType(queryType);
    }

    // 2. Corrections
    let wasCorrection = false;
    if (cfg.mistakesEnabled && this.messages.length >= 2) {
      const prev = this.findLastAssistantMessage();
      if (prev && isUserCorrection(userInput)) {
        wasCorrection = true;
        this.correctionsThisSession++;
        const { topicKey, correction } = extractCorrection(userInput, prev);
        cfg.mistakes.add(topicKey, userInput, prev, correction, "user-correction");
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

    // 4. Mistakes context
    let mistakesContext = "";
    if (cfg.mistakesEnabled) mistakesContext = cfg.mistakes.buildMistakesContext(userInput);

    // 5. Memory + pre-search — run in parallel
    callbacks.onPhase?.("recalling");
    let memoryContext = "";
    let theoryContext = "";
    const embedPromise: Promise<number[] | null> = cfg.memoryEnabled
      ? cfg.llm.embed(userInput).catch(() => null)
      : Promise.resolve(null);

    const [searchCtx, embedResult] = await Promise.all([this.resolveSearchContext(userInput), embedPromise]);
    const searchContext = searchCtx;
    if (this.currentTrace) this.currentTrace.searchUsed = searchContext.length > 0;
    const queryEmbedding = embedResult;

    if (cfg.memoryEnabled) {
      if (queryEmbedding && queryEmbedding.length > 0) {
        memoryContext = cfg.memory.buildMemoryContext(queryEmbedding, cfg.memoryRetrievalCount);
      } else {
        memoryContext = cfg.memory.buildMemoryContext(null, cfg.memoryRetrievalCount);
      }
      if (memoryContext && callbacks.onMemoryRecall) {
        const recalled = memoryContext.split("\n").filter((l) => l.startsWith("[")).length;
        if (this.currentTrace) this.currentTrace.memoryRecallCount = recalled;
        callbacks.onMemoryRecall(recalled);
      }
      if (cfg.theoryEnabled ?? true) {
        const recentEpisodes = cfg.memory.getRecent(10);
        this.theoryMemory.processEpisodesBulk(recentEpisodes);
        theoryContext = this.theoryMemory.buildTheoryContext(userInput);
        if (theoryContext && this.currentTrace) {
          this.currentTrace.theoryReason = "Relevant theory memory matched this input and was injected into context";
        }
      }
    }

    // 6. Cognitive kernel (once, cached)
    callbacks.onPhase?.("reasoning");
    let cognitiveContext = "";
    this.lastCognitiveResult = null;
    if (cfg.cognitiveKernel.isEnabled()) {
      this.lastCognitiveResult = cfg.cognitiveKernel.process(userInput);
      cognitiveContext = this.lastCognitiveResult.cognitiveContext;
      if (callbacks.onCognitive) {
        const r = this.lastCognitiveResult;
        const summary = `compressed ${r.primitive.domains.length} domains -> ${r.patterns.length} patterns`;
        if (this.currentTrace) this.currentTrace.cognitiveSummary = summary;
        callbacks.onCognitive(summary);
      }
    }

    // 7. User profile
    const userContext = cfg.userModel.buildUserContext();

    // 7b. Narrative — session continuity
    let narrativeContext = "";
    if (cfg.memoryEnabled) {
      const recentEpisodes = cfg.memory.getRecent(5);
      const profile = cfg.userModel.getProfile();
      const narrative = buildNarrative(recentEpisodes, profile);
      if (narrative) narrativeContext = `\n\n## Session Continuity\n${narrative}`;
    }

    // 8. Unified skill matching — registry + library triggers
    let skillMatches: SkillTriggerMatch[] = [];
    let skillContext = "";
    let libraryFrameworkContext = "";

    if (!cfg.cognitiveKernel.isEnabled()) {
      const regMatches = cfg.skillExecutor.findMatchingSkills(userInput);
      skillMatches.push(...regMatches);

      if (cfg.skillLibrary) {
        const libTriggers = cfg.skillLibrary.findByTrigger(userInput);
        for (const m of libTriggers) {
          const def = cfg.skillLibrary.toSkillDefinition(m.skill);
          skillMatches.push({ skill: def, confidence: m.confidence });
        }
      }

      const seen = new Set<string>();
      skillMatches = skillMatches
        .filter((m) => {
          const isNew = !seen.has(m.skill.name);
          seen.add(m.skill.name);
          return isNew;
        })
        .sort((a, b) => b.confidence - a.confidence);

      if (skillMatches.length > 0) {
        const top = skillMatches[0];
        skillContext = `\n\n## Active Skill: ${top.skill.name}\n${top.skill.prompt}`;
        if (!top.skill.isExternal) {
          cfg.skillExecutor.incrementUsage(top.skill.name);
        }
        cfg.analytics.trackSkillTrigger(top.skill.name);
        if (this.currentTrace) this.currentTrace.skill = { name: top.skill.name, confidence: top.confidence };
        if (callbacks.onSkillTriggered) {
          callbacks.onSkillTriggered(top.skill.name, top.confidence);
        }
      }
    }

    const alivePulse = this.alive?.pulse();
    if (alivePulse) this.publishAliveActions(alivePulse, callbacks);
    const aliveContext = this.alive?.consumeWakeContext() ?? "";

    // 9. Build system prompt
    const parts = [cfg.systemPrompt];

    if (strategyPrompt && !cfg.cognitiveKernel.isEnabled()) parts.push("\n\n" + strategyPrompt);
    if (cognitiveContext) parts.push(cognitiveContext);
    if (memoryContext) parts.push(memoryContext);
    if (theoryContext) parts.push(theoryContext);
    if (mistakesContext) parts.push(mistakesContext);
    if (userContext) parts.push(userContext);
    if (narrativeContext) parts.push(narrativeContext);
    if (mentalModelContext) parts.push(mentalModelContext);
    if (executiveContext) parts.push(executiveContext);
    if (skillContext) parts.push(skillContext);
    if (searchContext) parts.push(searchContext);
    if (aliveContext) parts.push(`\n\n${aliveContext}`);

    // Library skill frameworks
    if (cfg.skillLibrary && userInput.trim().split(/\s+/).length >= 3) {
      try {
        const remainingMatches = skillMatches.slice(1);
        if (remainingMatches.length > 0) {
          const libLines: string[] = ["\n\n## Relevant Skill Frameworks"];
          for (let i = 0; i < Math.min(remainingMatches.length, 3); i++) {
            const m = remainingMatches[i];
            const context = cfg.skillLibrary.getContextForQuery(m.skill.name, userInput);
            if (context) {
              const limit = i === 0 ? 500 : 80;
              libLines.push(`\n### ${m.skill.name}\n${context.split("\n").slice(0, limit).join("\n")}`);
            }
          }
          if (libLines.length > 1) libraryFrameworkContext = libLines.join("\n");
        } else {
          let searchResults = cfg.skillLibrary.search(userInput, 3);
          if (queryEmbedding && queryEmbedding.length > 0) {
            const semanticResults = cfg.skillLibrary.embedSearch(queryEmbedding, 3);
            if (semanticResults.length > 0) {
              searchResults = semanticResults.map((r) => r.skill);
            }
          }
          if (searchResults.length > 0) {
            const libLines: string[] = ["\n\n## Relevant Skill Frameworks"];
            for (let i = 0; i < searchResults.length; i++) {
              const sr = searchResults[i];
              const context = cfg.skillLibrary.getContextForQuery(sr.name, userInput);
              if (context) {
                const limit = i === 0 ? 500 : 80;
                libLines.push(`\n### ${sr.name}\n${context.split("\n").slice(0, limit).join("\n")}`);
              }
            }
            if (libLines.length > 1) libraryFrameworkContext = libLines.join("\n");
          }
        }
      } catch {
        /* library not available */
      }
    }
    if (libraryFrameworkContext) parts.push(libraryFrameworkContext);

    // Mode-specific system prompt override
    const modePrompt = getModePrompt(responseMode, userInput);
    if (modePrompt) {
      parts.push(`\n\n${modePrompt}`);
    }

    if (styleGuidance) parts.push(`\n\n## Communication Style\n${styleGuidance}`);
    if (sessionGuidance) parts.push(`\n\n## Session Context\n${sessionGuidance}`);
    if (timeGuidance) parts.push(`\n\n## Time Context\n${timeGuidance}`);

    const fullSystemPrompt = parts.join("");
    if (this.currentTrace) {
      this.currentTrace.contextBudget = buildContextBudgetLedger({
        system: cfg.systemPrompt,
        strategy: strategyPrompt,
        cognition: cognitiveContext,
        memory: memoryContext,
        theory: theoryContext,
        mistakes: mistakesContext,
        user: userContext,
        narrative: narrativeContext,
        mentalModel: mentalModelContext,
        executive: executiveContext,
        skills: skillContext + libraryFrameworkContext,
        search: searchContext,
        mode: modePrompt,
        session: sessionGuidance,
        time: timeGuidance,
        full: fullSystemPrompt,
      });
    }

    const openaiTools = cfg.tools.toOpenAITools();

    // 9a. Debate detection — route complex research questions to multi-agent debate
    const isDebateQuery =
      userInput.startsWith("/debate") ||
      (userInput.length > 80 &&
        /\b(?:debate|compare|analyze|evaluate|assess)\b/i.test(userInput) &&
        /\b(?:why|how|should|is it|are there|what are the implications)\b/i.test(userInput));

    if (isDebateQuery && !cfg.cognitiveKernel.isEnabled()) {
      const cleanQuery = userInput.replace(/^\/debate\s*/i, "");
      callbacks.onPhase?.("responding");
      const orchestrator = new DebateOrchestrator(cfg.llm);
      try {
        const result = await orchestrator.debate(cleanQuery, "", (voice, step) => {
          callbacks.onThinking?.(`${voice} (${step}/${DEBATE_VOICES.length})`);
        });
        const debateOutput = result.synthesis;
        callbacks.onToken(debateOutput);
        this.messages.push({ role: "assistant", content: debateOutput });
        this.lastAssistantResponse = debateOutput;
        this.lastUserMessage = userInput;
        this.finishTrace(debateOutput);
        yield debateOutput;
        return;
      } catch (e) {
        console.error("[debate] failed, falling through to standard mode:", e);
      }
    }

    // 10. ReAct loop
    callbacks.onPhase?.("responding");
    let done = false;
    let fullResponse = "";
    let attempts = 0;
    const failedToolCalls = new Map<string, string>();

    while (!done && attempts < 10) {
      attempts++;
      if (this.currentTrace) this.currentTrace.retries = Math.max(0, attempts - 1);
      let responseBuffer = "";

      const streamIter = cfg.llm.stream(this.messages, fullSystemPrompt, openaiTools, options.signal);
      let hasToolCalls = false;
      try {
        for await (const chunk of streamIter) {
          if (chunk.usage) callbacks.onUsage(chunk.usage);
          if (chunk.toolCalls && chunk.toolCalls.length > 0) {
            hasToolCalls = true;
            const toolCalls = chunk.toolCalls;
            this.messages.push({ role: "assistant", content: responseBuffer || "(tool call)", tool_calls: toolCalls });

            for (const tc of toolCalls) {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(tc.arguments || "{}");
              } catch {
                /* use empty */
              }
              callbacks.onToolCall(tc.name, args);
              cfg.analytics.trackToolCall(tc.name);
              this.toolUsageThisSession[tc.name] = (this.toolUsageThisSession[tc.name] || 0) + 1;
              const toolKey = this.stableToolKey(tc.name, args);
              let toolTrace: AgentToolTrace | null = null;
              if (this.currentTrace) {
                toolTrace = { name: tc.name, args: this.sanitizeTraceArgs(args) };
                this.currentTrace.toolCalls.push(toolTrace);
              }

              const tool = cfg.tools.get(tc.name);
              if (tool) {
                const priorFailure = failedToolCalls.get(toolKey);
                const startedAt = Date.now();
                const result = priorFailure
                  ? {
                      success: false,
                      error: `Repeated failed tool call skipped: ${priorFailure}`,
                      data: {
                        guidance:
                          "Change the arguments, choose another tool, or answer without retrying the same failed call.",
                      },
                    }
                  : await tool.execute(args);
                if (toolTrace) {
                  toolTrace.success = result.success;
                  if (result.error) toolTrace.error = result.error;
                  toolTrace.durationMs = Date.now() - startedAt;
                  toolTrace.autoCheckpointId = this.extractAutoCheckpointId(result);
                  if (priorFailure) toolTrace.reason = "repeat-skipped";
                }
                if (!result.success && !priorFailure) failedToolCalls.set(toolKey, result.error || "failed");
                const resultContent = this.compressToolResult(result);
                if (this.currentTrace?.contextBudget) {
                  this.currentTrace.contextBudget.toolResults += Math.ceil(resultContent.length / 4);
                  this.currentTrace.contextBudget.total += Math.ceil(resultContent.length / 4);
                }
                callbacks.onToolResult(tc.name, result, args);
                this.recordAliveToolOutcome(tc.name, result, args, toolTrace?.durationMs, callbacks);
                this.messages.push({
                  role: "tool",
                  tool_call_id: tc.id,
                  content: resultContent,
                });
              } else {
                if (toolTrace) {
                  toolTrace.success = false;
                  toolTrace.error = `Unknown tool: ${tc.name}`;
                }
                this.messages.push({
                  role: "tool",
                  tool_call_id: tc.id,
                  content: JSON.stringify({ success: false, error: `Unknown tool: ${tc.name}` }),
                });
              }
            }
            continue;
          }
          if (chunk.delta) {
            responseBuffer += chunk.delta;
            callbacks.onToken(chunk.delta);
          }
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        if (options.signal?.aborted || errMsg.includes("cancelled")) {
          this.finishTrace(fullResponse + responseBuffer, "cancelled");
          throw new Error("cancelled", { cause: e });
        }
        this.messages.push({ role: "assistant", content: `[Stream error: ${errMsg}]` });
        this.finishTrace(fullResponse + responseBuffer, errMsg);
        throw e;
      }

      if (hasToolCalls) {
        fullResponse += responseBuffer;
        continue;
      }

      fullResponse += responseBuffer;

      // Tool-build enforcement
      if (responseMode === "tool-build" && attempts < 3 && !hasToolCalls) {
        const correction =
          "[BUILD MODE] You explained instead of building. Create the file NOW using the write tool. No explanation. No questions. Just build it.";
        this.messages.push({ role: "assistant", content: responseBuffer });
        this.messages.push({ role: "user", content: correction });
        continue;
      }

      if (responseMode === "tool-build" && attempts >= 3 && !done) {
        done = true;
      }

      // False success detection
      if (!done && attempts < 6 && this.falseSuccessRetriesThisSession < 3 && responseMode !== "simple-query") {
        const trace: CognitiveTrace = {
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
        const surfaceCheck = checkForSurfaceReasoning(trace);
        if (surfaceCheck.isSurface) {
          this.falseSuccessRetriesThisSession++;
          if (cfg.mistakesEnabled) {
            cfg.mistakes.add(
              "shallow-reasoning",
              userInput,
              responseBuffer,
              `Surface reasoning: ${surfaceCheck.details.join("; ")}`,
              "self-reflection",
            );
          }
          try {
            const { penalizeTheoriesForFalseSuccess } = await import("../research/theory-store.js");
            penalizeTheoriesForFalseSuccess(
              `${userInput} ${responseBuffer}`,
              `Surface reasoning retry: ${surfaceCheck.details.join("; ")}`,
            );
          } catch {
            /* best effort */
          }
          this.messages.push({ role: "assistant", content: responseBuffer });
          this.messages.push({
            role: "user",
            content:
              "[SELF-CORRECTION] Your previous answer used surface-level reasoning. Re-answer with deeper causal reasoning: identify mechanisms, state assumptions, include a self-critique of limitations, and use first-principles thinking.",
          });
          continue;
        }
      }

      this.messages.push({ role: "assistant", content: responseBuffer });

      this.lastAssistantResponse = fullResponse;
      this.lastUserMessage = userInput;
      this.finishTrace(fullResponse);
      yield fullResponse;

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

      if (callbacks.onProactiveSuggestion) {
        try {
          cfg.proactive.setBondLevel(
            this.relationshipTracker.getBondLevel(),
            this.relationshipTracker.getNewMilestones(),
          );
          const suggestion = cfg.proactive.generate(
            cfg.userModel.getProfile(),
            this.messages.length,
            this.skillsCount,
            cfg.memory.count(),
            this.sessionContext.intent,
          );
          if (suggestion) callbacks.onProactiveSuggestion(suggestion);
        } catch (e) {
          console.error("[proactive]", e);
        }
      }

      if (callbacks.onSelfAwareness) {
        try {
          const announcement = this.selfAwareness.getNextAnnouncement();
          if (announcement) callbacks.onSelfAwareness(announcement);
        } catch (e) {
          console.error("[awareness]", e);
        }
      }

      if (callbacks.onFeedbackRequest) {
        try {
          const wasCorrection = this.messages.some((m) => m.content.includes("user-correction"));
          const feedbackRequest = this.selfAwareness.shouldRequestFeedback(0.5, wasCorrection, false);
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
            bondLevel: this.relationshipTracker.getBondLevel(),
            sessionCount: cfg.userModel.getProfile().sessionsCount,
            sessionIntent: this.sessionContext.intent,
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
            bondLevel: this.relationshipTracker.getBondLevel(),
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
        if (cfg.memoryEnabled && queryEmbedding && queryEmbedding.length > 0) {
          try {
            cfg.memory.addEpisode(cfg.sessionId, userInput, responseBuffer, queryEmbedding);
            if (callbacks.onMemoryStore) callbacks.onMemoryStore();
          } catch (e) {
            console.error("[memory]", e);
          }
        }
        if (cfg.cognitiveKernel.isEnabled() && this.lastCognitiveResult) {
          try {
            this.lastCognitiveResult = cfg.cognitiveKernel.process(userInput, responseBuffer);
          } catch (e) {
            console.error("[cognition]", e);
          }
        }
        this.selfAwareness.discoverFromIntent(this.sessionContext.intent, this.sessionContext.queryCount);
        await this.manageContextWindow();
      } catch (e) {
        console.error("[post-process]", e);
      }

      return;
    }
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

  private compressToolResult(result: ToolResult): string {
    if (
      !result.success &&
      result.error &&
      /ParserError|CommandNotFoundException|Unix-style command|looks like code|malformed tool XML/i.test(result.error)
    ) {
      return JSON.stringify({
        success: false,
        error: result.error.split("\n")[0].slice(0, 300),
        guidance:
          "Do not retry the same shell command. If the user asked for code, answer in chat without tools. On Windows use PowerShell syntax.",
      });
    }
    const json = JSON.stringify(result);
    if (json.length <= 12_000) return json;
    const head = json.slice(0, 8_000);
    const tail = json.slice(-2_000);
    return JSON.stringify({
      success: result.success,
      data: `${head}\n\n... tool result compressed (${json.length} chars) ...\n\n${tail}`,
      error: result.error,
    });
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

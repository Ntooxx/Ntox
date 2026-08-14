import { randomUUID } from "node:crypto";
import { localEmbed } from "../core/local-embed.js";
import { MemoryStore } from "../memory/episodic.js";
import { TheoryMemory } from "../memory/theory-memory.js";
import { MistakeJournal } from "../meta/mistakes.js";
import { classifyQuery, getStrategyPrompt } from "../meta/strategist.js";
import { SkillRegistry } from "../skills/registry.js";
import type { Episode, PrimitiveRepresentation, QueryType } from "../types/index.js";
import { CognitiveKernel } from "./kernel.js";

export type CognitiveEmbedder = (text: string) => number[] | Promise<number[]>;

export interface CognitiveStepInput {
  sessionId: string;
  userMessage: string;
  turnId?: string;
  embedding?: number[] | null;
  workspace?: string;
  metadata?: Record<string, string>;
}

export interface CognitiveContextSection {
  name: "strategy" | "patterns" | "memory" | "theories" | "corrections" | "recovery";
  content: string;
}

export interface CognitiveStepContext {
  sessionId: string;
  turnId?: string;
  queryType: QueryType;
  primitive?: PrimitiveRepresentation;
  embedding: number[] | null;
  sections: CognitiveContextSection[];
  prompt: string;
  diagnostics: {
    patternCount: number;
    memoryIncluded: boolean;
    theoryIncluded: boolean;
    correctionIncluded: boolean;
    recoveryIncluded: boolean;
    errors: string[];
  };
}

export interface CognitiveToolResult {
  sessionId: string;
  toolName: string;
  success: boolean;
  turnId?: string;
  error?: string;
  durationMs?: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface CognitiveCorrection {
  correction: string;
  topicKey?: string;
  wrongAnswer?: string;
}

export interface CognitiveTurnResult {
  sessionId: string;
  userMessage: string;
  assistantResponse: string;
  turnId?: string;
  embedding?: number[] | null;
  correction?: CognitiveCorrection;
}

export interface CognitiveLearningResult {
  sessionId: string;
  turnId?: string;
  memoryId?: string;
  mistakeId?: string;
  theoryUpdated: boolean;
  compiledPatterns: { name: string; abstract: boolean }[];
  toolOutcomes: CognitiveToolResult[];
  review: {
    gaps: string[];
    shouldRetry: boolean;
    correctionPrompt: string;
  };
  errors: string[];
}

export interface CognitiveLayer {
  beforeStep(input: CognitiveStepInput): Promise<CognitiveStepContext>;
  afterTool(result: CognitiveToolResult): Promise<void>;
  afterTurn(turn: CognitiveTurnResult): Promise<CognitiveLearningResult>;
}

export interface CognitiveLayerOptions {
  cognitionEnabled?: boolean;
  memoryEnabled?: boolean;
  theoryEnabled?: boolean;
  mistakesEnabled?: boolean;
  strategyEnabled?: boolean;
  memoryRetrievalCount?: number;
  maxToolOutcomesPerTurn?: number;
  embed?: CognitiveEmbedder;
}

export interface CognitiveLayerServices {
  kernel?: CognitiveKernel;
  memory?: MemoryStore;
  theoryMemory?: TheoryMemory;
  mistakes?: MistakeJournal;
  skillRegistry?: SkillRegistry;
}

interface PendingStep {
  userMessage: string;
  embedding: number[] | null;
}

const EMPTY_REVIEW = {
  gaps: [] as string[],
  shouldRetry: false,
  correctionPrompt: "",
};

function errorMessage(scope: string, error: unknown): string {
  return `${scope}: ${error instanceof Error ? error.message : String(error)}`;
}

function turnKey(sessionId: string, turnId?: string): string {
  return `${sessionId}:${turnId ?? "active"}`;
}

function renderPrompt(sections: CognitiveContextSection[]): string {
  if (sections.length === 0) return "";
  return `## NTOX Cognitive Context\n\n${sections.map((section) => section.content.trim()).join("\n\n")}`;
}

export class NtoxCognitiveLayer implements CognitiveLayer {
  private readonly options: Required<Omit<CognitiveLayerOptions, "embed">>;
  private readonly embed: CognitiveEmbedder;
  private readonly kernel: CognitiveKernel;
  private readonly memory: MemoryStore;
  private readonly theoryMemory: TheoryMemory;
  private readonly mistakes: MistakeJournal;
  private readonly pendingSteps = new Map<string, PendingStep>();
  private readonly toolOutcomes = new Map<string, CognitiveToolResult[]>();
  private readonly recentToolFailures = new Map<string, CognitiveToolResult[]>();

  constructor(options: CognitiveLayerOptions = {}, services: CognitiveLayerServices = {}) {
    this.options = {
      cognitionEnabled: options.cognitionEnabled ?? true,
      memoryEnabled: options.memoryEnabled ?? true,
      theoryEnabled: options.theoryEnabled ?? true,
      mistakesEnabled: options.mistakesEnabled ?? true,
      strategyEnabled: options.strategyEnabled ?? true,
      memoryRetrievalCount: Math.max(1, options.memoryRetrievalCount ?? 5),
      maxToolOutcomesPerTurn: Math.max(1, options.maxToolOutcomesPerTurn ?? 20),
    };
    this.embed = options.embed ?? localEmbed;
    const registry = services.skillRegistry ?? new SkillRegistry();
    this.kernel = services.kernel ?? new CognitiveKernel(registry);
    this.memory = services.memory ?? new MemoryStore();
    this.theoryMemory = services.theoryMemory ?? new TheoryMemory();
    this.mistakes = services.mistakes ?? new MistakeJournal();
    this.kernel.setEnabled(this.options.cognitionEnabled);
  }

  async beforeStep(input: CognitiveStepInput): Promise<CognitiveStepContext> {
    const errors: string[] = [];
    const sections: CognitiveContextSection[] = [];
    const queryType = classifyQuery(input.userMessage);
    const embedding = await this.resolveEmbedding(input.userMessage, input.embedding, errors);
    let primitive: PrimitiveRepresentation | undefined;
    let patternCount = 0;

    if (this.options.strategyEnabled) {
      sections.push({ name: "strategy", content: getStrategyPrompt(queryType) });
    }

    if (this.options.cognitionEnabled) {
      try {
        const result = this.kernel.process(input.userMessage);
        primitive = result.primitive;
        patternCount = result.patterns.length;
        if (result.cognitiveContext.trim()) {
          sections.push({ name: "patterns", content: result.cognitiveContext });
        }
      } catch (error) {
        errors.push(errorMessage("cognition", error));
      }
    }

    let correctionIncluded = false;
    if (this.options.mistakesEnabled) {
      try {
        const context = this.mistakes.buildMistakesContext(input.userMessage);
        if (context.trim()) {
          correctionIncluded = true;
          sections.push({ name: "corrections", content: context });
        }
      } catch (error) {
        errors.push(errorMessage("mistakes", error));
      }
    }

    const failures = this.recentToolFailures.get(input.sessionId) ?? [];
    let recoveryIncluded = false;
    if (failures.length > 0) {
      recoveryIncluded = true;
      sections.push({ name: "recovery", content: this.renderToolRecovery(failures) });
      this.recentToolFailures.delete(input.sessionId);
    }

    let memoryIncluded = false;
    if (this.options.memoryEnabled) {
      try {
        const context = this.memory.buildMemoryContext(embedding, this.options.memoryRetrievalCount);
        if (context.trim()) {
          memoryIncluded = true;
          sections.push({ name: "memory", content: context });
        }
      } catch (error) {
        errors.push(errorMessage("memory", error));
      }
    }

    let theoryIncluded = false;
    if (this.options.theoryEnabled) {
      try {
        const context = this.theoryMemory.buildTheoryContext(input.userMessage);
        if (context.trim()) {
          theoryIncluded = true;
          sections.push({ name: "theories", content: context });
        }
      } catch (error) {
        errors.push(errorMessage("theory", error));
      }
    }

    this.pendingSteps.set(turnKey(input.sessionId, input.turnId), {
      userMessage: input.userMessage,
      embedding,
    });

    return {
      sessionId: input.sessionId,
      ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
      queryType,
      ...(primitive === undefined ? {} : { primitive }),
      embedding,
      sections,
      prompt: renderPrompt(sections),
      diagnostics: {
        patternCount,
        memoryIncluded,
        theoryIncluded,
        correctionIncluded,
        recoveryIncluded,
        errors,
      },
    };
  }

  async afterTool(result: CognitiveToolResult): Promise<void> {
    const key = turnKey(result.sessionId, result.turnId);
    const outcomes = this.toolOutcomes.get(key) ?? [];
    outcomes.push({ ...result });
    this.toolOutcomes.set(key, outcomes.slice(-this.options.maxToolOutcomesPerTurn));
  }

  async afterTurn(turn: CognitiveTurnResult): Promise<CognitiveLearningResult> {
    const key = turnKey(turn.sessionId, turn.turnId);
    const pending = this.pendingSteps.get(key);
    const errors: string[] = [];
    const userMessage = turn.userMessage || pending?.userMessage || "";
    const embedding = await this.resolveEmbedding(
      userMessage,
      turn.embedding === undefined ? pending?.embedding : turn.embedding,
      errors,
    );
    let episode: Episode | undefined;
    let memoryId: string | undefined;
    let mistakeId: string | undefined;
    let theoryUpdated = false;
    let compiledPatterns: { name: string; abstract: boolean }[] = [];
    let review = { ...EMPTY_REVIEW, gaps: [] as string[] };

    if (this.options.memoryEnabled) {
      try {
        episode = this.memory.addEpisode(turn.sessionId, userMessage, turn.assistantResponse, embedding ?? []);
        memoryId = episode.id;
      } catch (error) {
        errors.push(errorMessage("memory", error));
      }
    }

    if (this.options.theoryEnabled) {
      try {
        const learningEpisode = episode ?? this.createEpisode(turn, userMessage, embedding);
        this.theoryMemory.processEpisode(learningEpisode);
        theoryUpdated = true;
      } catch (error) {
        errors.push(errorMessage("theory", error));
      }
    }

    if (this.options.cognitionEnabled) {
      try {
        const result = this.kernel.process(userMessage, turn.assistantResponse);
        compiledPatterns = result.compiledPatterns;
      } catch (error) {
        errors.push(errorMessage("cognition", error));
      }
      try {
        review = this.kernel.review(userMessage, turn.assistantResponse);
      } catch (error) {
        errors.push(errorMessage("review", error));
      }
    }

    if (this.options.mistakesEnabled && turn.correction) {
      try {
        const mistake = this.mistakes.add(
          turn.correction.topicKey ?? userMessage.slice(0, 80),
          userMessage,
          turn.correction.wrongAnswer ?? turn.assistantResponse,
          turn.correction.correction,
          "user-correction",
        );
        mistakeId = mistake.id;
      } catch (error) {
        errors.push(errorMessage("mistakes", error));
      }
    }

    const outcomes = this.toolOutcomes.get(key) ?? [];
    const failures = outcomes.filter((outcome) => !outcome.success).slice(-3);
    if (failures.length > 0) {
      this.recentToolFailures.set(turn.sessionId, failures);
    }
    this.pendingSteps.delete(key);
    this.toolOutcomes.delete(key);

    return {
      sessionId: turn.sessionId,
      ...(turn.turnId === undefined ? {} : { turnId: turn.turnId }),
      ...(memoryId === undefined ? {} : { memoryId }),
      ...(mistakeId === undefined ? {} : { mistakeId }),
      theoryUpdated,
      compiledPatterns,
      toolOutcomes: outcomes,
      review,
      errors,
    };
  }

  private async resolveEmbedding(
    text: string,
    provided: number[] | null | undefined,
    errors: string[],
  ): Promise<number[] | null> {
    if (!this.options.memoryEnabled && !this.options.theoryEnabled) return null;
    if (provided !== undefined) return provided;
    try {
      return await this.embed(text);
    } catch (error) {
      errors.push(errorMessage("embedding", error));
      return localEmbed(text);
    }
  }

  private createEpisode(turn: CognitiveTurnResult, userMessage: string, embedding: number[] | null): Episode {
    return {
      id: `turn_${randomUUID().slice(0, 8)}`,
      timestamp: Date.now(),
      sessionId: turn.sessionId,
      userMessage,
      assistantResponse: turn.assistantResponse,
      summary: userMessage.replace(/\s+/g, " ").trim().slice(0, 120),
      embedding: embedding ?? [],
    };
  }

  private renderToolRecovery(failures: CognitiveToolResult[]): string {
    const lines = failures.map((failure) => {
      const detail = failure.error ? `: ${failure.error.slice(0, 240)}` : "";
      return `- ${failure.toolName} failed${detail}`;
    });
    return `## Tool Recovery Guidance\n${lines.join("\n")}\nUse a viable fallback or verify the failing input before retrying. Do not repeat the same failing call unchanged.`;
  }
}

export function createCognitiveLayer(
  options: CognitiveLayerOptions = {},
  services: CognitiveLayerServices = {},
): CognitiveLayer {
  return new NtoxCognitiveLayer(options, services);
}

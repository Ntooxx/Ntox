import { NtoxCognitiveLayer } from "../../../dist/cognition/index.js";
import { MemoryStore } from "../../../dist/memory/episodic.js";
import { TheoryMemory } from "../../../dist/memory/theory-memory.js";
import { MistakeJournal } from "../../../dist/meta/mistakes.js";
import { SkillRegistry } from "../../../dist/skills/registry.js";
import { ProcedureStore } from "../../../dist/memory/procedure-store.js";
import { proposeProcedureCandidate } from "../../../dist/memory/procedure-candidates.js";
import type { ProcedureStep } from "../../../dist/memory/procedure-store.js";
import type {
  NtoxHarnessConfig,
  PreStepInput,
  ToolResultInput,
  TurnEndInput,
} from "./types.js";

export interface NtoxHarnessServices {
  memory?: MemoryStore;
  theoryMemory?: TheoryMemory;
  mistakes?: MistakeJournal;
  skillRegistry?: SkillRegistry;
  procedureStore?: ProcedureStore;
}

export interface TurnEndOutcome {
  learning: Awaited<ReturnType<NtoxCognitiveLayer["afterTurn"]>>;
  candidate?: Awaited<ReturnType<typeof proposeProcedureCandidate>>;
}

/**
 * Event bridge between a harness runtime and Ntox's cognitive layer.
 * It translates harness lifecycle events into beforeStep / afterTool / afterTurn,
 * and records procedure candidates. Verification stays in NtoxHarnessAuthority.
 */
export class NtoxHarnessBridge {
  readonly layer: NtoxCognitiveLayer;
  readonly procedureStore: ProcedureStore;
  private readonly config: NtoxHarnessConfig;

  constructor(config: NtoxHarnessConfig = {}, services: NtoxHarnessServices = {}) {
    this.config = config;
    this.procedureStore = services.procedureStore ?? new ProcedureStore();
    this.layer = new NtoxCognitiveLayer(
      {
        cognitionEnabled: true,
        proceduresEnabled: config.enableProceduralMemory === true,
      },
      {
        memory: services.memory ?? new MemoryStore(),
        theoryMemory: services.theoryMemory ?? new TheoryMemory(),
        mistakes: services.mistakes ?? new MistakeJournal(),
        skillRegistry: services.skillRegistry ?? new SkillRegistry(),
        procedureStore: this.procedureStore,
      },
    );
  }

  async preStep(input: PreStepInput) {
    return this.layer.beforeStep({
      sessionId: input.sessionId,
      turnId: input.turnId,
      userMessage: input.userMessage,
      embedding: input.embedding,
      embeddingModel: input.embeddingModel,
      workspace: this.config.workspaceRoot,
    });
  }

  async onToolResult(input: ToolResultInput): Promise<void> {
    await this.layer.afterTool({
      sessionId: input.sessionId,
      turnId: input.turnId,
      toolName: input.toolName,
      success: input.success,
      error: input.error,
      durationMs: input.durationMs,
    });
  }

  async onTurnEnd(input: TurnEndInput): Promise<TurnEndOutcome> {
    const learning = await this.layer.afterTurn({
      sessionId: input.sessionId,
      turnId: input.turnId,
      userMessage: input.userMessage,
      assistantResponse: input.assistantResponse,
      correction: input.correction,
    });

    if (
      this.config.enableProceduralMemory !== true ||
      input.wasCorrection === true ||
      input.falseSuccess === true
    ) {
      return { learning };
    }

    const steps: ProcedureStep[] = (input.toolCalls ?? [])
      .filter((call) => call.success)
      .slice(0, this.config.maxCandidateSteps ?? 20)
      .map((call, index) => ({
        id: `step_${index + 1}`,
        description: `${call.name} ${JSON.stringify(call.args ?? {}).slice(0, 200)}`.trim(),
        tool: call.name,
        args:
          call.args && typeof call.args === "object" && !Array.isArray(call.args)
            ? (call.args as Record<string, unknown>)
            : {},
      }));

    const candidate = proposeProcedureCandidate({
      store: this.procedureStore,
      taskId: input.turnId,
      userMessage: input.userMessage,
      steps,
      learnedScope: this.config.workspaceRoot ?? process.cwd(),
    });
    return { learning, candidate };
  }
}

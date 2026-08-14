import type { CognitiveToolResult } from "../cognition/layer.js";
import { makeTheoryPrediction, resolvePrediction } from "../research/theory-store.js";
import { AliveEngine } from "./engine.js";
import type { AliveAction, AliveEventInput, AliveExpectation, AlivePulse, CreateOpenLoopInput } from "./engine.js";

function isTestCommand(args?: Record<string, unknown>): boolean {
  const command = typeof args?.command === "string" ? args.command : "";
  return /\b(?:npm|pnpm|yarn|bun|vitest|jest|pytest)\b.*\b(?:test|check)\b/i.test(command);
}

export function toolOutcomeToAliveEvent(result: CognitiveToolResult, args?: Record<string, unknown>): AliveEventInput {
  const testCommand = result.toolName === "shell" && isTestCommand(args);
  return {
    type: testCommand
      ? "test_finished"
      : result.toolName === "shell"
        ? "process_exited"
        : result.success
          ? "tool_succeeded"
          : "tool_failed",
    source: "ntox-tool",
    significance: result.success ? 0.2 : 0.8,
    payload: {
      toolName: result.toolName,
      status: result.success ? "passed" : "failed",
      error: result.error,
      durationMs: result.durationMs,
      ...result.metadata,
    },
  };
}

export class NtoxAliveBridge {
  private readonly pendingActions: AliveAction[] = [];

  constructor(readonly engine: AliveEngine) {}

  recordToolOutcome(result: CognitiveToolResult, args?: Record<string, unknown>): AlivePulse {
    return this.handlePulse(this.engine.recordEvent(toolOutcomeToAliveEvent(result, args)));
  }

  recordEvent(event: AliveEventInput): AlivePulse {
    return this.handlePulse(this.engine.recordEvent(event));
  }

  pulse(now?: number): AlivePulse {
    return this.handlePulse(this.engine.pulse(now));
  }

  createTheoryPrediction(
    theoryId: string,
    statement: string,
    confidence: number,
    expectation: AliveExpectation,
    openLoopId?: string,
  ) {
    const theoryPrediction = makeTheoryPrediction(theoryId, statement, confidence);
    if (!theoryPrediction) return null;
    return this.engine.createPrediction({
      statement,
      confidence: theoryPrediction.confidence,
      expectation,
      theoryId,
      theoryPredictionId: theoryPrediction.id,
      openLoopId,
    });
  }

  createOpenLoop(input: CreateOpenLoopInput) {
    return this.engine.createOpenLoop(input);
  }

  consumeWakeContext(): string {
    const actions = this.pendingActions.splice(0, this.pendingActions.length);
    if (actions.length === 0) return "";
    const lines = actions.slice(0, 3).map((action) => `- ${action.reason}`);
    return `## NTOX Alive\nRecent world events need attention:\n${lines.join("\n")}`;
  }

  private handlePulse(pulse: AlivePulse): AlivePulse {
    for (const prediction of pulse.resolvedPredictions) {
      if (prediction.theoryPredictionId) {
        resolvePrediction(
          prediction.theoryPredictionId,
          prediction.status === "confirmed" ? "confirmed" : "falsified",
          prediction.actual ? `${prediction.actual.type}: ${JSON.stringify(prediction.actual.payload)}` : undefined,
        );
      }
    }
    this.pendingActions.push(...pulse.actions.filter((action) => action.kind === "wake" || action.kind === "notify"));
    return pulse;
  }
}

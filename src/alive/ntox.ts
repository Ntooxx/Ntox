import type { CognitiveToolResult } from "../cognition/layer.js";
import { makeTheoryPrediction, resolvePrediction } from "../research/theory-store.js";
import { AliveEngine } from "./engine.js";
import { pushNotification } from "./notifications.js";
import type {
  AliveAction,
  AliveEvent,
  AliveEventInput,
  AliveExpectation,
  AlivePulse,
  CreateOpenLoopInput,
} from "./engine.js";

function isTestCommand(args?: Record<string, unknown>): boolean {
  const command = typeof args?.command === "string" ? args.command : "";
  return /\b(?:npm|pnpm|yarn|bun|vitest|jest|pytest)\b.*\b(?:test|check)\b/i.test(command);
}

export function failedToolNextStep(result: CognitiveToolResult, args?: Record<string, unknown>): string | undefined {
  if (result.success) return undefined;
  const command = typeof args?.command === "string" ? args.command : "";
  const detail = `${result.error ?? ""} ${command}`.toLowerCase();
  if (/enoent|no such file|cannot find path|not found/.test(detail)) {
    return "Verify the path or discover the target before retrying.";
  }
  if (/permission|access denied|eperm|eacces/.test(detail)) {
    return "Check permissions or choose an allowed path before retrying.";
  }
  if (/parsererror|commandnotfound|not recognized|syntax|unexpected token/.test(detail)) {
    return "Fix the command syntax for this shell before retrying.";
  }
  if (/timeout|timed out|aborted/.test(detail)) {
    return "Retry with a narrower command or inspect partial output first.";
  }
  if (isTestCommand(args) || /test|assert|expect|failed/.test(detail)) {
    return "Inspect the failing assertion or logs, then change the smallest relevant code path.";
  }
  return "Change inputs or use a fallback; do not repeat the same tool call unchanged.";
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
      nextStep: failedToolNextStep(result, args),
      durationMs: result.durationMs,
      ...result.metadata,
    },
  };
}

export type AliveActionListener = (action: AliveAction, event?: AliveEvent) => void;

export class NtoxAliveBridge {
  private readonly pendingActions: AliveAction[] = [];
  private readonly listeners = new Set<AliveActionListener>();

  constructor(readonly engine: AliveEngine) {}

  subscribe(listener: AliveActionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  recordToolOutcome(result: CognitiveToolResult, args?: Record<string, unknown>): AlivePulse {
    return this.handlePulse(this.engine.recordEvent(toolOutcomeToAliveEvent(result, args)));
  }

  recordEvent(event: AliveEventInput): AlivePulse {
    return this.handlePulse(this.engine.recordEvent(event));
  }

  notify(reason: string, detail?: Record<string, unknown>): AliveAction {
    const action: AliveAction = { kind: "notify", reason };
    this.pendingActions.push(action);
    pushNotification({ kind: "agent", reason, detail });
    for (const listener of this.listeners) {
      try {
        listener(action);
      } catch (error) {
        console.error("[alive] notify listener failed:", error);
      }
    }
    return action;
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
    const events = this.engine.getState().events;
    const lines = actions.slice(0, 3).map((action) => {
      const event = action.eventId ? events.find((item) => item.id === action.eventId) : undefined;
      const nextStep = typeof event?.payload.nextStep === "string" ? ` Next step: ${event.payload.nextStep}` : "";
      return `- ${action.reason}.${nextStep}`;
    });
    return `## NTOX Alive\nRecent world events need attention:\n${lines.join("\n")}`;
  }

  inspect(limit = 8) {
    const state = this.engine.getState();
    return {
      events: state.events.slice(-limit).reverse(),
      predictions: state.predictions.slice(-limit).reverse(),
      openLoops: state.openLoops.slice(-limit).reverse(),
      pendingActions: [...this.pendingActions].slice(-limit).reverse(),
    };
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
    const actionable = pulse.actions.filter((action) => action.kind === "wake" || action.kind === "notify");
    this.pendingActions.push(...actionable);
    if (this.listeners.size > 0 && actionable.length > 0) {
      const events = this.engine.getState().events;
      for (const action of actionable) {
        const event = action.eventId ? events.find((item) => item.id === action.eventId) : undefined;
        for (const listener of this.listeners) {
          try {
            listener(action, event);
          } catch (error) {
            console.error("[alive] action listener failed:", error);
          }
        }
      }
    }
    return pulse;
  }
}

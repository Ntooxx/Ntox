import { randomUUID } from "node:crypto";

export type AliveActionKind = "ignore" | "learn" | "wake" | "notify";
export type AlivePredictionStatus = "pending" | "confirmed" | "falsified";
export type AliveOpenLoopStatus = "active" | "waiting_evidence" | "blocked" | "completed";

export interface AliveEvent {
  id: string;
  type: string;
  source: string;
  timestamp: number;
  significance: number;
  payload: Record<string, unknown>;
  predictionId?: string;
  requiresHuman: boolean;
}

export interface AliveEventInput {
  id?: string;
  type: string;
  source: string;
  timestamp?: number;
  significance?: number;
  payload?: Record<string, unknown>;
  predictionId?: string;
  requiresHuman?: boolean;
}

export interface AliveExpectation {
  eventType: string;
  payload?: Record<string, unknown>;
}

export interface AlivePrediction {
  id: string;
  statement: string;
  confidence: number;
  expectation: AliveExpectation;
  status: AlivePredictionStatus;
  createdAt: number;
  resolvedAt?: number;
  actual?: AliveEvent;
  predictionError?: number;
  theoryId?: string;
  theoryPredictionId?: string;
  openLoopId?: string;
}

export interface AliveOpenLoop {
  id: string;
  goal: string;
  hypothesis?: string;
  uncertainty?: string;
  nextEvidence?: string;
  status: AliveOpenLoopStatus;
  createdAt: number;
  updatedAt: number;
  deadline?: number;
  lastEvidence?: string;
}

export interface AliveState {
  events: AliveEvent[];
  predictions: AlivePrediction[];
  openLoops: AliveOpenLoop[];
}

export interface AliveAction {
  kind: AliveActionKind;
  reason: string;
  eventId?: string;
  predictionId?: string;
  openLoopId?: string;
}

export interface AlivePulse {
  actions: AliveAction[];
  resolvedPredictions: AlivePrediction[];
}

export interface AliveStore {
  load(): AliveState | null;
  save(state: AliveState): void;
}

export interface AliveEngineOptions {
  store?: AliveStore;
  now?: () => number;
  wakeSignificance?: number;
  wakePredictionError?: number;
  maxEvents?: number;
}

export interface CreateOpenLoopInput {
  id?: string;
  goal: string;
  hypothesis?: string;
  uncertainty?: string;
  nextEvidence?: string;
  status?: AliveOpenLoopStatus;
  deadline?: number;
}

export interface CreatePredictionInput {
  id?: string;
  statement: string;
  confidence: number;
  expectation: AliveExpectation;
  theoryId?: string;
  theoryPredictionId?: string;
  openLoopId?: string;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function matchesExpectation(event: AliveEvent, expectation: AliveExpectation): boolean {
  if (event.type !== expectation.eventType) return false;
  return Object.entries(expectation.payload ?? {}).every(([key, value]) => event.payload[key] === value);
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

export class AliveEngine {
  private readonly store?: AliveStore;
  private readonly now: () => number;
  private readonly wakeSignificance: number;
  private readonly wakePredictionError: number;
  private readonly maxEvents: number;
  private state: AliveState;

  constructor(options: AliveEngineOptions = {}) {
    this.store = options.store;
    this.now = options.now ?? Date.now;
    this.wakeSignificance = clamp(options.wakeSignificance ?? 0.75);
    this.wakePredictionError = clamp(options.wakePredictionError ?? 0.6);
    this.maxEvents = Math.max(1, options.maxEvents ?? 250);
    this.state = clone(this.store?.load() ?? { events: [], predictions: [], openLoops: [] });
  }

  getState(): AliveState {
    return clone(this.state);
  }

  createOpenLoop(input: CreateOpenLoopInput): AliveOpenLoop {
    const now = this.now();
    const loop: AliveOpenLoop = {
      id: input.id ?? id("loop"),
      goal: input.goal,
      hypothesis: input.hypothesis,
      uncertainty: input.uncertainty,
      nextEvidence: input.nextEvidence,
      status: input.status ?? "waiting_evidence",
      createdAt: now,
      updatedAt: now,
      deadline: input.deadline,
    };
    this.state.openLoops.push(loop);
    this.persist();
    return clone(loop);
  }

  createPrediction(input: CreatePredictionInput): AlivePrediction {
    if (input.openLoopId && !this.state.openLoops.some((loop) => loop.id === input.openLoopId)) {
      throw new Error(`Open loop ${input.openLoopId} does not exist`);
    }
    const prediction: AlivePrediction = {
      id: input.id ?? id("pred"),
      statement: input.statement,
      confidence: clamp(input.confidence),
      expectation: clone(input.expectation),
      status: "pending",
      createdAt: this.now(),
      theoryId: input.theoryId,
      theoryPredictionId: input.theoryPredictionId,
      openLoopId: input.openLoopId,
    };
    this.state.predictions.push(prediction);
    this.persist();
    return clone(prediction);
  }

  recordEvent(input: AliveEventInput): AlivePulse {
    const event: AliveEvent = {
      id: input.id ?? id("event"),
      type: input.type,
      source: input.source,
      timestamp: input.timestamp ?? this.now(),
      significance: clamp(input.significance ?? 0),
      payload: clone(input.payload ?? {}),
      predictionId: input.predictionId,
      requiresHuman: input.requiresHuman ?? false,
    };
    this.state.events.push(event);
    if (this.state.events.length > this.maxEvents)
      this.state.events.splice(0, this.state.events.length - this.maxEvents);

    const resolved = this.resolvePrediction(event);
    const actions: AliveAction[] = [];
    for (const prediction of resolved) {
      actions.push({
        kind: "learn",
        reason: `Prediction ${prediction.status}: ${prediction.statement}`,
        eventId: event.id,
        predictionId: prediction.id,
        openLoopId: prediction.openLoopId,
      });
      if (prediction.predictionError !== undefined && prediction.predictionError >= this.wakePredictionError) {
        actions.push({
          kind: "wake",
          reason: `High prediction error (${prediction.predictionError.toFixed(2)})`,
          eventId: event.id,
          predictionId: prediction.id,
          openLoopId: prediction.openLoopId,
        });
      }
    }
    if (event.requiresHuman) {
      actions.push({ kind: "notify", reason: "Human decision requested", eventId: event.id });
    } else if (event.significance >= this.wakeSignificance) {
      actions.push({ kind: "wake", reason: `Significant ${event.type} event`, eventId: event.id });
    }
    if (actions.length === 0)
      actions.push({ kind: "ignore", reason: `Low-significance ${event.type} event`, eventId: event.id });
    this.persist();
    return { actions, resolvedPredictions: resolved.map(clone) };
  }

  pulse(now = this.now()): AlivePulse {
    const actions: AliveAction[] = [];
    for (const loop of this.state.openLoops) {
      if (loop.status === "completed" || loop.deadline === undefined || loop.deadline > now) continue;
      loop.status = "blocked";
      loop.updatedAt = now;
      actions.push({ kind: "notify", reason: `Open loop deadline reached: ${loop.goal}`, openLoopId: loop.id });
    }
    if (actions.length === 0) actions.push({ kind: "ignore", reason: "No meaningful state change" });
    this.persist();
    return { actions, resolvedPredictions: [] };
  }

  private resolvePrediction(event: AliveEvent): AlivePrediction[] {
    if (!event.predictionId) return [];
    const prediction = this.state.predictions.find(
      (item) => item.id === event.predictionId && item.status === "pending",
    );
    if (!prediction) return [];
    prediction.status = matchesExpectation(event, prediction.expectation) ? "confirmed" : "falsified";
    prediction.resolvedAt = event.timestamp;
    prediction.actual = clone(event);
    prediction.predictionError = prediction.status === "confirmed" ? 1 - prediction.confidence : prediction.confidence;
    if (prediction.openLoopId) {
      const loop = this.state.openLoops.find((item) => item.id === prediction.openLoopId);
      if (loop) {
        loop.lastEvidence = `${prediction.status}: ${event.type}`;
        loop.updatedAt = event.timestamp;
      }
    }
    return [prediction];
  }

  private persist(): void {
    this.store?.save(clone(this.state));
  }
}

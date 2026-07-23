import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { InternalState } from "./state.js";

export class ActionResult {
  actionType: string;
  success: boolean;
  details: string;
  cycle: number;
  sessionId: string;
  goalId: string;
  goalCategory: string;

  constructor(
    actionType: string,
    success: boolean,
    details: string = "",
    cycle: number = 0,
    sessionId: string = "",
    goalId: string = "",
    goalCategory: string = "",
  ) {
    if (!actionType) throw new Error("ActionResult.actionType must be non-empty");
    this.actionType = actionType;
    this.success = success;
    this.details = details;
    this.cycle = cycle;
    this.sessionId = sessionId;
    this.goalId = goalId;
    this.goalCategory = goalCategory;
  }
}

export class StateTransition {
  before: InternalState;
  after: InternalState;
  actionResult: ActionResult;
  cause: string;
  cycle: number;
  timestamp: string;
  sessionId: string;

  constructor(
    before: InternalState,
    after: InternalState,
    actionResult: ActionResult,
    cause: string,
    cycle: number,
    timestamp: string = "",
    sessionId: string = "",
  ) {
    this.before = before;
    this.after = after;
    this.actionResult = actionResult;
    this.cause = cause;
    this.cycle = cycle;
    this.timestamp = timestamp || new Date().toISOString();
    this.sessionId = sessionId;
  }

  valuesChanged(): string[] {
    const changed: string[] = [];
    for (const key of ["curiosity", "analytical", "creative", "empathetic", "humor", "directness", "patience", "adaptability", "confidence", "energy", "engagement"]) {
      if ((this.before as unknown as Record<string, number>)[key] !== (this.after as unknown as Record<string, number>)[key]) {
        changed.push(key);
      }
    }
    return changed;
  }

  toJSON(): Record<string, unknown> {
    return {
      before: this.before.toJSON(),
      after: this.after.toJSON(),
      actionResult: {
        actionType: this.actionResult.actionType,
        success: this.actionResult.success,
        details: this.actionResult.details,
        cycle: this.actionResult.cycle,
        sessionId: this.actionResult.sessionId,
        goalId: this.actionResult.goalId,
        goalCategory: this.actionResult.goalCategory,
      },
      cause: this.cause,
      cycle: this.cycle,
      timestamp: this.timestamp,
      sessionId: this.sessionId,
    };
  }

  static fromJSON(d: Record<string, unknown>): StateTransition {
    const ar = d.actionResult as Record<string, unknown>;
    return new StateTransition(
      InternalState.fromJSON(d.before as Record<string, number>),
      InternalState.fromJSON(d.after as Record<string, number>),
      new ActionResult(
        ar.actionType as string,
        ar.success as boolean,
        (ar.details as string) || "",
        (ar.cycle as number) || 0,
        (ar.sessionId as string) || "",
        (ar.goalId as string) || "",
        (ar.goalCategory as string) || "",
      ),
      d.cause as string,
      (d.cycle as number) || 0,
      (d.timestamp as string) || "",
      (d.sessionId as string) || "",
    );
  }
}

export class IdentityLog {
  private transitions: StateTransition[] = [];

  append(transition: StateTransition): void {
    if (!(transition instanceof StateTransition)) {
      throw new TypeError(`IdentityLog.append requires a StateTransition`);
    }
    this.transitions.push(transition);
  }

  [Symbol.iterator](): Iterator<StateTransition> {
    return this.transitions[Symbol.iterator]();
  }

  get length(): number {
    return this.transitions.length;
  }

  at(idx: number): StateTransition | undefined {
    return this.transitions[idx];
  }

  stateAt(cycle: number): InternalState | undefined {
    let result: InternalState | undefined;
    for (const t of this.transitions) {
      if (t.cycle > cycle) break;
      result = t.after;
    }
    return result;
  }

  stateAtSession(sessionId: string, cycle?: number): InternalState | undefined {
    let result: InternalState | undefined;
    for (const t of this.transitions) {
      if (t.sessionId !== sessionId) continue;
      if (cycle !== undefined && t.cycle > cycle) break;
      result = t.after;
    }
    return result;
  }

  transitionsForCycle(cycle: number): StateTransition[] {
    return this.transitions.filter((t) => t.cycle === cycle);
  }

  transitionsForSession(sessionId: string): StateTransition[] {
    return this.transitions.filter((t) => t.sessionId === sessionId);
  }

  sessions(): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const t of this.transitions) {
      if (!seen.has(t.sessionId)) {
        seen.add(t.sessionId);
        result.push(t.sessionId);
      }
    }
    return result;
  }

  private filterBefore(filters: Record<string, { lt?: number; gt?: number }>): StateTransition[] {
    return this.transitions.filter((t) => {
      for (const [field, bounds] of Object.entries(filters)) {
        const val = (t.before as unknown as Record<string, number>)[field];
        if (bounds.lt !== undefined && !(val < bounds.lt)) return false;
        if (bounds.gt !== undefined && !(val > bounds.gt)) return false;
      }
      return true;
    });
  }

  private filterAfter(filters: Record<string, { lt?: number; gt?: number }>): StateTransition[] {
    return this.transitions.filter((t) => {
      for (const [field, bounds] of Object.entries(filters)) {
        const val = (t.after as unknown as Record<string, number>)[field];
        if (bounds.lt !== undefined && !(val < bounds.lt)) return false;
        if (bounds.gt !== undefined && !(val > bounds.gt)) return false;
      }
      return true;
    });
  }

  transitionsWhereBefore(fields: Record<string, { lt?: number; gt?: number }>): StateTransition[] {
    return this.filterBefore(fields);
  }

  transitionsWhereAfter(fields: Record<string, { lt?: number; gt?: number }>): StateTransition[] {
    return this.filterAfter(fields);
  }

  transitionsWithOutcome(success: boolean): StateTransition[] {
    return this.transitions.filter((t) => t.actionResult.success === success);
  }

  transitionsWithActionType(actionType: string): StateTransition[] {
    return this.transitions.filter((t) => t.actionResult.actionType === actionType);
  }

  allCauses(): string[] {
    return this.transitions.map((t) => t.cause);
  }

  timesWhenStateBelow(field: string, threshold: number, limit: number = 10): StateTransition[] {
    const result = this.filterBefore({ [field]: { lt: threshold } });
    return result.slice(-limit);
  }

  timesWhenStateAbove(field: string, threshold: number, limit: number = 10): StateTransition[] {
    const result = this.filterBefore({ [field]: { gt: threshold } });
    return result.slice(-limit);
  }

  trajectoryOf(field: string): Array<{ cycle: number; value: number }> {
    if (this.transitions.length === 0) return [];
    const result: Array<{ cycle: number; value: number }> = [];
    const first = this.transitions[0];
      result.push({ cycle: first.cycle, value: (first.before as unknown as Record<string, number>)[field] });
    for (const t of this.transitions) {
      result.push({ cycle: t.cycle, value: (t.after as unknown as Record<string, number>)[field] });
    }
    return result;
  }

  successRateByCategory(): Record<string, { success: number; failure: number; total: number; rate: number }> {
    const byCat: Record<string, { success: number; failure: number }> = {};
    for (const t of this.transitions) {
      const cat = t.actionResult.goalCategory;
      if (!cat) continue;
      if (!byCat[cat]) byCat[cat] = { success: 0, failure: 0 };
      if (t.actionResult.success) byCat[cat].success++;
      else byCat[cat].failure++;
    }
    const result: Record<string, { success: number; failure: number; total: number; rate: number }> = {};
    for (const [cat, counts] of Object.entries(byCat)) {
      const total = counts.success + counts.failure;
      result[cat] = { ...counts, total, rate: total > 0 ? counts.success / total : 0 };
    }
    return result;
  }

  save(filePath: string): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    let existing: Record<string, unknown>[] = [];
    if (existsSync(filePath)) {
      try {
        existing = JSON.parse(readFileSync(filePath, "utf-8"));
      } catch { /* ignore */ }
    }

    const existingCount = Array.isArray(existing) ? existing.length : 0;
    const newEntries = this.transitions.slice(existingCount);
    if (newEntries.length === 0 && existsSync(filePath)) return;

    const all = [...existing, ...newEntries.map((t) => t.toJSON())];
    const tmp = filePath + ".tmp";
    writeFileSync(tmp, JSON.stringify(all, null, 2), "utf-8");
    writeFileSync(filePath, JSON.stringify(all, null, 2), "utf-8");
    try { if (existsSync(tmp)) { unlinkSync(tmp); } } catch { /* ignore */ }
  }

  static load(filePath: string): IdentityLog {
    const log = new IdentityLog();
    if (!existsSync(filePath)) return log;
    try {
      const entries: Record<string, unknown>[] = JSON.parse(readFileSync(filePath, "utf-8"));
      if (!Array.isArray(entries)) return log;
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        try {
          log.append(StateTransition.fromJSON(entry as Record<string, unknown>));
        } catch { /* skip malformed */ }
      }
    } catch { /* ignore */ }
    return log;
  }

  merge(other: IdentityLog): void {
    for (const t of other) this.transitions.push(t);
  }
}

export class EvolutionConfig {
  confidenceGainOnSuccess: number = 0.05;
  confidenceLossOnFailure: number = 0.08;
  curiosityGainOnExploreSuccess: number = 0.02;
  analyticalGainOnOverconfidentFailure: number = 0.03;
  energyCostPerAction: number = 0.01;
  energyRecoveryPerCycle: number = 0.005;
  confidenceThreshold: number = 0.7;

  constructor(init?: Partial<EvolutionConfig>) {
    if (init) Object.assign(this, init);
  }
}

export function evolveState(
  state: InternalState,
  actionResult: ActionResult,
  config?: EvolutionConfig,
): InternalState {
  const cfg = config ?? new EvolutionConfig();
  const newState = state.clone();

  if (actionResult.success) {
    newState.confidence = Math.min(1.0, newState.confidence + cfg.confidenceGainOnSuccess);
    if (actionResult.actionType === "Explore") {
      newState.curiosity = Math.min(1.0, newState.curiosity + cfg.curiosityGainOnExploreSuccess);
    }
  } else {
    newState.confidence = Math.max(0.0, newState.confidence - cfg.confidenceLossOnFailure);
    if (state.confidence > cfg.confidenceThreshold) {
      newState.analytical = Math.min(1.0, newState.analytical + cfg.analyticalGainOnOverconfidentFailure);
    }
  }

  newState.energy = Math.max(0.0, newState.energy - cfg.energyCostPerAction);
  newState.energy = Math.min(1.0, newState.energy + cfg.energyRecoveryPerCycle);
  return newState;
}

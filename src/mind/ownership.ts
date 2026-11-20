import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import type { IdentityStore } from "./identity.js";
import { clamp } from "./util.js";

export type OwnershipDecision = "accept" | "decline" | "defer";

export interface BoundaryState {
  /** 0 = closed, 1 = fully permeable. */
  permeability: number;
  /** 0 = no coherence, 1 = well-delimited self. */
  integrity: number;
  accepted: number;
  declined: number;
  /** Refusals that had evidence present but conflicted with a strong position. */
  costlyRefusals: number;
  updatedAt: number;
}

export type OwnershipSource = "correction" | "mental-model" | "reflection" | "peer" | "operator";

export interface OwnershipCandidate {
  topic: string;
  stance: string;
  confidence: number;
  evidence: string[];
  source: OwnershipSource;
}

export interface OwnershipStore {
  load(): BoundaryState | null;
  save(state: BoundaryState): void;
}

export interface OwnershipGateOptions {
  path?: string;
  store?: OwnershipStore;
  now?: () => number;
}

function freshState(): BoundaryState {
  return {
    permeability: 0.5,
    integrity: 0.2,
    accepted: 0,
    declined: 0,
    costlyRefusals: 0,
    updatedAt: 0,
  };
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export class JsonFileOwnershipStore implements OwnershipStore {
  constructor(private readonly filePath: string) {}

  load(): BoundaryState | null {
    if (!existsSync(this.filePath)) return null;
    try {
      const state = JSON.parse(readFileSync(this.filePath, "utf8")) as BoundaryState;
      if (typeof state.permeability !== "number" || typeof state.integrity !== "number") return null;
      if (typeof state.accepted !== "number" || typeof state.declined !== "number") return null;
      if (typeof state.costlyRefusals !== "number") return null;
      return { ...freshState(), ...state };
    } catch {
      return null;
    }
  }

  save(state: BoundaryState): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(temporaryPath, this.filePath);
  }
}

export class OwnershipGate {
  private state: BoundaryState;
  private readonly store?: OwnershipStore;
  private readonly now: () => number;

  constructor(options: OwnershipGateOptions = {}) {
    this.store = options.store ?? new JsonFileOwnershipStore(options.path ?? join(NTOX_DIR, "mind", "ownership.json"));
    this.now = options.now ?? Date.now;
    this.state = { ...(this.store.load() ?? freshState()) };
  }

  getState(): BoundaryState {
    return { ...this.state };
  }

  /**
   * The boundary becomes a skin when it refuses evidence that would betray a
   * strong position. A refusal with no evidence is only a filter, not a "no".
   */
  decide(candidate: OwnershipCandidate, identity: IdentityStore): OwnershipDecision {
    const existing = identity.positionsMatching([candidate.topic]);
    const strong = existing.filter((position) => position.confidence >= 0.6);
    const conflict = strong.some((position) => normalize(position.stance) !== normalize(candidate.stance));
    const hasEvidence = candidate.evidence.length > 0;

    let decision: OwnershipDecision;
    if (conflict && hasEvidence) {
      this.state.costlyRefusals += 1;
      this.state.integrity = clamp(this.state.integrity + 0.04, 0, 1);
      this.state.permeability = clamp(this.state.permeability - 0.06, 0, 1);
      decision = "decline";
    } else if (candidate.confidence < 0.35 || !hasEvidence) {
      decision = "defer";
    } else if (candidate.confidence >= 0.5 || this.state.permeability > 0.6) {
      this.state.accepted += 1;
      this.state.permeability = clamp(this.state.permeability + 0.02, 0, 1);
      decision = "accept";
    } else {
      decision = "defer";
    }

    if (decision === "decline") this.state.declined += 1;
    this.state.updatedAt = this.now();
    this.persist();
    return decision;
  }

  /** The self closes after a challenge: more integrity, less permeability. */
  harden(amount = 0.08): BoundaryState {
    this.state.integrity = clamp(this.state.integrity + amount, 0, 1);
    this.state.permeability = clamp(this.state.permeability - amount, 0, 1);
    this.state.updatedAt = this.now();
    this.persist();
    return this.getState();
  }

  /** Allow the self to be wrong again: decay integrity, reopen the boundary. */
  soften(amount = 0.05): BoundaryState {
    this.state.integrity = clamp(this.state.integrity - amount, 0, 1);
    this.state.permeability = clamp(this.state.permeability + amount, 0, 1);
    this.state.updatedAt = this.now();
    this.persist();
    return this.getState();
  }

  clear(): void {
    this.state = freshState();
    this.persist();
  }

  private persist(): void {
    this.store?.save(this.getState());
  }
}

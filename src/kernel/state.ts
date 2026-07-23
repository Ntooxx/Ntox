export const TRAIT_NAMES = [
  "curiosity", "analytical", "creative", "empathetic",
  "humor", "directness", "patience", "adaptability",
] as const;

export const META_STATES = ["confidence", "energy", "engagement"] as const;

export type TraitName = typeof TRAIT_NAMES[number];
export type MetaStateName = typeof META_STATES[number];

export class InternalState {
  curiosity: number = 0.7;
  analytical: number = 0.7;
  creative: number = 0.5;
  empathetic: number = 0.5;
  humor: number = 0.4;
  directness: number = 0.7;
  patience: number = 0.6;
  adaptability: number = 0.7;

  confidence: number = 0.7;
  energy: number = 0.8;
  engagement: number = 0.6;

  constructor(init?: Partial<InternalState>) {
    if (init) Object.assign(this, init);
  }

  trait(name: string): number {
    return (this as unknown as Record<string, number>)[name] ?? 0.5;
  }

  meta(name: string): number {
    return (this as unknown as Record<string, number>)[name] ?? 0.5;
  }

  clone(): InternalState {
    return new InternalState({ ...this });
  }

  toJSON(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const key of [...TRAIT_NAMES, ...META_STATES]) {
      result[key] = (this as unknown as Record<string, number>)[key];
    }
    return result;
  }

  static fromJSON(data: Record<string, number>): InternalState {
    return new InternalState(data);
  }
}

export class WorldState {
  userPresent: boolean = true;
  pendingUserInput: boolean = false;
  cycle: number = 0;

  constructor(init?: Partial<WorldState>) {
    if (init) Object.assign(this, init);
  }
}

export class Action {
  readonly type: string;
  constructor(type: string) { this.type = type; }
}

export class SurfaceToUser extends Action {
  reason: string;
  constructor(reason: string) { super("SurfaceToUser"); this.reason = reason; }
}

export class Defer extends Action {
  reason: string;
  constructor(reason: string) { super("Defer"); this.reason = reason; }
}

export class Explore extends Action {
  target: unknown;
  constructor(target: unknown) { super("Explore"); this.target = target; }
}

export class ExecuteAction extends Action {
  subtask: unknown;
  verified: boolean;
  constructor(subtask: unknown, verified: boolean = false) {
    super("Execute");
    this.subtask = subtask;
    this.verified = verified;
  }
}

export class Reflect extends Action {
  topic?: string;
  constructor(topic?: string) { super("Reflect"); this.topic = topic; }
}

export class DecomposeGoal extends Action {
  goal: unknown;
  constructor(goal: unknown) { super("DecomposeGoal"); this.goal = goal; }
}

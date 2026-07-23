export type SuccessCondition = (world: unknown) => boolean;

export class Outcome {
  subtaskId: string;
  success: boolean;
  timestamp: string;
  details: string;

  constructor(subtaskId: string, success: boolean, timestamp: string, details: string = "") {
    if (!subtaskId) throw new Error("Outcome.subtaskId must be non-empty");
    this.subtaskId = subtaskId;
    this.success = success;
    this.timestamp = timestamp;
    this.details = details;
  }
}

export class Subtask {
  id: string;
  description: string;
  successCondition: SuccessCondition;
  dependencies: string[];
  evidence: Outcome[];
  toolName?: string;
  args?: Record<string, unknown>;

  constructor(
    id: string,
    description: string,
    successCondition: SuccessCondition,
    dependencies: string[] = [],
    evidence: Outcome[] = [],
    toolName?: string,
    args?: Record<string, unknown>,
  ) {
    if (!id) throw new Error("Subtask.id must be non-empty");
    if (typeof successCondition !== "function") throw new Error("Subtask.successCondition must be callable");
    if (dependencies.includes(id)) throw new Error(`Subtask ${id} cannot depend on itself`);
    this.id = id;
    this.description = description;
    this.successCondition = successCondition;
    this.dependencies = dependencies;
    this.evidence = evidence;
    this.toolName = toolName;
    this.args = args;
  }

  get isVerified(): boolean {
    if (this.evidence.length === 0) return false;
    return this.evidence[this.evidence.length - 1].success;
  }

  get isBlocked(): boolean {
    return false;
  }

  recordOutcome(outcome: Outcome): void {
    if (outcome.subtaskId !== this.id) {
      throw new Error(`Outcome for ${outcome.subtaskId} recorded against subtask ${this.id}`);
    }
    this.evidence.push(outcome);
  }
}

export class Goal {
  id: string;
  description: string;
  priority: number;
  successCondition: SuccessCondition;
  subtasks: Subtask[];
  evidence: Outcome[];
  isUnderspecified: boolean;
  category: string;

  constructor(
    id: string,
    description: string,
    priority: number,
    successCondition: SuccessCondition,
    subtasks: Subtask[] = [],
    evidence: Outcome[] = [],
    isUnderspecified: boolean = true,
    category: string = "general",
  ) {
    if (!id) throw new Error("Goal.id must be non-empty");
    if (typeof successCondition !== "function") throw new Error("Goal.successCondition must be callable");
    this.id = id;
    this.description = description;
    this.priority = priority;
    this.successCondition = successCondition;
    this.subtasks = subtasks;
    this.evidence = evidence;
    this.isUnderspecified = isUnderspecified;
    this.category = category;
  }

  get progress(): number {
    if (this.subtasks.length === 0) return 0.0;
    const verified = this.subtasks.filter((s) => s.isVerified).length;
    return verified / this.subtasks.length;
  }

  get isComplete(): boolean {
    return this.subtasks.length > 0 && this.subtasks.every((s) => s.isVerified);
  }

  isBlocked(subtaskId: string): boolean {
    const sub = this.subtasks.find((s) => s.id === subtaskId);
    if (!sub) return false;
    return sub.dependencies.some((depId) => {
      const dep = this.subtasks.find((s) => s.id === depId);
      return !dep || !dep.isVerified;
    });
  }

  readySubtasks(): Subtask[] {
    return this.subtasks.filter(
      (s) => !s.isVerified && !this.isBlocked(s.id)
    );
  }

  nextSubtasks(): Subtask[] {
    return this.readySubtasks();
  }

  recordOutcome(outcome: Outcome): void {
    this.evidence.push(outcome);
  }
}

export class GoalQueue {
  private goals: Goal[];

  constructor(goals: Goal[] = []) {
    this.goals = [...goals];
  }

  empty(): boolean {
    return this.goals.length === 0;
  }

  get length(): number {
    return this.goals.length;
  }

  [Symbol.iterator](): Iterator<Goal> {
    return this.goals[Symbol.iterator]();
  }

  highestPriority(): Goal | null {
    if (this.goals.length === 0) return null;
    return this.goals.reduce((best, g) => g.priority > best.priority ? g : best);
  }

  add(goal: Goal): void {
    this.goals.push(goal);
  }

  remove(goal: Goal): void {
    const idx = this.goals.indexOf(goal);
    if (idx >= 0) this.goals.splice(idx, 1);
  }
}

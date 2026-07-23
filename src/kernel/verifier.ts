import { Outcome, Goal, Subtask } from "./goals.js";

export class Verifier {
  private now: () => string;

  constructor(now?: () => string) {
    this.now = now ?? (() => new Date().toISOString());
  }

  verifySubtask(subtask: Subtask, world: unknown, details: string = ""): Outcome {
    let success = false;
    try {
      success = Boolean(subtask.successCondition(world));
    } catch (e) {
      details = `${details} [condition raised ${e instanceof Error ? e.constructor.name : "unknown"}: ${e}]`.trim();
    }
    const outcome = new Outcome(subtask.id, success, this.now(), details);
    subtask.recordOutcome(outcome);
    return outcome;
  }

  verifyGoal(goal: Goal, world: unknown, details: string = ""): Outcome {
    let success = false;
    try {
      success = Boolean(goal.successCondition(world));
    } catch (e) {
      details = `${details} [condition raised ${e instanceof Error ? e.constructor.name : "unknown"}: ${e}]`.trim();
    }
    const outcome = new Outcome(goal.id, success, this.now(), details);
    goal.recordOutcome(outcome);
    return outcome;
  }
}

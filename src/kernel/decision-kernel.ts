import { InternalState, WorldState, Action, SurfaceToUser, Defer, Explore, ExecuteAction, Reflect, DecomposeGoal } from "./state.js";
import { GoalQueue } from "./goals.js";

export class Thresholds {
  confidenceFloor: number = 0.30;
  energyFloor: number = 0.20;
  curiosityExplore: number = 0.70;
  patienceFloor: number = 0.30;
  analyticalVerify: number = 0.70;

  constructor(init?: Partial<Thresholds>) {
    if (init) Object.assign(this, init);
  }
}

export class DecisionKernel {
  goalQueue: GoalQueue;
  state: InternalState;
  world: WorldState;
  thresholds: Thresholds;

  constructor(
    goalQueue: GoalQueue,
    internalState: InternalState,
    world?: WorldState,
    thresholds?: Thresholds,
  ) {
    this.goalQueue = goalQueue;
    this.state = internalState;
    this.world = world ?? new WorldState();
    this.thresholds = thresholds ?? new Thresholds();
  }

  tick(): Action {
    const s = this.state;
    const t = this.thresholds;

    if (s.confidence < t.confidenceFloor) {
      return new SurfaceToUser(
        `confidence too low (${s.confidence.toFixed(2)} < ${t.confidenceFloor.toFixed(2)}) to proceed autonomously`
      );
    }

    if (s.energy < t.energyFloor) {
      return new Defer(
        `energy depleted (${s.energy.toFixed(2)} < ${t.energyFloor.toFixed(2)}) — resuming next cycle`
      );
    }

    if (this.goalQueue.empty()) {
      return new Reflect("no active goals — propose new direction");
    }

    let goal = this.goalQueue.highestPriority();
    while (goal !== null && goal.isComplete) {
      this.goalQueue.remove(goal);
      goal = this.goalQueue.highestPriority();
    }
    if (goal === null) {
      return new Reflect("all goals complete — propose new direction");
    }

    if (goal.isUnderspecified && s.curiosity > t.curiosityExplore) {
      return new Explore(goal);
    }

    const subtasks = goal.nextSubtasks();
    if (subtasks.length === 0) {
      return new DecomposeGoal(goal);
    }
    if (s.patience < t.patienceFloor) {
      return new DecomposeGoal(goal);
    }

    if (s.analytical > t.analyticalVerify) {
      return new ExecuteAction(subtasks[0], true);
    }
    return new ExecuteAction(subtasks[0], false);
  }

  updateInternalState(): void {
    this.world.cycle += 1;
  }
}

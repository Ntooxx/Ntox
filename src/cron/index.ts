export { parseSchedule, getNextRun } from "./scheduler.js";
export type { CronJob, CronStore, CronDelivery } from "./scheduler.js";
export { CronManager } from "./manager.js";
import { CronManager } from "./manager.js";

let shared: CronManager | null = null;

export function getCron(): CronManager {
  if (!shared) shared = new CronManager();
  return shared;
}

export function resetCronForTests(): void {
  shared = null;
}
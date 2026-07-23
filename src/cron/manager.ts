import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import { parseSchedule, getNextRun } from "./scheduler.js";
import type { CronJob, CronStore, CronDelivery } from "./scheduler.js";

const CRON_PATH = join(NTOX_DIR, "cron.json");
const CHECK_INTERVAL = 30_000;

export class CronManager {
  private jobs: CronJob[] = [];
  private nextId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private executor: ((prompt: string) => Promise<string>) | null = null;
  private delivery: CronDelivery | null = null;

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (!existsSync(NTOX_DIR)) mkdirSync(NTOX_DIR, { recursive: true });
      if (!existsSync(CRON_PATH)) return;
      const data = JSON.parse(readFileSync(CRON_PATH, "utf-8")) as CronStore;
      this.jobs = data.jobs || [];
      this.nextId = data.nextId || 1;
    } catch {
      this.jobs = [];
    }
  }

  private save(): void {
    try {
      if (!existsSync(NTOX_DIR)) mkdirSync(NTOX_DIR, { recursive: true });
      writeFileSync(CRON_PATH, JSON.stringify({ jobs: this.jobs, nextId: this.nextId }, null, 2));
    } catch { /* best effort */ }
  }

  setExecutor(executor: (prompt: string) => Promise<string>): void {
    this.executor = executor;
  }

  setDelivery(delivery: CronDelivery): void {
    this.delivery = delivery;
  }

  addJob(name: string, schedule: string, prompt: string, channel?: string, chatId?: string): CronJob | null {
    const parsed = parseSchedule(schedule);
    if (!parsed) return null;

    const job: CronJob = {
      id: `cron_${this.nextId++}`,
      name,
      schedule: parsed.cron,
      prompt,
      channel,
      chatId,
      enabled: true,
      lastRun: 0,
      nextRun: getNextRun(parsed.cron),
      runCount: 0,
      created: Date.now(),
    };
    this.jobs.push(job);
    this.save();
    return job;
  }

  removeJob(id: string): boolean {
    const idx = this.jobs.findIndex((j) => j.id === id);
    if (idx < 0) return false;
    this.jobs.splice(idx, 1);
    this.save();
    return true;
  }

  toggleJob(id: string): CronJob | null {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return null;
    job.enabled = !job.enabled;
    if (job.enabled) job.nextRun = getNextRun(job.schedule);
    this.save();
    return job;
  }

  listJobs(): CronJob[] {
    return [...this.jobs];
  }

  getJob(id: string): CronJob | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), CHECK_INTERVAL);
    this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const job of this.jobs) {
      if (!job.enabled) continue;
      if (now < job.nextRun) continue;

      job.lastRun = now;
      job.nextRun = getNextRun(job.schedule);
      job.runCount++;
      this.save();

      if (!this.executor) continue;

      try {
        const result = await this.executor(job.prompt);
        if (this.delivery && job.channel && job.chatId) {
          const msg = `[Scheduled: ${job.name}]\n${result}`;
          await this.delivery(job.channel, job.chatId, msg.slice(0, 4000));
        }
      } catch (e) {
        console.error(`[cron] job "${job.name}" failed: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
}

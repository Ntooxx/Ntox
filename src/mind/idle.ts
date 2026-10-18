import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import { dayKey } from "./util.js";

export interface IdleArtifact {
  at: number;
  job: string;
  summary: string;
  tokens: number;
  usd?: number;
}

export interface IdleJobContext {
  charge: (tokens: number, usd?: number) => void;
  deadline: number;
  since: number;
  now: () => number;
  expired: () => boolean;
}

export interface IdleJobResult {
  summary: string;
  tokens?: number;
  usd?: number;
}

export type IdleJobOutput = string | null | IdleJobResult;

export interface IdleJob {
  name: string;
  priority?: number;
  run: (ctx: IdleJobContext) => IdleJobOutput | Promise<IdleJobOutput>;
}

interface IdleState {
  day: string;
  cyclesToday: number;
  tokensToday: number;
  usdToday: number;
  totalCycles: number;
  lastRun: number;
  lastActivity: number;
  running: boolean;
  artifacts: IdleArtifact[];
  pendingProposals: string[];
}

export interface IdleStatus {
  enabled: boolean;
  day: string;
  cyclesToday: number;
  tokensToday: number;
  usdToday: number;
  totalCycles: number;
  lastRun: number;
  lastActivity: number;
  jobs: string[];
  artifacts: number;
  pendingProposals: string[];
  budgets: { tokens: number; usd: number; cycles: number; cycleMs: number; idleMs: number };
  yieldPerKToken: number;
}

export interface IdleOptions {
  path?: string;
  intervalMs?: number;
  dailyTokenBudget?: number;
  dailyUsdBudget?: number;
  maxCyclesPerDay?: number;
  cycleBudgetMs?: number;
  idleMs?: number;
  now?: () => number;
}

const DEFAULT_STATE: IdleState = {
  day: "",
  cyclesToday: 0,
  tokensToday: 0,
  usdToday: 0,
  totalCycles: 0,
  lastRun: 0,
  lastActivity: 0,
  running: false,
  artifacts: [],
  pendingProposals: [],
};

export class IdleScheduler {
  private state: IdleState;
  private jobs: IdleJob[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly path: string;
  private readonly intervalMs: number;
  private readonly dailyTokenBudget: number;
  private readonly dailyUsdBudget: number;
  private readonly maxCyclesPerDay: number;
  private readonly cycleBudgetMs: number;
  private readonly idleMs: number;
  private readonly now: () => number;

  constructor(options: IdleOptions = {}) {
    this.path = options.path ?? join(NTOX_DIR, "mind", "idle.json");
    this.intervalMs = Math.max(1000, options.intervalMs ?? 60_000);
    this.dailyTokenBudget = Math.max(0, options.dailyTokenBudget ?? 50_000);
    this.dailyUsdBudget = Math.max(0, options.dailyUsdBudget ?? 0.5);
    this.maxCyclesPerDay = Math.max(1, options.maxCyclesPerDay ?? 24);
    this.cycleBudgetMs = Math.max(1_000, options.cycleBudgetMs ?? 60_000);
    this.idleMs = Math.max(0, options.idleMs ?? 600_000);
    this.now = options.now ?? Date.now;
    this.state = this.load();
    this.resetDayIfNeeded();
    if (this.state.lastActivity === 0) this.state.lastActivity = this.now();
  }

  private load(): IdleState {
    if (!existsSync(this.path)) return { ...DEFAULT_STATE };
    try {
      return { ...DEFAULT_STATE, ...(JSON.parse(readFileSync(this.path, "utf-8")) as IdleState) };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  private save(): void {
    try {
      if (!existsSync(dirname(this.path))) mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.state, null, 2));
    } catch {
      /* keep in memory */
    }
  }

  private resetDayIfNeeded(): void {
    const today = dayKey(this.now());
    if (this.state.day !== today) {
      this.state.day = today;
      this.state.cyclesToday = 0;
      this.state.tokensToday = 0;
      this.state.usdToday = 0;
    }
  }

  addJob(job: IdleJob): void {
    if (this.jobs.some((j) => j.name === job.name)) return;
    this.jobs.push(job);
    this.jobs.sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50));
  }

  hasJob(name: string): boolean {
    return this.jobs.some((j) => j.name === name);
  }

  jobsList(): string[] {
    return this.jobs.map((j) => j.name);
  }

  setActivity(at = this.now()): void {
    this.state.lastActivity = at;
    this.save();
  }

  userIdleFor(): number {
    return Math.max(0, this.now() - this.state.lastActivity);
  }

  start(): void {
    if (this.timer) return;
    this.state.running = true;
    if (this.state.lastActivity === 0) this.state.lastActivity = this.now();
    this.save();
    this.timer = setInterval(() => {
      if (this.userIdleFor() < this.idleMs) return;
      void this.runCycle();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.state.running = false;
    this.save();
  }

  isEnabled(): boolean {
    return this.timer !== null;
  }

  charge(tokens: number, usd = 0): void {
    this.state.tokensToday += Math.max(0, tokens);
    this.state.usdToday += Math.max(0, usd);
    this.save();
  }

  canRun(): boolean {
    this.resetDayIfNeeded();
    if (this.state.cyclesToday >= this.maxCyclesPerDay) return false;
    if (this.state.tokensToday >= this.dailyTokenBudget) return false;
    if (this.state.usdToday >= this.dailyUsdBudget) return false;
    return this.jobs.length > 0;
  }

  async runCycle(): Promise<IdleArtifact[]> {
    if (!this.canRun()) return [];
    const created: IdleArtifact[] = [];
    const startedAt = this.now();
    const since = this.state.lastRun;
    this.state.cyclesToday += 1;
    this.state.totalCycles += 1;
    this.state.lastRun = startedAt;

    const ctx: IdleJobContext = {
      charge: (tokens, usd) => this.charge(tokens, usd),
      deadline: startedAt + this.cycleBudgetMs,
      since,
      now: this.now,
      expired: () => this.now() >= startedAt + this.cycleBudgetMs,
    };

    for (const job of this.jobs) {
      if (ctx.expired()) break;
      try {
        const tokensBefore = this.state.tokensToday;
        const result = await job.run(ctx);
        const normalized: IdleJobResult | null =
          typeof result === "string" ? (result.trim() ? { summary: result } : null) : result;
        if (normalized && normalized.summary.trim()) {
          const artifact: IdleArtifact = {
            at: this.now(),
            job: job.name,
            summary: normalized.summary.slice(0, 500),
            tokens: Math.max(0, normalized.tokens ?? 0),
            ...(normalized.usd ? { usd: normalized.usd } : {}),
          };
          created.push(artifact);
          this.state.artifacts.push(artifact);
          if (this.state.tokensToday === tokensBefore && artifact.tokens > 0) {
            this.charge(artifact.tokens, artifact.usd ?? 0);
          }
        }
      } catch {
        continue;
      }
    }

    if (this.state.artifacts.length > 200) this.state.artifacts = this.state.artifacts.slice(-200);
    this.save();
    return created;
  }

  pushProposal(proposal: string): void {
    const text = proposal.trim().slice(0, 300);
    if (!text) return;
    this.state.pendingProposals.push(text);
    if (this.state.pendingProposals.length > 3) this.state.pendingProposals = this.state.pendingProposals.slice(-3);
    this.save();
  }

  drainProposals(): string[] {
    const proposals = [...this.state.pendingProposals];
    this.state.pendingProposals = [];
    this.save();
    return proposals;
  }

  status(): IdleStatus {
    this.resetDayIfNeeded();
    const artifactsToday = this.state.artifacts.filter((a) => dayKey(a.at) === this.state.day).length;
    const yieldPerKToken =
      this.state.tokensToday > 0 ? artifactsToday / (this.state.tokensToday / 1000) : artifactsToday > 0 ? Infinity : 0;
    return {
      enabled: this.timer !== null,
      day: this.state.day,
      cyclesToday: this.state.cyclesToday,
      tokensToday: this.state.tokensToday,
      usdToday: this.state.usdToday,
      totalCycles: this.state.totalCycles,
      lastRun: this.state.lastRun,
      lastActivity: this.state.lastActivity,
      jobs: this.jobsList(),
      artifacts: this.state.artifacts.length,
      pendingProposals: [...this.state.pendingProposals],
      budgets: {
        tokens: this.dailyTokenBudget,
        usd: this.dailyUsdBudget,
        cycles: this.maxCyclesPerDay,
        cycleMs: this.cycleBudgetMs,
        idleMs: this.idleMs,
      },
      yieldPerKToken,
    };
  }

  recentArtifacts(limit = 10): IdleArtifact[] {
    return this.state.artifacts.slice(-limit).reverse();
  }

  clear(): void {
    this.state = { ...DEFAULT_STATE, day: dayKey(this.now()) };
    this.save();
  }
}

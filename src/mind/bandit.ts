import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import { clamp } from "./util.js";

export const STRATEGY_VARIANTS = ["standard", "direct", "verify", "clarify"] as const;
export type StrategyVariant = (typeof STRATEGY_VARIANTS)[number];

interface ArmStats {
  alpha: number;
  beta: number;
  pulls: number;
}

export interface BanditStats {
  contexts: number;
  arms: {
    strategy: string;
    variant: string;
    pulls: number;
    mean: number;
    posterior: number;
  }[];
  preferred: Record<string, StrategyVariant>;
}

export interface BanditOptions {
  path?: string;
  rng?: () => number;
}

export interface BanditRewardWeights {
  lambdaCost?: number;
  muLatency?: number;
  costRefUsd?: number;
  latencyRefMs?: number;
}

export const DEFAULT_BANDIT_REWARD_WEIGHTS: Required<BanditRewardWeights> = {
  lambdaCost: 0.2,
  muLatency: 0.1,
  costRefUsd: 0.1,
  latencyRefMs: 10_000,
};

export function banditContextKey(queryType: string, responseMode: string): string {
  const mode = responseMode.trim();
  return mode ? `${queryType}:${mode}` : queryType;
}

export function computeBanditReward(
  score: number,
  costUsd: number,
  latencyMs: number,
  weights: BanditRewardWeights = {},
): number {
  const w = { ...DEFAULT_BANDIT_REWARD_WEIGHTS, ...weights };
  const base = (clamp(score, -1, 1) + 1) / 2;
  const normCost = Math.min(1, Math.max(0, costUsd) / Math.max(1e-9, w.costRefUsd));
  const normLatency = Math.min(1, Math.max(0, latencyMs) / Math.max(1e-9, w.latencyRefMs));
  return clamp(base - w.lambdaCost * normCost - w.muLatency * normLatency, 0, 1);
}

function sampleNormal(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function sampleGamma(shape: number, rng: () => number): number {
  if (shape < 1) return sampleGamma(shape + 1, rng) * Math.pow(rng(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x = sampleNormal(rng);
    let v = 1 + c * x;
    while (v <= 0) {
      x = sampleNormal(rng);
      v = 1 + c * x;
    }
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function sampleBeta(alpha: number, beta: number, rng: () => number): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  return x + y === 0 ? 0.5 : x / (x + y);
}

const VARIANT_GUIDANCE: Record<StrategyVariant, string> = {
  standard: "",
  direct:
    "\n\n## Strategy Variant: Direct\n- Answer with the smallest sufficient response.\n- Prefer action over deliberation when the request is clear.",
  verify:
    "\n\n## Strategy Variant: Verify First\n- State the key assumption before answering.\n- Use a tool or a concrete check before making a factual claim.",
  clarify:
    "\n\n## Strategy Variant: Clarify\n- If the request is underspecified, ask one precise clarifying question before answering.\n- Otherwise answer directly.",
};

function defaultArm(variant: StrategyVariant): ArmStats {
  return variant === "standard" ? { alpha: 2, beta: 1, pulls: 0 } : { alpha: 1, beta: 1, pulls: 0 };
}

export class StrategyBandit {
  private table = new Map<string, Map<StrategyVariant, ArmStats>>();
  private explorationBoosts = new Map<string, number>();
  private loaded = false;
  private dirty = false;
  private readonly path: string;
  private readonly rng: () => number;

  constructor(options: BanditOptions = {}) {
    this.path = options.path ?? join(NTOX_DIR, "mind", "bandit.json");
    this.rng = options.rng ?? Math.random;
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf-8")) as Record<
        string,
        Partial<Record<StrategyVariant, ArmStats>>
      >;
      for (const [context, arms] of Object.entries(raw)) {
        const armMap = new Map<StrategyVariant, ArmStats>();
        for (const variant of STRATEGY_VARIANTS) {
          armMap.set(variant, arms[variant] ?? defaultArm(variant));
        }
        this.table.set(context, armMap);
      }
    } catch {
      this.table = new Map();
    }
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      if (!existsSync(dirname(this.path))) mkdirSync(dirname(this.path), { recursive: true });
      const raw: Record<string, Partial<Record<StrategyVariant, ArmStats>>> = {};
      for (const [context, arms] of this.table) {
        raw[context] = Object.fromEntries(arms) as Partial<Record<StrategyVariant, ArmStats>>;
      }
      writeFileSync(this.path, JSON.stringify(raw, null, 2));
    } catch {
      this.dirty = true;
    }
  }

  private ensure(context: string): Map<StrategyVariant, ArmStats> {
    let arms = this.table.get(context);
    if (!arms) {
      arms = new Map(STRATEGY_VARIANTS.map((variant) => [variant, defaultArm(variant)]));
      this.table.set(context, arms);
      this.dirty = true;
    }
    return arms;
  }

  bumpExploration(context: string, count = 1): void {
    this.explorationBoosts.set(context, (this.explorationBoosts.get(context) ?? 0) + Math.max(1, count));
  }

  explorationRemaining(context: string): number {
    return this.explorationBoosts.get(context) ?? 0;
  }

  select(context: string): StrategyVariant {
    this.load();
    const arms = this.ensure(context);
    const boost = this.explorationBoosts.get(context) ?? 0;
    if (boost > 0) {
      this.explorationBoosts.set(context, boost - 1);
      const index = Math.floor(this.rng() * STRATEGY_VARIANTS.length);
      const picked = STRATEGY_VARIANTS[index] ?? "standard";
      const arm = arms.get(picked) ?? defaultArm(picked);
      arm.pulls += 1;
      arms.set(picked, arm);
      this.dirty = true;
      return picked;
    }
    let best: StrategyVariant = "standard";
    let bestSample = -1;
    for (const variant of STRATEGY_VARIANTS) {
      const arm = arms.get(variant) ?? defaultArm(variant);
      const sample = sampleBeta(arm.alpha, arm.beta, this.rng);
      if (sample > bestSample) {
        bestSample = sample;
        best = variant;
      }
    }
    const selected = arms.get(best) ?? defaultArm(best);
    selected.pulls += 1;
    this.dirty = true;
    return best;
  }

  update(context: string, variant: StrategyVariant, reward: number): void {
    this.load();
    const arms = this.ensure(context);
    const arm = arms.get(variant) ?? defaultArm(variant);
    const r = clamp(reward, 0, 1);
    arm.alpha += r;
    arm.beta += 1 - r;
    arms.set(variant, arm);
    this.dirty = true;
  }

  guidance(variant: StrategyVariant): string {
    return VARIANT_GUIDANCE[variant] ?? "";
  }

  stats(): BanditStats {
    this.load();
    const arms: BanditStats["arms"] = [];
    const preferred: Record<string, StrategyVariant> = {};
    for (const [context, armMap] of this.table) {
      let best: StrategyVariant = "standard";
      let bestMean = -1;
      for (const variant of STRATEGY_VARIANTS) {
        const arm = armMap.get(variant) ?? defaultArm(variant);
        const mean = arm.alpha / (arm.alpha + arm.beta);
        arms.push({ strategy: context, variant, pulls: arm.pulls, mean, posterior: mean });
        if (arm.pulls > 0 && mean > bestMean) {
          bestMean = mean;
          best = variant;
        }
      }
      preferred[context] = best;
    }
    arms.sort((a, b) => b.pulls - a.pulls);
    return { contexts: this.table.size, arms, preferred };
  }

  clear(): void {
    this.load();
    this.table.clear();
    this.dirty = true;
    this.flush();
  }
}

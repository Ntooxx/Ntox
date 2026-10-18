import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import { clamp } from "./util.js";
import type { StrategyVariant } from "./bandit.js";

interface DomainStats {
  success: number;
  failure: number;
  corrections: number;
  lastSeen: number;
}

export interface CapabilityStats {
  domains: { domain: string; count: number; confidence: number; correctionRate: number }[];
}

export interface StanceDecision {
  variantOverride?: StrategyVariant;
  skipDebate: boolean;
  reason?: string;
}

export interface CapabilityOptions {
  path?: string;
  now?: () => number;
}

export class CapabilityModel {
  private domains = new Map<string, DomainStats>();
  private loaded = false;
  private dirty = false;
  private readonly path: string;
  private readonly now: () => number;

  constructor(options: CapabilityOptions = {}) {
    this.path = options.path ?? join(NTOX_DIR, "mind", "capability.json");
    this.now = options.now ?? Date.now;
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf-8")) as Record<string, DomainStats>;
      this.domains = new Map(Object.entries(raw));
    } catch {
      this.domains = new Map();
    }
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      if (!existsSync(dirname(this.path))) mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(Object.fromEntries(this.domains), null, 2));
    } catch {
      this.dirty = true;
    }
  }

  record(domains: string[], score: number): void {
    if (domains.length === 0) return;
    this.load();
    const positive = score >= 0.15;
    const negative = score <= -0.15;
    for (const domain of domains) {
      const entry = this.domains.get(domain) ?? { success: 0, failure: 0, corrections: 0, lastSeen: this.now() };
      if (positive) entry.success += 1;
      if (negative) entry.failure += 1;
      if (score <= -0.4) entry.corrections += 1;
      entry.lastSeen = this.now();
      this.domains.set(domain, entry);
    }
    this.dirty = true;
  }

  confidence(domain: string): number {
    this.load();
    const entry = this.domains.get(domain);
    if (!entry) return 0.5;
    const total = entry.success + entry.failure;
    if (total === 0) return 0.5;
    return clamp((entry.success + 1) / (total + 2), 0, 1);
  }

  guidance(domains: string[]): string {
    if (domains.length === 0) return "";
    const lines: string[] = [];
    for (const domain of domains.slice(0, 3)) {
      const entry = this.domains.get(domain);
      if (!entry || entry.success + entry.failure < 5) continue;
      const conf = this.confidence(domain);
      if (conf < 0.4)
        lines.push(
          `- Historical success in ${domain} is low (${Math.round(conf * 100)}%) — verify assumptions and check your work.`,
        );
      else if (conf > 0.75)
        lines.push(
          `- Historical success in ${domain} is high (${Math.round(conf * 100)}%) — you can be more direct here.`,
        );
    }
    if (lines.length === 0) return "";
    return `\n\n## Capability Notes\n${lines.join("\n")}`;
  }

  decideStance(domains: string[], selectedVariant: StrategyVariant, minSamples = 5): StanceDecision {
    this.load();
    const known: { domain: string; conf: number }[] = [];
    for (const domain of domains) {
      const entry = this.domains.get(domain);
      if (!entry) continue;
      if (entry.success + entry.failure < minSamples) continue;
      known.push({ domain, conf: this.confidence(domain) });
    }

    const skipDebate = known.length > 0 && known.every((k) => k.conf > 0.75);
    if (known.length === 0) {
      return { skipDebate: false };
    }

    const weakest = known.reduce((a, b) => (b.conf < a.conf ? b : a));
    if (weakest.conf < 0.4) {
      if (selectedVariant === "direct") {
        return {
          variantOverride: "clarify",
          skipDebate,
          reason: `low confidence in ${weakest.domain} (${Math.round(weakest.conf * 100)}%) — ask instead of guessing`,
        };
      }
      if (selectedVariant === "standard") {
        return {
          variantOverride: "verify",
          skipDebate,
          reason: `low confidence in ${weakest.domain} (${Math.round(weakest.conf * 100)}%) — check with a tool before asserting`,
        };
      }
      return { skipDebate, reason: `low confidence in ${weakest.domain} (${Math.round(weakest.conf * 100)}%)` };
    }

    return { skipDebate, reason: skipDebate ? "all known domains confident — debate cost not worth it" : undefined };
  }

  stats(): CapabilityStats {
    this.load();
    const domains = [...this.domains.entries()]
      .map(([domain, entry]) => {
        const total = entry.success + entry.failure;
        return {
          domain,
          count: total + entry.corrections,
          confidence: this.confidence(domain),
          correctionRate: total > 0 ? entry.corrections / Math.max(1, total) : 0,
        };
      })
      .sort((a, b) => b.count - a.count);
    return { domains };
  }

  clear(): void {
    this.load();
    this.domains.clear();
    this.dirty = true;
    this.flush();
  }
}

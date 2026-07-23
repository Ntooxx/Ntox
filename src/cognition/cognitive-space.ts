import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { COGNITION_DIR } from "../core/config.js";
import { ALL_DOMAINS as ALL_DOMAIN_NAMES } from "./domains.js";
import { cosineSimilarity as _cosineSimilarity } from "../utils/math.js";

const DIMS = 8;
const SPACE_PATH = join(COGNITION_DIR, "cognitive-space.json");

// Explicit similarity lookup
function targetSim(a: string, b: string): number {
  if (a === b) return 1.0;
  const map: Record<string, Record<string, number>> = {
    programming:     { python: 0.85, javascript: 0.85, rust: 0.80, data_science: 0.55, database: 0.55, devops: 0.60, system_admin: 0.50, writing: 0.25, design: 0.30 },
    python:          { javascript: 0.60, rust: 0.50, data_science: 0.85, database: 0.55, devops: 0.40, system_admin: 0.25, writing: 0.30, design: 0.25 },
    javascript:      { rust: 0.40, data_science: 0.40, database: 0.40, devops: 0.50, design: 0.65, writing: 0.30, system_admin: 0.25 },
    rust:            { data_science: 0.30, database: 0.25, devops: 0.55, system_admin: 0.45, design: 0.15, writing: 0.20 },
    data_science:    { database: 0.75, devops: 0.35, system_admin: 0.25, design: 0.30, writing: 0.50 },
    database:        { devops: 0.45, system_admin: 0.45, design: 0.20, writing: 0.20 },
    devops:          { system_admin: 0.80, design: 0.20, writing: 0.15 },
    system_admin:    { design: 0.10, writing: 0.10 },
    design:          { writing: 0.60 },
  };
  return map[a]?.[b] ?? map[b]?.[a] ?? 0.1;
}

export class CognitiveSpace {
  private domainVectors: Map<string, number[]> = new Map();
  private loaded = false;

  constructor() {
    if (!existsSync(COGNITION_DIR)) {
      mkdirSync(COGNITION_DIR, { recursive: true });
    }
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;

    if (existsSync(SPACE_PATH)) {
      try {
        const raw = JSON.parse(readFileSync(SPACE_PATH, "utf-8"));
        if (raw.domains && raw.vectors && raw.vectors.length === ALL_DOMAIN_NAMES.length) {
          for (let i = 0; i < ALL_DOMAIN_NAMES.length; i++) {
            this.domainVectors.set(ALL_DOMAIN_NAMES[i], raw.vectors[i]);
          }
          return;
        }
      } catch {
        // fall through
      }
    }

    this.initializeVectors();
    this.persist();
  }

  private persist(): void {
    if (!existsSync(COGNITION_DIR)) {
      mkdirSync(COGNITION_DIR, { recursive: true });
    }
    writeFileSync(SPACE_PATH, JSON.stringify({
      domains: ALL_DOMAIN_NAMES,
      vectors: ALL_DOMAIN_NAMES.map((d) => this.domainVectors.get(d)),
    }));
  }

  private initializeVectors(): void {
    // Start with random vectors
    for (const domain of ALL_DOMAIN_NAMES) {
      const vec = new Array(DIMS);
      for (let i = 0; i < DIMS; i++) vec[i] = Math.random() - 0.5;
      const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
      for (let i = 0; i < DIMS; i++) vec[i] /= mag;
      this.domainVectors.set(domain, vec);
    }

    // Gradient descent to match target similarities
    for (let iter = 0; iter < 500; iter++) {
      let totalError = 0;
      const updates = new Map<string, number[]>();
      for (const d of ALL_DOMAIN_NAMES) updates.set(d, new Array(DIMS).fill(0));

      for (let i = 0; i < ALL_DOMAIN_NAMES.length; i++) {
        for (let j = i + 1; j < ALL_DOMAIN_NAMES.length; j++) {
          const a = ALL_DOMAIN_NAMES[i], b = ALL_DOMAIN_NAMES[j];
          const va = this.domainVectors.get(a)!;
          const vb = this.domainVectors.get(b)!;

          const current = this.cosineSimilarity(va, vb);
          const target = targetSim(a, b);
          const error = current - target;
          totalError += error * error;

          // Gradient: d(error^2)/d(va) = 2 * error * (vb - current * va) / |va|
          // Simplified: push vectors toward/away from each other
          const alpha = 0.01;
          for (let k = 0; k < DIMS; k++) {
            updates.get(a)![k] += alpha * error * (vb[k] - current * va[k]);
            updates.get(b)![k] += alpha * error * (va[k] - current * vb[k]);
          }
        }
      }

      // Apply updates
      for (const [domain, delta] of updates) {
        const vec = this.domainVectors.get(domain)!;
        for (let k = 0; k < DIMS; k++) vec[k] -= delta[k];
        const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
        for (let k = 0; k < DIMS; k++) vec[k] /= mag;
      }

      if (totalError < 0.01) break;
    }
  }

  cosineSimilarity(a: number[], b: number[]): number {
    return _cosineSimilarity(a, b);
  }

  getDomainVector(domain: string): number[] {
    this.load();
    return this.domainVectors.get(domain) ?? new Array(DIMS).fill(0);
  }

  computeQueryVector(domains: string[]): number[] {
    this.load();
    if (domains.length === 0) return new Array(DIMS).fill(0);

    const vec = new Array(DIMS).fill(0);
    let count = 0;

    for (const domain of domains) {
      const dv = this.domainVectors.get(domain);
      if (dv) {
        for (let i = 0; i < DIMS; i++) vec[i] += dv[i];
        count++;
      }
    }

    if (count > 0) {
      const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
      if (mag > 0) for (let i = 0; i < DIMS; i++) vec[i] /= mag;
    }

    return vec;
  }

  getDomainRelationships(domain: string): Record<string, number> {
    this.load();
    const vec = this.domainVectors.get(domain);
    if (!vec) return {};

    const rels: Record<string, number> = {};
    for (const [other, otherVec] of this.domainVectors) {
      if (other !== domain) {
        rels[other] = this.cosineSimilarity(vec, otherVec);
      }
    }
    return Object.fromEntries(Object.entries(rels).sort(([, a], [, b]) => b - a));
  }
}

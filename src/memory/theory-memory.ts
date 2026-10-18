import {
  recordObservation,
  getTheoryHierarchy,
  extractObservationFromEpisode,
  loadTheoryStore,
  makeTheoryPrediction,
} from "../research/theory-store.js";
import { localEmbed } from "../core/local-embed.js";
import { cosineSimilarity } from "../utils/math.js";
import type { Episode } from "../types/index.js";

const THEORY_MATCH_MIN_SIM = 0.2;
const PATTERN_MATCH_MIN_SIM = 0.15;
const MAX_PATTERN_LINES = 3;

export interface TheoryPromptItem {
  id: string;
  kind: "theory" | "pattern";
  text: string;
  relevance: number;
}

export function renderTheoryItems(items: TheoryPromptItem[]): string {
  const theories = items.filter((item) => item.kind === "theory").map((item) => item.text);
  const patterns = items.filter((item) => item.kind === "pattern").map((item) => item.text);
  const parts: string[] = [];
  if (theories.length > 0) parts.push("## Learned Knowledge\n" + theories.join("\n"));
  if (patterns.length > 0) parts.push("## Observed Patterns\n" + patterns.join("\n"));
  return parts.length > 0 ? "\n\n" + parts.join("\n\n") : "";
}

export class TheoryMemory {
  private initialized = false;
  private processedIds = new Set<string>();
  private lastPredictionAt = new Map<string, number>();
  private predictionThrottleMs = 30 * 60 * 1000;

  constructor() {
    loadTheoryStore();
    this.initialized = true;
  }

  processEpisode(episode: Episode): void {
    if (!this.initialized || !episode.id) return;
    if (this.processedIds.has(episode.id)) return;
    this.processedIds.add(episode.id);
    if (this.processedIds.size > 2000) {
      const ids = [...this.processedIds];
      this.processedIds = new Set(ids.slice(-2000));
    }
    const extracted = extractObservationFromEpisode(episode.userMessage, episode.assistantResponse);
    if (extracted) {
      recordObservation(extracted.description, extracted.domain, 0.3);
    }
  }

  processEpisodesBulk(episodes: Episode[], max: number = 20): number {
    if (!this.initialized) return 0;
    let count = 0;
    const recent = episodes.slice(-max);
    for (const ep of recent) {
      if (!ep.id) continue;
      if (this.processedIds.has(ep.id)) continue;
      this.processedIds.add(ep.id);
      const extracted = extractObservationFromEpisode(ep.userMessage, ep.assistantResponse);
      if (extracted) {
        recordObservation(extracted.description, extracted.domain, 0.2);
        count++;
      }
    }
    return count;
  }

  buildTheoryItems(query: string): TheoryPromptItem[] {
    if (!this.initialized) return [];
    const hierarchy = getTheoryHierarchy();
    const queryEmbedding = localEmbed(query);
    const items: TheoryPromptItem[] = [];

    const confirmed = hierarchy.theories
      .filter((t) => t.confirmed)
      .map((t) => ({
        t,
        sim: cosineSimilarity(queryEmbedding, t.embedding || localEmbed(t.name + " " + t.explanation)),
      }))
      .filter((s) => s.sim >= THEORY_MATCH_MIN_SIM)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 1);

    if (confirmed.length > 0) {
      const { t, sim } = confirmed[0];
      const now = Date.now();
      const lastPrediction = this.lastPredictionAt.get(t.id) ?? 0;
      if (now - lastPrediction > this.predictionThrottleMs) {
        this.lastPredictionAt.set(t.id, now);
        makeTheoryPrediction(
          t.id,
          `Applying "${t.name.replace("Theory: ", "")}" reasoning to "${query.slice(0, 120)}" leads to a better outcome than generic reasoning`,
          t.confidence,
        );
      }
      items.push({
        id: t.id,
        kind: "theory",
        text: `- ${t.name}: ${t.explanation} [confirmed]`,
        relevance: sim,
      });
      return items;
    }

    if (hierarchy.patterns.length > 0) {
      const scored = hierarchy.patterns
        .map((p) => ({
          p,
          sim: cosineSimilarity(queryEmbedding, p.embedding || localEmbed(p.generalization)),
        }))
        .filter((s) => s.sim >= PATTERN_MATCH_MIN_SIM)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, MAX_PATTERN_LINES);

      for (const { p, sim } of scored) {
        items.push({
          id: p.id,
          kind: "pattern",
          text: `- ${p.name}: ${p.generalization.slice(0, 150)}`,
          relevance: sim,
        });
      }
    }

    return items;
  }

  buildTheoryContext(query: string): string {
    return renderTheoryItems(this.buildTheoryItems(query));
  }

  getStats(): { observations: number; patterns: number; theories: number; confirmedTheories: number } {
    const h = getTheoryHierarchy();
    return {
      observations: h.observations.length,
      patterns: h.patterns.length,
      theories: h.theories.length,
      confirmedTheories: h.theories.filter((t) => t.confirmed).length,
    };
  }
}

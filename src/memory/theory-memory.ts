import { recordObservation, getTheoryHierarchy, extractObservationFromEpisode, loadTheoryStore } from "../research/theory-store.js";
import type { Episode } from "../types/index.js";

export class TheoryMemory {
  private initialized = false;
  private processedIds = new Set<string>();

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

  buildTheoryContext(query: string): string {
    if (!this.initialized) return "";
    const hierarchy = getTheoryHierarchy();

    const parts: string[] = [];

    if (hierarchy.theories.length > 0) {
      const qWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const scored = hierarchy.theories
        .map((t) => {
          const tText = (t.name + " " + t.explanation).toLowerCase();
          let score = 0;
          for (const w of qWords) if (tText.includes(w)) score++;
          return { t, score };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      if (scored.length > 0) {
        const theoryLines = scored.map(({ t }) => {
          const status = t.confirmed ? "[confirmed]" : "[unconfirmed]";
          return `- ${t.name}: ${t.explanation} ${status}`;
        });
        parts.push("## Learned Knowledge\n" + theoryLines.join("\n"));
      }
    }

    if (hierarchy.patterns.length > 0 && parts.length === 0) {
      const topPatterns = hierarchy.patterns.slice(-3).reverse();
      const patternLines = topPatterns.map((p) => `- ${p.name}: ${p.generalization.slice(0, 150)}`);
      parts.push("## Observed Patterns\n" + patternLines.join("\n"));
    }

    return parts.length > 0 ? "\n\n" + parts.join("\n\n") : "";
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

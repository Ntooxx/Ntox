import { describe, it, expect } from "vitest";
import { FounderIntelligence } from "./founder.js";
import type { ObservedSession } from "./observation.js";
import type { MentalModelEntry } from "./mental-model.js";
import type { ExecGoal } from "./executive.js";

function makeObs(topics: string[], hour: number = 10, intent: string = "casual"): ObservedSession {
  const now = new Date();
  now.setHours(hour, 0, 0, 0);
  return {
    id: `obs_${Math.random().toString(36).slice(2, 8)}`,
    sessionId: "test",
    timestamp: now.getTime(),
    topics,
    toolUsage: {},
    durationMinutes: 15,
    messageCount: 3,
    correctionsCount: 0,
    sentiment: "neutral",
    sentimentScore: 0,
    energy: "medium",
    sessionIntent: intent,
  };
}

function makeBelief(statement: string, mentionCount: number = 3, status: "active" | "challenged" = "active"): MentalModelEntry {
  return {
    id: `mm_${Math.random().toString(36).slice(2, 8)}`,
    statement,
    category: "opinion",
    firstSeen: Date.now() - 86400000,
    lastSeen: Date.now(),
    mentionCount,
    sourceContext: "",
    contradictions: [],
    status,
  };
}

function makeGoal(description: string): ExecGoal {
  return {
    id: `goal_${Math.random().toString(36).slice(2, 8)}`,
    description,
    category: "general",
    priority: "medium",
    statedAt: Date.now(),
    status: "active",
    progress: 0,
    lastMentioned: Date.now(),
  };
}

describe("FounderIntelligence", () => {
  const fi = new FounderIntelligence();

  describe("analyzePatterns", () => {
    it("returns empty for few observations", () => {
      const obs = Array.from({ length: 5 }, () => makeObs(["topic"]));
      expect(fi.analyzePatterns(obs)).toHaveLength(0);
    });

    it("detects morning focus pattern", () => {
      const obs = Array.from({ length: 12 }, () => makeObs(["coding"], 9));
      const patterns = fi.analyzePatterns(obs);
      expect(patterns.some((p) => p.id === "pat_morning_focus")).toBe(true);
    });

    it("detects evening focus pattern", () => {
      const obs = Array.from({ length: 12 }, () => makeObs(["coding"], 20));
      const patterns = fi.analyzePatterns(obs);
      expect(patterns.some((p) => p.id === "pat_evening_focus")).toBe(true);
    });

    it("detects dominant topics", () => {
      const obs = Array.from({ length: 15 }, (_, i) =>
        makeObs(i < 10 ? ["refactoring"] : ["testing"])
      );
      const patterns = fi.analyzePatterns(obs);
      expect(patterns.some((p) => p.description.includes("refactoring"))).toBe(true);
    });

    it("detects heavy tool usage", () => {
      const obs = Array.from({ length: 12 }, () =>
        makeObs(["coding"], 10)
      );
      obs.forEach((o) => { o.toolUsage = { read: 5, write: 3 }; });
      const patterns = fi.analyzePatterns(obs);
      expect(patterns.some((p) => p.id === "pat_tool_read")).toBe(true);
    });

    it("detects high correction rate", () => {
      const obs = Array.from({ length: 12 }, (_, i) => {
        const o = makeObs(["coding"]);
        o.correctionsCount = i < 4 ? 1 : 0;
        return o;
      });
      const patterns = fi.analyzePatterns(obs);
      expect(patterns.some((p) => p.id === "pat_high_corrections")).toBe(true);
    });
  });

  describe("surfaceInsights", () => {
    it("returns empty for few observations", () => {
      const obs = Array.from({ length: 5 }, () => makeObs(["topic"]));
      expect(fi.surfaceInsights(obs, [])).toHaveLength(0);
    });

    it("detects topic concentration", () => {
      const obs = Array.from({ length: 25 }, (_, i) =>
        makeObs(i < 10 ? ["coding"] : i < 18 ? ["testing"] : ["deployment"])
      );
      const insights = fi.surfaceInsights(obs, []);
      expect(insights.some((i) => i.pattern === "topic_concentration")).toBe(true);
    });

    it("detects belief evolution", () => {
      const beliefs = [
        makeBelief("monoliths are better", 3, "challenged"),
        makeBelief("microservices scale better", 3, "challenged"),
      ];
      const obs = Array.from({ length: 15 }, () => makeObs(["architecture"]));
      const insights = fi.surfaceInsights(obs, beliefs);
      expect(insights.some((i) => i.pattern === "belief_evolution")).toBe(true);
    });

    it("detects strong convictions", () => {
      const beliefs = [
        makeBelief("testing is essential", 7),
        makeBelief("code review matters", 5),
      ];
      const obs = Array.from({ length: 15 }, () => makeObs(["coding"]));
      const insights = fi.surfaceInsights(obs, beliefs);
      expect(insights.some((i) => i.pattern === "strong_convictions")).toBe(true);
    });
  });

  describe("detectDecisionTendencies", () => {
    it("returns empty for few observations", () => {
      const obs = Array.from({ length: 3 }, () => makeObs(["topic"]));
      expect(fi.detectDecisionTendencies(obs)).toHaveLength(0);
    });

    it("detects dominant intent", () => {
      const obs = Array.from({ length: 12 }, () => makeObs(["coding"], 10, "deep-work"));
      const tendencies = fi.detectDecisionTendencies(obs);
      expect(tendencies.some((t) => t.includes("deep-work"))).toBe(true);
    });

    it("detects long sessions", () => {
      const obs = Array.from({ length: 12 }, () => {
        const o = makeObs(["coding"]);
        o.durationMinutes = 45;
        return o;
      });
      const tendencies = fi.detectDecisionTendencies(obs);
      expect(tendencies.some((t) => t.includes("deep blocks"))).toBe(true);
    });

    it("detects short sessions", () => {
      const obs = Array.from({ length: 12 }, () => {
        const o = makeObs(["coding"]);
        o.durationMinutes = 5;
        return o;
      });
      const tendencies = fi.detectDecisionTendencies(obs);
      expect(tendencies.some((t) => t.includes("quick bursts"))).toBe(true);
    });
  });

  describe("detectBlindSpots", () => {
    it("returns empty for few observations", () => {
      const obs = Array.from({ length: 5 }, () => makeObs(["topic"]));
      expect(fi.detectBlindSpots(obs, [])).toHaveLength(0);
    });

    it("detects goals with no matching sessions", () => {
      const goals = [makeGoal("launch Sentinel")];
      const obs = Array.from({ length: 15 }, () => makeObs(["css styling", "animations"]));
      const blindSpots = fi.detectBlindSpots(obs, goals);
      expect(blindSpots.some((b) => b.includes("launch Sentinel"))).toBe(true);
    });

    it("detects abandoned topics", () => {
      const goals = [makeGoal("launch Sentinel")];
      const oldObs = Array.from({ length: 12 }, () => makeObs(["backend", "database", "api design", "server config"]));
      const newObs = Array.from({ length: 12 }, () => makeObs(["frontend", "css"]));
      const blindSpots = fi.detectBlindSpots([...oldObs, ...newObs], goals);
      expect(blindSpots.some((b) => b.includes("backend") || b.includes("database"))).toBe(true);
    });

    it("returns empty when goals have matching sessions", () => {
      const goals = [makeGoal("launch Sentinel")];
      const obs = Array.from({ length: 15 }, () => makeObs(["launch sentinel", "github"]));
      const blindSpots = fi.detectBlindSpots(obs, goals);
      expect(blindSpots).toHaveLength(0);
    });
  });
});
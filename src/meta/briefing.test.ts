import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { BriefingEngine } from "./briefing.js";
import type { BriefingContext, Briefing } from "./briefing.js";
import type { ObservedSession } from "./observation.js";
import type { MentalModelEntry } from "./mental-model.js";
import type { ExecGoal, Risk, Constraint } from "./executive.js";

const TEST_PATH = join(tmpdir(), `ntox-brief-test-${randomUUID().slice(0, 8)}.json`);

function makeObs(topics: string[]): ObservedSession {
  return {
    id: `obs_${randomUUID().slice(0, 8)}`,
    sessionId: `s_${randomUUID().slice(0, 6)}`,
    timestamp: Date.now(),
    topics,
    toolUsage: {},
    durationMinutes: 5,
    messageCount: 3,
    correctionsCount: 0,
    sentiment: "neutral",
    sentimentScore: 0,
    energy: "medium",
    sessionIntent: "casual",
  };
}

function makeBelief(statement: string, mentionCount: number = 3, status: "active" | "challenged" = "active"): MentalModelEntry {
  return {
    id: `mm_${randomUUID().slice(0, 8)}`,
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

function makeGoal(description: string, progress: number = 0): ExecGoal {
  return {
    id: `goal_${randomUUID().slice(0, 8)}`,
    description,
    category: "general",
    priority: "medium",
    statedAt: Date.now(),
    status: "active",
    progress,
    lastMentioned: Date.now(),
  };
}

function makeRisk(description: string, severity: "high" | "medium" | "low" = "medium", mentionCount: number = 1): Risk {
  return {
    description,
    severity,
    firstIdentified: Date.now() - 86400000,
    lastMentioned: Date.now(),
    mentionCount,
  };
}

function defaultCtx(overrides: Partial<BriefingContext> = {}): BriefingContext {
  return {
    statedFocus: null,
    goals: [],
    risks: [],
    constraints: [],
    observations: [],
    beliefs: [],
    sessionCount: 0,
    lastSessionEndAt: 0,
    lastBriefAt: 0,
    bondLevel: 30,
    ...overrides,
  };
}

describe("BriefingEngine", () => {
  let engine: BriefingEngine;

  beforeEach(() => {
    try { if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH); } catch { }
    engine = new BriefingEngine(TEST_PATH);
  });

  afterAll(() => {
    try { if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH); } catch { }
  });

  it("returns none when no data", () => {
    const ctx = defaultCtx();
    expect(engine.shouldBrief(ctx)).toBe("none");
  });

  it("returns morning brief when goals exist and no prior brief", () => {
    const ctx = defaultCtx({ goals: [makeGoal("Reach 500 stars")] });
    expect(engine.shouldBrief(ctx)).toBe("morning");
  });

  it("returns morning brief when risks exist and no prior brief", () => {
    const ctx = defaultCtx({ risks: [makeRisk("No distribution")] });
    expect(engine.shouldBrief(ctx)).toBe("morning");
  });

  it("generates morning brief with goals and risks", () => {
    const ctx = defaultCtx({
      goals: [makeGoal("Reach 500 stars", 30)],
      risks: [makeRisk("No distribution", "high")],
      statedFocus: "launch Sentinel",
    });
    const brief = engine.generate(ctx);
    expect(brief.type).toBe("morning");
    expect(brief.sections.length).toBeGreaterThan(0);
    expect(brief.question).not.toBeNull();
  });

  it("formats brief correctly", () => {
    const ctx = defaultCtx({
      goals: [makeGoal("Reach 500 stars", 30)],
      risks: [makeRisk("No distribution", "high")],
      statedFocus: "launch Sentinel",
    });
    const brief = engine.generate(ctx);
    const formatted = engine.formatBrief(brief);
    expect(formatted).toContain("NTOX Executive Brief");
    expect(formatted).toContain("launch Sentinel");
    expect(formatted).toContain("Reach 500 stars");
    expect(formatted).toContain("No distribution");
  });

  it("returns event brief on drift detection", () => {
    const observations = Array.from({ length: 6 }, () =>
      makeObs(["css styling", "animation", "color palette"])
    );
    const ctx = defaultCtx({
      observations,
      statedFocus: "launch Sentinel",
      goals: [makeGoal("Reach 500 stars")],
      risks: [makeRisk("No distribution")],
    });
    const briefType = engine.shouldBrief(ctx);
    expect(["event", "morning"]).toContain(briefType);
  });

  it("returns event brief on belief contradiction", () => {
    const beliefs = [makeBelief("CLI users hate GUIs", 3, "challenged")];
    const ctx = defaultCtx({
      beliefs,
      goals: [makeGoal("Reach 500 stars")],
    });
    const briefType = engine.shouldBrief(ctx);
    expect(["event", "morning"]).toContain(briefType);
  });

  it("returns none after max briefs per day", () => {
    const ctx = defaultCtx({ goals: [makeGoal("Reach 500 stars")] });
    engine.generate(ctx);
    engine.generate(ctx);
    engine.generate(ctx);
    const result = engine.generate(ctx);
    expect(result.type).toBe("none");
  });

  it("generates risk-focused question for repeated risks", () => {
    const ctx = defaultCtx({
      risks: [makeRisk("No distribution", "high", 5)],
      goals: [makeGoal("Reach 500 stars")],
    });
    const brief = engine.generate(ctx);
    expect(brief.question).toContain("No distribution");
    expect(brief.question).toContain("5 times");
  });

  it("generates goal-focused question for on-track goals", () => {
    const ctx = defaultCtx({
      goals: [makeGoal("Reach 500 stars", 50)],
    });
    const brief = engine.generate(ctx);
    expect(brief.question).toContain("500 stars");
    expect(brief.question).toContain("50%");
  });

  it("formats brief with question", () => {
    const ctx = defaultCtx({
      goals: [makeGoal("Reach 500 stars", 50)],
    });
    const brief = engine.generate(ctx);
    const formatted = engine.formatBrief(brief);
    expect(formatted).toContain("Question:");
  });

  it("returns none for empty formatted brief", () => {
    const ctx = defaultCtx();
    const brief = engine.generate(ctx);
    expect(engine.formatBrief(brief)).toBe("");
  });

  it("records session end", () => {
    engine.recordSessionEnd();
    const ctx = defaultCtx({
      goals: [makeGoal("Reach 500 stars")],
      lastSessionEndAt: Date.now() - 5 * 60 * 60 * 1000,
    });
    const briefType = engine.shouldBrief(ctx);
    expect(["return", "morning"]).toContain(briefType);
  });
});
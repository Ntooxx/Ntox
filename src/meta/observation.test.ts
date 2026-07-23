import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ObservationEngine } from "./observation.js";
import type { Message, UserProfile } from "../types/index.js";

const TEST_PATH = join(tmpdir(), `ntox-obs-test-${randomUUID().slice(0, 8)}.json`);

function defaultProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    name: "",
    expertise: {},
    preferences: { verbosity: "balanced", technicalLevel: "intermediate", tone: "adaptive", codeExamples: "when-helpful" },
    goals: [],
    patterns: { averageMessageLength: 0, totalMessages: 0, correctionsReceived: 0, prefersCodeBlocks: false, prefersBulletPoints: false },
    domains: [],
    lastActive: Date.now(),
    sessionsCount: 0,
    createdAt: Date.now(),
    communicationStyle: "adaptive",
    learningStyle: "adaptive",
    timezone: "UTC",
    moodHistory: [],
    personalVocabulary: [],
    projectAssociations: [],
    closenessScore: 0,
    lastSessionEnd: Date.now(),
    ...overrides,
  };
}

function makeMessages(texts: string[], role: "user" | "assistant" = "user"): Message[] {
  return texts.map((content) => ({ role, content }));
}

describe("ObservationEngine", () => {
  let engine: ObservationEngine;

  beforeEach(() => {
    try { if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH); } catch { }
    engine = new ObservationEngine(TEST_PATH);
  });

  afterAll(() => {
    try { if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH); } catch { }
  });

  it("starts with empty observations", () => {
    expect(engine.getRecent()).toEqual([]);
    expect(engine.getRecent(5)).toEqual([]);
  });

  it("records a session and returns observation", () => {
    const profile = defaultProfile({ moodHistory: [{ timestamp: Date.now(), sentiment: "neutral", energy: "medium", score: 0 }] });
    const messages = makeMessages(["fix the login bug in the auth module"]);
    const obs = engine.recordSession({
      sessionId: "test-001",
      messages,
      toolUsage: { read: 2, write: 1 },
      sessionIntent: "debugging",
      correctionsCount: 0,
      sessionStartTime: Date.now() - 120000,
      userProfile: profile,
    });

    expect(obs.sessionId).toBe("test-001");
    expect(obs.messageCount).toBe(1);
    expect(obs.durationMinutes).toBe(2);
    expect(obs.toolUsage["read"]).toBe(2);
    expect(obs.toolUsage["write"]).toBe(1);
    expect(obs.topics.length).toBeGreaterThan(0);
    expect(obs.topics.some((t) => t.includes("login"))).toBe(true);
  });

  it("extracts topics from multiple messages", () => {
    const profile = defaultProfile();
    const messages = makeMessages([
      "debug the database connection timeout",
      "the query optimizer is causing slow responses",
      "add an index on the user table",
    ]);
    const obs = engine.recordSession({
      sessionId: "test-002",
      messages,
      toolUsage: {},
      sessionIntent: "debugging",
      correctionsCount: 0,
      sessionStartTime: Date.now(),
      userProfile: profile,
    });

    expect(obs.topics.length).toBeGreaterThanOrEqual(2);
  });

  it("returns recent observations in insertion order", () => {
    const profile = defaultProfile();
    engine.recordSession({
      sessionId: "s1", messages: makeMessages(["first task"]), toolUsage: {},
      sessionIntent: "casual", correctionsCount: 0, sessionStartTime: Date.now(), userProfile: profile,
    });
    engine.recordSession({
      sessionId: "s2", messages: makeMessages(["second task"]), toolUsage: {},
      sessionIntent: "casual", correctionsCount: 0, sessionStartTime: Date.now(), userProfile: profile,
    });

    const recent = engine.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].sessionId).toBe("s1");
    expect(recent[1].sessionId).toBe("s2");
  });

  it("filters by topic", () => {
    const profile = defaultProfile();
    engine.recordSession({
      sessionId: "s1", messages: makeMessages(["debugging the database connection"]), toolUsage: {},
      sessionIntent: "debugging", correctionsCount: 0, sessionStartTime: Date.now(), userProfile: profile,
    });
    engine.recordSession({
      sessionId: "s2", messages: makeMessages(["designing the landing page layout"]), toolUsage: {},
      sessionIntent: "deep-work", correctionsCount: 0, sessionStartTime: Date.now(), userProfile: profile,
    });

    const results = engine.getByTopic("database");
    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe("s1");
  });

  it("calculates pattern frequency over a window", () => {
    const profile = defaultProfile();
    for (let i = 0; i < 10; i++) {
      const text = i < 6 ? "working on the parser module" : "designing the landing page";
      engine.recordSession({
        sessionId: `s${i}`, messages: makeMessages([text]), toolUsage: {},
        sessionIntent: "deep-work", correctionsCount: 0, sessionStartTime: Date.now(), userProfile: profile,
      });
    }

    const pattern = engine.getPattern("parser", 10);
    expect(pattern.frequency).toBe(6);
    expect(pattern.total).toBe(10);
  });

  it("calculates consecutive streak for a topic", () => {
    const profile = defaultProfile();
    for (let i = 0; i < 4; i++) {
      engine.recordSession({
        sessionId: `s${i}`, messages: makeMessages(["building the database schema"]), toolUsage: {},
        sessionIntent: "deep-work", correctionsCount: 0, sessionStartTime: Date.now(), userProfile: profile,
      });
    }
    engine.recordSession({
      sessionId: "break", messages: makeMessages(["designing the landing page"]), toolUsage: {},
      sessionIntent: "deep-work", correctionsCount: 0, sessionStartTime: Date.now(), userProfile: profile,
    });
    for (let i = 0; i < 2; i++) {
      engine.recordSession({
        sessionId: `s${i + 5}`, messages: makeMessages(["back to the database work"]), toolUsage: {},
        sessionIntent: "deep-work", correctionsCount: 0, sessionStartTime: Date.now(), userProfile: profile,
      });
    }

    const streak = engine.getStreak("database");
    expect(streak).toBe(2);
  });

  it("returns stats", () => {
    const profile = defaultProfile();
    engine.recordSession({
      sessionId: "s1", messages: makeMessages(["debugging the auth flow"]), toolUsage: {},
      sessionIntent: "debugging", correctionsCount: 0, sessionStartTime: Date.now(), userProfile: profile,
    });

    const stats = engine.getStats();
    expect(stats.total).toBe(1);
    expect(stats.topics.length).toBeGreaterThan(0);
  });

  it("clears all observations", () => {
    const profile = defaultProfile();
    engine.recordSession({
      sessionId: "s1", messages: makeMessages(["something"]), toolUsage: {},
      sessionIntent: "casual", correctionsCount: 0, sessionStartTime: Date.now(), userProfile: profile,
    });
    expect(engine.getRecent()).toHaveLength(1);

    engine.clearAll();
    expect(engine.getRecent()).toHaveLength(0);
  });

  it("persists observations across engine instances", () => {
    const profile = defaultProfile();
    const e1 = new ObservationEngine(TEST_PATH);
    e1.recordSession({
      sessionId: "persist-test", messages: makeMessages(["testing persistence"]), toolUsage: {},
      sessionIntent: "casual", correctionsCount: 0, sessionStartTime: Date.now(), userProfile: profile,
    });

    const e2 = new ObservationEngine(TEST_PATH);
    const recent = e2.getRecent();
    expect(recent).toHaveLength(1);
    expect(recent[0].sessionId).toBe("persist-test");
  });

  it("records wasCorrection true when corrections exist", () => {
    const profile = defaultProfile({ moodHistory: [{ timestamp: Date.now(), sentiment: "neutral", energy: "medium", score: 0 }] });
    const obs = engine.recordSession({
      sessionId: "corr-test", messages: makeMessages(["no, that is wrong"]), toolUsage: {},
      sessionIntent: "debugging", correctionsCount: 2, sessionStartTime: Date.now(), userProfile: profile,
    });

    expect(obs.correctionsCount).toBe(2);
    expect(obs.correctionsCount > 0).toBe(true);
  });

  it("extracts sentiment from user profile mood history", () => {
    const profile = defaultProfile({
      moodHistory: [
        { timestamp: Date.now(), sentiment: "frustrated", energy: "high", score: -0.5 },
        { timestamp: Date.now() - 1000, sentiment: "frustrated", energy: "high", score: -0.4 },
        { timestamp: Date.now() - 2000, sentiment: "neutral", energy: "medium", score: 0 },
      ],
    });
    const obs = engine.recordSession({
      sessionId: "mood-test", messages: makeMessages(["this is not working"]), toolUsage: {},
      sessionIntent: "debugging", correctionsCount: 0, sessionStartTime: Date.now(), userProfile: profile,
    });

    expect(obs.sentiment).toBe("frustrated");
  });

  it("limits observations to 1000", { timeout: 30000 }, () => {
    const profile = defaultProfile();
    for (let i = 0; i < 1010; i++) {
      engine.recordSession({
        sessionId: `s${i}`, messages: makeMessages([`session ${i}`]), toolUsage: {},
        sessionIntent: "casual", correctionsCount: 0, sessionStartTime: Date.now(), userProfile: profile,
      });
    }
    expect(engine.getStats().total).toBe(1000);
  });
});
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { isUserCorrection, extractCorrection, MistakeJournal } from "./mistakes.js";
import { MISTAKES_PATH } from "../core/config.js";

describe("isUserCorrection", () => {
  it("detects corrections", () => {
    expect(isUserCorrection("no that's wrong")).toBe(true);
    expect(isUserCorrection("actually, it's not correct")).toBe(true);
    expect(isUserCorrection("you're incorrect about that")).toBe(true);
    expect(isUserCorrection("that's not right, the answer is 42")).toBe(true);
    expect(isUserCorrection("I think you're confused")).toBe(true);
  });

  it("does not flag normal messages", () => {
    expect(isUserCorrection("hello")).toBe(false);
    expect(isUserCorrection("what is the weather")).toBe(false);
    expect(isUserCorrection("please write a function")).toBe(false);
  });
});

describe("extractCorrection", () => {
  it("extracts topic and correction", () => {
    const r = extractCorrection("actually the Earth is round, not flat", "The Earth is flat");
    expect(r.topicKey).toBeDefined();
    expect(r.correction.length).toBeGreaterThan(0);
  });

  it("extracts topic with 'about' prefix", () => {
    const r = extractCorrection("no, that's wrong about 'gravity' — it pulls, not pushes", "gravity pushes");
    expect(r.topicKey).toContain("gravity");
  });
});

describe("MistakeJournal", () => {
  afterEach(() => {
    if (existsSync(MISTAKES_PATH)) unlinkSync(MISTAKES_PATH);
  });

  it("adds and retrieves mistakes", () => {
    const j = new MistakeJournal();
    j.add("topic1", "what is x", "x is 1", "x is 2", "user-correction");
    expect(j.getAll().length).toBe(1);
  });

  it("finds relevant mistakes by query", () => {
    const j = new MistakeJournal();
    j.add("gravity", "what is gravity", "pushing force", "pulling force", "user-correction");
    j.add("magnetism", "what is magnetism", "magic", "electromagnetic force", "user-correction");

    const relevant = j.getRelevantMistakes("tell me about gravity theory");
    expect(relevant.length).toBeGreaterThanOrEqual(1);
    expect(relevant[0].topicKey).toBe("gravity");
  });

  it("builds mistakes context", () => {
    const j = new MistakeJournal();
    j.add("topic", "query about topic", "wrong answer", "right answer", "user-correction");
    const ctx = j.buildMistakesContext("tell me about topic");
    expect(ctx).toContain("Previous Corrections");
    expect(ctx).toContain("right");
  });

  it("returns empty context when no mistakes", () => {
    const j = new MistakeJournal();
    expect(j.buildMistakesContext("anything")).toBe("");
  });

  it("tracks stats", () => {
    const j = new MistakeJournal();
    j.add("a", "q", "w", "c", "user-correction");
    j.add("b", "q", "w", "c", "self-reflection");
    const stats = j.getStats();
    expect(stats.total).toBe(2);
    expect(stats.bySource["user-correction"]).toBe(1);
    expect(stats.bySource["self-reflection"]).toBe(1);
  });

  it("clears all mistakes", () => {
    const j = new MistakeJournal();
    j.add("a", "q", "w", "c", "user-correction");
    j.clearAll();
    expect(j.getAll().length).toBe(0);
  });
});

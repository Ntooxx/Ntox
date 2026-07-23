import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { MentalModel } from "./mental-model.js";

const TEST_PATH = join(tmpdir(), `ntox-mm-test-${randomUUID().slice(0, 8)}.json`);

describe("MentalModel", () => {
  let mm: MentalModel;

  beforeEach(() => {
    try { if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH); } catch { }
    mm = new MentalModel(TEST_PATH);
  });

  afterAll(() => {
    try { if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH); } catch { }
  });

  it("starts empty", () => {
    expect(mm.getActiveEntries()).toEqual([]);
  });

  it("extracts opinion statements", () => {
    mm.extractFromConversation("I think CLI users hate GUIs");
    const entries = mm.getActiveEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("opinion");
    expect(entries[0].statement.toLowerCase()).toContain("cli users");
  });

  it("extracts generalization statements", () => {
    mm.extractFromConversation("Users never read documentation");
    const entries = mm.getActiveEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("generalization");
  });

  it("extracts comparison statements", () => {
    mm.extractFromConversation("Python is better than JavaScript for data pipelines");
    const entries = mm.getActiveEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("comparison");
  });

  it("reinforces existing beliefs on repeat mention", () => {
    mm.extractFromConversation("I think speed matters most");
    mm.extractFromConversation("I believe speed is the priority");
    const entries = mm.getActiveEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].mentionCount).toBe(2);
  });

  it("detects contradiction via opposite words", () => {
    mm.extractFromConversation("I think CLI users hate GUIs");
    mm.extractFromConversation("In my experience, users like graphical interfaces");
    const challenged = mm.getChallengedEntries();
    expect(challenged.length).toBeGreaterThan(0);
    expect(challenged[0].statement.toLowerCase()).toContain("hate");
  });

  it("detects contradiction via negation (never vs without negation)", () => {
    mm.extractFromConversation("Users never read documentation");
    mm.extractFromConversation("I believe users check the docs");
    const challenged = mm.getChallengedEntries();
    expect(challenged.length).toBeGreaterThan(0);
  });

  it("returns active entries with correct status", () => {
    mm.extractFromConversation("I think open source is the future");
    const active = mm.getActiveEntries();
    expect(active).toHaveLength(1);
    expect(active[0].status).toBe("active");
  });

  it("returns challenged entries", () => {
    mm.extractFromConversation("I think speed matters most");
    mm.extractFromConversation("I believe design matters more than speed");
    const challenged = mm.getChallengedEntries();
    expect(challenged.length).toBeGreaterThan(0);
  });

  it("persists and reloads", () => {
    mm.extractFromConversation("I believe testing is essential");
    const mm2 = new MentalModel(TEST_PATH);
    expect(mm2.getActiveEntries()).toHaveLength(1);
    expect(mm2.getActiveEntries()[0].statement.toLowerCase()).toContain("testing");
  });

  it("clears all entries", () => {
    mm.extractFromConversation("I think something");
    mm.clearAll();
    expect(mm.getActiveEntries()).toHaveLength(0);
  });

  it("returns contradictions list", () => {
    mm.extractFromConversation("I think CLI users hate GUIs");
    mm.extractFromConversation("I believe users like GUIs");
    const contradictions = mm.getContradictions();
    expect(contradictions.length).toBeGreaterThan(0);
  });

  it("handles empty input gracefully", () => {
    mm.extractFromConversation("");
    expect(mm.getActiveEntries()).toHaveLength(0);
  });
});
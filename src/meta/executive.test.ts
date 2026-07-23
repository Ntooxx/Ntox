import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Executive } from "./executive.js";

const TEST_PATH = join(tmpdir(), `ntox-exec-test-${randomUUID().slice(0, 8)}.json`);

describe("Executive", () => {
  let exec: Executive;

  beforeEach(() => {
    try { if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH); } catch { }
    exec = new Executive(TEST_PATH);
  });

  afterAll(() => {
    try { if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH); } catch { }
  });

  it("starts with no goals, constraints, or risks", () => {
    expect(exec.getActiveGoals()).toHaveLength(0);
    expect(exec.getConstraints()).toHaveLength(0);
    expect(exec.getRisks()).toHaveLength(0);
    expect(exec.getStatedFocus()).toBeNull();
  });

  it("sets and gets focus", () => {
    exec.setFocus("launch Sentinel");
    expect(exec.getStatedFocus()).toBe("launch Sentinel");
    expect(exec.getFocusHistory()).toHaveLength(1);
  });

  it("extracts focus from conversation", () => {
    exec.extractFromConversation("My priority is to ship the landing page");
    expect(exec.getStatedFocus()).toContain("ship the landing page");
  });

  it("extracts goals from conversation", () => {
    exec.extractFromConversation("Our goal is to reach 500 GitHub stars");
    const goals = exec.getActiveGoals();
    expect(goals.length).toBeGreaterThan(0);
    expect(goals[0].description.toLowerCase()).toContain("500");
  });

  it("extracts constraints from conversation", () => {
    exec.extractFromConversation("I'm limited on budget for marketing");
    const constraints = exec.getConstraints();
    expect(constraints.length).toBeGreaterThan(0);
  });

  it("extracts risks from conversation", () => {
    exec.extractFromConversation("I'm worried about having no distribution");
    const risks = exec.getRisks();
    expect(risks.length).toBeGreaterThan(0);
    expect(risks[0].description.toLowerCase()).toContain("distribution");
  });

  it("adds goals manually", () => {
    const goal = exec.addGoal("Reach 500 stars", "growth", "high");
    expect(goal.description).toBe("Reach 500 stars");
    expect(goal.priority).toBe("high");
    expect(exec.getActiveGoals()).toHaveLength(1);
  });

  it("does not duplicate goals", () => {
    exec.addGoal("Reach 500 stars");
    exec.addGoal("Reach 500 stars");
    expect(exec.getActiveGoals()).toHaveLength(1);
  });

  it("updates goal progress", () => {
    const goal = exec.addGoal("Reach 500 stars");
    exec.updateGoalProgress(goal.id, 50);
    expect(exec.getActiveGoals()[0].progress).toBe(50);
  });

  it("completes goals", () => {
    const goal = exec.addGoal("Reach 500 stars");
    exec.completeGoal(goal.id);
    expect(exec.getActiveGoals()).toHaveLength(0);
  });

  it("removes goals", () => {
    const goal = exec.addGoal("Reach 500 stars");
    exec.removeGoal(goal.id);
    expect(exec.getActiveGoals()).toHaveLength(0);
  });

  it("adds constraints manually", () => {
    exec.addConstraint("budget", "No marketing budget");
    expect(exec.getConstraints()).toHaveLength(1);
    expect(exec.getConstraints()[0].type).toBe("budget");
  });

  it("does not duplicate constraints", () => {
    exec.addConstraint("budget", "No marketing budget");
    exec.addConstraint("budget", "No marketing budget");
    expect(exec.getConstraints()).toHaveLength(1);
  });

  it("adds risks manually", () => {
    exec.addRisk("No distribution channel", "high");
    const risks = exec.getRisks();
    expect(risks).toHaveLength(1);
    expect(risks[0].severity).toBe("high");
  });

  it("increments risk mention count", () => {
    exec.addRisk("No distribution channel");
    exec.addRisk("No distribution channel");
    expect(exec.getRisks()[0].mentionCount).toBe(2);
  });

  it("builds context string", () => {
    exec.setFocus("launch Sentinel");
    exec.addGoal("Reach 500 stars", "growth", "high");
    exec.addRisk("No distribution", "high");
    const ctx = exec.buildContext();
    expect(ctx).toContain("launch Sentinel");
    expect(ctx).toContain("Reach 500 stars");
    expect(ctx).toContain("No distribution");
    expect(ctx).toContain("Executive Context");
  });

  it("persists and reloads", () => {
    exec.setFocus("launch Sentinel");
    exec.addGoal("Reach 500 stars");
    exec.addRisk("No distribution");

    const exec2 = new Executive(TEST_PATH);
    expect(exec2.getStatedFocus()).toBe("launch Sentinel");
    expect(exec2.getActiveGoals()).toHaveLength(1);
    expect(exec2.getRisks()).toHaveLength(1);
  });

  it("clears all data", () => {
    exec.setFocus("launch Sentinel");
    exec.addGoal("Reach 500 stars");
    exec.addRisk("No distribution");
    exec.clearAll();
    expect(exec.getStatedFocus()).toBeNull();
    expect(exec.getActiveGoals()).toHaveLength(0);
    expect(exec.getRisks()).toHaveLength(0);
  });
});
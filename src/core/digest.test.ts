import { describe, expect, it } from "vitest";
import type { AliveEvent, AliveOpenLoop } from "../alive/engine.js";
import type { PlanState } from "../tools/plan.js";
import { DIGEST_WINDOW_MS, isDigestPrompt, renderDigest } from "./digest.js";

const NOW = Date.UTC(2026, 9, 24, 8, 0, 0);

const event = (overrides: Partial<AliveEvent> = {}): AliveEvent => ({
  id: "event_1",
  type: "git_commit",
  source: "git-watcher",
  timestamp: NOW - 60 * 60 * 1000,
  significance: 0.8,
  payload: { head: "abcdef1234", changedFiles: 3 },
  requiresHuman: false,
  ...overrides,
});

const loop = (overrides: Partial<AliveOpenLoop> = {}): AliveOpenLoop => ({
  id: "loop_1",
  goal: "Ship the digest",
  status: "waiting_evidence",
  createdAt: NOW - 1000,
  updatedAt: NOW - 1000,
  ...overrides,
});

const plan: PlanState = {
  sessionId: "telegram_42",
  goal: "Ship 4.3",
  createdAt: NOW - 5000,
  updatedAt: NOW - 1000,
  tasks: [
    { id: "t1", title: "Extract event wording", status: "completed", createdAt: NOW - 5000, updatedAt: NOW - 4000 },
    { id: "t2", title: "Render the brief", status: "in_progress", createdAt: NOW - 5000, updatedAt: NOW - 1000 },
    { id: "t3", title: "Wire the cron prompt", status: "pending", createdAt: NOW - 5000, updatedAt: NOW - 1000 },
  ],
};

describe("isDigestPrompt", () => {
  it("accepts only the exact digest prompt token", () => {
    expect(isDigestPrompt("/digest")).toBe(true);
    expect(isDigestPrompt("  /DIGEST  ")).toBe(true);
    expect(isDigestPrompt("digest")).toBe(false);
    expect(isDigestPrompt("/digest now")).toBe(false);
    expect(isDigestPrompt("morning brief")).toBe(false);
    expect(isDigestPrompt("/cron list")).toBe(false);
  });
});

describe("renderDigest", () => {
  it("renders every section from its sources", () => {
    const alive = {
      inspect: () => ({
        events: [
          event(),
          event({ id: "event_2", type: "file_changed", significance: 0.6, payload: { path: "src/a.ts" } }),
        ],
        openLoops: [loop(), loop({ id: "loop_2", goal: "Close the loop", status: "completed" })],
        pendingActions: [],
      }),
    };

    const text = renderDigest({
      alive,
      plan,
      costs: { totalInputTokens: 12_400, totalOutputTokens: 3_100, totalCost: 0.42 },
      title: "morning brief",
      now: NOW,
    });

    expect(text.split("\n")[0]).toContain("morning brief —");
    expect(text).toContain("Plan");
    expect(text).toContain("## Active Plan: Ship 4.3");
    expect(text).toContain("t2 Render the brief");
    expect(text).toContain("Progress: 1/3 complete.");
    expect(text).toContain("Alive (last 1d)");
    expect(text).toContain("  - 1h ago · Git: new commit abcdef1 (3 files)");
    expect(text).toContain("  - 1h ago · Workspace: src/a.ts");
    expect(text).toContain("Open loops");
    expect(text).toContain("  - [waiting_evidence] Ship the digest");
    expect(text).not.toContain("Close the loop");
    expect(text).toContain("Costs");
    expect(text).toMatch(/\d+(\.\d+)?k in · \d+(\.\d+)?k out · \$0\.420 lifetime/);
  });

  it("keeps only inbox-worthy events from the window", () => {
    const alive = {
      inspect: () => ({
        events: [
          event({ id: "quiet", type: "file_changed", significance: 0.2, payload: { path: "noise.ts" } }),
          event({ id: "stale", timestamp: NOW - DIGEST_WINDOW_MS - 1 }),
          event({ id: "human", type: "git_state_changed", significance: 0.1, requiresHuman: true, payload: {} }),
          event({ id: "unknown", type: "surprise", payload: {} }),
        ],
        openLoops: [],
        pendingActions: [],
      }),
    };

    const text = renderDigest({ alive, now: NOW });

    expect(text).not.toContain("noise.ts");
    expect(text).not.toContain("new commit abcdef1");
    expect(text).toContain("Git: working tree now has 0 changed files");
    expect(text).toContain("· surprise");
    const aliveLines = text.split("\n").filter((line) => line.startsWith("  - "));
    expect(aliveLines).toHaveLength(2);
  });

  it("renders relative ages and the custom window label", () => {
    const alive = {
      inspect: () => ({
        events: [
          event({ id: "fresh", timestamp: NOW - 10_000 }),
          event({ id: "mins", timestamp: NOW - 30 * 60_000 }),
          event({ id: "hours", timestamp: NOW - 5 * 60 * 60_000 }),
          event({ id: "days", timestamp: NOW - 3 * 24 * 60 * 60_000, payload: { head: "1234567890" } }),
        ],
        openLoops: [],
        pendingActions: [],
      }),
    };

    const text = renderDigest({ alive, now: NOW, windowMs: 7 * 24 * 60 * 60 * 1000 });

    expect(text).toContain("Alive (last 7d)");
    expect(text).toContain("just now · Git:");
    expect(text).toContain("30m ago · Git:");
    expect(text).toContain("5h ago · Git:");
    expect(text).toContain("3d ago · Git:");
  });

  it("stays useful when there is nothing to report", () => {
    const text = renderDigest({ now: NOW, costs: { totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0 } });

    expect(text).toContain("No active plan.");
    expect(text).toContain("Nothing notable.");
    expect(text).toContain("  None.");
    expect(text).toContain("$0.00 lifetime");
  });

  it("labels the sections when sources are missing entirely", () => {
    const text = renderDigest({ now: NOW });

    expect(text).toContain("Plan");
    expect(text).toContain("Open loops");
    expect(text).toContain("Costs");
    expect(text).toContain("Usage tracking unavailable.");
    expect(text.startsWith("Digest — ")).toBe(true);
  });

  it("caps the event and loop lists", () => {
    const alive = {
      inspect: () => ({
        events: Array.from({ length: 20 }, (_, index) =>
          event({ id: `event_${index}`, timestamp: NOW - index * 1000 }),
        ),
        openLoops: Array.from({ length: 12 }, (_, index) => loop({ id: `loop_${index}`, goal: `goal ${index}` })),
        pendingActions: [],
      }),
    };

    const text = renderDigest({ alive, now: NOW });
    const eventLines = text.split("\n").filter((line) => line.startsWith("  - ") && line.includes("Git: new commit"));
    const loopLines = text.split("\n").filter((line) => line.startsWith("  - ["));

    expect(eventLines).toHaveLength(6);
    expect(loopLines).toHaveLength(5);
    expect(text).not.toContain("goal 5");
  });
});

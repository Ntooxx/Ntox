import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IdentityStore } from "./identity.js";
import { IdleScheduler } from "./idle.js";

function tempIdentity(): IdentityStore {
  return new IdentityStore({ path: join(mkdtempSync(join(tmpdir(), "ntox-id-")), "identity.json") });
}

describe("IdentityStore", () => {
  it("adds positions and revises on conflict", () => {
    const identity = tempIdentity();
    identity.addPosition("testing", "prefer unit tests for logic", 0.6, ["correction:1"]);
    identity.addPosition("testing", "prefer property tests for parsers", 0.7, ["correction:2"]);
    const positions = identity.get().positions;
    expect(positions).toHaveLength(1);
    expect(positions[0].stance).toContain("property tests");
    expect(identity.get().revisionLog.length).toBe(2);
  });

  it("changes fingerprint when positions change", () => {
    const identity = tempIdentity();
    const before = identity.fingerprint();
    identity.addPosition("style", "be terse", 0.8);
    const after = identity.fingerprint();
    expect(after.hash).not.toBe(before.hash);
  });

  it("renders a summary once positions exist", () => {
    const identity = tempIdentity();
    expect(identity.summary()).toBe("");
    identity.addPosition("evidence", "verifiable claims only", 0.9);
    expect(identity.summary()).toContain("Established Positions");
  });

  it("sets active projects with dedupe and caps", () => {
    const identity = tempIdentity();
    identity.setActiveProjects(["ALIVE-1", "ALIVE-1", "  transfer lab  "]);
    expect(identity.get().activeProjects).toEqual(["ALIVE-1", "transfer lab"]);
  });

  it("strengthens and challenges positions", () => {
    const identity = tempIdentity();
    identity.addPosition("testing", "prefer property tests", 0.5);
    const stronger = identity.strengthenPosition("testing", 0.2);
    expect(stronger?.confidence).toBeCloseTo(0.7, 5);
    const weaker = identity.challengePosition("testing", "failed on held-out parser tasks", 0.5);
    expect(weaker?.confidence).toBeCloseTo(0.35, 5);
    expect(identity.get().revisionLog.some((r) => r.change.startsWith("challenged"))).toBe(true);
    expect(identity.strengthenPosition("missing")).toBeNull();
    expect(identity.challengePosition("missing", "x")).toBeNull();
  });

  it("decays stale low-confidence positions only", () => {
    let now = 1_000;
    const identity = new IdentityStore({
      path: join(mkdtempSync(join(tmpdir(), "ntox-id-")), "identity.json"),
      now: () => now,
    });
    identity.addPosition("stale", "old weak stance", 0.2);
    now += 10_000_000;
    identity.addPosition("fresh", "recent stance", 0.9);
    const removed = identity.decayStalePositions(1_000_000, 0.35, now);
    expect(removed).toBe(1);
    const topics = identity.get().positions.map((p) => p.topic);
    expect(topics).toContain("fresh");
    expect(topics).not.toContain("stale");
  });

  it("finds positions matching topic fragments", () => {
    const identity = tempIdentity();
    identity.addPosition("api-testing", "prefer contract tests", 0.7);
    expect(identity.positionsMatching(["testing"])).toHaveLength(1);
    expect(identity.positionsMatching(["missing"])).toHaveLength(0);
    expect(identity.positionsMatching([])).toHaveLength(0);
  });

  it("persists atomically and reloads", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ntox-id-")), "identity.json");
    const identity = new IdentityStore({ path });
    identity.addPosition("style", "be terse", 0.8);
    identity.setNarrative("Evidence-first agent");
    const reloaded = new IdentityStore({ path });
    expect(reloaded.get().positions[0].topic).toBe("style");
    expect(reloaded.get().narrative).toBe("Evidence-first agent");
  });
});

describe("IdleScheduler", () => {
  it("runs jobs and records artifacts", async () => {
    const scheduler = new IdleScheduler({
      path: join(mkdtempSync(join(tmpdir(), "ntox-idle-")), "idle.json"),
    });
    let ran = 0;
    scheduler.addJob({
      name: "count",
      run: () => {
        ran += 1;
        return "artifact produced";
      },
    });
    const artifacts = await scheduler.runCycle();
    expect(ran).toBe(1);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].job).toBe("count");
    expect(scheduler.status().cyclesToday).toBe(1);
  });

  it("respects the daily cycle cap", async () => {
    const scheduler = new IdleScheduler({
      path: join(mkdtempSync(join(tmpdir(), "ntox-idle-")), "idle.json"),
      maxCyclesPerDay: 2,
    });
    scheduler.addJob({ name: "noop", run: () => null });
    await scheduler.runCycle();
    await scheduler.runCycle();
    expect(await scheduler.runCycle()).toHaveLength(0);
  });

  it("skips jobs that return null", async () => {
    const scheduler = new IdleScheduler({
      path: join(mkdtempSync(join(tmpdir(), "ntox-idle-")), "idle.json"),
    });
    scheduler.addJob({ name: "noop", run: () => null });
    const artifacts = await scheduler.runCycle();
    expect(artifacts).toHaveLength(0);
    expect(scheduler.status().cyclesToday).toBe(1);
  });

  it("deduplicates jobs by name", () => {
    const scheduler = new IdleScheduler({
      path: join(mkdtempSync(join(tmpdir(), "ntox-idle-")), "idle.json"),
    });
    scheduler.addJob({ name: "x", run: () => null });
    scheduler.addJob({ name: "x", run: () => null });
    expect(scheduler.jobsList()).toHaveLength(1);
  });
});

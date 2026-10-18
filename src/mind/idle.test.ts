import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IdleScheduler, type IdleJob } from "./idle.js";

function tempScheduler(overrides: ConstructorParameters<typeof IdleScheduler>[0] = {}): IdleScheduler {
  return new IdleScheduler({ path: join(mkdtempSync(join(tmpdir(), "ntox-idle-")), "idle.json"), ...overrides });
}

describe("IdleScheduler hardening", () => {
  it("runs jobs in priority order, not insertion order", async () => {
    const idle = tempScheduler();
    const order: string[] = [];
    idle.addJob({
      name: "low",
      priority: 10,
      run: () => {
        order.push("low");
        return null;
      },
    });
    idle.addJob({
      name: "high",
      priority: 90,
      run: () => {
        order.push("high");
        return null;
      },
    });
    idle.addJob({
      name: "mid",
      priority: 50,
      run: () => {
        order.push("mid");
        return null;
      },
    });
    expect(idle.jobsList()).toEqual(["high", "mid", "low"]);
    await idle.runCycle();
    expect(order).toEqual(["high", "mid", "low"]);
  });

  it("stops the cycle when the wall-clock deadline passes", async () => {
    let clock = 1_000_000;
    const idle = tempScheduler({ cycleBudgetMs: 5_000, now: () => clock });
    const ran: string[] = [];
    idle.addJob({
      name: "slow",
      priority: 90,
      run: (ctx) => {
        clock += 6_000;
        ran.push("slow");
        expect(ctx.expired()).toBe(true);
        return null;
      },
    });
    idle.addJob({
      name: "after",
      priority: 80,
      run: () => {
        ran.push("after");
        return null;
      },
    });
    await idle.runCycle();
    expect(ran).toEqual(["slow"]);
  });

  it("charges real token and dollar usage onto artifacts and budget", () => {
    const idle = tempScheduler({ dailyTokenBudget: 100, dailyUsdBudget: 0.01 });
    idle.addJob({ name: "j", run: () => null });
    expect(idle.canRun()).toBe(true);
    idle.charge(60, 0.005);
    expect(idle.canRun()).toBe(true);
    idle.charge(50, 0.006);
    expect(idle.canRun()).toBe(false);
    const status = idle.status();
    expect(status.tokensToday).toBe(110);
    expect(status.usdToday).toBeCloseTo(0.011, 3);
    expect(status.budgets.tokens).toBe(100);
    expect(status.budgets.usd).toBeCloseTo(0.01, 5);
  });

  it("records artifact token usage reported by jobs and computes yield", async () => {
    const idle = tempScheduler({ dailyTokenBudget: 10_000 });
    idle.addJob({
      name: "paid",
      priority: 90,
      run: (ctx) => {
        ctx.charge(500);
        return { summary: "did work", tokens: 500 };
      },
    });
    const artifacts = await idle.runCycle();
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].tokens).toBe(500);
    const status = idle.status();
    expect(status.tokensToday).toBe(500);
    expect(status.yieldPerKToken).toBeCloseTo(2, 5);
  });

  it("waits for the user-idle gate before cycling", async () => {
    let clock = 1_000_000;
    const idle = tempScheduler({ idleMs: 600_000, now: () => clock });
    expect(idle.userIdleFor()).toBe(0);
    clock += 599_000;
    expect(idle.userIdleFor()).toBeLessThan(600_000);
    clock += 2_000;
    expect(idle.userIdleFor()).toBeGreaterThan(600_000);
  });

  it("caps and drains queued proposals", () => {
    const idle = tempScheduler();
    idle.pushProposal("first idea");
    idle.pushProposal("second idea");
    idle.pushProposal("third idea");
    idle.pushProposal("fourth idea");
    expect(idle.status().pendingProposals).toHaveLength(3);
    const drained = idle.drainProposals();
    expect(drained).toHaveLength(3);
    expect(drained[2]).toBe("fourth idea");
    expect(idle.status().pendingProposals).toHaveLength(0);
  });

  it("accepts legacy string-returning jobs", async () => {
    const idle = tempScheduler();
    const job: IdleJob = { name: "legacy", run: () => "plain result" };
    idle.addJob(job);
    const artifacts = await idle.runCycle();
    expect(artifacts[0].summary).toBe("plain result");
    expect(artifacts[0].tokens).toBe(0);
  });

  it("enforces the daily cycle cap", async () => {
    const idle = tempScheduler({ maxCyclesPerDay: 2 });
    idle.addJob({ name: "j", run: () => null });
    await idle.runCycle();
    await idle.runCycle();
    expect(idle.canRun()).toBe(false);
    expect(await idle.runCycle()).toEqual([]);
  });
});

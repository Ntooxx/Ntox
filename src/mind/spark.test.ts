import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SPARK_COOLDOWN_MS,
  DEFAULT_SPARK_THRESHOLD,
  SparkEngine,
  pickTemplate,
  scoreBoredom,
} from "./spark.js";
import { createIdleJobs } from "./jobs.js";
import { Mind } from "./mind.js";
import { NtoxAliveBridge } from "../alive/ntox.js";
import { AliveEngine } from "../alive/engine.js";
import type { IdleJobContext } from "./idle.js";

function engine(overrides: Partial<ConstructorParameters<typeof SparkEngine>[0]> = {}): SparkEngine {
  return new SparkEngine({
    path: join(mkdtempSync(join(tmpdir(), "ntox-spark-")), "spark.json"),
    quietHours: false,
    ...overrides,
  });
}

function ctx(overrides: Partial<IdleJobContext> = {}): IdleJobContext {
  const started = Date.now();
  return {
    charge: () => {},
    deadline: started + 60_000,
    since: 0,
    now: () => Date.now(),
    expired: () => false,
    ...overrides,
  };
}

const fullBoredom = {
  minutesSinceLastActive: 90,
  artifactsToday: 0,
  openLoops: 2,
  significantEventsSinceLastRun: 3,
};

describe("scoreBoredom", () => {
  it("returns zero signals for an active, productive session", () => {
    const { score, signals } = scoreBoredom({
      minutesSinceLastActive: 0,
      artifactsToday: 10,
      openLoops: 0,
      significantEventsSinceLastRun: 0,
    });
    expect(signals).toHaveLength(0);
    expect(score).toBe(0);
  });

  it("scales with idle time and stays clamped to [0,1]", () => {
    const early = scoreBoredom({
      minutesSinceLastActive: 30,
      artifactsToday: 10,
      openLoops: 0,
      significantEventsSinceLastRun: 0,
    });
    const late = scoreBoredom({
      minutesSinceLastActive: 60,
      artifactsToday: 10,
      openLoops: 0,
      significantEventsSinceLastRun: 0,
    });
    expect(late.score).toBeGreaterThan(early.score);

    const maxed = scoreBoredom({
      minutesSinceLastActive: 10_000,
      artifactsToday: 0,
      openLoops: 50,
      significantEventsSinceLastRun: 100,
    });
    expect(maxed.score).toBeLessThanOrEqual(1);
    expect(maxed.score).toBeGreaterThanOrEqual(DEFAULT_SPARK_THRESHOLD);
  });
});

describe("pickTemplate", () => {
  it("picks from the dominant signal's pool", () => {
    const msg = pickTemplate("default", [
      { name: "open-loops", weight: 0.3 },
      { name: "idle", weight: 0.2 },
    ]);
    expect(msg).toMatch(/open loop|unfinished thread/i);
  });

  it("falls back to the default pool without signals", () => {
    expect(pickTemplate("default", [], 7)).toContain("Antonio");
  });
});

describe("SparkEngine.decide", () => {
  it("sends when boredom clears the threshold", () => {
    const decision = engine().decide(fullBoredom);
    expect(decision.send).toBe(true);
    expect(decision.reason).toBe("sent");
    expect(decision.message).toBeTruthy();
    expect(decision.score).toBeGreaterThanOrEqual(DEFAULT_SPARK_THRESHOLD);
  });

  it("stays quiet when there is no signal", () => {
    const decision = engine().decide({
      minutesSinceLastActive: 0,
      artifactsToday: 10,
      openLoops: 0,
      significantEventsSinceLastRun: 0,
    });
    expect(decision.send).toBe(false);
    expect(decision.reason).toBe("no-signal");
  });

  it("stays quiet below the threshold", () => {
    const decision = engine().decide({
      minutesSinceLastActive: 0,
      artifactsToday: 10,
      openLoops: 1,
      significantEventsSinceLastRun: 0,
    });
    expect(decision.send).toBe(false);
    expect(decision.reason).toBe("not-bored");
  });

  it("respects the disabled flag", () => {
    const decision = engine().decide({ ...fullBoredom, enabled: false });
    expect(decision.send).toBe(false);
    expect(decision.reason).toBe("disabled");
  });

  it("respects quiet hours", () => {
    const quiet = engine({ quietHours: true }).decide(fullBoredom);
    expect(quiet.send).toBe(false);
    expect(quiet.reason).toBe("quiet-hours");
  });

  it("enforces cooldown after a send", () => {
    let now = 1_000_000;
    const spark = engine({
      now: () => now,
      cooldownMs: DEFAULT_SPARK_COOLDOWN_MS,
    });
    const first = spark.decide(fullBoredom);
    expect(first.send).toBe(true);
    spark.record(first);

    now += 60 * 60 * 1000; // 1h later — still inside the 4h cooldown
    const second = spark.decide(fullBoredom);
    expect(second.send).toBe(false);
    expect(second.reason).toBe("cooldown");

    now += DEFAULT_SPARK_COOLDOWN_MS; // past cooldown
    const third = spark.decide(fullBoredom);
    expect(third.send).toBe(true);
  });

  it("enforces the daily cap", () => {
    let now = 5_000_000;
    const spark = engine({ now: () => now, cooldownMs: 0, minIntervalMs: 0, maxPerDay: 2 });
    for (let i = 0; i < 2; i++) {
      const d = spark.decide(fullBoredom);
      expect(d.send).toBe(true);
      spark.record(d);
      now += 1;
    }
    const capped = spark.decide(fullBoredom);
    expect(capped.send).toBe(false);
    expect(capped.reason).toBe("cooldown");
    expect(spark.status().sentToday).toBe(2);
  });

  it("persists state across instances", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ntox-spark-")), "spark.json");
    const first = engine({ path, now: () => 10_000_000 });
    const d = first.decide(fullBoredom);
    first.record(d);

    const rehydrated = engine({ path, now: () => 10_000_000 + 60_000 });
    expect(rehydrated.status().history).toHaveLength(1);
    const gated = rehydrated.decide(fullBoredom);
    expect(gated.reason).toBe("cooldown");
  });
});

describe("spark idle job", () => {
  it("notifies alive and queues a proposal when bored", () => {
    const bridge = new NtoxAliveBridge(new AliveEngine());
    const proposals: string[] = [];
    let notified = 0;
    const originalNotify = bridge.notify.bind(bridge);
    bridge.notify = ((message: string, meta?: Record<string, unknown>) => {
      notified++;
      return originalNotify(message, meta);
    }) as typeof bridge.notify;

    const spark = engine({ quietHours: false });
    const jobs = createIdleJobs({
      mind: new Mind({ rootDir: mkdtempSync(join(tmpdir(), "ntox-spark-mind-")) }),
      alive: bridge,
      spark,
      sparkEnabled: true,
      pushProposal: (p) => proposals.push(p),
    });
    const sparkJob = jobs.find((j) => j.name === "spark")!;

    const result = sparkJob.run(ctx());
    expect(result).not.toBeNull();
    expect(notified).toBe(1);
    expect(proposals).toHaveLength(1);
    expect(spark.status().sentToday).toBe(1);

    // second run inside cooldown stays silent
    expect(sparkJob.run(ctx())).toBeNull();
    expect(notified).toBe(1);
  });

  it("does nothing without a spark engine or when disabled", () => {
    const bridge = new NtoxAliveBridge(new AliveEngine());
    const noEngine = createIdleJobs({ mind: new Mind({ rootDir: mkdtempSync(join(tmpdir(), "ntox-spark-mind-")) }), alive: bridge });
    expect(noEngine.find((j) => j.name === "spark")!.run(ctx())).toBeNull();

    const disabled = createIdleJobs({
      mind: new Mind({ rootDir: mkdtempSync(join(tmpdir(), "ntox-spark-mind-")) }),
      alive: bridge,
      spark: engine(),
      sparkEnabled: false,
    });
    expect(disabled.find((j) => j.name === "spark")!.run(ctx())).toBeNull();
  });
});

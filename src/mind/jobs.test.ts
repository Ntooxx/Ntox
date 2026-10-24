import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIdleJobs } from "./jobs.js";
import { Mind } from "./mind.js";
import { NtoxAliveBridge } from "../alive/ntox.js";
import { AliveEngine } from "../alive/engine.js";
import type { Reflector } from "../meta/reflector.js";
import type { Executive } from "../meta/executive.js";
import type { IdleJobContext } from "./idle.js";

function tempMind(): Mind {
  return new Mind({ rootDir: mkdtempSync(join(tmpdir(), "ntox-jobs-mind-")) });
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

const neutral = {
  corrected: false,
  rephrased: false,
  thanked: false,
  abandoned: false,
  falseSuccess: false,
  toolFailure: false,
};

describe("idle jobs", () => {
  it("resolve job completes loops when a matching event arrives", async () => {
    const bridge = new NtoxAliveBridge(new AliveEngine());
    bridge.createOpenLoop({ goal: "Check the build cache configuration", nextEvidence: "Verify cache hits" });
    bridge.recordEvent({
      type: "process_exited",
      source: "test",
      payload: { toolName: "shell", nextStep: "build cache configuration shows 0 hits" },
    });
    const [resolveJob] = createIdleJobs({ mind: tempMind(), alive: bridge });
    expect(resolveJob.name).toBe("resolve");

    const result = await resolveJob.run(ctx());
    expect(result).not.toBeNull();
    const loop = bridge.engine.getState().openLoops[0];
    expect(loop.status).toBe("completed");
    expect(loop.lastEvidence).toContain("process_exited");
  });

  it("resolve job leaves loops open without evidence", async () => {
    const bridge = new NtoxAliveBridge(new AliveEngine());
    bridge.createOpenLoop({ goal: "Investigate quantum flux capacitor drift", nextEvidence: "measure" });
    bridge.recordEvent({
      type: "tool_succeeded",
      source: "test",
      payload: { toolName: "read", unrelated: "cooking recipe" },
    });
    const [resolveJob] = createIdleJobs({ mind: tempMind(), alive: bridge });
    expect(await resolveJob.run(ctx())).toBeNull();
    expect(bridge.engine.getState().openLoops[0].status).toBe("waiting_evidence");
  });

  it("reflect-surprise job reflects on new high-error turns once", async () => {
    const mind = tempMind();
    const handle = mind.beginTurn({
      turnId: "surprise-1",
      sessionId: "s",
      query: "what is the deploy port",
      queryType: "factual",
      responseMode: "chat",
    })!;
    handle.prediction = { ...handle.prediction, confidence: 0.95 };
    mind.finishTurn(handle, { ...neutral, corrected: true });

    let reflections = 0;
    const reflector = {
      reflect: async () => {
        reflections++;
        return {
          confidence: 0.5,
          addressed: true,
          knowledgeGaps: [],
          improvement: "Pin the port explicitly.",
          timestamp: Date.now(),
        };
      },
    } as unknown as Reflector;

    const jobs = createIdleJobs({ mind, reflector });
    const reflectJob = jobs.find((j) => j.name === "reflect-surprise")!;
    const first = await reflectJob.run(ctx());
    expect(first).not.toBeNull();
    expect(reflections).toBe(1);
    expect(typeof first === "object" && first ? first.tokens : 0).toBeGreaterThan(0);

    const second = await reflectJob.run(ctx());
    expect(second).toBeNull();
    expect(reflections).toBe(1);
  });

  it("prepare job injects a changed brief and dedupes unchanged ones", async () => {
    const bridge = new NtoxAliveBridge(new AliveEngine());
    const executive = { buildContext: () => "## Goals\nShip the release" } as Executive;
    const jobs = createIdleJobs({ mind: tempMind(), alive: bridge, executive });
    const prepareJob = jobs.find((j) => j.name === "prepare")!;

    const first = await prepareJob.run(ctx());
    expect(first).not.toBeNull();
    const events = bridge.engine.getState().events.filter((e) => e.type === "context_prepared");
    expect(events).toHaveLength(1);
    expect(String(events[0].payload.nextStep)).toContain("Ship the release");

    const second = await prepareJob.run(ctx());
    expect(second).toBeNull();
    expect(bridge.engine.getState().events.filter((e) => e.type === "context_prepared")).toHaveLength(1);
  });

  it("propose job queues the oldest waiting loop, else a weak-domain suggestion", async () => {
    const bridge = new NtoxAliveBridge(new AliveEngine());
    bridge.createOpenLoop({ goal: "Resolve the flaky test mystery", nextEvidence: "run it 20 times" });
    const proposals: string[] = [];
    const mind = tempMind();
    const jobs = createIdleJobs({
      mind,
      alive: bridge,
      pushProposal: (p) => proposals.push(p),
    });
    const proposeJob = jobs.find((j) => j.name === "propose")!;

    const first = await proposeJob.run(ctx());
    expect(first).not.toBeNull();
    expect(proposals[0]).toContain("flaky test mystery");

    const strongLoop = bridge.engine.getState().openLoops[0];
    bridge.engine.completeOpenLoop(strongLoop.id, "resolved");
    const second = await proposeJob.run(ctx());
    expect(second).toBeNull();

    for (let i = 0; i < 10; i++) mind.capability.record(["rust"], -0.5);
    const third = await proposeJob.run(ctx());
    expect(third).not.toBeNull();
    expect(proposals[1]).toContain("rust");
  });

  it("self-play job respects the daily cap", async () => {
    const mind = tempMind();
    let cursor = 0;
    const charged: number[] = [];
    const jobs = createIdleJobs({
      mind,
      createSelfPlaySession: () => ({
        send: async () => ({ response: "attempted answer", tokens: 100 }),
        reset: async () => {},
      }),
      pushProposal: () => {},
      selfPlayCursor: () => cursor++,
      selfPlayCapPerDay: 2,
    });
    const selfPlayJob = jobs.find((j) => j.name === "self-play")!;
    const jobCtx = ctx({ charge: (tokens) => charged.push(tokens) });

    const first = await selfPlayJob.run(jobCtx);
    const second = await selfPlayJob.run(jobCtx);
    const third = await selfPlayJob.run(jobCtx);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(third).toBeNull();
    expect(charged).toHaveLength(2);
    const selfPlayRows = mind.ledger.all().filter((r) => r.sessionId === "selfplay");
    expect(selfPlayRows).toHaveLength(2);
    expect(selfPlayRows[0].predictionSource).toBe("selfplay");
  });

  it("runs jobs in priority order across the full set", () => {
    const jobs = createIdleJobs({ mind: tempMind() });
    const priorities = jobs.map((j) => j.priority ?? 50);
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i]).toBeLessThan(priorities[i - 1]);
    }
    expect(jobs.map((j) => j.name)).toEqual([
      "resolve",
      "consolidate",
      "reflect-surprise",
      "prepare",
      "self-play",
      "propose",
      "spark",
    ]);
  });
});

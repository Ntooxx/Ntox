import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSelfPlay } from "./self-play.js";
import { Mind } from "./mind.js";
import { buildCurriculum } from "../evaluation/curriculum.js";
import type { EvalSession } from "../evaluation/runner.js";

function tempMind(): Mind {
  return new Mind({ rootDir: mkdtempSync(join(tmpdir(), "ntox-selfplay-")) });
}

function session(responses: string[] | string, tokens = 50): EvalSession {
  const list = Array.isArray(responses) ? [...responses] : [responses];
  let index = 0;
  return {
    send: async () => ({ response: list[Math.min(index++, list.length - 1)], tokens }),
    reset: async () => {
      index = 0;
    },
  };
}

describe("runSelfPlay", () => {
  it("scores a task and writes an objective ledger row", async () => {
    const mind = tempMind();
    const curriculum = buildCurriculum({ families: ["arithmetic"], variantsPerFamily: 2 });
    const task = curriculum.tasks[0];
    const probeAnswer =
      task.check.type === "numeric" && "expected" in task.check
        ? `the answer is ${task.check.expected}`
        : "attempted answer";
    const charged: number[] = [];

    const result = await runSelfPlay(
      {
        createSession: () => session(probeAnswer),
        mind,
        curriculum,
      },
      { taskIndex: 0, charge: (tokens) => charged.push(tokens) },
    );

    expect(result).not.toBeNull();
    expect(result?.taskId).toBe(task.id);
    expect(result?.family).toBe("arithmetic");
    expect(result?.score).toBeGreaterThanOrEqual(0);
    expect(charged.length).toBe(1);

    const row = mind.ledger.all().find((r) => r.sessionId === "selfplay");
    expect(row).toBeDefined();
    expect(row?.predictionSource).toBe("selfplay");
    expect(row?.queryType).toBe("self-play");
    expect(row?.score).toBeCloseTo((result?.score ?? 0) * 2 - 1, 5);
  });

  it("isolates bandit context from user turns", async () => {
    const mind = tempMind();
    await runSelfPlay(
      {
        createSession: () => session("answer"),
        mind,
        curriculum: buildCurriculum({ families: ["arithmetic"], variantsPerFamily: 1 }),
      },
      { taskIndex: 0, charge: () => {} },
    );
    const preferred = Object.keys(mind.bandit.stats().preferred);
    expect(preferred).toContain("self-play:self-play");
    expect(preferred.every((key) => key.startsWith("self-play:"))).toBe(true);
  });

  it("rotates deterministically by task index", async () => {
    const mind = tempMind();
    const curriculum = buildCurriculum({ families: ["arithmetic"], variantsPerFamily: 3 });
    const a = await runSelfPlay(
      { createSession: () => session("x"), mind, curriculum },
      { taskIndex: 1, charge: () => {} },
    );
    const b = await runSelfPlay(
      { createSession: () => session("x"), mind, curriculum },
      { taskIndex: 1, charge: () => {} },
    );
    const c = await runSelfPlay(
      { createSession: () => session("x"), mind, curriculum },
      { taskIndex: 3, charge: () => {} },
    );
    expect(a?.taskId).toBe(b?.taskId);
    expect(c?.taskId).not.toBe(a?.taskId);
  });

  it("handles a failing session without throwing", async () => {
    const mind = tempMind();
    const failing: EvalSession = {
      send: async () => {
        throw new Error("agent crashed");
      },
    };
    const result = await runSelfPlay(
      {
        createSession: () => failing,
        mind,
        curriculum: buildCurriculum({ families: ["arithmetic"], variantsPerFamily: 1 }),
      },
      { taskIndex: 0, charge: () => {} },
    );
    expect(result).toBeNull();
  });
});

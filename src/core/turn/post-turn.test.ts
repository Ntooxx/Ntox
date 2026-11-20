import { describe, it, expect } from "vitest";
import { buildProcedureSteps } from "./post-turn.js";
import type { AgentToolTrace } from "../../types/index.js";

describe("buildProcedureSteps", () => {
  it("keeps only successful named tool calls, bounded to 20", () => {
    const calls: AgentToolTrace[] = [
      { name: "a", args: {}, success: true },
      { name: "b", args: {}, success: false },
      { name: "", args: {}, success: true },
    ];
    const steps = buildProcedureSteps(calls);
    expect(steps.length).toBe(1);
    expect(steps[0].tool).toBe("a");
    expect(steps[0].id).toBe("step_1");
    expect(buildProcedureSteps(undefined)).toEqual([]);
  });

  it("redacts secrets from args and description before persistence", () => {
    const secret = "sk-or-v1-abcdefghijklmnopqrstuv";
    const steps = buildProcedureSteps([
      { name: "shell", args: { command: `curl -H "Authorization: Bearer ${secret}"`, token: secret }, success: true },
    ]);
    const serialized = JSON.stringify(steps);
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("[redacted]");
    expect(steps[0].description).not.toContain(secret);
    expect((steps[0].args as Record<string, unknown>).token).toBe("[redacted]");
  });
});

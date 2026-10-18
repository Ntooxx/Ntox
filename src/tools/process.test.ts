import { afterEach, describe, expect, it } from "vitest";
import { killAllBackgroundProcesses, processTool } from "./process.js";

interface ProcessData {
  process: { id: string; status: string; exitCode: number | null };
  stdout: string;
  stderr: string;
  exited?: boolean;
  alreadyStopped?: boolean;
}

function data(result: { data?: unknown }): ProcessData {
  return result.data as ProcessData;
}

afterEach(async () => {
  await killAllBackgroundProcesses();
});

describe("process tool", () => {
  it("starts a command and returns its output", async () => {
    const started = await processTool.execute({ action: "start", command: `node -e "console.log('bg-ok')"` });
    expect(started.success).toBe(true);
    const id = data(started).process.id;

    const waited = await processTool.execute({ action: "wait", id, timeoutMs: 8000 });
    expect(waited.success).toBe(true);
    expect(data(waited).exited).toBe(true);
    expect(data(waited).process.status).toBe("exited");
    expect(data(waited).stdout).toContain("bg-ok");
  });

  it("reports a failing exit code", async () => {
    const started = await processTool.execute({ action: "start", command: `node -e "process.exit(3)"` });
    const id = data(started).process.id;
    const waited = await processTool.execute({ action: "wait", id, timeoutMs: 8000 });

    expect(data(waited).process.status).toBe("failed");
    expect(data(waited).process.exitCode).not.toBe(0);
  });

  it("kills a running process", async () => {
    const started = await processTool.execute({
      action: "start",
      command: `node -e "setInterval(() => {}, 1000)"`,
    });
    expect(started.success).toBe(true);
    const id = data(started).process.id;

    await new Promise((resolve) => setTimeout(resolve, 300));
    const killed = await processTool.execute({ action: "kill", id });
    expect(killed.success).toBe(true);
    const waited = await processTool.execute({ action: "wait", id, timeoutMs: 8000 });
    expect(data(waited).process.status).toBe("killed");
  });

  it("tails output and lists records", async () => {
    const started = await processTool.execute({
      action: "start",
      command: `node -e "for (let i = 0; i < 20; i++) console.log('line' + i)"`,
    });
    const id = data(started).process.id;
    await processTool.execute({ action: "wait", id, timeoutMs: 8000 });

    const output = await processTool.execute({ action: "output", id, tail: 20 });
    expect(data(output).stdout).toContain("line19");

    const listed = await processTool.execute({ action: "list" });
    const items = (listed.data as { processes: { id: string }[] }).processes;
    expect(items.some((item) => item.id === id)).toBe(true);
  });

  it("removes finished records", async () => {
    const started = await processTool.execute({ action: "start", command: `node -e "console.log('done')"` });
    const id = data(started).process.id;
    await processTool.execute({ action: "wait", id, timeoutMs: 8000 });

    const removed = await processTool.execute({ action: "remove", id });
    expect(removed.success).toBe(true);
    const status = await processTool.execute({ action: "status", id });
    expect(status.success).toBe(false);
  });

  it("blocks unsafe commands", async () => {
    const result = await processTool.execute({ action: "start", command: "rm -rf /" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("blocked by safety policy");
  });

  it("validates ids and commands", async () => {
    expect((await processTool.execute({ action: "start" })).success).toBe(false);
    expect((await processTool.execute({ action: "status" })).success).toBe(false);
    expect((await processTool.execute({ action: "status", id: "missing" })).success).toBe(false);
    expect((await processTool.execute({ action: "nope" })).success).toBe(false);
  });
});

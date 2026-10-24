import { describe, expect, it, vi, beforeEach } from "vitest";
import { AliveEngine } from "./engine.js";
import { NtoxAliveBridge } from "./ntox.js";
import { buildAdvice, groupConsumers, GpuWatchdog, type GpuConsumer, type GpuSample } from "./gpu.js";
import { clearNotifications, listNotifications } from "./notifications.js";

const idle: GpuSample = { utilizationPercent: 5, temperatureC: 44, memoryUsedMiB: 480, memoryTotalMiB: 16303 };
const busy: GpuSample = { utilizationPercent: 72, temperatureC: 71, memoryUsedMiB: 6100, memoryTotalMiB: 16303 };
const consumers: GpuConsumer[] = [
  { pid: 11, name: "chrome.exe", gpuMemoryMiB: 0, cpuSeconds: 12.4, ramMiB: 1400, hasWindow: true },
  { pid: 12, name: "OneDrive.exe", gpuMemoryMiB: 0, cpuSeconds: 0.4, ramMiB: 120, hasWindow: false },
  { pid: 13, name: "SearchIndexer.exe", gpuMemoryMiB: 0, cpuSeconds: 0.1, ramMiB: 40, hasWindow: false },
];

function watchdogWith(sample: GpuSample | null, overrides: Record<string, unknown> = {}) {
  const bridge = new NtoxAliveBridge(new AliveEngine());
  const notify = vi.spyOn(bridge, "notify");
  const watchdog = new GpuWatchdog({
    bridge,
    sampleGpu: async () => sample,
    sampleConsumers: async () => consumers,
    cooldownMs: 600_000,
    ...overrides,
  });
  return { bridge, notify, watchdog };
}

beforeEach(() => {
  clearNotifications();
});

describe("GpuWatchdog", () => {
  it("stays quiet while the GPU is cool", async () => {
    const { notify, watchdog } = watchdogWith(idle);
    expect(await watchdog.sampleOnce()).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  it("stays quiet when nvidia-smi is unavailable", async () => {
    const { notify, watchdog } = watchdogWith(null);
    expect(await watchdog.sampleOnce()).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  it("alerts with advice when usage crosses the threshold", async () => {
    const { notify, watchdog } = watchdogWith(busy);
    const message = await watchdog.sampleOnce();

    expect(message).toContain("72% usage");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(listNotifications()).toHaveLength(1);
    expect(listNotifications()[0].reason).toContain("72% usage");
  });

  it("alerts on temperature even when usage is low", async () => {
    const { notify, watchdog } = watchdogWith({ ...idle, temperatureC: 90 });
    await watchdog.sampleOnce();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1]).toMatchObject({ level: "urgent", source: "gpu-watchdog" });
  });

  it("suppresses repeats inside the cooldown and allows a later alert", async () => {
    const { notify, watchdog } = watchdogWith(busy);
    const start = Date.now();

    expect(await watchdog.sampleOnce(start)).not.toBeNull();
    expect(await watchdog.sampleOnce(start + 60_000)).toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);

    expect(await watchdog.sampleOnce(start + 600_001)).not.toBeNull();
    expect(notify).toHaveBeenCalledTimes(2);
  });
});

describe("buildAdvice", () => {
  it("separates safe-to-close background apps from the ones with windows", () => {
    const { message, closeCommand } = buildAdvice(busy, consumers);

    expect(message).toContain("GPU at 72% usage, 71C");
    expect(message).toContain("Holding the GPU:");
    expect(message).toContain("chrome.exe");
    expect(message).toContain("window open");
    expect(message).toContain("Safe to close");
    expect(message).toContain("Everything else is yours to judge");
    expect(closeCommand).toBe('taskkill /f /im "OneDrive.exe"');
    expect(message).toContain("Windows and driver components, not worth touching: SearchIndexer.exe");
    expect(closeCommand).not.toContain("chrome.exe");
    expect(closeCommand).not.toContain("SearchIndexer.exe");
  });

  it("reports when nothing is background noise", () => {
    const { message, closeCommand } = buildAdvice(busy, [
      { pid: 21, name: "game.exe", gpuMemoryMiB: 0, cpuSeconds: 40, ramMiB: 3000, hasWindow: true },
      { pid: 22, name: "oldtool.exe", gpuMemoryMiB: 0, cpuSeconds: 1, ramMiB: 80, hasWindow: false },
    ]);

    expect(closeCommand).toBe("");
    expect(message).toContain("No background app on the GPU looks disposable.");
    expect(message).toContain("Everything else is yours to judge:");
    expect(message).toContain("oldtool.exe");
    expect(message).toContain("game.exe");
  });
});

describe("groupConsumers", () => {
  it("merges multiple processes of the same app and ranks by memory", () => {
    const groups = groupConsumers([
      { pid: 1, name: "opera.exe", gpuMemoryMiB: 0, cpuSeconds: 3, ramMiB: 500, hasWindow: true },
      { pid: 2, name: "opera.exe", gpuMemoryMiB: 0, cpuSeconds: 5, ramMiB: 700, hasWindow: false },
      { pid: 3, name: "Code.exe", gpuMemoryMiB: 0, cpuSeconds: 9, ramMiB: 900, hasWindow: true },
    ]);

    const opera = groups.find((group) => group.name === "opera.exe");
    expect(opera).toMatchObject({ processes: 2, cpuSeconds: 8, ramMiB: 1200, hasWindow: true });
    expect(groups[0].name).toBe("opera.exe");
    expect(groups[1].name).toBe("Code.exe");
  });
});
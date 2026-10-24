import { execFile } from "node:child_process";
import { basename } from "node:path";
import type { NtoxAliveBridge } from "./ntox.js";

export interface GpuSample {
  utilizationPercent: number;
  temperatureC: number;
  memoryUsedMiB: number;
  memoryTotalMiB: number;
}

export interface GpuConsumer {
  pid: number;
  name: string;
  gpuMemoryMiB: number;
  cpuSeconds?: number;
  ramMiB?: number;
  hasWindow?: boolean;
}

export interface GpuWatchdogOptions {
  bridge: NtoxAliveBridge;
  intervalMs?: number;
  utilThreshold?: number;
  tempThreshold?: number;
  cooldownMs?: number;
  sampleGpu?: () => Promise<GpuSample | null>;
  sampleConsumers?: () => Promise<GpuConsumer[]>;
}

class NameSet {
  private readonly values: Set<string>;
  constructor(names: string[]) {
    this.values = new Set(names.map((name) => name.toLowerCase()));
  }
  has(name: string): boolean {
    return this.values.has(name.toLowerCase());
  }
}

const CLOSEABLE = new NameSet([
  "onedrive.exe",
  "dropbox.exe",
  "icloud.exe",
  "googledrivesync.exe",
  "ea desktop.exe",
  "eacefsubprocess.exe",
  "epicwebhelper.exe",
  "rockstarservice.exe",
  "adobecleanup.exe",
  "ccxprocess.exe",
  "adobeipcb.exe",
  "adobeupdateservice.exe",
  "acrordsl.exe",
  "spotify.exe",
  "discord.exe",
  "slack.exe",
  "telegram.exe",
  "utorrent.exe",
  "qbittorrent.exe",
  "plex.exe",
  "plexmediaserver.exe",
]);

const SYSTEM_COMPONENTS = new NameSet([
  "searchindexer.exe",
  "searchapp.exe",
  "searchhost.exe",
  "searchui.exe",
  "runtimebroker.exe",
  "taskhostw.exe",
  "backgroundtaskhost.exe",
  "wsappx.exe",
  "sihost.exe",
  "ctfmon.exe",
  "crossdeviceresume.exe",
  "startmenuexperiencehost.exe",
  "shellexperiencehost.exe",
  "shellhost.exe",
  "applicationframehost.exe",
  "textinputhost.exe",
  "systemsettings.exe",
  "msedgewebview2.exe",
  "nvcontainer.exe",
  "nvidia web helper.exe",
  "nvprofileupdater.exe",
  "nvsphelper64.exe",
  "nvidiaapp.exe",
  "nvidia app.exe",
  "securityhealthservice.exe",
  "securityhealthsystray.exe",
  "nvidia share.exe",
  "nvlmksvr.exe",
]);

const NEVER_CLOSE = new NameSet([
  "system",
  "idle process",
  "registry",
  "smss.exe",
  "csrss.exe",
  "wininit.exe",
  "services.exe",
  "lsass.exe",
  "dwm.exe",
  "explorer.exe",
  "fontdrvhost.exe",
  "ntoskrnl.exe",
  "ntox.exe",
  "electron.exe",
]);

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: 8000 }, (error, stdout) => {
      resolve(error ? "" : stdout);
    });
  });
}

function windowsImageName(raw: string): string {
  const value = raw.trim();
  if (!value || value.startsWith("[")) return "";
  const name = basename(value);
  return /\.exe$/i.test(name) ? name : `${name}.exe`;
}

export async function sampleGpu(): Promise<GpuSample | null> {
  const output = await run("nvidia-smi", [
    "--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total",
    "--format=csv,noheader,nounits",
  ]);
  const firstLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;
  const [utilization, temperature, used, total] = firstLine.split(",").map((value) => Number(value.trim()));
  if (![utilization, temperature, used, total].every((value) => Number.isFinite(value))) return null;
  return { utilizationPercent: utilization, temperatureC: temperature, memoryUsedMiB: used, memoryTotalMiB: total };
}

async function describeProcesses(pids: number[]): Promise<Map<number, { name: string; cpuSeconds: number; ramMiB: number; hasWindow: boolean }>> {
  const found = new Map<number, { name: string; cpuSeconds: number; ramMiB: number; hasWindow: boolean }>();
  const list = pids.filter((pid) => Number.isFinite(pid) && pid > 0).join(",");
  if (!list) return found;
  const script = `Get-Process -Id ${list} -ErrorAction SilentlyContinue | ForEach-Object { "{0}|{1}|{2}|{3}|{4}" -f $_.Id, $_.ProcessName, [math]::Round($_.CPU,1), [int]($_.MainWindowHandle -ne 0), [math]::Round($_.WorkingSet64/1MB,0) }`;
  const output = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
  for (const line of output.split(/\r?\n/)) {
    const [pid, name, cpu, hasWindow, ram] = line.trim().split("|");
    if (!pid || !name) continue;
    found.set(Number(pid), {
      name: windowsImageName(name) || `pid ${pid}`,
      cpuSeconds: Number(cpu) || 0,
      ramMiB: Number(ram) || 0,
      hasWindow: hasWindow === "1",
    });
  }
  return found;
}

export async function sampleConsumers(): Promise<GpuConsumer[]> {
  const output = await run("nvidia-smi", [
    "--query-compute-apps=pid,process_name,used_gpu_memory",
    "--format=csv,noheader,nounits",
  ]);
  const rows = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(",").map((value) => value.trim());
      const pid = Number(parts[0]);
      const memory = Number(parts[parts.length - 1]);
      const pathName = parts.length > 1 ? parts.slice(1, -1).join(",") : "";
      return { pid, pathName, gpuMemoryMiB: Number.isFinite(memory) && memory > 0 ? memory : 0 };
    })
    .filter((row) => Number.isFinite(row.pid) && row.pid > 0);
  if (rows.length === 0) return [];

  const described = await describeProcesses(rows.map((row) => row.pid));
  return rows.map((row) => {
    const info = described.get(row.pid);
    return {
      pid: row.pid,
      name: info?.name || windowsImageName(row.pathName) || `pid ${row.pid}`,
      gpuMemoryMiB: row.gpuMemoryMiB,
      cpuSeconds: info?.cpuSeconds ?? 0,
      ramMiB: info?.ramMiB ?? 0,
      hasWindow: info?.hasWindow ?? false,
    };
  });
}

export interface GpuConsumerGroup {
  name: string;
  processes: number;
  cpuSeconds: number;
  ramMiB: number;
  gpuMemoryMiB: number;
  hasWindow: boolean;
}

export function groupConsumers(consumers: GpuConsumer[]): GpuConsumerGroup[] {
  const groups = new Map<string, GpuConsumerGroup>();
  for (const consumer of consumers) {
    const key = consumer.name.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.processes += 1;
      existing.cpuSeconds += consumer.cpuSeconds ?? 0;
      existing.ramMiB += consumer.ramMiB ?? 0;
      existing.gpuMemoryMiB += consumer.gpuMemoryMiB ?? 0;
      existing.hasWindow = existing.hasWindow || Boolean(consumer.hasWindow);
      continue;
    }
    groups.set(key, {
      name: consumer.name,
      processes: 1,
      cpuSeconds: consumer.cpuSeconds ?? 0,
      ramMiB: consumer.ramMiB ?? 0,
      gpuMemoryMiB: consumer.gpuMemoryMiB,
      hasWindow: Boolean(consumer.hasWindow),
    });
  }
  return [...groups.values()].sort((left, right) => {
    if (left.gpuMemoryMiB !== right.gpuMemoryMiB) return right.gpuMemoryMiB - left.gpuMemoryMiB;
    if (left.ramMiB !== right.ramMiB) return right.ramMiB - left.ramMiB;
    return right.cpuSeconds - left.cpuSeconds;
  });
}

function formatRam(mebibytes: number): string {
  if (mebibytes >= 1024) return `${(mebibytes / 1024).toFixed(1)} GB RAM`;
  return `${Math.round(mebibytes)} MB RAM`;
}

function formatCpu(seconds: number): string {
  if (seconds >= 3600) return `CPU ${Math.round(seconds / 3600)}h`;
  if (seconds >= 90) return `CPU ${Math.round(seconds / 60)}m`;
  return "";
}

function describeGroup(group: GpuConsumerGroup): string {
  const parts = [formatRam(group.ramMiB), group.hasWindow ? "window open" : "no window"];
  const cpu = formatCpu(group.cpuSeconds);
  if (cpu) parts.push(cpu);
  if (group.gpuMemoryMiB > 0) parts.push(`${Math.round(group.gpuMemoryMiB)} MiB VRAM`);
  const count = group.processes > 1 ? ` · ${group.processes} processes` : "";
  return `  - ${group.name} · ${parts.join(" · ")}${count}`;
}

export function buildAdvice(sample: GpuSample, consumers: GpuConsumer[]): { message: string; closeCommand: string } {
  const groups = groupConsumers(consumers);
  const headline = `GPU at ${sample.utilizationPercent}% usage, ${sample.temperatureC}C, ${sample.memoryUsedMiB}/${sample.memoryTotalMiB} MiB.`;

  const closeable = groups.filter((group) => CLOSEABLE.has(group.name) && !NEVER_CLOSE.has(group.name));
  const system = groups.filter((group) => SYSTEM_COMPONENTS.has(group.name) && !NEVER_CLOSE.has(group.name));
  const closeCommand = closeable.map((group) => `taskkill /f /im "${group.name}"`).join(" | ");

  const lines = [headline];
  if (groups.length > 0) {
    lines.push("Holding the GPU:", ...groups.slice(0, 8).map(describeGroup));
  } else {
    lines.push("No per-process GPU users reported.");
  }

  if (closeable.length > 0) {
    lines.push(
      "Safe to close — background apps you are not using:",
      ...closeable.map((group) => `  - ${group.name}${group.processes > 1 ? ` (${group.processes} processes)` : ""}`),
      `Close them with: ${closeCommand}`,
    );
  } else {
    lines.push("No background app on the GPU looks disposable.");
  }

  const others = groups.filter(
    (group) => !CLOSEABLE.has(group.name) && !SYSTEM_COMPONENTS.has(group.name) && !NEVER_CLOSE.has(group.name),
  );
  if (others.length > 0) {
    lines.push("Everything else is yours to judge:", ...others.slice(0, 6).map(describeGroup));
  }
  if (system.length > 0) {
    lines.push(`Windows and driver components, not worth touching: ${system.slice(0, 8).map((group) => group.name).join(", ")}`);
  }

  return { message: lines.join("\n"), closeCommand };
}

export class GpuWatchdog {
  private readonly bridge: NtoxAliveBridge;
  private readonly intervalMs: number;
  private readonly utilThreshold: number;
  private readonly tempThreshold: number;
  private readonly cooldownMs: number;
  private readonly readGpu: () => Promise<GpuSample | null>;
  private readonly readConsumers: () => Promise<GpuConsumer[]>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastAlertAt = 0;
  private busy = false;

  constructor(options: GpuWatchdogOptions) {
    this.bridge = options.bridge;
    this.intervalMs = options.intervalMs ?? envNumber("NTOX_GPU_INTERVAL_MS", 60_000);
    this.utilThreshold = options.utilThreshold ?? envNumber("NTOX_GPU_UTIL", 50);
    this.tempThreshold = options.tempThreshold ?? envNumber("NTOX_GPU_TEMP", 85);
    this.cooldownMs = options.cooldownMs ?? envNumber("NTOX_GPU_COOLDOWN_MS", 600_000);
    this.readGpu = options.sampleGpu ?? sampleGpu;
    this.readConsumers = options.sampleConsumers ?? sampleConsumers;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.sampleOnce();
    }, this.intervalMs);
    this.timer.unref?.();
    void this.sampleOnce();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async sampleOnce(now = Date.now()): Promise<string | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      const sample = await this.readGpu();
      if (!sample) return null;
      const hot = sample.utilizationPercent >= this.utilThreshold || sample.temperatureC >= this.tempThreshold;
      if (!hot) return null;
      if (now - this.lastAlertAt < this.cooldownMs) return null;
      this.lastAlertAt = now;
      const consumers = await this.readConsumers();
      const { message } = buildAdvice(sample, consumers);
      this.bridge.notify(message, {
        level: sample.temperatureC >= this.tempThreshold ? "urgent" : "warning",
        source: "gpu-watchdog",
        utilizationPercent: sample.utilizationPercent,
        temperatureC: sample.temperatureC,
      });
      return message;
    } finally {
      this.busy = false;
    }
  }
}

export function createGpuWatchdog(bridge: NtoxAliveBridge): GpuWatchdog | null {
  if (process.env.NTOX_GPU_MONITOR === "0") return null;
  return new GpuWatchdog({ bridge });
}
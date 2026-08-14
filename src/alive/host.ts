import { execFile } from "node:child_process";
import { watch } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { FSWatcher } from "node:fs";
import { NtoxAliveBridge } from "./ntox.js";

export interface AliveGitState {
  head: string;
  changedFiles: number;
}

export interface NtoxAliveHostOptions {
  bridge: NtoxAliveBridge;
  workspaceRoot: string;
  pulseIntervalMs?: number;
  gitIntervalMs?: number;
  gitProbe?: (workspaceRoot: string) => Promise<AliveGitState | null>;
}

const IGNORED_DIRECTORY_NAMES = new Set([".git", ".ntox", "node_modules", "dist", "coverage"]);

function isWorkspaceRelativePath(path: string): boolean {
  return path !== "" && !path.startsWith("..") && !path.startsWith(sep);
}

function isIgnoredPath(path: string): boolean {
  return path.split(/[\\/]/).some((part) => IGNORED_DIRECTORY_NAMES.has(part));
}

function runGit(workspaceRoot: string, args: string[]): Promise<string | null> {
  return new Promise((resolveResult) => {
    execFile("git", args, { cwd: workspaceRoot, windowsHide: true }, (error, stdout) => {
      resolveResult(error ? null : stdout.trim());
    });
  });
}

export async function probeAliveGitState(workspaceRoot: string): Promise<AliveGitState | null> {
  const [head, status] = await Promise.all([
    runGit(workspaceRoot, ["rev-parse", "HEAD"]),
    runGit(workspaceRoot, ["status", "--porcelain"]),
  ]);
  if (!head || status === null) return null;
  return { head, changedFiles: status ? status.split("\n").filter(Boolean).length : 0 };
}

export class NtoxAliveHostAdapters {
  private readonly bridge: NtoxAliveBridge;
  private readonly workspaceRoot: string;
  private readonly pulseIntervalMs: number;
  private readonly gitIntervalMs: number;
  private readonly gitProbe: (workspaceRoot: string) => Promise<AliveGitState | null>;
  private watcher: FSWatcher | null = null;
  private pulseTimer: NodeJS.Timeout | null = null;
  private gitTimer: NodeJS.Timeout | null = null;
  private lastGitState: AliveGitState | null = null;
  private started = false;

  constructor(options: NtoxAliveHostOptions) {
    this.bridge = options.bridge;
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.pulseIntervalMs = Math.max(1000, options.pulseIntervalMs ?? 60_000);
    this.gitIntervalMs = Math.max(1000, options.gitIntervalMs ?? 30_000);
    this.gitProbe = options.gitProbe ?? probeAliveGitState;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.startFileWatcher();
    void this.pollGit();
    this.pulseTimer = setInterval(() => this.bridge.pulse(), this.pulseIntervalMs);
    this.gitTimer = setInterval(() => void this.pollGit(), this.gitIntervalMs);
  }

  stop(): void {
    this.started = false;
    this.watcher?.close();
    this.watcher = null;
    if (this.pulseTimer) clearInterval(this.pulseTimer);
    if (this.gitTimer) clearInterval(this.gitTimer);
    this.pulseTimer = null;
    this.gitTimer = null;
  }

  recordFileChange(path: string, change: string = "change"): void {
    const absolutePath = resolve(this.workspaceRoot, path);
    const relativePath = relative(this.workspaceRoot, absolutePath);
    if (!isWorkspaceRelativePath(relativePath) || isIgnoredPath(relativePath)) return;
    const eventPath = relativePath.split(sep).join("/");
    const significance = /(?:^|[\\/])(package\.json|tsconfig\.json|pnpm-lock\.yaml|package-lock\.json)$/.test(
      relativePath,
    )
      ? 0.5
      : 0.2;
    this.bridge.recordEvent({
      type: "file_changed",
      source: "workspace-watcher",
      significance,
      payload: { path: eventPath, change },
    });
  }

  async pollGit(): Promise<void> {
    const current = await this.gitProbe(this.workspaceRoot);
    if (!current) return;
    const previous = this.lastGitState;
    this.lastGitState = current;
    if (!previous) return;
    if (current.head !== previous.head) {
      this.bridge.recordEvent({
        type: "git_commit",
        source: "git-watcher",
        significance: 0.8,
        payload: { head: current.head, changedFiles: current.changedFiles },
      });
      return;
    }
    if (current.changedFiles !== previous.changedFiles) {
      this.bridge.recordEvent({
        type: "git_state_changed",
        source: "git-watcher",
        significance: 0.4,
        payload: { changedFiles: current.changedFiles },
      });
    }
  }

  private startFileWatcher(): void {
    const onChange = (change: string, filename: string | Buffer | null) => {
      if (filename) this.recordFileChange(String(filename), change);
    };
    const start = (recursive: boolean) => {
      this.watcher = watch(this.workspaceRoot, { recursive }, onChange);
      this.watcher.on("error", () => {
        this.watcher?.close();
        this.watcher = null;
      });
    };
    try {
      start(true);
    } catch {
      try {
        start(false);
      } catch {
        this.watcher = null;
      }
    }
  }
}

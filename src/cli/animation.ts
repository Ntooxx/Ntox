import chalk from "chalk";
import type { ThinkPhase } from "../types/index.js";
import { getPhaseIndicator } from "./phases.js";

export class Spinner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private text = "";
  private phase: ThinkPhase = "thinking";
  private startedAt = 0;

  start(text = "thinking"): void {
    if (this.interval) return;
    this.text = text;
    this.frame = 0;
    this.startedAt = Date.now();

    const tick = () => {
      const ind = getPhaseIndicator(this.phase);
      const char = ind.frames[this.frame % ind.frames.length];
      const elapsed = Date.now() - this.startedAt;
      const label = this.fitLabel(this.text || ind.label, elapsed > 1200 ? 14 : 0);
      const pulse = this.frame % 16 < 8 ? chalk.hex("#00ccff")("\u2502") : chalk.dim("\u2502");
      const dots = ".".repeat((Math.floor(this.frame / 5) % 3) + 1).padEnd(3, " ");
      const clock = elapsed > 1200 ? chalk.dim(` ${(elapsed / 1000).toFixed(1)}s`) : "";
      process.stdout.write(`\r${pulse} ${ind.color(char)} ${chalk.dim(label)}${chalk.dim(dots)}${clock} \x1b[K`);
      this.frame++;
    };
    tick();
    this.interval = setInterval(tick, 55);
  }

  setText(text: string): void {
    this.text = text.replace(/\s+/g, " ").trim();
  }

  setPhase(phase: ThinkPhase): void {
    this.phase = phase;
  }

  stop(): void {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
    process.stdout.write("\r\x1b[K");
  }

  private fitLabel(label: string, reserved = 0): string {
    const width = Math.max(20, (process.stdout.columns || 80) - 12 - reserved);
    if (label.length <= width) return label;
    return `${label.slice(0, Math.max(1, width - 1))}…`;
  }
}

export function animateExit(): Promise<void> {
  return new Promise((resolve) => {
    const steps = 10;
    let i = 0;
    const interval = setInterval(() => {
      const trail = "\u2500".repeat(Math.max(0, steps - i));
      process.stdout.write(`\r${chalk.dim("\u2502 " + trail)}\x1b[K`);
      if (i >= steps) {
        clearInterval(interval);
        process.stdout.write("\r\x1b[K");
        resolve();
      }
      i++;
    }, 22);
  });
}

export function renderVolumeBar(pct: number, width = 10): string {
  const f = Math.round((pct / 100) * width);
  const c = pct > 70 ? chalk.green : pct > 30 ? chalk.yellow : chalk.red;
  return c("\u2588".repeat(f)) + chalk.dim("\u2591".repeat(width - f));
}

export function animateConvergence(): Promise<void> {
  return new Promise((resolve) => {
    const width = 20;
    const half = Math.floor(width / 2);
    let step = 0;
    const totalSteps = 8;

    const interval = setInterval(() => {
      const progress = Math.min(1, step / totalSteps);
      const leftLen = Math.floor(half * progress);
      const rightLen = Math.floor(half * progress);

      const left = "\u2500".repeat(leftLen) + "\u257A";
      const right = "\u2578" + "\u2500".repeat(rightLen);
      const center = progress >= 1 ? chalk.cyan("\u25CF") : chalk.dim("\u25CB");

      const line = `${chalk.dim(left)} ${center} ${chalk.dim(right)}`;
      process.stdout.write(`\r${chalk.hex("#00ccff")("\u2502")} ${line}  \x1b[K`);

      step++;
      if (step > totalSteps + 4) {
        clearInterval(interval);
        process.stdout.write("\r\x1b[K");
        resolve();
      }
    }, 40);
  });
}

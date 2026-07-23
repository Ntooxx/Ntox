import chalk from "chalk";
import type { ThinkPhase } from "../types/index.js";
import { getPhaseIndicator } from "./phases.js";

export class Spinner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private text = "";
  private phase: ThinkPhase = "thinking";

  start(text = "thinking"): void {
    if (this.interval) return;
    this.text = text;
    this.frame = 0;

    const tick = () => {
      const ind = getPhaseIndicator(this.phase);
      const char = ind.frames[this.frame % ind.frames.length];
      const label = this.text || ind.label;
      process.stdout.write(`\r${chalk.hex("#00ccff")("\u2502")} ${ind.color(char)} ${chalk.dim(label)}  \x1b[K`);
      this.frame++;
    };
    tick();
    this.interval = setInterval(tick, 80);
  }

  setText(text: string): void {
    this.text = text;
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
}

export function animateExit(): Promise<void> {
  return new Promise((resolve) => {
    const steps = 6;
    let i = 0;
    const interval = setInterval(() => {
      process.stdout.write(`\r${chalk.dim(" ".repeat(40))}\x1b[K`);
      if (i >= steps) {
        clearInterval(interval);
        process.stdout.write("\r\x1b[K");
        resolve();
      }
      i++;
    }, 30);
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

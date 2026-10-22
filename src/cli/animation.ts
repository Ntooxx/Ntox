import chalk from "chalk";
import type { ThinkPhase } from "../types/index.js";
import { getPhaseIndicator } from "./phases.js";
import { paint, palette, dimRgb, hsl, mix, type RGB } from "./theme.js";
import { easeInOutCubic, sleep } from "./motion.js";

const HUE_BASE = 190;
const HUE_SWEEP = 70;

export class Spinner {
  private static globallyPaused = false;
  private interval: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private text = "";
  private phase: ThinkPhase = "thinking";
  private startedAt = 0;
  private running = false;

  static pauseGlobally(pause: boolean): void {
    Spinner.globallyPaused = pause;
    if (pause && process.stdout.isTTY) process.stdout.write("\r\x1b[K");
  }

  start(text = "thinking"): void {
    if (this.running) return;
    this.running = true;
    this.text = text;
    this.frame = 0;
    this.startedAt = Date.now();

    if (!process.stdout.isTTY) {
      process.stdout.write(`${paint(palette.accent, "•")} ${chalk.dim(text)}\n`);
      return;
    }

    const tick = () => {
      if (!this.running || Spinner.globallyPaused) return;
      const ind = getPhaseIndicator(this.phase);
      const char = ind.frames[this.frame % ind.frames.length];
      const elapsed = Date.now() - this.startedAt;
      const hue = HUE_BASE + Math.sin(this.frame / 9) * HUE_SWEEP;
      const glyphColor = hsl(hue);
      const label = this.fitLabel(this.text || ind.label, elapsed > 1400 ? 16 : 0);
      const breathing = 0.55 + 0.45 * Math.abs(Math.sin(this.frame / 7));
      const pulse = paint(dimRgb(glyphColor, breathing), "◆");
      const dots = ".".repeat((Math.floor(this.frame / 6) % 3) + 1).padEnd(3, " ");
      const clock = elapsed > 1400 ? chalk.dim(` ${(elapsed / 1000).toFixed(1)}s`) : "";
      const labelColor = paint(mix(glyphColor, palette.ink, 0.55), label);
      process.stdout.write(`\r${pulse} ${paint(glyphColor, char)} ${labelColor}${chalk.dim(dots)}${clock} \x1b[K`);
      this.frame++;
    };
    tick();
    this.interval = setInterval(tick, 50);
  }

  setText(text: string): void {
    this.text = text.replace(/\s+/g, " ").trim();
  }

  setPhase(phase: ThinkPhase): void {
    this.phase = phase;
  }

  stop(): void {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
  }

  private fitLabel(label: string, reserved = 0): string {
    const width = Math.max(20, (process.stdout.columns || 80) - 14 - reserved);
    if (label.length <= width) return label;
    return `${label.slice(0, Math.max(1, width - 1))}…`;
  }
}

export async function animateExit(): Promise<void> {
  if (!process.stdout.isTTY) return;
  const message = "severing link";
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = easeInOutCubic(i / steps);
    const trailLen = Math.max(0, Math.round((1 - t) * 18));
    const bar =
      paint(dimRgb(palette.accent, 0.3 + t * 0.7), "━".repeat(Math.round(t * 18))) + chalk.dim("─".repeat(trailLen));
    const fade = 1 - t * 0.7;
    process.stdout.write(
      `\r${paint(dimRgb(palette.violet, fade), "◆")} ${bar} ${paint(dimRgb(palette.muted, fade), message)} \x1b[K`,
    );
    await sleep(24);
  }
  process.stdout.write("\r\x1b[K");
}

export function renderVolumeBar(pct: number, width = 10): string {
  const f = Math.round((pct / 100) * width);
  const c = pct > 70 ? chalk.green : pct > 30 ? chalk.yellow : chalk.red;
  return c("█".repeat(f)) + chalk.dim("░".repeat(width - f));
}

export async function animateConvergence(): Promise<void> {
  if (!process.stdout.isTTY) return;
  const width = 20;
  const half = Math.floor(width / 2);
  const totalSteps = 10;
  for (let step = 0; step <= totalSteps + 4; step++) {
    const progress = Math.min(1, step / totalSteps);
    const eased = easeInOutCubic(progress);
    const len = Math.floor(half * eased);
    const left = "─".repeat(len) + (progress < 1 ? "╾" : "");
    const right = (progress < 1 ? "╼" : "") + "─".repeat(len);
    const center = progress >= 1 ? paint(palette.accent, "●") : paint(palette.faint, "○");
    const color: RGB = mix(palette.accent, palette.violet, progress);
    process.stdout.write(`\r${paint(color, left)} ${center} ${paint(color, right)}  \x1b[K`);
    await sleep(36);
  }
  process.stdout.write("\r\x1b[K");
}

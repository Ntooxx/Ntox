import { paint, palette, dimRgb, type RGB } from "./theme.js";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

export function canAnimate(): boolean {
  return Boolean(process.stdout.isTTY);
}

function fadeLine(line: string, brightness: number): string {
  if (brightness >= 0.97) return line;
  if (brightness <= 0.25) return paint(dimRgb(palette.ink, 0.35), line.replace(/\x1b\[[0-9;]*m/g, ""));
  return line;
}

export interface RevealOptions {
  lineDelayMs?: number;
  maxTotalMs?: number;
  enabled?: boolean;
}

export async function revealBlock(text: string, opts: RevealOptions = {}): Promise<void> {
  const lines = text.split("\n");
  const enabled = (opts.enabled ?? true) && canAnimate();
  if (!enabled) {
    process.stdout.write(text + "\n");
    return;
  }
  const lineDelay = opts.lineDelayMs ?? 14;
  const maxTotal = opts.maxTotalMs ?? 520;
  const delay = Math.min(lineDelay, maxTotal / Math.max(1, lines.length));
  for (let i = 0; i < lines.length; i++) {
    const t = lines.length === 1 ? 1 : i / (lines.length - 1);
    const brightness = lerp(0.35, 1, easeOutCubic(t));
    process.stdout.write(fadeLine(lines[i], brightness) + "\n");
    if (i < lines.length - 1) await sleep(delay);
  }
}

export function shimmerFrame(width: number, time: number, color: RGB = palette.accent): string {
  const pos = (time / 45) % (width + 8);
  let out = "";
  for (let i = 0; i < width; i++) {
    const dist = Math.abs(i - pos);
    const glow = Math.max(0, 1 - dist / 6);
    if (glow > 0.08) out += paint(dimRgb(color, 0.45 + glow * 0.55), "━");
    else out += paint(dimRgb(color, 0.18), "━");
  }
  return out;
}

export function progressTrack(pct: number, width = 18): string {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  let out = "";
  for (let i = 0; i < width; i++) {
    if (i < filled) out += paint(palette.accent, "━");
    else out += paint(palette.faint, "─");
  }
  return out;
}

export function spinFrames(count = 10): string[] {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  return frames.slice(0, Math.max(1, Math.min(count, frames.length)));
}

export async function sweepDivider(width: number, enabled = true): Promise<void> {
  const w = Math.max(20, width);
  if (!enabled || !canAnimate()) {
    process.stdout.write(paint(palette.faint, "━".repeat(w)) + "\n");
    return;
  }
  const frames = 10;
  for (let f = 0; f <= frames; f++) {
    const pos = (f / frames) * (w + 10) - 5;
    let line = "";
    for (let i = 0; i < w; i++) {
      const glow = Math.max(0, 1 - Math.abs(i - pos) / 9);
      line += paint(dimRgb(palette.accent, 0.22 + glow * 0.78), "━");
    }
    process.stdout.write(`\r${line} \x1b[K`);
    await sleep(15);
  }
  process.stdout.write(`\r${paint(palette.faint, "━".repeat(w))}\n`);
}

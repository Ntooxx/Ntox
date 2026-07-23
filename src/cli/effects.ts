import chalk from "chalk";

type RGB = [number, number, number];

export function fg(c: RGB): string {
  return `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
}

export function dimColor(c: RGB, factor: number): RGB {
  const f = Math.max(0, Math.min(1, factor));
  return [Math.floor(c[0] * f), Math.floor(c[1] * f), Math.floor(c[2] * f)];
}

export function pulseChar(frame: number, speed = 80): string {
  const t = (Date.now() / speed + frame * 30) % (Math.PI * 2);
  const brightness = 0.4 + 0.6 * Math.abs(Math.sin(t));
  return chalk.dim(String(brightness));
}

export function fadeText(text: string, progress: number): string {
  const br = Math.max(0, Math.min(1, 1 - progress));
  if (br >= 0.99) return text;
  if (br <= 0.01) return "";
  return chalk.dim(text);
}

export function slideIn(text: string, progress: number, direction: "left" | "right" = "left"): string {
  const visibleChars = Math.floor(text.length * Math.min(1, progress));
  if (visibleChars <= 0) return "";
  if (direction === "left") {
    return text.slice(0, visibleChars);
  }
  return text.slice(text.length - visibleChars);
}

export function typewriter(text: string, progress: number): string {
  const visibleChars = Math.floor(text.length * Math.min(1, progress));
  return text.slice(0, visibleChars);
}

export function colorShift(base: RGB, time: number, range = 15): RGB {
  const shift = Math.sin(time / 500) * range;
  return [
    Math.max(0, Math.min(255, Math.floor(base[0] + shift))),
    Math.max(0, Math.min(255, Math.floor(base[1] + shift * 0.5))),
    Math.max(0, Math.min(255, Math.floor(base[2] - shift * 0.3))),
  ];
}

export function bar(pct: number, width = 10, filled = "\u2588", empty = "\u2591"): string {
  const f = Math.round((pct / 100) * width);
  return filled.repeat(f) + empty.repeat(width - f);
}

export function truncate(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  return text.slice(0, maxWidth - 1) + "\u2026";
}

import chalk from "chalk";

export type RGB = [number, number, number];

export const palette = {
  accent: [61, 220, 255] as RGB,
  accentDeep: [0, 160, 255] as RGB,
  violet: [179, 136, 255] as RGB,
  gold: [255, 183, 77] as RGB,
  green: [102, 255, 170] as RGB,
  red: [255, 100, 130] as RGB,
  yellow: [255, 220, 100] as RGB,
  ink: [220, 235, 245] as RGB,
  muted: [110, 130, 150] as RGB,
  faint: [60, 75, 90] as RGB,
};

export function rgbFg(c: RGB): string {
  return `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
}

export const reset = "\x1b[0m";

export function paint(c: RGB, text: string): string {
  return `${rgbFg(c)}${text}${reset}`;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

export function dimRgb(c: RGB, factor: number): RGB {
  const f = Math.max(0, Math.min(1, factor));
  return [Math.floor(c[0] * f), Math.floor(c[1] * f), Math.floor(c[2] * f)];
}

export function gradient(text: string, from: RGB, to: RGB): string {
  if (text.length === 0) return "";
  if (text.length === 1) return paint(mix(from, to, 0.5), text);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    out += paint(mix(from, to, i / (text.length - 1)), text[i]);
  }
  return out;
}

export function hsl(h: number, s = 0.85, l = 0.62): RGB {
  const sat = Math.max(0, Math.min(1, s));
  const lig = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0,
    g = 0,
    b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = lig - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export function visibleWidth(s: string): number {
  return stripAnsi(s).length;
}

export function truncateVisible(s: string, max: number): string {
  if (visibleWidth(s) <= max) return s;
  const plain = stripAnsi(s);
  return plain.slice(0, Math.max(1, max - 1)) + "…";
}

export function padVisible(s: string, width: number): string {
  const pad = Math.max(0, width - visibleWidth(s));
  return s + " ".repeat(pad);
}

export function termWidth(): number {
  return Math.min(process.stdout.columns || 80, 120);
}

export const accents = {
  brand: (s: string) => gradient(s, palette.accent, palette.violet),
  title: (s: string) => paint(palette.accent, s),
  soft: (s: string) => chalk.dim(s),
  gold: (s: string) => paint(palette.gold, s),
  good: (s: string) => paint(palette.green, s),
  bad: (s: string) => paint(palette.red, s),
  warn: (s: string) => paint(palette.yellow, s),
  violet: (s: string) => paint(palette.violet, s),
  ink: (s: string) => paint(palette.ink, s),
};

const DOT = "·";
const ROUND = {
  tl: "╭",
  tr: "╮",
  bl: "╰",
  br: "╯",
  h: "─",
  v: "│",
};

export interface PanelOptions {
  width?: number;
  accent?: RGB;
  titleColor?: (s: string) => string;
  pad?: number;
}

export function panel(title: string, body: string[], opts: PanelOptions = {}): string {
  const w = Math.max(20, opts.width ?? termWidth());
  const accent = opts.accent ?? palette.accent;
  const titleColor = opts.titleColor ?? ((s: string) => paint(accent, s));
  const inner = w - 2;
  const contentW = Math.max(8, inner - 2);
  const extraPad = Math.max(0, (opts.pad ?? 1) - 1);

  const titleVis = title ? visibleWidth(title) + 2 : 0;
  const h = (n: number) => paint(accent, ROUND.h.repeat(Math.max(0, n)));
  const topInner = title ? `${h(1)} ${titleColor(title)} ${h(inner - titleVis - 1)}` : h(inner);
  const top = `${paint(accent, ROUND.tl)}${topInner}${paint(accent, ROUND.tr)}`;

  const lines: string[] = [top];
  for (const raw of body) {
    const visible = visibleWidth(raw);
    if (visible > contentW) {
      lines.push(`${paint(accent, ROUND.v)} ${truncateVisible(raw, contentW)} ${paint(accent, ROUND.v)}`);
    } else {
      lines.push(
        `${paint(accent, ROUND.v)} ${raw}${" ".repeat(Math.max(0, contentW - visible))} ${paint(accent, ROUND.v)}`,
      );
    }
  }
  for (let i = 0; i < extraPad; i++) {
    lines.push(`${paint(accent, ROUND.v)}${" ".repeat(contentW + 2)}${paint(accent, ROUND.v)}`);
  }
  lines.push(`${paint(accent, ROUND.bl)}${h(inner)}${paint(accent, ROUND.br)}`);
  return lines.join("\n");
}

export function pill(label: string, value: string, valueColor: (s: string) => string = accents.title): string {
  return `${accents.soft(label)} ${valueColor(value)}`;
}

export function separator(): string {
  return accents.soft(DOT);
}

export function metaLine(parts: string[]): string {
  return parts.filter(Boolean).join(` ${accents.soft(DOT)} `);
}

export function meterBar(pct: number, width = 12): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  const color = clamped > 85 ? palette.red : clamped > 60 ? palette.gold : palette.accent;
  return paint(color, "▰".repeat(filled)) + paint(palette.faint, "▱".repeat(width - filled));
}

export function bullet(color: RGB, text: string): string {
  return `${paint(color, "•")} ${text}`;
}

export function hintLine(text: string): string {
  return paint(palette.faint, text);
}

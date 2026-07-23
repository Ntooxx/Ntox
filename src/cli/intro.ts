import { exec } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as readline from "node:readline";

// ── Timing ────────────────────────────────────────────────
const VOID_MS = 600;
const LABELS_MS = 500;
const CONVERGENCE_MS = 1500;
const CONTACT_MS = 400;
const FLASH_MS = 200;
const BIRTH_MS = 800;
const FADE_MS = 500;
const TOTAL_MS = VOID_MS + LABELS_MS + CONVERGENCE_MS + CONTACT_MS + FLASH_MS + BIRTH_MS + FADE_MS;

// ── Colors (warm palette) ─────────────────────────────────
type RGB = [number, number, number];
const ORANGE: RGB = [255, 107, 53];
const RED: RGB = [220, 50, 47];
const GOLD: RGB = [255, 183, 77];
const WARM_WHITE: RGB = [255, 255, 200];
const MUTED_RED: RGB = [140, 55, 50];

// ── Easing ────────────────────────────────────────────────
function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
function easeInCubic(t: number): number {
  return t * t * t;
}
function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// ── Color utilities ───────────────────────────────────────
function fg(c: RGB): string {
  return `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
}
function dim(c: RGB, factor: number): RGB {
  const f = Math.max(0, Math.min(1, factor));
  return [Math.floor(c[0] * f), Math.floor(c[1] * f), Math.floor(c[2] * f)];
}
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

// ── Layout ────────────────────────────────────────────────
interface Layout {
  cols: number;
  rows: number;
  centerY: number;
  humanX: number;
  aiX: number;
  lineStart: number;
  lineEnd: number;
  centerX: number;
  maxLineLen: number;
}

function computeLayout(cols: number, rows: number): Layout {
  const centerY = Math.floor(rows / 2);
  const humanX = Math.floor(cols * 0.15);
  const aiX = Math.floor(cols * 0.82);
  const lineStart = humanX + 6;
  const lineEnd = aiX - 2;
  const centerX = Math.floor((lineStart + lineEnd) / 2);
  const maxLineLen = Math.max(10, lineEnd - lineStart);
  return { cols, rows, centerY, humanX, aiX, lineStart, lineEnd, centerX, maxLineLen };
}

// ── Cell grid ─────────────────────────────────────────────
interface Cell { char: string; color: RGB | null; }

function createGrid(rows: number, cols: number): Cell[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ char: " ", color: null }))
  );
}

function placeText(grid: Cell[][], row: number, col: number, text: string, color: RGB): void {
  if (row < 0 || row >= grid.length) return;
  for (let i = 0; i < text.length; i++) {
    const c = col + i;
    if (c >= 0 && c < grid[0].length) {
      grid[row][c] = { char: text[i], color };
    }
  }
}

function renderGrid(grid: Cell[][], globalBrightness: number = 1): string {
  let out = "\x1b[H";
  for (let r = 0; r < grid.length; r++) {
    let line = "";
    let lastColor: RGB | null = null;
    for (let c = 0; c < grid[r].length; c++) {
      const cell = grid[r][c];
      const color = cell.color ? dim(cell.color, globalBrightness) : null;
      if (color !== lastColor) {
        if (color) {
          line += fg(color);
        } else {
          line += "\x1b[39m";
        }
        lastColor = color;
      }
      line += cell.char;
    }
    if (r < grid.length - 1) line += "\n";
    out += line;
  }
  return out + "\x1b[0m";
}

// ── Phase helpers ─────────────────────────────────────────
function getPhase(elapsed: number): { phase: string; progress: number } {
  let t = 0;
  const check = (dur: number, name: string) => {
    const start = t;
    t += dur;
    if (elapsed < t) return { phase: name, progress: Math.min(1, (elapsed - start) / dur) };
    return null;
  };
  return check(VOID_MS, "void") || check(LABELS_MS, "labels") || check(CONVERGENCE_MS, "convergence") ||
    check(CONTACT_MS, "contact") || check(FLASH_MS, "flash") || check(BIRTH_MS, "birth") ||
    check(FADE_MS, "fade") || { phase: "done", progress: 1 };
}

function addParticles(grid: Cell[][], row: number, lineStart: number, lineEnd: number, lineProgress: number, frameTime: number): void {
  const tipL = lineStart + Math.floor((lineEnd - lineStart) * lineProgress / 2);
  const tipR = lineEnd - Math.floor((lineEnd - lineStart) * lineProgress / 2);
  const chars = ["\u00b7", "\u2022", "\u25e6", "\u2218"];
  for (let p = 0; p < 5; p++) {
    const drift = Math.sin(frameTime / 180 + p * 2.1) * 3;
    const lPos = Math.floor(tipL - 2 + seededRandom(p * 7) * 6 + drift);
    const rPos = Math.floor(tipR - 3 + seededRandom(p * 13 + 50) * 6 - drift);
    if (lPos >= lineStart && lPos < tipL + 2) {
      const br = 0.5 + seededRandom(p * 3 + frameTime / 200) * 0.5;
      grid[row][lPos] = { char: chars[p % chars.length], color: dim(GOLD, br) };
    }
    if (rPos <= lineEnd && rPos > tipR - 2) {
      const br = 0.5 + seededRandom(p * 5 + frameTime / 200) * 0.5;
      grid[row][rPos] = { char: chars[p % chars.length], color: dim(GOLD, br) };
    }
  }
}

const SYMBOLS = [
  { char: "\u2211", dx: -5, dy: -3 },
  { char: "\u03BB", dx: 2, dy: -4 },
  { char: "\u03C0", dx: -2, dy: -2 },
  { char: "\u221E", dx: 4, dy: -3 },
  { char: "\u2234", dx: 0, dy: -3 },
  { char: "\u03C6", dx: -3, dy: -2 },
  { char: "\u2202", dx: 3, dy: -2 },
  { char: "\u0394", dx: -1, dy: -4 },
];

// ── Frame renderer ────────────────────────────────────────
function renderFrame(phase: string, progress: number, layout: Layout, frameTime: number): string {
  const { cols, rows, centerY, humanX, aiX, lineStart, lineEnd, centerX, maxLineLen } = layout;
  const grid = createGrid(rows, cols);

  // Label brightness
  let labelBr = 1;
  if (phase === "void") labelBr = 0;
  else if (phase === "labels") labelBr = easeOutCubic(progress);
  else if (phase === "fade") labelBr = 1 - progress;

  // Place labels
  placeText(grid, centerY, humanX, "HUMAN", dim(ORANGE, labelBr));
  placeText(grid, centerY, aiX, "AI", dim(RED, labelBr));

  // Lines
  let lineProgress = 0;
  if (phase === "convergence") lineProgress = easeOutExpo(progress);
  else if (phase === "contact" || phase === "flash" || phase === "birth") lineProgress = 1;
  else if (phase === "fade") lineProgress = 1;

  if (lineProgress > 0) {
    const halfLen = Math.floor(maxLineLen * lineProgress / 2);
    const lineColor: RGB = phase === "fade" ? dim(MUTED_RED, 1 - progress) : MUTED_RED;
    for (let i = 0; i < halfLen; i++) {
      grid[centerY][lineStart + i] = { char: "\u2550", color: lineColor };
      grid[centerY][lineEnd - i] = { char: "\u2550", color: lineColor };
    }
  }

  // Center dot
  if (phase === "void" || phase === "labels" || phase === "convergence") {
    const pulseSpeed = phase === "convergence" ? 3 + progress * 5 : 2;
    const pulse = 0.3 + 0.7 * Math.abs(Math.sin(frameTime / 400 * pulseSpeed));
    grid[centerY][centerX] = { char: "\u00b7", color: dim(GOLD, pulse) };
  } else if (phase === "contact") {
    const p = easeInOutQuad(progress);
    grid[centerY][centerX] = { char: p < 0.5 ? "\u25C9" : "\u2726", color: WARM_WHITE };
  } else if (phase === "flash") {
    grid[centerY][centerX] = { char: "\u2726", color: WARM_WHITE };
  } else if (phase === "birth") {
    const br = progress < 0.8 ? 1 : 1 - (progress - 0.8) / 0.2;
    grid[centerY][centerX] = { char: "\u25C9", color: dim(WARM_WHITE, br) };
  } else if (phase === "fade") {
    grid[centerY][centerX] = { char: "\u25C9", color: dim(WARM_WHITE, 1 - progress) };
  }

  // Particles during convergence
  if (phase === "convergence") {
    addParticles(grid, centerY, lineStart, lineEnd, lineProgress, frameTime);
  }

  // Ripple during contact/flash
  if (phase === "contact" || phase === "flash") {
    const radius = Math.floor(progress * 8);
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0) continue;
      const x = centerX + dx;
      if (x >= 0 && x < cols) {
        const dist = Math.abs(dx);
        const br = Math.max(0, 1 - dist / Math.max(1, radius)) * (1 - progress * 0.5);
        if (br > 0.1 && grid[centerY][x].char === " ") {
          grid[centerY][x] = { char: "\u2248", color: dim(GOLD, br) };
        }
      }
    }
  }

  // Symbols during birth
  if (phase === "birth") {
    for (let i = 0; i < SYMBOLS.length; i++) {
      const sym = SYMBOLS[i];
      const delay = i * 0.06;
      const adjusted = Math.max(0, progress - delay) / (1 - delay);
      if (adjusted <= 0) continue;

      let t: number;
      if (adjusted < 0.6) {
        t = easeOutCubic(adjusted / 0.6);
      } else {
        t = 1 - easeInCubic((adjusted - 0.6) / 0.4);
      }

      const x = centerX + Math.floor(sym.dx * t);
      const y = centerY + Math.floor(sym.dy * t);

      if (y >= 0 && y < rows && x >= 0 && x < cols) {
        const brightness = adjusted < 0.6 ? 0.7 + 0.3 * t : Math.max(0, 1 - (adjusted - 0.6) / 0.4);
        if (brightness > 0.05) {
          grid[y][x] = { char: sym.char, color: dim(GOLD, brightness) };
        }
      }
    }
  }

  // Prompt hint during late fade
  if (phase === "fade" && progress > 0.6) {
    const promptBr = (progress - 0.6) / 0.4;
    const promptCol = centerX - 1;
    if (promptCol >= 0 && promptCol + 2 < cols) {
      grid[rows > centerY + 3 ? centerY + 3 : centerY][promptCol] = { char: ">", color: dim(GOLD, promptBr) };
    }
  }

  const globalBr = phase === "fade" ? Math.max(0, 1 - progress * 1.2) : 1;
  return renderGrid(grid, globalBr);
}

// ── Sound ─────────────────────────────────────────────────
function generateChimeWav(): Buffer {
  const sr = 22050;
  const dur = 0.7;
  const n = Math.floor(sr * dur);
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.exp(-t * 5) * (1 - Math.exp(-t * 120));
    const s =
      Math.sin(2 * Math.PI * 440 * t) * 0.18 +
      Math.sin(2 * Math.PI * 554 * t) * 0.11 +
      Math.sin(2 * Math.PI * 659 * t) * 0.07 +
      Math.sin(2 * Math.PI * 880 * t) * 0.03;
    const v = Math.floor(s * env * 32767);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, v)), 44 + i * 2);
  }
  return buf;
}

function playChimeAsync(): void {
  try {
    const wav = generateChimeWav();
    const tmpPath = join(tmpdir(), `ntox-chime-${Date.now()}.wav`);
    writeFileSync(tmpPath, wav);

    const cleanup = () => { try { unlinkSync(tmpPath); } catch { /* ok */ } };
    const callback = () => cleanup();

    if (process.platform === "win32") {
      exec(`powershell -c "(New-Object Media.SoundPlayer '${tmpPath}').PlaySync()"`, callback);
    } else if (process.platform === "darwin") {
      exec(`afplay "${tmpPath}"`, callback);
    } else {
      exec(`aplay "${tmpPath}" 2>/dev/null || paplay "${tmpPath}" 2>/dev/null || true`, callback);
    }
  } catch { /* sound is optional */ }
}

// ── Main ──────────────────────────────────────────────────
export async function playIntro(): Promise<void> {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  if (cols < 40 || rows < 8) return;

  const layout = computeLayout(cols, rows);

  try {
    process.stdout.write("\x1b[?25l");
    process.stdout.write("\x1b[2J");
  } catch { /* terminal doesn't support ANSI */ }

  let skip = false;

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(true); } catch { /* ok */ }
    process.stdin.resume();
    process.stdin.on("keypress", () => { skip = true; });
  }

  const startTime = Date.now();
  let chimePlayed = false;

  try {
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;

        if (skip || elapsed >= TOTAL_MS) {
          clearInterval(interval);
          process.stdout.write("\x1b[?25h");
          if (process.stdin.isTTY) {
            try { process.stdin.setRawMode(false); process.stdin.pause(); } catch { /* ok */ }
          }
          resolve();
          return;
        }

        const { phase, progress } = getPhase(elapsed);

        if (phase === "contact" && !chimePlayed) {
          chimePlayed = true;
          playChimeAsync();
        }

        try {
          const frame = renderFrame(phase, progress, layout, elapsed);
          process.stdout.write(frame);
        } catch { /* render error, continue */ }
      }, 33);
    });
  } catch { /* intro failed, clean up */ }
   finally {
    try { process.stdout.write("\x1b[?25h"); } catch { /* ok */ }
    if (process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); process.stdin.pause(); } catch { /* ok */ }
    }
  }
}

import chalk from "chalk";
import type { ThinkPhase } from "../types/index.js";
import { accents, paint, palette } from "./theme.js";

export interface PhaseIndicator {
  char: string;
  label: string;
  color: (s: string) => string;
  frames: string[];
}

const INDICATORS: Record<ThinkPhase, PhaseIndicator> = {
  thinking: {
    char: "⠿",
    label: "thinking",
    color: chalk.cyan,
    frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  },
  analyzing: {
    char: "◈",
    label: "analyzing",
    color: (s: string) => accents.warn(s),
    frames: ["◇", "◈", "◆", "◈"],
  },
  reasoning: {
    char: "▸",
    label: "reasoning",
    color: (s: string) => accents.violet(s),
    frames: ["▵", "▸", "▿", "◂"],
  },
  recalling: {
    char: "◉",
    label: "recalling",
    color: (s: string) => accents.good(s),
    frames: ["◌", "◎", "◉", "◎"],
  },
  responding: {
    char: "▹",
    label: "responding",
    color: (s: string) => accents.title(s),
    frames: ["▸", "▹", "▸", "▹", "▸", "▹"],
  },
  retrying: {
    char: "↻",
    label: "retrying",
    color: (s: string) => accents.warn(s),
    frames: ["↻", "⟳", "↻", "⟳"],
  },
};

export function getPhaseIndicator(phase: ThinkPhase): PhaseIndicator {
  return INDICATORS[phase];
}

export function renderPhaseFrame(phase: ThinkPhase, frameIndex: number): string {
  const ind = INDICATORS[phase];
  const char = ind.frames[frameIndex % ind.frames.length];
  return paint(palette.accent, char);
}

export function renderPhaseLabel(phase: ThinkPhase): string {
  const ind = INDICATORS[phase];
  return chalk.dim(ind.label);
}

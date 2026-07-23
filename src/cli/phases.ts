import chalk from "chalk";
import type { ThinkPhase } from "../types/index.js";

export interface PhaseIndicator {
  char: string;
  label: string;
  color: (s: string) => string;
  frames: string[];
}

const INDICATORS: Record<ThinkPhase, PhaseIndicator> = {
  thinking: {
    char: "\u280B",
    label: "thinking",
    color: chalk.cyan,
    frames: ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"],
  },
  analyzing: {
    char: "\u25C7",
    label: "analyzing",
    color: chalk.yellow,
    frames: ["\u25C7", "\u25C6", "\u25C7"],
  },
  reasoning: {
    char: "\u25B3",
    label: "reasoning",
    color: chalk.magenta,
    frames: ["\u25B3", "\u25B2", "\u25B3"],
  },
  recalling: {
    char: "\u25CE",
    label: "recalling",
    color: chalk.green,
    frames: ["\u25CE", "\u25CF", "\u25CE"],
  },
  responding: {
    char: "\u25B8",
    label: "responding",
    color: chalk.cyan,
    frames: ["\u25B8", "\u25B9", "\u25B8"],
  },
};

export function getPhaseIndicator(phase: ThinkPhase): PhaseIndicator {
  return INDICATORS[phase];
}

export function renderPhaseFrame(phase: ThinkPhase, frameIndex: number): string {
  const ind = INDICATORS[phase];
  const char = ind.frames[frameIndex % ind.frames.length];
  return ind.color(char);
}

export function renderPhaseLabel(phase: ThinkPhase): string {
  const ind = INDICATORS[phase];
  return chalk.dim(ind.label);
}

import type { ProfileVoice } from "../mind/profile.js";
import type { AudioConfig } from "./types.js";

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function ttsInstructionsFromProfile(voice: ProfileVoice): string {
  const directness = clamp(voice.directness);
  const verbosity = clamp(voice.verbosity);
  const shape =
    directness > 0.6
      ? "Be concise and go straight to the point."
      : directness < 0.4
        ? "Soften the delivery with brief acknowledgements."
        : "Keep a balanced, matter-of-fact delivery.";
  const length =
    verbosity > 0.6
      ? "Allow a little more detail."
      : verbosity < 0.4
        ? "Keep answers short."
        : "Use medium-length answers.";
  return `Speak with directness ${directness.toFixed(2)} and verbosity ${verbosity.toFixed(2)}. ${shape} ${length} Preserve calibration: admit uncertainty instead of asserting with false confidence.`;
}

export function resolveTtsInstructions(config: AudioConfig, voice?: ProfileVoice): string | undefined {
  return config.ttsStyle === "profile" && voice ? ttsInstructionsFromProfile(voice) : undefined;
}

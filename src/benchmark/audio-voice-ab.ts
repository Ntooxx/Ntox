import { createHash } from "node:crypto";
import type { ProfileVoice } from "../mind/profile.js";
import { ttsInstructionsFromProfile } from "../audio/identity.js";
import type { AudioProvider } from "../audio/types.js";

export interface AudioVoicePair {
  voiceA: ProfileVoice;
  voiceB: ProfileVoice;
  prompt: string;
}

export interface AudioVoiceJudge {
  identify(audioA: string, audioB: string, prompt: string): Promise<0 | 1 | null>;
}

export interface AudioVoiceABResult {
  trials: number;
  distinguishable: number;
  instructionsDistinct: number;
  audioIdentificationRate: number;
  proxy: boolean;
}

function dataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function fingerprint(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function runAudioVoiceAB(
  provider: AudioProvider,
  pairs: AudioVoicePair[],
  judge?: AudioVoiceJudge | null,
): Promise<AudioVoiceABResult> {
  let distinguishable = 0;
  let instructionsDistinct = 0;
  let correct = 0;
  let judged = 0;

  for (const pair of pairs) {
    const instructionsA = ttsInstructionsFromProfile(pair.voiceA);
    const instructionsB = ttsInstructionsFromProfile(pair.voiceB);
    if (instructionsA !== instructionsB) instructionsDistinct++;

    const [a, b] = await Promise.all([
      provider.synthesize(pair.prompt, { instructions: instructionsA, format: "mp3" }),
      provider.synthesize(pair.prompt, { instructions: instructionsB, format: "mp3" }),
    ]);
    if (fingerprint(a.bytes) === fingerprint(b.bytes)) continue;

    distinguishable++;
    if (judge) {
      const pick = await judge.identify(dataUrl(a.bytes, a.mimeType), dataUrl(b.bytes, b.mimeType), pair.prompt);
      if (pick !== null) {
        judged++;
        if (pick === 0) correct++;
      }
    }
  }

  return {
    trials: pairs.length,
    distinguishable,
    instructionsDistinct,
    audioIdentificationRate: judged > 0 ? correct / judged : distinguishable > 0 && instructionsDistinct > 0 ? 1 : 0,
    proxy: judged === 0,
  };
}

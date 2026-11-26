import chalk from "chalk";
import {
  assertAudioToolAllowed,
  createRealtimeSession,
  resolveAudioProviders,
  resolveTtsInstructions,
  type RealtimeSession,
} from "../audio/index.js";
import { getVoiceSettings, voiceReplyText } from "../gateway/voice-mode.js";
import type { ProfileVoice } from "../mind/profile.js";
import type { NtoxConfig } from "../types/index.js";
import { startRecorder, type RecorderSession } from "./voice-input.js";
import { playDataUrlAudio } from "./voice-output.js";

export interface ReplVoiceHost {
  config: NtoxConfig;
  sessionId: string;
  currentProfileVoice(): ProfileVoice | undefined;
  onTranscript(text: string): Promise<void>;
  setProcessing(value: boolean): void;
}

/** Mic, playback and live-session state for the CLI REPL, kept out of the main loop. */
export class ReplVoice {
  private recorder: RecorderSession | null = null;
  private live: RealtimeSession | null = null;
  private speaking = false;
  private reply = "";

  constructor(private readonly host: ReplVoiceHost) {}

  hasPendingRecording(): boolean {
    return this.recorder !== null;
  }

  resetReply(): void {
    this.reply = "";
  }

  appendReply(token: string): void {
    if (this.speaking && token) this.reply += token;
  }

  async syncLiveSession(): Promise<void> {
    const settings = getVoiceSettings("repl", this.host.sessionId);
    if (!settings.live) {
      this.live?.close();
      this.live = null;
      return;
    }
    if (this.live) return;
    try {
      const session = createRealtimeSession(this.host.config, {
        voice: settings.voice,
        instructions: resolveTtsInstructions(this.host.config, this.host.currentProfileVoice()),
      });
      session.onAudio(async (bytes) => {
        const dataUrl = `data:audio/mpeg;base64,${Buffer.from(bytes).toString("base64")}`;
        const played = await playDataUrlAudio(dataUrl);
        if (!played.ok) console.log(chalk.yellow(`[voice] ${played.error}`));
      });
      await session.ready;
      this.live = session;
      console.log("[voice] live conversation ready");
    } catch (e) {
      console.log(chalk.yellow(`[voice] live unavailable: ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  async speakLastReply(): Promise<void> {
    if (!this.speaking || !this.reply.trim()) return;
    try {
      assertAudioToolAllowed(this.host.config, "tts");
      const { tts } = resolveAudioProviders(this.host.config);
      const result = await tts.synthesize(voiceReplyText(this.reply), {
        instructions: resolveTtsInstructions(this.host.config, this.host.currentProfileVoice()),
        format: "mp3",
      });
      const dataUrl = `data:${result.mimeType};base64,${Buffer.from(result.bytes).toString("base64")}`;
      const played = await playDataUrlAudio(dataUrl);
      if (!played.ok) console.log(chalk.yellow(`[voice] playback failed: ${played.error}`));
    } catch (e) {
      console.log(chalk.yellow(`[voice] ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  async captureTurn(): Promise<void> {
    const recorder = this.recorder;
    if (!recorder) return;
    this.recorder = null;
    try {
      const bytes = await recorder.stop();
      if (this.live) {
        this.live.sendAudio(bytes);
        this.live.commitAudio();
        this.live.requestResponse();
        return;
      }
      const { stt } = resolveAudioProviders(this.host.config);
      const transcript = (await stt.transcribe(bytes, { filename: "audio.wav" })).text.trim();
      if (!transcript) {
        console.log(chalk.yellow("[mic] no speech detected"));
        return;
      }
      console.log(chalk.cyan(`[mic] ${transcript}`));
      this.host.setProcessing(true);
      this.resetReply();
      await this.host.onTranscript(transcript);
      this.host.setProcessing(false);
      await this.speakLastReply();
    } catch (e) {
      this.host.setProcessing(false);
      console.error(chalk.red(`[mic] ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  handleMic(arg: string): void {
    const mode = arg.toLowerCase();
    if (mode === "off") {
      this.recorder?.cancel();
      this.recorder = null;
      console.log("[mic] off");
      return;
    }
    if (mode !== "on" && mode !== "auto") {
      console.log(chalk.yellow("Usage: /mic on|off|auto"));
      return;
    }
    try {
      assertAudioToolAllowed(this.host.config, "stt");
      this.recorder = startRecorder();
      console.log(`[mic] ${mode} — press Enter when finished speaking`);
    } catch (e) {
      console.log(chalk.yellow(`[mic] ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  handleSpeak(arg: string): void {
    const mode = arg.toLowerCase();
    if (mode !== "on" && mode !== "off") {
      console.log(chalk.yellow("Usage: /speak on|off"));
      return;
    }
    this.speaking = mode === "on";
    console.log(`[speak] ${mode}`);
  }
}

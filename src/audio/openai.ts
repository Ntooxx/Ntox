import { AUDIO_FORMAT_MIME, resolveFormat, type AudioConfig, type AudioProvider, type SynthesizeOptions, type TranscribeOptions } from "./types.js";

const DEFAULT_BASE = "https://api.openai.com/v1";

export function createOpenAiAudio(config: AudioConfig): AudioProvider {
  const base = (config.audioBaseUrl || DEFAULT_BASE).replace(/\/$/, "");

  return {
    async transcribe(audio, options: TranscribeOptions = {}) {
      const key = config.sttApiKey || config.apiKey;
      if (!key) throw new Error("No API key configured. Set sttApiKey or apiKey to use STT.");
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), options.filename || "audio.mp3");
      form.append("model", config.sttModel);
      const res = await fetch(`${base}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: options.signal,
      });
      if (!res.ok) throw new Error(`STT API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const result = (await res.json()) as { text: string };
      return { text: result.text, model: config.sttModel };
    },

    async synthesize(text, options: SynthesizeOptions = {}) {
      const key = config.ttsApiKey || config.apiKey;
      if (!key) throw new Error("No API key configured. Set ttsApiKey or apiKey to use TTS.");
      const format = resolveFormat(options.format);
      const voice = options.voice || config.ttsVoice;
      const body: Record<string, unknown> = {
        model: config.ttsModel,
        input: text,
        voice,
        response_format: format,
      };
      if (options.instructions) body.instructions = options.instructions;
      const res = await fetch(`${base}/audio/speech`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options.signal,
      });
      if (!res.ok) throw new Error(`TTS API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        mimeType: AUDIO_FORMAT_MIME[format],
        model: config.ttsModel,
        voice,
        format,
      };
    },
  };
}

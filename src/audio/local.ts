import { AUDIO_FORMAT_MIME, resolveFormat, type AudioConfig, type AudioProvider } from "./types.js";

function localUrl(config: AudioConfig, envKey: string, path: string): string {
  const explicit = process.env[envKey];
  const base = (explicit || config.audioBaseUrl).replace(/\/$/, "");
  if (!base) throw new Error("Local audio provider requires audioBaseUrl or a local endpoint environment variable.");
  return `${base}${path}`;
}

export function createLocalAudio(config: AudioConfig): AudioProvider {
  return {
    async transcribe(audio, options = {}) {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), options.filename || "audio.mp3");
      form.append("model", config.sttModel);
      const res = await fetch(localUrl(config, "NTOX_LOCAL_STT_URL", "/audio/transcriptions"), {
        method: "POST",
        body: form,
        signal: options.signal,
      });
      if (!res.ok) throw new Error(`Local STT error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return { text: ((await res.json()) as { text: string }).text, model: config.sttModel };
    },
    async synthesize(text, options = {}) {
      const format = resolveFormat(options.format);
      const voice = options.voice || config.ttsVoice;
      const body: Record<string, unknown> = { model: config.ttsModel, input: text, voice, response_format: format };
      if (options.instructions) body.instructions = options.instructions;
      const res = await fetch(localUrl(config, "NTOX_LOCAL_TTS_URL", "/audio/speech"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options.signal,
      });
      if (!res.ok) throw new Error(`Local TTS error ${res.status}: ${(await res.text()).slice(0, 300)}`);
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

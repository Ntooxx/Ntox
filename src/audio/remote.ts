import { AUDIO_FORMAT_MIME, resolveFormat, type AudioConfig, type AudioProvider } from "./types.js";

const GROQ_BASE = "https://api.groq.com/openai/v1";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export function createGroqStt(config: AudioConfig): AudioProvider {
  const base = (config.audioBaseUrl || GROQ_BASE).replace(/\/$/, "");
  return {
    async transcribe(audio, options = {}) {
      const key = config.sttApiKey || process.env.GROQ_API_KEY || config.apiKey;
      if (!key) throw new Error("No Groq API key configured. Set sttApiKey or GROQ_API_KEY.");
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), options.filename || "audio.mp3");
      form.append("model", config.sttModel);
      const res = await fetch(`${base}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: options.signal,
      });
      if (!res.ok) throw new Error(`Groq STT error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return { text: ((await res.json()) as { text: string }).text, model: config.sttModel };
    },
    async synthesize() {
      throw new Error("Groq TTS is not supported. Choose ttsProvider openai, openrouter or local.");
    },
  };
}

export function createOpenRouterTts(config: AudioConfig): AudioProvider {
  const base = (config.audioBaseUrl || OPENROUTER_BASE).replace(/\/$/, "");
  return {
    async transcribe() {
      throw new Error("OpenRouter STT is not supported. Choose sttProvider openai, groq or local.");
    },
    async synthesize(text, options = {}) {
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
      if (!res.ok) throw new Error(`OpenRouter TTS error ${res.status}: ${(await res.text()).slice(0, 300)}`);
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

import type { Tool, ToolResult } from "../types/index.js";
import { loadConfig } from "../core/config.js";

const VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;

const FORMAT_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/pcm",
};

export const ttsTool: Tool = {
  name: "tts",
  description: "Convert text to speech using OpenAI TTS API. Returns audio as a base64-encoded data URL.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "Text to convert to speech" },
      voice: { type: "string", enum: [...VOICES], description: "Voice to use (default: alloy)" },
      format: {
        type: "string",
        enum: Object.keys(FORMAT_MIME),
        description: "Audio format (default: mp3; use opus for Telegram/WhatsApp voice notes)",
      },
    },
    required: ["text"],
  },
  async execute(args): Promise<ToolResult> {
    const text = String(args.text);
    if (!text) return { success: false, error: "Text is required" };

    const voice = args.voice && VOICES.includes(args.voice as (typeof VOICES)[number]) ? String(args.voice) : "alloy";
    const format = args.format && FORMAT_MIME[String(args.format)] ? String(args.format) : "mp3";

    const config = loadConfig();
    if (!config.apiKey) {
      return { success: false, error: "No API key configured. Set apiKey in config to use TTS." };
    }

    try {
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "tts-1",
          input: text,
          voice,
          response_format: format,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        return { success: false, error: `TTS API error ${res.status}: ${errBody.slice(0, 300)}` };
      }

      const arrayBuffer = await res.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const dataUrl = `data:${FORMAT_MIME[format]};base64,${base64}`;

      return { success: true, data: { audio: dataUrl, voice, format } };
    } catch (e) {
      return { success: false, error: `TTS error: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};

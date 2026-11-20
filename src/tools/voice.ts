import type { Tool, ToolResult } from "../types/index.js";
import { resolveAudioFromConfig, AUDIO_FORMAT_MIME, TTS_VOICES, resolveFormat } from "../audio/index.js";

export const ttsTool: Tool = {
  name: "tts",
  description: "Convert text to speech using the configured TTS provider. Returns audio as a base64-encoded data URL.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "Text to convert to speech" },
      voice: { type: "string", enum: [...TTS_VOICES], description: "Voice to use (default: config ttsVoice)" },
      format: {
        type: "string",
        enum: Object.keys(AUDIO_FORMAT_MIME),
        description: "Audio format (default: mp3; use opus for Telegram/WhatsApp voice notes)",
      },
      instructions: { type: "string", description: "Optional timbre instructions for expressive TTS models" },
    },
    required: ["text"],
  },
  async execute(args): Promise<ToolResult> {
    const text = String(args.text);
    if (!text) return { success: false, error: "Text is required" };

    const voice = args.voice && TTS_VOICES.includes(args.voice as (typeof TTS_VOICES)[number]) ? String(args.voice) : undefined;
    const format = resolveFormat(args.format);

    try {
      const { tts } = resolveAudioFromConfig();
      const result = await tts.synthesize(text, {
        voice,
        format,
        instructions: typeof args.instructions === "string" && args.instructions ? args.instructions : undefined,
      });
      const audio = `data:${result.mimeType};base64,${Buffer.from(result.bytes).toString("base64")}`;
      return { success: true, data: { audio, voice: result.voice, format: result.format, model: result.model } };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { success: false, error: message.includes("No API key") ? message : `TTS error: ${message}` };
    }
  },
};

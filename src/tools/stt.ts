import { readFileSync, existsSync } from "node:fs";
import type { Tool, ToolResult } from "../types/index.js";
import { loadConfig } from "../core/config.js";

export const sttTool: Tool = {
  name: "stt",
  description: "Transcribe audio to text using OpenAI Whisper API. Accepts base64-encoded audio or a file path.",
  parameters: {
    type: "object",
    properties: {
      audio: { type: "string", description: "Base64-encoded audio data or path to an audio file" },
    },
    required: ["audio"],
  },
  async execute(args): Promise<ToolResult> {
    const audioInput = String(args.audio);
    if (!audioInput) return { success: false, error: "Audio input is required" };

    const config = loadConfig();
    if (!config.apiKey) {
      return { success: false, error: "No API key configured. Set apiKey in config to use STT." };
    }

    let audioBuffer: Buffer;
    let filename = "audio.mp3";

    if (existsSync(audioInput)) {
      audioBuffer = readFileSync(audioInput);
      const ext = audioInput.split(".").pop();
      if (ext) filename = `audio.${ext}`;
    } else {
      const base64Data = audioInput.includes(",") ? audioInput.split(",").pop()! : audioInput;
      audioBuffer = Buffer.from(base64Data, "base64");
    }

    try {
      const uint8 = new Uint8Array(audioBuffer);
      const blob = new Blob([uint8], { type: "audio/mpeg" });
      const form = new FormData();
      form.append("file", blob, filename);
      form.append("model", "whisper-1");

      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.apiKey}`,
        },
        body: form,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        return { success: false, error: `STT API error ${res.status}: ${errBody.slice(0, 300)}` };
      }

      const result = await res.json() as { text: string };
      return { success: true, data: { text: result.text } };
    } catch (e) {
      return { success: false, error: `STT error: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};

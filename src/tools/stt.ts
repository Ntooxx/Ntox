import { readFileSync, existsSync } from "node:fs";
import type { Tool, ToolResult } from "../types/index.js";
import { resolveAudioFromConfig } from "../audio/index.js";

export const sttTool: Tool = {
  name: "stt",
  description: "Transcribe audio to text using the configured STT provider. Accepts base64-encoded audio or a file path.",
  parameters: {
    type: "object",
    properties: {
      audio: { type: "string", description: "Base64-encoded audio data or path to an audio file" },
      filename: { type: "string", description: "Filename hint with extension when audio is base64 (e.g. audio.webm)" },
    },
    required: ["audio"],
  },
  async execute(args): Promise<ToolResult> {
    const audioInput = String(args.audio);
    if (!audioInput) return { success: false, error: "Audio input is required" };

    let audioBuffer: Buffer;
    let filename = "audio.mp3";

    if (existsSync(audioInput)) {
      audioBuffer = readFileSync(audioInput);
      const ext = audioInput.split(".").pop();
      if (ext) filename = `audio.${ext}`;
    } else {
      const base64Data = audioInput.includes(",") ? audioInput.split(",").pop()! : audioInput;
      audioBuffer = Buffer.from(base64Data, "base64");
      const hinted = String(args.filename || "")
        .replace(/[^\w.-]/g, "")
        .replace(/\.+$/, "");
      if (/^[\w-]+\.[a-z0-9]{2,5}$/i.test(hinted)) filename = hinted;
    }

    try {
      const { stt } = resolveAudioFromConfig();
      const result = await stt.transcribe(new Uint8Array(audioBuffer), { filename });
      return { success: true, data: { text: result.text, model: result.model } };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { success: false, error: message.includes("No API key") ? message : `STT error: ${message}` };
    }
  },
};

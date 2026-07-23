import type { Tool, ToolResult } from "../types/index.js";
import { loadConfig } from "../core/config.js";

async function analyzeImage(apiKey: string, image: string, prompt: string): Promise<ToolResult> {
  let imageUrl: string;

  if (image.startsWith("http://") || image.startsWith("https://")) {
    imageUrl = image;
  } else if (image.startsWith("data:")) {
    imageUrl = image;
  } else {
    const base64Data = image.includes(",") ? image.split(",").pop()! : image;
    imageUrl = `data:image/png;base64,${base64Data}`;
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    return { success: false, error: `Vision API error ${res.status}: ${errBody.slice(0, 300)}` };
  }

  const result = await res.json() as { choices: { message: { content: string } }[] };
  return { success: true, data: { text: result.choices[0].message.content } };
}

async function generateImage(apiKey: string, prompt: string, size: string): Promise<ToolResult> {
  const validSizes = ["1024x1024", "1792x1024", "1024x1792"];
  const imageSize = validSizes.includes(size) ? size : "1024x1024";

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: imageSize,
      response_format: "b64_json",
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    return { success: false, error: `DALL-E API error ${res.status}: ${errBody.slice(0, 300)}` };
  }

  const result = await res.json() as { data: { b64_json: string; revised_prompt?: string }[] };
  const dataUrl = `data:image/png;base64,${result.data[0].b64_json}`;
  return {
    success: true,
    data: { image: dataUrl, revisedPrompt: result.data[0].revised_prompt },
  };
}

export const imageTool: Tool = {
  name: "image",
  description: "Analyze an image with GPT-4o Vision or generate an image with DALL-E 3. For analysis, provide image (base64/URL) and optional prompt. For generation, set mode to 'generate'.",
  parameters: {
    type: "object",
    properties: {
      image: { type: "string", description: "Image as base64 string, data URL, or HTTP URL (for analysis)" },
      prompt: { type: "string", description: "Question about the image (analysis) or description (generation)" },
      mode: { type: "string", enum: ["analyze", "generate"], description: "Mode: analyze (default) or generate" },
      size: { type: "string", enum: ["1024x1024", "1792x1024", "1024x1792"], description: "Image size for generation (default: 1024x1024)" },
    },
    required: [],
  },
  async execute(args): Promise<ToolResult> {
    const config = loadConfig();
    if (!config.apiKey) {
      return { success: false, error: "No API key configured. Set apiKey in config to use image tools." };
    }

    const mode = args.mode ? String(args.mode) : "analyze";

    if (mode === "generate") {
      const prompt = args.prompt ? String(args.prompt) : "";
      if (!prompt) return { success: false, error: "Prompt is required for image generation" };
      const size = args.size ? String(args.size) : "1024x1024";
      return generateImage(config.apiKey, prompt, size);
    }

    const image = args.image ? String(args.image) : "";
    if (!image) return { success: false, error: "Image is required for analysis" };
    const prompt = args.prompt ? String(args.prompt) : "Describe this image in detail.";
    return analyzeImage(config.apiKey, image, prompt);
  },
};

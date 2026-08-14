import { afterEach, describe, it, expect, vi } from "vitest";
import {
  LLMClient,
  getProviderNames,
  getProviders,
  formatTokenCount,
  formatCost,
  countTokens,
  countMessageTokens,
  providerRequiresKey,
  estimateCost,
  LOCAL_PROVIDERS,
  toOpenAIMessages,
} from "./llm.js";
import type { ModelInfo } from "../types/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("countTokens", () => {
  it("counts tokens in text", () => {
    expect(countTokens("")).toBe(0);
    expect(countTokens("hello")).toBeGreaterThan(0);
  });

  it("counts longer text proportionally", () => {
    const short = countTokens("hi");
    const long = countTokens("this is a much longer piece of text with many words");
    expect(long).toBeGreaterThan(short);
  });
});

describe("countMessageTokens", () => {
  it("sums tokens across messages", () => {
    const total = countMessageTokens([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);
    expect(total).toBeGreaterThan(0);
  });

  it("returns 0 for empty array", () => {
    expect(countMessageTokens([])).toBe(0);
  });
});

describe("toOpenAIMessages", () => {
  it("wraps internal tool calls in OpenAI function envelopes", () => {
    const messages = toOpenAIMessages(
      [
        { role: "user", content: "browse this" },
        {
          role: "assistant",
          content: "(tool call)",
          tool_calls: [{ id: "call_1", name: "browse", arguments: '{"url":"https://example.com"}' }],
        },
        { role: "tool", tool_call_id: "call_1", name: "browse", content: '{"success":true}' },
      ],
      "system",
    );

    expect(messages[0]).toEqual({ role: "system", content: "system" });
    expect(messages[2].tool_calls?.[0]).toEqual({
      id: "call_1",
      type: "function",
      function: { name: "browse", arguments: '{"url":"https://example.com"}' },
    });
    expect(messages[3]).toEqual({ role: "tool", content: '{"success":true}', tool_call_id: "call_1" });
  });
});

describe("providerRequiresKey", () => {
  it("openrouter requires key", () => {
    expect(providerRequiresKey("openrouter")).toBe(true);
  });

  it("ollama does not require key", () => {
    expect(providerRequiresKey("ollama")).toBe(false);
  });

  it("lmstudio does not require key", () => {
    expect(providerRequiresKey("lmstudio")).toBe(false);
  });
});

describe("LOCAL_PROVIDERS", () => {
  it("includes ollama and lmstudio", () => {
    expect(LOCAL_PROVIDERS).toContain("ollama");
    expect(LOCAL_PROVIDERS).toContain("lmstudio");
  });
});

describe("estimateCost", () => {
  const models: ModelInfo[] = [
    {
      id: "test-model",
      name: "Test Model",
      provider: "openai",
      pricing: { prompt: 0.5, completion: 1.5 },
      context_length: 4096,
    },
  ];

  it("estimates cost based on pricing", () => {
    const cost = estimateCost("test-model", 1000, 500, models);
    expect(cost).toBeGreaterThan(0);
  });

  it("returns 0 for unknown model", () => {
    const cost = estimateCost("unknown/model", 1000, 500, []);
    expect(cost).toBe(0);
  });
  it("returns 0 for empty model list", () => {
    const cost = estimateCost("test-model", 1000, 500, []);
    expect(cost).toBe(0);
  });

  it("handles zero tokens", () => {
    const cost = estimateCost("test-model", 0, 0, models);
    expect(cost).toBe(0);
  });
});

describe("getProviders", () => {
  it("returns all provider IDs", () => {
    const providers = getProviders();
    expect(providers).toContain("openrouter");
    expect(providers).toContain("openai");
    expect(providers).toContain("anthropic");
    expect(providers).toContain("groq");
    expect(providers).toContain("deepseek");
    expect(providers).toContain("ollama");
    expect(providers).toContain("lmstudio");
  });

  it("includes openai-compatible", () => {
    expect(getProviders()).toContain("openai-compatible");
  });
});

describe("getProviderNames", () => {
  it("returns human-readable names", () => {
    const names = getProviderNames();
    expect(names.openrouter).toBe("OpenRouter");
    expect(names.openai).toBe("OpenAI");
    expect(names.anthropic).toBe("Anthropic");
  });
});

describe("OpenRouter model discovery", () => {
  it("returns only the live OpenRouter catalog and normalizes its metadata", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "zeta/model",
              name: "Zeta",
              context_length: 200000,
              pricing: { prompt: "0.2", completion: "0.4" },
            },
            {
              id: "alpha/model",
              name: "Alpha",
              context_length: 128000,
              pricing: { prompt: "0", completion: "0" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const client = new LLMClient("key", "alpha/model", "openai/text-embedding-3-small", 1024, 0.7);

    const models = await client.fetchModels();

    expect(fetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({ headers: { Authorization: "Bearer key" } }),
    );
    expect(models.map((model) => model.id)).toEqual(["alpha/model", "zeta/model"]);
    expect(models[0]).toMatchObject({
      provider: "openrouter",
      pricing: { prompt: 0, completion: 0 },
      context_length: 128000,
    });
  });
});

describe("formatTokenCount", () => {
  it("formats small numbers", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(500)).toBe("500");
    expect(formatTokenCount(999)).toBe("999");
  });

  it("formats thousands", () => {
    expect(formatTokenCount(1000)).toBe("1.0k");
    expect(formatTokenCount(1500)).toBe("1.5k");
    expect(formatTokenCount(12345)).toBe("12.3k");
  });
});

describe("formatCost", () => {
  it("formats zero", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("formats small costs", () => {
    expect(formatCost(0.0001)).toBe("$0.00");
    expect(formatCost(0.001)).toBe("$0.0010");
    expect(formatCost(0.005)).toBe("$0.0050");
  });

  it("formats normal costs", () => {
    expect(formatCost(0.01)).toBe("$0.010");
    expect(formatCost(0.15)).toBe("$0.150");
    expect(formatCost(1.5)).toBe("$1.500");
  });
});

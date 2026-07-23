import { describe, it, expect } from "vitest";
import {
  getProviderNames, getProviders, formatTokenCount, formatCost,
  countTokens, countMessageTokens, providerRequiresKey,
  estimateCost, LOCAL_PROVIDERS,
} from "./llm.js";
import type { ModelInfo } from "../types/index.js";

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

import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { createSettingsService } from "./settings.js";
import { LLMClient } from "../core/llm.js";
import { CONFIG_PATH, MODELS_CACHE_PATH, loadConfig, saveConfig } from "../core/config.js";
import type { NtoxConfig } from "../types/index.js";

afterEach(() => {
  for (const p of [CONFIG_PATH, MODELS_CACHE_PATH]) {
    if (existsSync(p)) unlinkSync(p);
  }
});

function freshConfig(): NtoxConfig {
  const base = loadConfig();
  const config: NtoxConfig = {
    ...base,
    model: "openai/gpt-4o-mini",
    provider: "openrouter",
    uiMode: "normal",
    memoryEnabled: true,
    cognitiveEnabled: true,
  };
  saveConfig(config);
  return config;
}

describe("createSettingsService", () => {
  it("returns a settings view with providers", () => {
    const config = freshConfig();
    const llm = new LLMClient("", config.model, config.embeddingModel, 1024, 0.7, "", config.provider);
    const settings = createSettingsService({ config, llm });
    const view = settings.get();
    expect(view.model).toBe("openai/gpt-4o-mini");
    expect(view.provider).toBe("openrouter");
    expect(view.providers.some((p) => p.id === "openrouter")).toBe(true);
    expect(view.providers.some((p) => p.id === "anthropic")).toBe(true);
  });

  it("sets model on config and llm client", () => {
    const config = freshConfig();
    const llm = new LLMClient("", config.model, config.embeddingModel, 1024, 0.7, "", config.provider);
    const settings = createSettingsService({ config, llm });
    const result = settings.setModel("anthropic/claude-3-5-sonnet");
    expect(result.ok).toBe(true);
    expect(config.model).toBe("anthropic/claude-3-5-sonnet");
    expect(llm.updateModel).toBeDefined();
    expect(settings.get().model).toBe("anthropic/claude-3-5-sonnet");
    const reloaded = loadConfig();
    expect(reloaded.model).toBe("anthropic/claude-3-5-sonnet");
  });

  it("rejects empty model and unknown provider", () => {
    const config = freshConfig();
    const llm = new LLMClient("", config.model, config.embeddingModel, 1024, 0.7, "", config.provider);
    const settings = createSettingsService({ config, llm });
    expect(settings.setModel("   ").ok).toBe(false);
    expect(settings.setProvider("not-a-provider").ok).toBe(false);
    expect(settings.setProvider("ollama").ok).toBe(true);
    expect(config.provider).toBe("ollama");
  });

  it("lists cached models and tolerates empty refresh", async () => {
    const config = freshConfig();
    const llm = new LLMClient("key", config.model, config.embeddingModel, 1024, 0.7, "", "openrouter");
    vi.spyOn(llm, "fetchModels").mockResolvedValue([]);
    const settings = createSettingsService({ config, llm });
    expect(settings.listModels()).toEqual([]);
    const models = await settings.refreshModels();
    expect(Array.isArray(models)).toBe(true);
    expect(models).toEqual([]);
  });
});

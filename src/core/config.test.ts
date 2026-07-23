import { describe, it, expect, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { NTOX_DIR, loadConfig, saveConfig, validateConfig } from "./config.js";
import type { NtoxConfig } from "../types/index.js";

describe("validateConfig", () => {
  const valid: NtoxConfig = {
    apiKey: "sk-test",
    model: "openai/gpt-4o",
    provider: "openai",
    apiBaseUrl: "",
    maxTokens: 4096,
    temperature: 0.7,
    systemPrompt: "You are helpful.",
    embeddingModel: "openai/text-embedding-3-small",
    memoryEnabled: true,
    memoryRetrievalCount: 5,
    metaStrategyEnabled: true,
    metaReflectionEnabled: false,
    metaMistakesEnabled: true,
    metaMinConfidence: 0.5,
    cognitiveEnabled: true,
    theoryEnabled: true,
    soundEnabled: false,
    soundVolume: 50,
    animationLevel: "minimal",
    telegramToken: "",
    telegramAllowedUsers: [],
    discordToken: "",
    discordAllowedUsers: [],
    whatsappToken: "",
    whatsappPhoneNumberId: "",
    whatsappVerifyToken: "",
    whatsappPort: 3001,
    dockerEnabled: false,
    webPort: 3000,
  };

  it("passes valid config", () => {
    expect(validateConfig(valid).valid).toBe(true);
  });

  it("rejects empty model", () => {
    const r = validateConfig({ ...valid, model: "" });
    expect(r.valid).toBe(false);
  });

  it("rejects negative maxTokens", () => {
    const r = validateConfig({ ...valid, maxTokens: -1 });
    expect(r.valid).toBe(false);
  });

  it("rejects temperature out of range", () => {
    expect(validateConfig({ ...valid, temperature: 3 }).valid).toBe(false);
    expect(validateConfig({ ...valid, temperature: -0.5 }).valid).toBe(false);
  });

  it("rejects metaMinConfidence out of range", () => {
    expect(validateConfig({ ...valid, metaMinConfidence: 1.5 }).valid).toBe(false);
    expect(validateConfig({ ...valid, metaMinConfidence: -0.1 }).valid).toBe(false);
  });

  it("rejects sound volume out of range", () => {
    expect(validateConfig({ ...valid, soundVolume: 150 }).valid).toBe(false);
    expect(validateConfig({ ...valid, soundVolume: -10 }).valid).toBe(false);
  });

  it("returns error messages for invalid config", () => {
    const r = validateConfig({ ...valid, model: "", maxTokens: -5 });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("accepts populated allowed users", () => {
    const r = validateConfig({ ...valid, telegramAllowedUsers: ["user1", "user2"] });
    expect(r.valid).toBe(true);
  });
});

describe("config", () => {
  afterEach(() => {
    const configPath = NTOX_DIR + "/config.json";
    if (existsSync(configPath)) unlinkSync(configPath);
  });

  const cfgPath = () => NTOX_DIR + "/config.json";

  it("loads with defaults when no config exists", () => {
    if (existsSync(cfgPath())) unlinkSync(cfgPath());
    const config = loadConfig();
    expect(config.model).toBe("openai/gpt-4o-mini");
    expect(config.maxTokens).toBe(4096);
    expect(config.temperature).toBe(0.7);
    expect(config.memoryEnabled).toBe(true);
  });

  it("loads with cognitive kernel enabled by default", () => {
    if (existsSync(cfgPath())) unlinkSync(cfgPath());
    const config = loadConfig();
    expect(config.cognitiveEnabled).toBe(true);
  });

  it("saves and loads config correctly", () => {
    const testConfig: Partial<NtoxConfig> = {
      model: "openai/gpt-4o",
      maxTokens: 8192,
      temperature: 0.5,
    };
    saveConfig(testConfig as NtoxConfig);
    const loaded = loadConfig();
    expect(loaded.model).toBe("openai/gpt-4o");
    expect(loaded.maxTokens).toBe(8192);
    expect(loaded.temperature).toBe(0.5);
  });

  it("merges partial config with defaults", () => {
    if (existsSync(cfgPath())) unlinkSync(cfgPath());
    saveConfig({ model: "ollama/llama3" } as NtoxConfig);
    const loaded = loadConfig();
    expect(loaded.model).toBe("ollama/llama3");
    expect(loaded.maxTokens).toBe(4096); // default preserved
    expect(loaded.memoryEnabled).toBe(true); // default preserved
  });
});

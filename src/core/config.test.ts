import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { NTOX_DIR, hasLegacyToolPrompt, loadConfig, normalizeConfig, saveConfig, validateConfig } from "./config.js";
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
    systemContextBudget: 6000,
    contextCompilerEnabled: true,
    predictionLlmEnabled: true,
    modelCritiqueEnabled: true,
    idleEnabled: true,
    idleSelfPlay: false,
    metaStrategyEnabled: true,
    metaReflectionEnabled: false,
    metaMistakesEnabled: true,
    metaMinConfidence: 0.5,
    cognitiveEnabled: true,
    theoryEnabled: true,
    animationLevel: "minimal",
    uiMode: "normal",
    telegramToken: "",
    telegramAllowedUsers: [],
    discordToken: "",
    discordAllowedUsers: [],
    whatsappToken: "",
    whatsappPhoneNumberId: "",
    whatsappVerifyToken: "",
    whatsappAppSecret: "",
    whatsappPort: 3001,
    dockerEnabled: false,
    webPort: 3000,
    webHost: "127.0.0.1",
    webAuthToken: "",
    apiPort: 3100,
    apiAuthToken: "",
    introEnabled: true,
    verboseCallbacks: false,
    defaultProfileId: "default",
    profiles: [
      {
        id: "default",
        name: "Default Workspace",
        workspaceRoot: process.cwd(),
        readRoots: [process.cwd()],
        writeRoots: [process.cwd()],
        allowedTools: ["read", "write", "shell"],
        shellPolicy: "approval-required",
        networkPolicy: "browser-allowed",
        autoCheckpoint: true,
      },
    ],
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

  it("adds the plan and process tools to legacy default allowlists", () => {
    const normalized = normalizeConfig({
      ...valid,
      profiles: [{ ...valid.profiles[0], allowedTools: ["read", "write", "checkpoint"] }],
    });
    expect(normalized.profiles[0].allowedTools).toContain("plan");
    expect(normalized.profiles[0].allowedTools).toContain("process");
    expect(normalized.profiles[0].allowedTools).toContain("read");
  });

  it("rejects metaMinConfidence out of range", () => {
    expect(validateConfig({ ...valid, metaMinConfidence: 1.5 }).valid).toBe(false);
    expect(validateConfig({ ...valid, metaMinConfidence: -0.1 }).valid).toBe(false);
  });

  it("rejects invalid UI mode", () => {
    expect(validateConfig({ ...valid, uiMode: "loud" as NtoxConfig["uiMode"] }).valid).toBe(false);
  });

  it("rejects empty web host", () => {
    expect(validateConfig({ ...valid, webHost: "" }).valid).toBe(false);
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
    expect(config.uiMode).toBe("normal");
    expect(config.defaultProfileId).toBe("default");
    expect(config.profiles[0].workspaceRoot).toBeTruthy();
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

  it("detects legacy XML tool-call prompts", () => {
    expect(hasLegacyToolPrompt("To call a tool, output EXACTLY this XML block (no surrounding text)")).toBe(true);
    expect(hasLegacyToolPrompt("wrap it in <tool_call> tags")).toBe(true);
    expect(hasLegacyToolPrompt("Tools are available via native function calling")).toBe(false);
  });

  it("repairs a stale legacy XML tool-call systemPrompt on load", () => {
    const stale =
      'You are Ntox.\n## Tools\nTo call a tool, output EXACTLY this XML block (no surrounding text, no markdown fences):\n<tool_call>{"name":"read","args":{}}</tool_call>\nAfter the tool result appears, continue your response.';
    saveConfig({ model: "xiaomi/mimo-v2.6-flash", systemPrompt: stale } as NtoxConfig);
    const loaded = loadConfig();
    expect(loaded.model).toBe("xiaomi/mimo-v2.6-flash");
    expect(hasLegacyToolPrompt(loaded.systemPrompt)).toBe(false);
    expect(loaded.systemPrompt).toContain("native function calling");
    const onDisk = JSON.parse(readFileSync(cfgPath(), "utf-8")) as NtoxConfig;
    expect(hasLegacyToolPrompt(onDisk.systemPrompt)).toBe(false);
  });
});

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import {
  CREDENTIALS_PATH,
  credentialStatuses,
  deleteProviderCredential,
  emptyCredentials,
  extractSecretsFromConfig,
  fingerprintSecret,
  getProviderCredential,
  hydrateSecrets,
  loadCredentials,
  maskSecret,
  providerEnvKey,
  resolveApiKey,
  saveCredentials,
  setChannelSecret,
  setProviderCredential,
  stripSecrets,
} from "./credentials.js";

function cleanup(): void {
  if (existsSync(CREDENTIALS_PATH)) unlinkSync(CREDENTIALS_PATH);
}

beforeEach(cleanup);
afterEach(() => {
  cleanup();
  delete process.env.NTOX_API_KEY;
  delete process.env.NTOX_API_KEY_PROVIDER;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

describe("maskSecret", () => {
  it("keeps a recognizable prefix and last four characters", () => {
    expect(maskSecret("sk-or-v1-abcdefghijklmnop1234")).toBe("sk-or-…1234");
  });

  it("fully masks short values and empty values", () => {
    expect(maskSecret("short")).toBe("***");
    expect(maskSecret("")).toBe("");
  });

  it("never returns the full secret", () => {
    const secret = "sk-or-v1-0123456789abcdef";
    expect(maskSecret(secret)).not.toContain("0123456789");
  });
});

describe("fingerprintSecret", () => {
  it("is stable and does not reveal the value", () => {
    const a = fingerprintSecret("sk-or-v1-one");
    const b = fingerprintSecret("sk-or-v1-one");
    expect(a).toBe(b);
    expect(a).toHaveLength(12);
    expect(fingerprintSecret("sk-or-v1-two")).not.toBe(a);
  });
});

describe("provider credential store", () => {
  it("round-trips a provider key", () => {
    setProviderCredential("openrouter", "sk-or-v1-store");
    expect(getProviderCredential("openrouter")?.apiKey).toBe("sk-or-v1-store");
    expect(loadCredentials().providers.openrouter?.fingerprint).toBe(fingerprintSecret("sk-or-v1-store"));
  });

  it("deletes a provider key", () => {
    setProviderCredential("openai", "sk-openai-store");
    expect(deleteProviderCredential("openai")).toBe(true);
    expect(deleteProviderCredential("openai")).toBe(false);
    expect(getProviderCredential("openai")).toBeUndefined();
  });

  it("stores channel secrets", () => {
    setChannelSecret("telegramToken", "8598712471:AAtelegramsecretvalue000000000");
    expect(loadCredentials().channels.telegramToken).toBe("8598712471:AAtelegramsecretvalue000000000");
  });

  it("writes credentials without any trailing newline-free JSON corruption", () => {
    saveCredentials(emptyCredentials());
    expect(JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8")).schemaVersion).toBe(1);
  });
});

describe("resolveApiKey precedence", () => {
  it("prefers the injected environment key", () => {
    setProviderCredential("openrouter", "sk-or-v1-store");
    process.env.NTOX_API_KEY = "sk-or-v1-injected";
    const resolved = resolveApiKey("xiaomi/mimo-v2.6-flash", "openrouter");
    expect(resolved.key).toBe("sk-or-v1-injected");
    expect(resolved.source).toBe("env");
  });

  it("falls back to the credential store", () => {
    setProviderCredential("openrouter", "sk-or-v1-store");
    const resolved = resolveApiKey("xiaomi/mimo-v2.6-flash", "openrouter");
    expect(resolved.key).toBe("sk-or-v1-store");
    expect(resolved.source).toBe("store");
  });

  it("falls back to the conventional provider environment variable", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-conventional";
    const resolved = resolveApiKey("xiaomi/mimo-v2.6-flash", "openrouter");
    expect(resolved.key).toBe("sk-or-v1-conventional");
    expect(resolved.source).toBe("env");
  });

  it("returns an empty key when nothing is configured", () => {
    const resolved = resolveApiKey("xiaomi/mimo-v2.6-flash", "openrouter");
    expect(resolved.key).toBe("");
    expect(resolved.source).toBe("none");
  });

  it("resolves the effective provider from the model prefix", () => {
    setProviderCredential("ollama", "local-token");
    const resolved = resolveApiKey("ollama/llama3", "openrouter");
    expect(resolved.provider).toBe("ollama");
    expect(resolved.key).toBe("local-token");
  });

  it("does not reuse another provider's key", () => {
    setProviderCredential("openrouter", "sk-or-v1-only");
    const resolved = resolveApiKey("deepseek/deepseek-chat", "deepseek");
    expect(resolved.key).toBe("");
  });

  it("only uses an injected key for the provider it was injected for", () => {
    process.env.NTOX_API_KEY = "sk-or-v1-injected";
    process.env.NTOX_API_KEY_PROVIDER = "openrouter";
    expect(resolveApiKey("xiaomi/mimo-v2.6-flash", "openrouter").key).toBe("sk-or-v1-injected");
    setProviderCredential("deepseek", "sk-deepseek-own");
    expect(resolveApiKey("deepseek/deepseek-chat", "deepseek").key).toBe("sk-deepseek-own");
  });
});

describe("credentialStatuses", () => {
  it("reports masked status for every provider", () => {
    setProviderCredential("openrouter", "sk-or-v1-status");
    const statuses = credentialStatuses();
    const openrouter = statuses.find((status) => status.provider === "openrouter");
    expect(openrouter?.configured).toBe(true);
    expect(openrouter?.masked).toBe("sk-or-…atus");
    expect(openrouter?.masked).not.toContain("sk-or-v1-status");
    expect(statuses.find((status) => status.provider === "ollama")?.apiKeyRequired).toBe(false);
  });
});

describe("config secret split", () => {
  it("strips every secret field", () => {
    const stripped = stripSecrets({
      model: "m",
      apiKey: "sk-x",
      telegramToken: "t",
      discordToken: "d",
      whatsappToken: "w",
      whatsappVerifyToken: "v",
      whatsappAppSecret: "a",
      webAuthToken: "web",
      apiAuthToken: "api",
    });
    for (const field of Object.keys(stripped)) {
      if (field === "model") expect(stripped[field]).toBe("m");
      else expect(stripped[field]).toBe("");
    }
  });

  it("extracts legacy secrets and reports what changed", () => {
    const { credentials, changed } = extractSecretsFromConfig({
      provider: "deepseek",
      apiKey: "sk-legacy",
      telegramToken: "123456789:AAlegacytokenvalue000000000000",
    });
    expect(changed).toContain("apiKey");
    expect(changed).toContain("telegramToken");
    expect(credentials.providers.deepseek?.apiKey).toBe("sk-legacy");
  });

  it("hydrates secrets back into a config object", () => {
    setProviderCredential("openrouter", "sk-or-v1-hydrate");
    setChannelSecret("discordToken", "discord-secret");
    const config: Record<string, unknown> = { model: "xiaomi/mimo-v2.6-flash", provider: "openrouter" };
    hydrateSecrets(config, loadCredentials());
    expect(config.apiKey).toBe("sk-or-v1-hydrate");
    expect(config.discordToken).toBe("discord-secret");
  });
});

describe("providerEnvKey", () => {
  it("maps known providers and returns undefined otherwise", () => {
    expect(providerEnvKey("openrouter")).toBe("OPENROUTER_API_KEY");
    expect(providerEnvKey("ollama")).toBeUndefined();
  });
});

describe("credential file robustness", () => {
  it("reads a credentials file written with a UTF-8 BOM", () => {
    process.env.NTOX_API_KEY = "";
    const body = JSON.stringify({
      schemaVersion: 1,
      providers: { openrouter: { provider: "openrouter", apiKey: "sk-or-v1-bom", updatedAt: 1, fingerprint: "x" } },
      channels: {},
      http: {},
    });
    writeFileSync(CREDENTIALS_PATH, String.fromCharCode(0xfeff) + body, "utf8");
    expect(loadCredentials().providers.openrouter?.apiKey).toBe("sk-or-v1-bom");
    expect(resolveApiKey("xiaomi/mimo-v2.6-flash", "openrouter").key).toBe("sk-or-v1-bom");
  });

  it("returns an empty store for a corrupt file instead of throwing", () => {
    writeFileSync(CREDENTIALS_PATH, "{ not json", "utf8");
    expect(loadCredentials().providers).toEqual({});
  });
});

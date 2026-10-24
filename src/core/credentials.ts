import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { CREDENTIALS_ENC_PATH, CREDENTIALS_PATH, getBaseDir } from "./paths.js";
import { getProviders, getProviderNames, providerRequiresKey, resolveEffectiveProvider } from "./llm.js";

export { CREDENTIALS_ENC_PATH, CREDENTIALS_PATH, getBaseDir };

export const CREDENTIALS_SCHEMA_VERSION = 1;

export interface ProviderCredential {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  updatedAt: number;
  lastVerifiedAt?: number;
  fingerprint: string;
}

export interface Credentials {
  schemaVersion: typeof CREDENTIALS_SCHEMA_VERSION;
  providers: Record<string, ProviderCredential>;
  channels: {
    telegramToken: string;
    discordToken: string;
    whatsappToken: string;
    whatsappVerifyToken: string;
    whatsappAppSecret: string;
  };
  http: {
    webAuthToken: string;
    apiAuthToken: string;
  };
}

export interface CredentialStatus {
  provider: string;
  name: string;
  apiKeyRequired: boolean;
  configured: boolean;
  masked: string;
  source: "env" | "store" | "config" | "none";
  updatedAt?: number;
  lastVerifiedAt?: number;
}

export const CONFIG_SECRET_FIELDS = [
  "apiKey",
  "telegramToken",
  "discordToken",
  "whatsappToken",
  "whatsappVerifyToken",
  "whatsappAppSecret",
  "webAuthToken",
  "apiAuthToken",
] as const;

const PROVIDER_ENV_KEYS: Record<string, string> = {
  openrouter: "OPENROUTER_API_KEY",
  openai: "OPENAI_API_KEY",
  groq: "GROQ_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  together: "TOGETHER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

const CHANNEL_SECRET_FIELDS = [
  "telegramToken",
  "discordToken",
  "whatsappToken",
  "whatsappVerifyToken",
  "whatsappAppSecret",
] as const;
const HTTP_SECRET_FIELDS = ["webAuthToken", "apiAuthToken"] as const;

export function emptyCredentials(): Credentials {
  return {
    schemaVersion: CREDENTIALS_SCHEMA_VERSION,
    providers: {},
    channels: {
      telegramToken: "",
      discordToken: "",
      whatsappToken: "",
      whatsappVerifyToken: "",
      whatsappAppSecret: "",
    },
    http: { webAuthToken: "", apiAuthToken: "" },
  };
}

export function credentialsFilePath(): string {
  return CREDENTIALS_PATH;
}

export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function fingerprintSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function providerEnvKey(provider: string): string | undefined {
  return PROVIDER_ENV_KEYS[provider];
}

export function restrictFilePermissions(target: string): void {
  try {
    if (process.platform === "win32") {
      const user = process.env.USERNAME || process.env.USER;
      if (user) {
        execFileSync("icacls", [target, "/inheritance:r", "/grant:r", `${user}:F`], { stdio: "ignore" });
        return;
      }
    }
    chmodSync(target, 0o600);
  } catch {}
}

function writeRestricted(target: string, contents: string): void {
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, contents, { encoding: "utf8", mode: 0o600 });
  renameSync(temp, target);
  restrictFilePermissions(target);
}

function normalizeCredentials(parsed: Partial<Credentials> | undefined): Credentials {
  const base = emptyCredentials();
  if (!parsed || typeof parsed !== "object") return base;
  const providers: Record<string, ProviderCredential> = {};
  for (const [key, value] of Object.entries(parsed.providers || {})) {
    if (!value || typeof value !== "object") continue;
    const record = value as Partial<ProviderCredential>;
    if (typeof record.apiKey !== "string") continue;
    providers[key] = {
      provider: record.provider || key,
      apiKey: record.apiKey,
      baseUrl: typeof record.baseUrl === "string" ? record.baseUrl : undefined,
      updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
      lastVerifiedAt: typeof record.lastVerifiedAt === "number" ? record.lastVerifiedAt : undefined,
      fingerprint: record.fingerprint || fingerprintSecret(record.apiKey),
    };
  }
  const channels = { ...base.channels };
  for (const field of CHANNEL_SECRET_FIELDS) {
    const value = parsed.channels?.[field];
    if (typeof value === "string") channels[field] = value;
  }
  const http = { ...base.http };
  for (const field of HTTP_SECRET_FIELDS) {
    const value = parsed.http?.[field];
    if (typeof value === "string") http[field] = value;
  }
  return { schemaVersion: CREDENTIALS_SCHEMA_VERSION, providers, channels, http };
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function loadCredentials(): Credentials {
  if (!existsSync(CREDENTIALS_PATH)) return emptyCredentials();
  try {
    return normalizeCredentials(JSON.parse(stripBom(readFileSync(CREDENTIALS_PATH, "utf8"))) as Partial<Credentials>);
  } catch {
    return emptyCredentials();
  }
}

export function saveCredentials(credentials: Credentials): void {
  writeRestricted(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2));
}

export function getProviderCredential(
  provider: string,
  credentials: Credentials = loadCredentials(),
): ProviderCredential | undefined {
  return credentials.providers[provider];
}

export function setProviderCredential(provider: string, apiKey: string, baseUrl?: string): ProviderCredential {
  const credentials = loadCredentials();
  const record: ProviderCredential = {
    provider,
    apiKey,
    baseUrl,
    updatedAt: Date.now(),
    lastVerifiedAt: credentials.providers[provider]?.lastVerifiedAt,
    fingerprint: fingerprintSecret(apiKey),
  };
  credentials.providers[provider] = record;
  saveCredentials(credentials);
  return record;
}

export function markProviderVerified(provider: string): void {
  const credentials = loadCredentials();
  const record = credentials.providers[provider];
  if (!record) return;
  record.lastVerifiedAt = Date.now();
  saveCredentials(credentials);
}

export function deleteProviderCredential(provider: string): boolean {
  const credentials = loadCredentials();
  if (!credentials.providers[provider]) return false;
  delete credentials.providers[provider];
  saveCredentials(credentials);
  return true;
}

export function setChannelSecret(field: (typeof CHANNEL_SECRET_FIELDS)[number], value: string): void {
  const credentials = loadCredentials();
  credentials.channels[field] = value;
  saveCredentials(credentials);
}

export function setHttpSecret(field: (typeof HTTP_SECRET_FIELDS)[number], value: string): void {
  const credentials = loadCredentials();
  credentials.http[field] = value;
  saveCredentials(credentials);
}

export function readInjectedApiKey(): { key: string; provider: string } {
  const key = process.env.NTOX_API_KEY;
  const provider = process.env.NTOX_API_KEY_PROVIDER;
  return { key: typeof key === "string" ? key : "", provider: typeof provider === "string" ? provider : "" };
}

export function resolveApiKey(
  model: string,
  configuredProvider: string,
): { key: string; source: CredentialStatus["source"]; provider: string } {
  const provider = resolveEffectiveProvider(configuredProvider, model);
  const injected = readInjectedApiKey();
  if (injected.key && (!injected.provider || injected.provider === provider)) {
    return { key: injected.key, source: "env", provider };
  }
  const fromStore = loadCredentials().providers[provider]?.apiKey;
  if (fromStore) return { key: fromStore, source: "store", provider };
  const envKey = providerEnvKey(provider);
  const conventional = envKey ? process.env[envKey] : "";
  if (conventional) return { key: conventional, source: "env", provider };
  return { key: "", source: "none", provider };
}

export function credentialStatuses(): CredentialStatus[] {
  const credentials = loadCredentials();
  const names = getProviderNames();
  const injected = readInjectedApiKey();
  return getProviders().map((provider) => {
    const stored = credentials.providers[provider];
    const envKey = providerEnvKey(provider);
    const fromInjected = injected.key && injected.provider === provider ? injected.key : "";
    const fromEnv = envKey ? process.env[envKey] || "" : "";
    const apiKeyRequired = providerRequiresKey(provider);
    const value = fromInjected || stored?.apiKey || fromEnv;
    const source: CredentialStatus["source"] = fromInjected
      ? "env"
      : stored?.apiKey
        ? "store"
        : fromEnv
          ? "env"
          : "none";
    return {
      provider,
      name: names[provider] || provider,
      apiKeyRequired,
      configured: Boolean(value),
      masked: maskSecret(value),
      source,
      updatedAt: stored?.updatedAt,
      lastVerifiedAt: stored?.lastVerifiedAt,
    };
  });
}

export function extractSecretsFromConfig(raw: Record<string, unknown>): {
  credentials: Credentials;
  changed: string[];
} {
  const credentials = loadCredentials();
  const changed: string[] = [];
  const credentialProvider = typeof raw.provider === "string" && raw.provider ? raw.provider : "openrouter";
  const apiKey = raw.apiKey;
  if (typeof apiKey === "string" && apiKey && credentials.providers[credentialProvider]?.apiKey !== apiKey) {
    credentials.providers[credentialProvider] = {
      provider: credentialProvider,
      apiKey,
      updatedAt: Date.now(),
      fingerprint: fingerprintSecret(apiKey),
    };
    changed.push("apiKey");
  }
  for (const field of CHANNEL_SECRET_FIELDS) {
    const value = raw[field];
    if (typeof value === "string" && value && credentials.channels[field] !== value) {
      credentials.channels[field] = value;
      changed.push(field);
    }
  }
  for (const field of HTTP_SECRET_FIELDS) {
    const value = raw[field];
    if (typeof value === "string" && value && credentials.http[field] !== value) {
      credentials.http[field] = value;
      changed.push(field);
    }
  }
  return { credentials, changed };
}

export function hydrateSecrets(config: Record<string, unknown>, credentials: Credentials): void {
  const model = typeof config.model === "string" ? config.model : "";
  const provider = typeof config.provider === "string" ? config.provider : "";
  const resolved = resolveApiKey(model, provider);
  const stored = credentials.providers[resolved.provider];
  config.apiKey = resolved.key || stored?.apiKey || "";
  config.telegramToken = credentials.channels.telegramToken;
  config.discordToken = credentials.channels.discordToken;
  config.whatsappToken = credentials.channels.whatsappToken;
  config.whatsappVerifyToken = credentials.channels.whatsappVerifyToken;
  config.whatsappAppSecret = credentials.channels.whatsappAppSecret;
  config.webAuthToken = credentials.http.webAuthToken;
  config.apiAuthToken = credentials.http.apiAuthToken;
}

export function stripSecrets(config: Record<string, unknown>): Record<string, unknown> {
  const result = { ...config };
  for (const field of CONFIG_SECRET_FIELDS) result[field] = "";
  return result;
}

export function baseDir(): string {
  return getBaseDir();
}

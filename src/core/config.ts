import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { NtoxConfig, ModelInfo } from "../types/index.js";
import {
  COGNITION_DIR,
  CONFIG_PATH,
  COST_PATH,
  CREDENTIALS_ENC_PATH,
  CREDENTIALS_PATH,
  DURABLE_MEMORY_PATH,
  EPISODES_JSONL_PATH,
  EPISODES_PATH,
  MEMORY_DIR,
  MISTAKES_PATH,
  MODELS_CACHE_PATH,
  NTOX_DIR,
  SKILLS_DIR,
  getBaseDir,
  getMemoryDir,
} from "./paths.js";
import {
  CONFIG_SECRET_FIELDS,
  extractSecretsFromConfig,
  hydrateSecrets,
  saveCredentials,
  stripSecrets,
} from "./credentials.js";
import { registerSecrets } from "./redact.js";

export {
  COGNITION_DIR,
  CONFIG_PATH,
  COST_PATH,
  CREDENTIALS_ENC_PATH,
  CREDENTIALS_PATH,
  DURABLE_MEMORY_PATH,
  EPISODES_JSONL_PATH,
  EPISODES_PATH,
  MEMORY_DIR,
  MISTAKES_PATH,
  MODELS_CACHE_PATH,
  NTOX_DIR,
  SKILLS_DIR,
  getBaseDir,
  getMemoryDir,
};

export const CONFIG_SCHEMA_VERSION = 1;

export const BUNDLED_MARKETPLACE_INDEX = join(
  resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."),
  "marketplace",
  "index.json",
);
export const REMOTE_MARKETPLACE_INDEX = "https://raw.githubusercontent.com/Ntooxx/Ntox/main/marketplace/index.json";

export function defaultMarketplaceIndex(): string {
  return existsSync(BUNDLED_MARKETPLACE_INDEX) ? BUNDLED_MARKETPLACE_INDEX : REMOTE_MARKETPLACE_INDEX;
}

const ConfigSchema = z.object({
  apiKey: z.string(),
  model: z.string().min(1),
  provider: z.string(),
  apiBaseUrl: z.string(),
  maxTokens: z.number().int().positive(),
  temperature: z.number().min(0).max(2),
  systemPrompt: z.string(),
  embeddingModel: z.string().min(1),
  memoryEnabled: z.boolean(),
  memoryRetrievalCount: z.number().int().min(1).max(100),
  systemContextBudget: z.number().int().min(200).max(20_000),
  contextCompilerEnabled: z.boolean(),
  predictionLlmEnabled: z.boolean(),
  modelCritiqueEnabled: z.boolean(),
  idleEnabled: z.boolean(),
  idleSelfPlay: z.boolean(),
  metaStrategyEnabled: z.boolean(),
  metaReflectionEnabled: z.boolean(),
  metaMistakesEnabled: z.boolean(),
  metaMinConfidence: z.number().min(0).max(1),
  skillAutoLearnEnabled: z.boolean(),
  skillMarketplaceIndex: z.string(),
  mcpServers: z
    .record(
      z.object({
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string()).optional(),
        url: z.string().optional(),
        headers: z.record(z.string()).optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .default({}),
  cognitiveEnabled: z.boolean(),
  theoryEnabled: z.boolean(),
  animationLevel: z.enum(["off", "minimal", "full"]),
  uiMode: z.enum(["minimal", "normal", "debug"]),
  telegramToken: z.string(),
  telegramAllowedUsers: z.array(z.string()),
  discordToken: z.string(),
  discordAllowedUsers: z.array(z.string()),
  whatsappToken: z.string(),
  whatsappPhoneNumberId: z.string(),
  whatsappVerifyToken: z.string(),
  whatsappAppSecret: z.string(),
  whatsappPort: z.number().int().min(1024).max(65535),
  dockerEnabled: z.boolean(),
  webPort: z.number().int().min(1024).max(65535),
  webHost: z.string().min(1),
  webAuthToken: z.string(),
  apiPort: z.number().int().min(1024).max(65535),
  apiAuthToken: z.string(),
  introEnabled: z.boolean(),
  verboseCallbacks: z.boolean(),
  defaultProfileId: z.string().min(1),
  profiles: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      workspaceRoot: z.string().min(1),
      readRoots: z.array(z.string()),
      writeRoots: z.array(z.string()),
      allowedTools: z.array(z.string()),
      shellPolicy: z.enum(["disabled", "workspace", "approval-required"]),
      networkPolicy: z.enum(["disabled", "fetch-only", "browser-allowed"]),
      autoCheckpoint: z.boolean(),
    }),
  ),
});

const DEFAULT_ALLOWED_TOOLS = [
  "read",
  "write",
  "glob",
  "ls",
  "shell",
  "web_fetch",
  "web_read",
  "search",
  "grep",
  "edit",
  "tts",
  "stt",
  "image",
  "subagent",
  "checkpoint",
  "plan",
  "process",
  "browse",
  "job_tracker",
  "profile_eval",
  "email_send",
  "email_read",
];

export function validateConfig(config: NtoxConfig): { valid: boolean; errors: string[] } {
  const result = ConfigSchema.safeParse(config);
  if (result.success) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

const DEFAULT_CONFIG: NtoxConfig = {
  apiKey: "",
  model: "openai/gpt-4o-mini",
  provider: "openrouter",
  apiBaseUrl: "",
  maxTokens: 32000,
  temperature: 0.7,
  // prettier-ignore
  systemPrompt: [
    "You are Ntox, a CLI agent running as a personal assistant.",

    "## Tools",
    "Tools are available via native function calling — use them when needed.",
    "Call tools proactively: read files before editing, search the web when you need current info.",
    "When a tool result appears, continue your response naturally.",
    "Never mention tools by name in your response unless the user asks about them.",

    "## Shell Commands",
    "The user is on Windows. Use PowerShell syntax, not bash.",
    "Prefer: Get-ChildItem (not ls), Select-String (not grep), Remove-Item (not rm).",
    "For npm/node: use 'npm', 'npx', 'node' directly.",
    "For Python: use 'python' or 'py'.",
    "Do NOT use: bash, gawk, sed, grep (Unix), pwsh (use powershell instead).",
    "Always quote file paths with spaces: Set-Location -LiteralPath \"C:\\path with spaces\"",
    "Chain commands with: command1; if ($?) { command2 }",
    "Do NOT use '&&' or '||' for chaining (they don't work in PowerShell).",
    "Use ';' for sequential execution.",

    "## Response Rules",
    "Be concise. Short sentences. No filler, no disclaimers, no 'Certainly!' or 'I'd be happy to help'.",
    "Answer the question directly. One word answers are fine.",
    "Do not repeat the user's question back to them.",
    "Do not explain what you're about to do, just do it.",
    "When a tool produces output, show it directly. Don't summarize what the user can see.",
    "If you're unsure about something, say 'I don't know' — don't speculate.",
    "Match the user's tone. If they're technical, be technical. If casual, be casual.",
    "Use markdown code blocks ``` for code snippets. Always specify the language after the opening ```.",

    "## Agentic Workflow",
    "For any task that needs more than two steps, create a plan with the plan tool before acting. Put the overall goal and concrete tasks in it.",
    "Work autonomously: once a plan exists, keep calling tools until every task is done. Never end your turn mid-plan to ask the user to say go, continue, or proceed.",
    "When a tool call fails, tell the user plainly what failed and why before ending your turn, then say what you did instead or what they should do about it.",
    "Keep exactly one plan task in_progress. Update statuses as work advances and mark a task complete only when it is actually done.",
    "Give every code-changing task a verify command such as npm test, npm run build, or npm run lint. Completing a task runs that command and fails when it does not pass.",
    "For dev servers, watchers, or long builds, use the process tool instead of a blocking shell call. Start it, read output, and kill it when done.",
    "When verification fails, read the output, fix the cause, and retry. Do not claim success or mark the task complete while a verify command is failing.",
    "If a step is blocked, record the blocker in the task notes and try a different approach instead of repeating the same failed call.",

    "## Files and Workspace",
    "The user has a project. Always read relevant files before making changes.",
    "Check package.json, tsconfig.json, and existing source files to understand conventions.",
    "Follow the codebase's existing patterns — naming, imports, structure.",
    "Never assume a library is available. Check package.json first.",
    "Write tests alongside code changes when possible.",
    "Run the build, linter, or tests after making changes to verify they work.",

    "## Writing Files",
    "Use the write tool for any file size — HTML, CSS, JS, JSON, or code.",
    "The write tool writes content byte-for-byte; quotes, backticks, template literals, and ${} pass through untouched.",
    "Do not use shell here-strings ( @'...'@ ) to write files — they add no safety and are slower than write.",
    "Write the whole file in one write call instead of splitting it into chunks or appending in pieces.",

    "## Opening on the User's Machine",
    "When the user asks to open, view, show, or launch a file, folder, page, or URL, use the open tool with its path or http(s) URL.",
    "The open tool launches the OS default application: browser for HTML, viewer for images and PDF, file manager for folders.",
    "Do not use shell Start-Process, start, xdg-open, or explorer for this — use the open tool so workspace policy applies.",
    "If open fails because a path is outside allowed roots, tell the user the path must be inside the workspace.",

    "## Memory and Profile",
    "You have access to the user's profile (name, expertise, preferences) and past conversation memories.",
    "A memory file at ~/.ntox/memory/memory.md contains summaries of older conversations — read it when context is relevant.",
    "Use remembered facts to personalize responses.",
    "When the user shares personal info (name, job, preferences), acknowledge it and the system will save it.",
    "Do NOT repeatedly ask the user who they are if you have their name in the profile context.",

    "## Search and Web",
    "Use web_search for current information, documentation, or anything beyond your training cutoff.",
    "Use web_read to read specific URLs because it can fall back to browser rendering. Use web_fetch only when you explicitly need raw fetch behavior.",
    "When answering from web results, cite the source URL in parentheses.",

    "## Job Tracking",
    "When displaying job tracker results, format them clearly:",
    "- Show company, role, match score, and location per entry.",
    "- Use bullet points (-) for lists of jobs.",
    "- Highlight match scores as percentages (e.g. 85/100).",
    "- Group by status: applied, interviewing, offered, rejected.",
    "- If the user asks about a specific job, show the full details.",
    "- Do not just dump raw tool output — format it as readable text.",

    "## Accuracy",
    "Never fabricate code, APIs, or facts.",
    "If you need to know something, check the file system or search the web.",
    "Admit uncertainty. The user trusts you more when you're honest about what you don't know.",
  ].join("\n"),
  embeddingModel: "openai/text-embedding-3-small",
  memoryEnabled: true,
  memoryRetrievalCount: 20,
  systemContextBudget: 20000,
  contextCompilerEnabled: true,
  predictionLlmEnabled: true,
  modelCritiqueEnabled: true,
  idleEnabled: true,
  idleSelfPlay: false,
  metaStrategyEnabled: true,
  metaReflectionEnabled: false,
  metaMistakesEnabled: true,
  metaMinConfidence: 0.5,
  skillAutoLearnEnabled: true,
  skillMarketplaceIndex: defaultMarketplaceIndex(),
  mcpServers: {},
  cognitiveEnabled: true,
  theoryEnabled: true,
  animationLevel: "minimal" as const,
  uiMode: "normal" as const,
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
      workspaceRoot: resolve(process.cwd()),
      readRoots: [resolve(process.cwd())],
      writeRoots: [resolve(process.cwd())],
      allowedTools: DEFAULT_ALLOWED_TOOLS,
      shellPolicy: "approval-required",
      networkPolicy: "browser-allowed",
      autoCheckpoint: true,
    },
  ],
};

export function getNtoxDir(): string {
  if (!existsSync(NTOX_DIR)) {
    mkdirSync(NTOX_DIR, { recursive: true });
  }
  return NTOX_DIR;
}

export function loadConfig(): NtoxConfig {
  const config = loadConfigRaw();
  return process.env.NTOX_LITE === "1" ? applyLitePreset(config) : config;
}

function applyLitePreset(config: NtoxConfig): NtoxConfig {
  return {
    ...config,
    cognitiveEnabled: false,
    theoryEnabled: false,
    metaStrategyEnabled: false,
    metaReflectionEnabled: false,
    metaMistakesEnabled: false,
    introEnabled: false,
    animationLevel: "off",
  };
}

const LEGACY_XML_TOOL_PROMPT = /output EXACTLY this XML block|<\/?tool_call/i;

export function hasLegacyToolPrompt(systemPrompt: string): boolean {
  return LEGACY_XML_TOOL_PROMPT.test(systemPrompt);
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function loadConfigRaw(): NtoxConfig {
  if (!existsSync(CONFIG_PATH)) {
    saveConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = stripBom(readFileSync(CONFIG_PATH, "utf-8"));
    const parsed = JSON.parse(raw) as Partial<NtoxConfig> & Record<string, unknown>;
    const merged = normalizeConfig({ ...DEFAULT_CONFIG, ...parsed });
    const legacyPrompt = typeof parsed.systemPrompt === "string" && hasLegacyToolPrompt(parsed.systemPrompt);
    if (legacyPrompt) merged.systemPrompt = DEFAULT_CONFIG.systemPrompt;

    const { credentials, changed } = extractSecretsFromConfig(parsed);
    if (changed.length) saveCredentials(credentials);
    hydrateSecrets(merged as unknown as Record<string, unknown>, credentials);
    registerSecrets(secretValues(merged));

    if (legacyPrompt || changed.length) {
      try {
        saveConfig(merged);
      } catch {
        /* in-memory repair is enough */
      }
    }

    const validation = validateConfig(merged);
    if (!validation.valid) {
      console.error("[config] validation warnings:", validation.errors.join("; "));
      return { ...DEFAULT_CONFIG, ...merged } as NtoxConfig;
    }
    return merged;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error(
      `[config] Failed to parse ${CONFIG_PATH}: ${reason}\n` +
        `[config] Falling back to defaults (model ${DEFAULT_CONFIG.model}, empty apiKey).\n` +
        `[config] Your saved settings are NOT lost — fix the file and restart.`,
    );
    return { ...DEFAULT_CONFIG };
  }
}

function secretValues(config: NtoxConfig): string[] {
  return CONFIG_SECRET_FIELDS.map((field) => config[field]).filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

export function normalizeConfig(config: NtoxConfig): NtoxConfig {
  const profiles =
    Array.isArray(config.profiles) && config.profiles.length > 0 ? config.profiles : DEFAULT_CONFIG.profiles;
  const normalizedProfiles = profiles.map((profile) => {
    const workspaceRoot = resolve(profile.workspaceRoot || process.cwd());
    const allowedTools =
      profile.allowedTools.length > 0
        ? profile.allowedTools.includes("checkpoint")
          ? [...profile.allowedTools, ...["plan", "process"].filter((tool) => !profile.allowedTools.includes(tool))]
          : profile.allowedTools
        : DEFAULT_ALLOWED_TOOLS;
    return {
      ...profile,
      workspaceRoot,
      readRoots: profile.readRoots.length > 0 ? profile.readRoots.map((p) => resolve(p)) : [workspaceRoot],
      writeRoots: profile.writeRoots.length > 0 ? profile.writeRoots.map((p) => resolve(p)) : [workspaceRoot],
      allowedTools,
    };
  });
  const defaultProfileId = normalizedProfiles.some((p) => p.id === config.defaultProfileId)
    ? config.defaultProfileId
    : normalizedProfiles[0].id;
  return { ...config, defaultProfileId, profiles: normalizedProfiles };
}

export function saveConfig(config: NtoxConfig): void {
  getNtoxDir();
  persistSecrets(config);
  const stored = stripSecrets({ ...config, schemaVersion: CONFIG_SCHEMA_VERSION });
  writeFileSync(CONFIG_PATH, JSON.stringify(stored, null, 2));
  try {
    chmodSync(CONFIG_PATH, 0o600);
  } catch {}
  registerSecrets(secretValues(config));
}

function persistSecrets(config: NtoxConfig): void {
  const { credentials, changed } = extractSecretsFromConfig(config as unknown as Record<string, unknown>);
  if (changed.length) saveCredentials(credentials);
}

export function patchConfig(patch: Partial<NtoxConfig>): NtoxConfig {
  const merged = { ...loadConfigRaw(), ...patch };
  saveConfig(merged);
  return merged;
}

export function loadCosts(): { totalInputTokens: number; totalOutputTokens: number; totalCost: number } {
  if (!existsSync(COST_PATH)) {
    return { totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0 };
  }
  try {
    return JSON.parse(readFileSync(COST_PATH, "utf-8"));
  } catch {
    return { totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0 };
  }
}

export function saveCosts(costs: { totalInputTokens: number; totalOutputTokens: number; totalCost: number }): void {
  writeFileSync(COST_PATH, JSON.stringify(costs, null, 2));
}

export function recordCosts(delta: { inputTokens: number; outputTokens: number; cost: number }): void {
  const current = loadCosts();
  saveCosts({
    totalInputTokens: current.totalInputTokens + Math.max(0, delta.inputTokens),
    totalOutputTokens: current.totalOutputTokens + Math.max(0, delta.outputTokens),
    totalCost: current.totalCost + Math.max(0, delta.cost),
  });
}

export function loadCachedModels(): ModelInfo[] | null {
  if (!existsSync(MODELS_CACHE_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(MODELS_CACHE_PATH, "utf-8")) as ModelInfo[];
    // Normalize pricing (OpenRouter may return strings)
    return raw.map((m) => ({
      ...m,
      pricing: {
        prompt: Number(m.pricing?.prompt ?? 0),
        completion: Number(m.pricing?.completion ?? 0),
      },
    }));
  } catch {
    return null;
  }
}

export function saveCachedModels(models: ModelInfo[]): void {
  writeFileSync(MODELS_CACHE_PATH, JSON.stringify(models, null, 2));
}

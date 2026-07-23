import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { NtoxConfig, ModelInfo } from "../types/index.js";

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
  metaStrategyEnabled: z.boolean(),
  metaReflectionEnabled: z.boolean(),
  metaMistakesEnabled: z.boolean(),
  metaMinConfidence: z.number().min(0).max(1),
  cognitiveEnabled: z.boolean(),
  theoryEnabled: z.boolean(),
  soundEnabled: z.boolean(),
  soundVolume: z.number().int().min(0).max(100),
  telegramToken: z.string(),
  telegramAllowedUsers: z.array(z.string()),
  discordToken: z.string(),
  discordAllowedUsers: z.array(z.string()),
  whatsappToken: z.string(),
  whatsappPhoneNumberId: z.string(),
  whatsappVerifyToken: z.string(),
  whatsappPort: z.number().int().min(1024).max(65535),
  dockerEnabled: z.boolean(),
  webPort: z.number().int().min(1024).max(65535),
});

export function validateConfig(config: NtoxConfig): { valid: boolean; errors: string[] } {
  const result = ConfigSchema.safeParse(config);
  if (result.success) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

export function getBaseDir(): string {
  return process.env.NTOX_DIR || join(homedir(), ".ntox");
}

export const NTOX_DIR = getBaseDir();
export const CONFIG_PATH = join(NTOX_DIR, "config.json");
export const COST_PATH = join(NTOX_DIR, "costs.json");
export const MODELS_CACHE_PATH = join(NTOX_DIR, "models-cache.json");
export const MEMORY_DIR = join(NTOX_DIR, "memory");
export const EPISODES_PATH = join(MEMORY_DIR, "episodes.json");
export const MISTAKES_PATH = join(MEMORY_DIR, "mistakes.json");
export const SKILLS_DIR = join(NTOX_DIR, "skills");
export const COGNITION_DIR = join(NTOX_DIR, "cognition");

const DEFAULT_CONFIG: NtoxConfig = {
  apiKey: "",
  model: "openai/gpt-4o-mini",
  provider: "openrouter",
  apiBaseUrl: "",
  maxTokens: 4096,
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
    "DO NOT use markdown formatting. No **bold**, no *italic*, no `code fences`, no --- dividers.",
    "Write plain text. Use indentation for code blocks, not ``` fences.",
    "DO NOT use emoji. Ever.",
    "Be concise. Short sentences. No filler, no disclaimers, no 'Certainly!' or 'I'd be happy to help'.",
    "Answer the question directly. One word answers are fine.",
    "Do not repeat the user's question back to them.",
    "Do not explain what you're about to do, just do it.",
    "When a tool produces output, show it directly. Don't summarize what the user can see.",
    "If you're unsure about something, say 'I don't know' — don't speculate.",
    "Match the user's tone. If they're technical, be technical. If casual, be casual.",

    "## Files and Workspace",
    "The user has a project. Always read relevant files before making changes.",
    "Check package.json, tsconfig.json, and existing source files to understand conventions.",
    "Follow the codebase's existing patterns — naming, imports, structure.",
    "Never assume a library is available. Check package.json first.",
    "Write tests alongside code changes when possible.",
    "Run the build, linter, or tests after making changes to verify they work.",

    "## Memory and Profile",
    "You have access to the user's profile (name, expertise, preferences) and past conversation memories.",
    "A memory file at .ntox/memory.md contains summaries of older conversations — read it when context is relevant.",
    "Use remembered facts to personalize responses.",
    "When the user shares personal info (name, job, preferences), acknowledge it and the system will save it.",
    "Do NOT repeatedly ask the user who they are if you have their name in the profile context.",

    "## Search and Web",
    "Use web_search for current information, documentation, or anything beyond your training cutoff.",
    "Use web_fetch to read specific URLs. Prefer markdown format for readability.",
    "When answering from web results, cite the source URL in parentheses.",

    "## Accuracy",
    "Never fabricate code, APIs, or facts.",
    "If you need to know something, check the file system or search the web.",
    "Admit uncertainty. The user trusts you more when you're honest about what you don't know.",
  ].join("\n"),
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

export function getNtoxDir(): string {
  if (!existsSync(NTOX_DIR)) {
    mkdirSync(NTOX_DIR, { recursive: true });
  }
  return NTOX_DIR;
}

export function loadConfig(): NtoxConfig {
  if (!existsSync(CONFIG_PATH)) {
    saveConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<NtoxConfig>;
    const merged = { ...DEFAULT_CONFIG, ...parsed };
    const validation = validateConfig(merged);
    if (!validation.valid) {
      console.error("[config] validation warnings:", validation.errors.join("; "));
      return { ...DEFAULT_CONFIG, ...merged } as NtoxConfig;
    }
    return merged;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: NtoxConfig): void {
  getNtoxDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
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

export function getMemoryDir(): string {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true });
  }
  return MEMORY_DIR;
}

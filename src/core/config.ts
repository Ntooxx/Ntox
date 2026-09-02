import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
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
  animationLevel: z.enum(["off", "minimal", "full"]),
  uiMode: z.enum(["minimal", "normal", "debug"]),
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
  webHost: z.string().min(1),
  introEnabled: z.boolean(),
  verboseCallbacks: z.boolean(),
  defaultProfileId: z.string().min(1),
  profiles: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    workspaceRoot: z.string().min(1),
    readRoots: z.array(z.string()),
    writeRoots: z.array(z.string()),
    allowedTools: z.array(z.string()),
    shellPolicy: z.enum(["disabled", "workspace", "approval-required"]),
    networkPolicy: z.enum(["disabled", "fetch-only", "browser-allowed"]),
    autoCheckpoint: z.boolean(),
  })),
});

const DEFAULT_ALLOWED_TOOLS = [
  "read", "write", "glob", "ls", "shell", "web_fetch", "web_read", "search", "grep", "edit",
  "tts", "stt", "image", "subagent", "checkpoint", "browse", "job_tracker", "profile_eval",
];

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
export const DURABLE_MEMORY_PATH = join(MEMORY_DIR, "durable.json");
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
    "Be concise. Short sentences. No filler, no disclaimers, no 'Certainly!' or 'I'd be happy to help'.",
    "Answer the question directly. One word answers are fine.",
    "Do not repeat the user's question back to them.",
    "Do not explain what you're about to do, just do it.",
    "When a tool produces output, show it directly. Don't summarize what the user can see.",
    "If you're unsure about something, say 'I don't know' — don't speculate.",
    "Match the user's tone. If they're technical, be technical. If casual, be casual.",
    "Use markdown code blocks ``` for code snippets. Always specify the language after the opening ```.",

    "## Files and Workspace",
    "The user has a project. Always read relevant files before making changes.",
    "Check package.json, tsconfig.json, and existing source files to understand conventions.",
    "Follow the codebase's existing patterns — naming, imports, structure.",
    "Never assume a library is available. Check package.json first.",
    "Write tests alongside code changes when possible.",
    "Run the build, linter, or tests after making changes to verify they work.",

    "## Writing Files",
    "Use the write tool for small files only (under 2KB).",
    "For files over 2KB (HTML, CSS, JS, etc.), use the shell tool with PowerShell here-strings.",
    "PowerShell here-string syntax: @'<newline>content<newline>'@ | Set-Content -Path \"file.html\" -Encoding UTF8",
    "This avoids JSON escaping bugs that break large content in tool call arguments.",
    "The write tool's content parameter goes through JSON serialization which corrupts large HTML/JS/CSS with quotes and special chars.",
    "Shell here-strings pass content verbatim with no escaping issues.",

    "## Memory and Profile",
    "You have access to the user's profile (name, expertise, preferences) and past conversation memories.",
    "A memory file at .ntox/memory.md contains summaries of older conversations — read it when context is relevant.",
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
  memoryRetrievalCount: 5,
  metaStrategyEnabled: true,
  metaReflectionEnabled: false,
  metaMistakesEnabled: true,
  metaMinConfidence: 0.5,
  cognitiveEnabled: true,
  theoryEnabled: true,
  soundEnabled: false,
  soundVolume: 50,
  animationLevel: "minimal" as const,
  uiMode: "normal" as const,
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
  webHost: "127.0.0.1",
  introEnabled: true,
  verboseCallbacks: false,
  defaultProfileId: "default",
  profiles: [{
    id: "default",
    name: "Default Workspace",
    workspaceRoot: resolve(process.cwd()),
    readRoots: [resolve(process.cwd())],
    writeRoots: [resolve(process.cwd())],
    allowedTools: DEFAULT_ALLOWED_TOOLS,
    shellPolicy: "approval-required",
    networkPolicy: "browser-allowed",
    autoCheckpoint: true,
  }],
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
    const merged = normalizeConfig({ ...DEFAULT_CONFIG, ...parsed });
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

export function normalizeConfig(config: NtoxConfig): NtoxConfig {
  const profiles = Array.isArray(config.profiles) && config.profiles.length > 0
    ? config.profiles
    : DEFAULT_CONFIG.profiles;
  const normalizedProfiles = profiles.map((profile) => {
    const workspaceRoot = resolve(profile.workspaceRoot || process.cwd());
    return {
      ...profile,
      workspaceRoot,
      readRoots: profile.readRoots.length > 0 ? profile.readRoots.map((p) => resolve(p)) : [workspaceRoot],
      writeRoots: profile.writeRoots.length > 0 ? profile.writeRoots.map((p) => resolve(p)) : [workspaceRoot],
      allowedTools: profile.allowedTools.length > 0 ? profile.allowedTools : DEFAULT_ALLOWED_TOOLS,
    };
  });
  const defaultProfileId = normalizedProfiles.some((p) => p.id === config.defaultProfileId)
    ? config.defaultProfileId
    : normalizedProfiles[0].id;
  return { ...config, defaultProfileId, profiles: normalizedProfiles };
}

export function saveConfig(config: NtoxConfig): void {
  getNtoxDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  try { chmodSync(CONFIG_PATH, 0o600); } catch { }
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

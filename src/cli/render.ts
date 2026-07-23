import chalk from "chalk";
import { formatTokenCount, formatCost } from "../core/llm.js";
import type { ModelInfo, CostUsage, MemoryStats, Reflection, QueryType, MistakeEntry } from "../types/index.js";

function div(n = -1): string {
  const w = n > 0 ? n : Math.min((process.stdout.columns || 80) - 1, 60);
  return chalk.dim("\u2500".repeat(Math.min(w, 200)));
}

export function renderUserPrompt(msgCount: number): string {
  return `\n${chalk.green("\u25B6")} ${chalk.dim(`[${msgCount}]`)} ${chalk.dim("\u25B8")} `;
}

export function renderAssistantLabel(): string {
  return chalk.hex("#00ccff")("\u2502") + " ";
}

export function renderUserLabel(): string {
  return chalk.green("\u25B6") + " ";
}

export function renderDivider(): string {
  return div();
}

export function renderInlineTag(tag: string, color?: (s: string) => string): string {
  const c = color || chalk.dim;
  return `\n${c("\u2014")} ${c(tag)}`;
}

export function renderWelcome(
  modelName: string,
  providerLabel?: string
): string {
  const model = (modelName.split("/").pop() || modelName).slice(0, 24);
  const prov = providerLabel || "openrouter";
  const lines: string[] = [];
  lines.push(chalk.dim(`  ${model}  \u2502  ${prov}`));
  lines.push(chalk.dim(`  type ${chalk.cyan("/help")} for commands  \u2502  just chat to begin  \u2502  ${chalk.dim("ctrl+c")} to exit`));
  return lines.join("\n");
}

export function renderHelp(): string {
  const groups: { title: string; items: [string, string][] }[] = [
    {
      title: "chat & model",
      items: [
        ["/model", "switch model"],
        ["/provider", "switch provider"],
        ["/config", "view / set config"],
        ["/cost", "token usage"],
        ["/clear", "clear conversation"],
        ["/exit", "quit"],
      ],
    },
    {
      title: "memory & skills",
      items: [
        ["/memory", "view / search / clear"],
        ["/profile", "user preferences"],
        ["/mistakes", "learnt corrections"],
        ["/skill", "manage skills"],
        ["/skill learn", "create a skill"],
        ["/menu skills", "browse skill library"],
      ],
    },
    {
      title: "diagnostics",
      items: [
        ["/meta", "meta-cognition status"],
        ["/analytics", "usage stats"],
        ["/suggest", "proactive suggestion"],
        ["/benchmark", "test cognitive kernel"],
        ["/sound", "toggle sounds"],
        ["/reset", "reset everything"],
      ],
    },
  ];

  const cols: string[] = [];
  for (const g of groups) {
    let s = `  ${chalk.bold(g.title)}\n`;
    for (const [cmd, desc] of g.items) {
      s += `    ${chalk.cyan(cmd.padEnd(16))} ${chalk.dim(desc)}\n`;
    }
    cols.push(s);
  }
  return `${chalk.bold("\n  ntox commands")}\n\n${cols.join("\n")}`;
}

export function renderConfig(
  modelId: string, maxTokens: number, temperature: number,
  contextLength: number | null, embeddingModel?: string,
  memoryEnabled?: boolean, memoryCount?: number,
  provider?: string, apiBaseUrl?: string, telegramToken?: string
): string {
  const m: string[] = [];
  m.push(`${chalk.dim("provider")}    ${chalk.cyan(provider || "openrouter")}`);
  m.push(`${chalk.dim("model")}       ${chalk.yellow(modelId)}`);
  m.push(`${chalk.dim("max tokens")}  ${maxTokens}`);
  m.push(`${chalk.dim("temperature")} ${temperature}`);
  if (contextLength) m.push(`${chalk.dim("context")}     ${formatTokenCount(contextLength)}`);
  if (embeddingModel) m.push(`${chalk.dim("embedding")}   ${embeddingModel}`);
  if (apiBaseUrl) m.push(`${chalk.dim("base url")}    ${chalk.dim(apiBaseUrl)}`);
  if (memoryEnabled !== undefined) m.push(`${chalk.dim("memory")}      ${memoryEnabled ? chalk.green("on") : chalk.dim("off")}`);
  if (memoryCount !== undefined) m.push(`${chalk.dim("episodes")}    ${memoryCount}`);
  if (telegramToken) m.push(`${chalk.dim("telegram")}    ${chalk.green("set")}`);
  return `\n${chalk.bold("config")}\n  ${m.join("\n  ")}\n`;
}

export function renderCosts(
  inT: number, outT: number, cost: number,
  totalIn: number, totalOut: number, totalCost: number
): string {
  return [
    `${chalk.bold("costs")}`,
    `  ${chalk.dim("session")}   in ${formatTokenCount(inT)}  out ${formatTokenCount(outT)}  ${chalk.yellow(formatCost(cost))}`,
    `  ${chalk.dim("lifetime")}  in ${formatTokenCount(totalIn)}  out ${formatTokenCount(totalOut)}  ${chalk.yellow(formatCost(totalCost))}`,
  ].join("\n");
}

export function renderUsageBar(
  usage: CostUsage,
  modelInfo: ModelInfo | undefined,
  extraContext?: { used: number; limit: number }
): string {
  const tc = (usage.inputTokens / 1000) * (modelInfo?.pricing.prompt ?? 0) +
             (usage.outputTokens / 1000) * (modelInfo?.pricing.completion ?? 0);
  const model = modelInfo ? (modelInfo.id.split("/").pop() || "?") : "?";
  const parts: string[] = [];
  parts.push(chalk.dim(`in ${formatTokenCount(usage.inputTokens)}`));
  parts.push(chalk.dim(`out ${formatTokenCount(usage.outputTokens)}`));
  parts.push(chalk.yellow(formatCost(tc)));
  if (extraContext) {
    const pct = (extraContext.used / extraContext.limit * 100);
    parts.push(chalk.dim(`ctx ${pct.toFixed(0)}%`));
  }
  parts.push(chalk.dim(model));
  return parts.join("  ");
}

export function renderModelsMenu(
  models: { id: string; name: string }[],
  current: string
): string {
  const lines: string[] = [`${chalk.bold(`models (${models.length})`)}`];
  const grouped = new Map<string, typeof models>();
  for (const m of models) {
    const p = m.id.split("/")[0] || "other";
    if (!grouped.has(p)) grouped.set(p, []);
    grouped.get(p)!.push(m);
  }
  for (const [p, list] of grouped) {
    lines.push(`  ${chalk.cyan(p.toUpperCase())}`);
    for (let i = 0; i < Math.min(list.length, 12); i++) {
      const m = list[i];
      const active = m.id === current ? chalk.green(" *") : "";
      lines.push(`  ${chalk.dim(String(i + 1).padStart(2))}. ${chalk.yellow(m.name)}${active}`);
    }
    if (list.length > 12) lines.push(chalk.dim(`  ... +${list.length - 12} more`));
  }
  lines.push(chalk.dim(`  /model <number> or /model <name> to switch`));
  return lines.join("\n");
}

export function renderModelList(models: ModelInfo[], currentId: string): string {
  return renderModelsMenu(models.map(m => ({ id: m.id, name: m.name })), currentId);
}

export function renderMemoryStats(stats: MemoryStats): string {
  const from = stats.oldestTimestamp ? new Date(stats.oldestTimestamp).toISOString().slice(0, 10) : "n/a";
  const to = stats.newestTimestamp ? new Date(stats.newestTimestamp).toISOString().slice(0, 10) : "n/a";
  return [
    `${chalk.bold("memory")}`,
    `  ${chalk.dim("episodes")} ${chalk.cyan(String(stats.totalEpisodes))}`,
    `  ${chalk.dim("sessions")} ${stats.totalSessions}`,
    `  ${chalk.dim("range")}    ${from}..${to}`,
    `  ${chalk.dim("size")}     ${(stats.memorySizeBytes / 1024).toFixed(1)} KB`,
    `  ${chalk.dim("/memory search <q>  /memory last <n>  /memory clear")}`,
  ].join("\n");
}

export function renderMetaStats(
  metaConfig: {
    strategyEnabled: boolean; reflectionEnabled: boolean; mistakesEnabled: boolean; minConfidenceThreshold: number;
  },
  lastStrategy: QueryType | null,
  lastReflection: Reflection | null,
  mistakeStats: { total: number; bySource: Record<string, number> }
): string {
  const m: string[] = [`${chalk.bold("meta")}`];
  m.push(`  ${chalk.dim("strategy")}   ${metaConfig.strategyEnabled ? chalk.green("on") : chalk.dim("off")}`);
  m.push(`  ${chalk.dim("reflection")} ${metaConfig.reflectionEnabled ? chalk.green("on") : chalk.dim("off")}`);
  m.push(`  ${chalk.dim("mistakes")}   ${metaConfig.mistakesEnabled ? chalk.green("on") : chalk.dim("off")} (${mistakeStats.total})`);
  m.push(`  ${chalk.dim("confidence")} ${(metaConfig.minConfidenceThreshold * 100).toFixed(0)}% min`);
  if (lastStrategy) m.push(`  ${chalk.dim("strategy")}   ${chalk.magenta(lastStrategy)}`);
  if (lastReflection) {
    const c = lastReflection.confidence;
    const color = c >= 0.7 ? chalk.green : c >= 0.4 ? chalk.yellow : chalk.red;
    m.push(`  ${chalk.dim("conf")}       ${color((c * 100).toFixed(0) + "%")}`);
    if (lastReflection.knowledgeGaps.length) {
      m.push(`  ${chalk.dim("gaps")}       ${chalk.yellow(lastReflection.knowledgeGaps.join(", "))}`);
    }
  }
  return m.join("\n");
}

export function renderMistakeList(mistakes: MistakeEntry[]): string {
  if (mistakes.length === 0) return chalk.dim("  no mistakes logged");
  const m: string[] = [`${chalk.bold(`mistakes (${mistakes.length})`)}`];
  for (const mk of mistakes) {
    const date = new Date(mk.timestamp).toISOString().slice(0, 10);
    const src = mk.source === "user-correction" ? chalk.green("user") : chalk.blue("self");
    m.push(`  ${chalk.cyan(mk.id)} ${chalk.dim(date)} ${src}  ${chalk.dim(mk.topicKey)}`);
  }
  return m.join("\n");
}

export function renderSkillsMenu(domains: string[], total: number): string {
  const m: string[] = [`${chalk.bold(`skill library (${total} skills, ${domains.length} domains)`)}`];
  for (const d of domains) m.push(`  ${chalk.cyan(d)}`);
  m.push(chalk.dim(`  /menu skills <domain> to browse`));
  return m.join("\n");
}

export function renderDomainSkills(
  domain: string,
  skills: { name: string; importance: number; description: string; voices: string[] }[]
): string {
  const m: string[] = [`${chalk.bold(`${domain} (${skills.length})`)}`];
  for (let i = 0; i < skills.length; i++) {
    const s = skills[i];
    const voices = s.voices.length > 0 ? chalk.dim(` [${s.voices.join(", ")}]`) : "";
    m.push(`  ${chalk.cyan(String(i + 1))}. ${s.name} ${chalk.yellow(String(s.importance))}/10${voices}`);
    m.push(`     ${chalk.dim(s.description.slice(0, 80))}`);
  }
  m.push(chalk.dim(`  /skill load <number>  or  /skill load <name>`));
  return m.join("\n");
}

export function renderToolPill(name: string, status: "running" | "done" | "failed"): string {
  const icon = status === "running" ? chalk.dim("\u25F7") : status === "done" ? chalk.green("\u2713") : chalk.red("\u2717");
  const color = status === "running" ? chalk.dim : status === "done" ? chalk.green : chalk.red;
  return `${chalk.dim("tool:")} ${color(name)} ${icon}`;
}

export function renderMemoryPulse(action: "stored" | "recalled", count: number): string {
  const color = action === "stored" ? chalk.green : chalk.cyan;
  return `${chalk.dim("mem:")} ${color(action)} ${chalk.dim(count)}`;
}

export function renderConvergenceLine(progress: number): string {
  const width = 20;
  const half = Math.floor(width / 2);
  const leftLen = Math.floor(half * progress);
  const rightLen = Math.floor(half * progress);

  const left = "\u2500".repeat(leftLen) + (progress < 1 ? "\u257A" : "");
  const right = (progress < 1 ? "\u2578" : "") + "\u2500".repeat(rightLen);
  const center = progress >= 1 ? chalk.cyan("\u25CF") : chalk.dim("\u25CB");

  return `${chalk.dim(left)} ${center} ${chalk.dim(right)}`;
}

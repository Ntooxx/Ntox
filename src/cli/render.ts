import chalk from "chalk";
import { formatTokenCount, formatCost } from "../core/llm.js";
import type {
  ModelInfo,
  CostUsage,
  MemoryStats,
  Reflection,
  QueryType,
  MistakeEntry,
  ToolResult,
  AgentTurnTrace,
} from "../types/index.js";
import { getCommandGroups } from "./commands.js";

export function termWidth(): number {
  return Math.min(process.stdout.columns || 80, 120);
}

function div(n = -1): string {
  const w = n > 0 ? n : termWidth();
  return chalk.dim("\u2500".repeat(w));
}

export function renderPanel(title: string, content: string[], width?: number): string {
  const w = width ?? termWidth();
  const inner = w - 4;
  const top = title
    ? `\u250c ${chalk.bold(title)} ${chalk.dim("\u2500".repeat(Math.max(0, inner - title.length - 2)))} \u2510`
    : `\u250c ${chalk.dim("\u2500".repeat(inner))} \u2510`;
  const lines = [chalk.dim(top)];
  for (const line of content) {
    const trimmed = line.length > inner ? line.slice(0, inner - 1) + "\u2026" : line;
    const padding = inner - trimmed.length;
    lines.push(`${chalk.dim("\u2502")} ${trimmed}${" ".repeat(padding)} ${chalk.dim("\u2502")}`);
  }
  const bottom = `\u2514 ${chalk.dim("\u2500".repeat(inner))} \u2518`;
  lines.push(chalk.dim(bottom));
  return lines.join("\n");
}

function boxed(content: string, inner: number): string {
  return `${chalk.dim("\u2502")} ${content}${" ".repeat(Math.max(0, inner - content.length))} ${chalk.dim("\u2502")}`;
}

export function renderHeaderBar(
  modelName: string,
  providerLabel?: string,
  extra?: { ctxPct?: number; memoryCount?: number; sessionCost?: number },
): string {
  const model = (modelName.split("/").pop() || modelName).slice(0, 20);
  const prov = (providerLabel || "openrouter").slice(0, 14);
  const inner = termWidth() - 4;
  const parts: string[] = [`${chalk.cyan("\u25B6 NTOX")}`];
  parts.push(chalk.dim(model));
  parts.push(chalk.dim(prov));
  if (extra?.ctxPct !== undefined) {
    const ctxColor = extra.ctxPct > 80 ? chalk.red : extra.ctxPct > 50 ? chalk.yellow : chalk.dim;
    parts.push(`${chalk.dim("ctx")} ${ctxColor(`${extra.ctxPct.toFixed(0)}%`)}`);
  }
  if (extra?.memoryCount !== undefined) {
    parts.push(`${chalk.dim("mem")} ${chalk.cyan(String(extra.memoryCount))}`);
  }
  if (extra?.sessionCost !== undefined && extra.sessionCost > 0) {
    parts.push(chalk.yellow(formatCost(extra.sessionCost)));
  }
  const content = parts.join(` ${chalk.dim("\u2502")} `);
  const trimmed = content.length > inner ? content.slice(0, inner - 1) + "\u2026" : content;
  return [
    chalk.dim(`\u250c ${"\u2501".repeat(inner)} \u2510`),
    boxed(trimmed, inner),
    chalk.dim(`\u2514 ${"\u2501".repeat(inner)} \u2518`),
  ].join("\n");
}

export function renderStatusBar(
  usage: CostUsage,
  trace?: AgentTurnTrace | null,
  extra?: { memoryCount?: number; skillsCount?: number; mistakeCount?: number },
): string {
  const inner = termWidth() - 4;
  const parts: string[] = [];
  parts.push(chalk.dim(`in ${formatTokenCount(usage.inputTokens)}`));
  parts.push(chalk.dim(`out ${formatTokenCount(usage.outputTokens)}`));
  const cost = (usage.inputTokens / 1000) * 0.00015 + (usage.outputTokens / 1000) * 0.0006;
  parts.push(chalk.yellow(formatCost(cost)));
  if (trace) {
    const tools = trace.toolCalls.length;
    if (tools > 0) parts.push(`${chalk.dim("tools")} ${chalk.cyan(String(tools))}`);
    const files = trace.fileChanges?.length || 0;
    if (files > 0) parts.push(`${chalk.dim("files")} ${chalk.cyan(String(files))}`);
  }
  if (extra?.memoryCount !== undefined) parts.push(`${chalk.dim("mem")} ${chalk.cyan(String(extra.memoryCount))}`);
  if (extra?.skillsCount !== undefined) parts.push(`${chalk.dim("skills")} ${chalk.cyan(String(extra.skillsCount))}`);
  const content = parts.join(` ${chalk.dim("\u2502")} `);
  const trimmed = content.length > inner ? content.slice(0, inner - 1) + "\u2026" : content;
  return [
    chalk.dim(`\u250c ${"\u2500".repeat(inner)} \u2510`),
    boxed(trimmed, inner),
    chalk.dim(`\u2514 ${"\u2500".repeat(inner)} \u2518`),
  ].join("\n");
}

export function renderUserPrompt(msgCount: number, modelName?: string): string {
  const model = modelName ? chalk.dim(` ${modelName.split("/").pop() || ""}`) : "";
  return `${chalk.green("\u25B6")}${chalk.dim(`[${msgCount}]`)}${model} ${chalk.dim("\u25B8")} `;
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
  return `\n${chalk.dim("\u2502")} ${c("\u2500")} ${c(tag)} ${chalk.dim("\u2502")}`;
}

export function renderWelcome(modelName: string, providerLabel?: string): string {
  return renderHeaderBar(modelName, providerLabel);
}

export function renderHelp(): string {
  const groups = getCommandGroups();

  const cols: string[] = [];
  for (const g of groups) {
    let s = `  ${chalk.bold(g.title)}\n`;
    for (const [cmd, desc] of g.items) {
      s += `    ${chalk.cyan(cmd.padEnd(16))} ${chalk.dim(desc)}\n`;
    }
    cols.push(s);
  }
  return [
    chalk.bold("\n  ntox quick guide"),
    "",
    `  ${chalk.cyan("chat normally")} and let Ntox decide when tools help`,
    `  use ${chalk.cyan("/last")} after a busy turn, ${chalk.cyan("/retry")} when an answer is off, ${chalk.cyan("/rollback")} after bad file edits`,
    "",
    cols.join("\n"),
  ].join("\n");
}

export function renderTips(): string {
  const tips = [
    ["Fix a bad answer", "Use /retry to remove the last exchange and rerun the same prompt."],
    ["Undo context", "Use /undo when the last exchange should not influence future replies."],
    ["Inspect work", "Use /last for a compact summary, /trace for full internals, /diff for file edits."],
    ["Recover files", "Use /checkpoints, then /rollback <id>. /undo only changes chat context."],
    ["Feed context", "Use @file.ts, @./dir, @https://url, or @HEAD directly in your message."],
    ["Tune noise", "Use /ui minimal for quiet, /ui normal for daily use, /ui debug for internals."],
    ["Make memory explicit", "Use /remember preference <text> for facts you want Ntox to keep."],
  ];
  const lines = [chalk.bold("\n  practical Ntox tips"), ""];
  for (const [title, body] of tips) {
    lines.push(`  ${chalk.cyan(title.padEnd(15))} ${chalk.dim(body)}`);
  }
  return lines.join("\n");
}

function durationLabel(trace: AgentTurnTrace): string {
  return trace.completedAt ? `${trace.completedAt - trace.startedAt}ms` : "open";
}

export function renderTurnSummary(trace: AgentTurnTrace): string {
  const tools = trace.toolCalls.length;
  const failed = trace.toolCalls.filter((call) => call.success === false).length;
  const files = trace.fileChanges?.length || 0;
  const checkpoints = trace.checkpointIds.length;
  const parts = [
    `${trace.responseMode || "turn"}`,
    durationLabel(trace),
    tools > 0 ? `${tools} tool${tools === 1 ? "" : "s"}` : "",
    failed > 0 ? chalk.red(`${failed} failed`) : "",
    files > 0 ? `${files} file${files === 1 ? "" : "s"}` : "",
    checkpoints > 0 ? `${checkpoints} checkpoint${checkpoints === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return `${chalk.dim("last:")} ${parts.join(chalk.dim(" | "))}`;
}

export function renderLastTurn(trace: AgentTurnTrace | null): string {
  if (!trace) return chalk.dim("\nNo last turn yet.");
  const lines = [chalk.bold("\nLast turn"), `  ${renderTurnSummary(trace)}`];
  if (trace.toolCalls.length > 0) {
    const calls = trace.toolCalls.map((call) => {
      const status = call.success === false ? chalk.red("fail") : call.success ? chalk.green("ok") : chalk.dim("?");
      const duration = call.durationMs !== undefined ? chalk.dim(` ${call.durationMs}ms`) : "";
      return `${call.name} ${status}${duration}`;
    });
    lines.push(`  ${chalk.dim("tools")}     ${calls.join(", ")}`);
  }
  if (trace.fileChanges && trace.fileChanges.length > 0) {
    const files = trace.fileChanges.slice(0, 4).map((f) => `${f.action}:${f.path.split(/[\\/]/).pop() || f.path}`);
    lines.push(`  ${chalk.dim("files")}     ${files.join(", ")}${trace.fileChanges.length > 4 ? " ..." : ""}`);
  }
  if (trace.checkpointIds.length > 0) lines.push(`  ${chalk.dim("recover")}   /rollback ${trace.checkpointIds.at(-1)}`);
  if (trace.error) lines.push(`  ${chalk.dim("error")}     ${trace.error}`);
  lines.push(chalk.dim("  /trace for details  /diff for file changes  /retry to rerun"));
  return lines.join("\n");
}

export function renderConfig(
  modelId: string,
  maxTokens: number,
  temperature: number,
  contextLength: number | null,
  embeddingModel?: string,
  memoryEnabled?: boolean,
  memoryCount?: number,
  provider?: string,
  apiBaseUrl?: string,
  telegramToken?: string,
  uiMode?: string,
): string {
  const m: string[] = [];
  m.push(`${chalk.dim("provider")}    ${chalk.cyan(provider || "openrouter")}`);
  m.push(`${chalk.dim("model")}       ${chalk.yellow(modelId)}`);
  m.push(`${chalk.dim("max tokens")}  ${maxTokens}`);
  m.push(`${chalk.dim("temperature")} ${temperature}`);
  if (contextLength) m.push(`${chalk.dim("context")}     ${formatTokenCount(contextLength)}`);
  if (embeddingModel) m.push(`${chalk.dim("embedding")}   ${embeddingModel}`);
  if (apiBaseUrl) m.push(`${chalk.dim("base url")}    ${chalk.dim(apiBaseUrl)}`);
  if (memoryEnabled !== undefined)
    m.push(`${chalk.dim("memory")}      ${memoryEnabled ? chalk.green("on") : chalk.dim("off")}`);
  if (memoryCount !== undefined) m.push(`${chalk.dim("episodes")}    ${memoryCount}`);
  if (uiMode) m.push(`${chalk.dim("ui")}          ${chalk.cyan(uiMode)}`);
  if (telegramToken) m.push(`${chalk.dim("telegram")}    ${chalk.green("set")}`);
  return `\n${chalk.bold("config")}\n  ${m.join("\n  ")}\n`;
}

export function renderCosts(
  inT: number,
  outT: number,
  cost: number,
  totalIn: number,
  totalOut: number,
  totalCost: number,
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
  extraContext?: { used: number; limit: number },
): string {
  const tc =
    (usage.inputTokens / 1000) * (modelInfo?.pricing.prompt ?? 0) +
    (usage.outputTokens / 1000) * (modelInfo?.pricing.completion ?? 0);
  const model = modelInfo ? modelInfo.id.split("/").pop() || "?" : "?";
  const parts: string[] = [];
  parts.push(chalk.dim(`in ${formatTokenCount(usage.inputTokens)}`));
  parts.push(chalk.dim(`out ${formatTokenCount(usage.outputTokens)}`));
  parts.push(chalk.yellow(formatCost(tc)));
  if (extraContext) {
    const pct = (extraContext.used / extraContext.limit) * 100;
    parts.push(chalk.dim(`ctx ${pct.toFixed(0)}%`));
  }
  parts.push(chalk.dim(model));
  return parts.join("  ");
}

export function renderModelsMenu(models: { id: string; name: string }[], current: string): string {
  const lines: string[] = [`${chalk.bold(`models (${models.length})`)}`];
  const grouped = new Map<string, typeof models>();
  for (const m of models) {
    const p = m.id.split("/")[0] || "other";
    if (!grouped.has(p)) grouped.set(p, []);
    grouped.get(p)!.push(m);
  }
  for (const [p, list] of grouped) {
    lines.push(`  ${chalk.cyan(p.toUpperCase())}`);
    for (let i = 0; i < Math.min(list.length, 20); i++) {
      const m = list[i];
      const active = m.id === current ? chalk.green(" *") : "";
      lines.push(`  ${chalk.dim(String(models.indexOf(m) + 1).padStart(2))}. ${chalk.yellow(m.name)}${active}`);
    }
    if (list.length > 20) lines.push(chalk.dim(`  ... +${list.length - 20} more`));
  }
  lines.push(chalk.dim(`  /model <number> or /model <name> to switch  /model refresh to update OpenRouter models`));
  return lines.join("\n");
}

export function renderModelList(models: ModelInfo[], currentId: string): string {
  return renderModelsMenu(
    models.map((m) => ({ id: m.id, name: m.name })),
    currentId,
  );
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
    strategyEnabled: boolean;
    reflectionEnabled: boolean;
    mistakesEnabled: boolean;
    minConfidenceThreshold: number;
  },
  lastStrategy: QueryType | null,
  lastReflection: Reflection | null,
  mistakeStats: { total: number; bySource: Record<string, number> },
): string {
  const m: string[] = [`${chalk.bold("meta")}`];
  m.push(`  ${chalk.dim("strategy")}   ${metaConfig.strategyEnabled ? chalk.green("on") : chalk.dim("off")}`);
  m.push(`  ${chalk.dim("reflection")} ${metaConfig.reflectionEnabled ? chalk.green("on") : chalk.dim("off")}`);
  m.push(
    `  ${chalk.dim("mistakes")}   ${metaConfig.mistakesEnabled ? chalk.green("on") : chalk.dim("off")} (${mistakeStats.total})`,
  );
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
  skills: { name: string; importance: number; description: string; voices: string[] }[],
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
  const icon =
    status === "running" ? chalk.dim("\u25F7") : status === "done" ? chalk.green("\u2713") : chalk.red("\u2717");
  const color = status === "running" ? chalk.dim : status === "done" ? chalk.green : chalk.red;
  return `${chalk.dim("tool:")} ${color(name)} ${icon}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function oneLine(value: unknown, max = 120): string {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function checkpointSuffix(data: Record<string, unknown>): string {
  const id = data.autoCheckpointId;
  return typeof id === "string" && id ? ` ${chalk.dim(`checkpoint ${id}`)}` : "";
}

export function summarizeToolResult(name: string, result: ToolResult): string {
  const data = asRecord(result.data);
  if (!result.success) return oneLine(result.error || "failed", 140);
  if (name === "shell") {
    const status = typeof data.status === "number" ? `exit ${data.status}` : "ok";
    const stdout = oneLine(data.stdout, 90);
    const stderr = oneLine(data.stderr, 90);
    return [status, stdout || stderr].filter(Boolean).join(" ");
  }
  if (name === "web_read" || name === "web_fetch" || name === "browse") {
    const title = oneLine(data.title, 70);
    const method = oneLine(data.method || (Array.isArray(data.steps) ? asRecord(data.steps.at(-1)).method : ""), 20);
    const diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics.map(String).slice(0, 2).join(", ") : "";
    return [method, title || oneLine(data.url, 70), diagnostics ? chalk.yellow(diagnostics) : ""]
      .filter(Boolean)
      .join(" ");
  }
  if (name === "write" || name === "edit" || name === "checkpoint") {
    return `${oneLine(result.data, 120)}${checkpointSuffix(data)}`;
  }
  if (Array.isArray(result.data)) return `${result.data.length} item${result.data.length === 1 ? "" : "s"}`;
  if (typeof result.data === "string") return oneLine(result.data, 120);
  if (Object.keys(data).length > 0) return oneLine(JSON.stringify(data), 120);
  return "ok";
}

export function renderToolEvent(name: string, result: ToolResult, elapsedMs?: number): string {
  const icon = result.success ? chalk.green("\u2713") : chalk.red("\u2717");
  const elapsed = elapsedMs !== undefined ? chalk.dim(` ${elapsedMs}ms`) : "";
  const detail = summarizeToolResult(name, result);
  const color = result.success ? chalk.green : chalk.red;
  const label = `${chalk.dim("tool:")} ${color(name)} ${icon}${elapsed}${detail ? chalk.dim(" - ") + detail : ""}`;
  const inner = termWidth() - 4;
  return `\n${chalk.dim("\u2502")} ${chalk.dim("\u2500")} ${label} ${chalk.dim("\u2500".repeat(Math.max(0, inner - label.length - 4)))} ${chalk.dim("\u2502")}`;
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

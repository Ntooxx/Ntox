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
import type { Briefing } from "../meta/briefing.js";
import { getCommandGroups } from "./commands.js";
import {
  accents,
  gradient,
  hintLine,
  metaLine,
  paint,
  palette,
  panel,
  pill,
  stripAnsi,
  termWidth,
  dimRgb,
} from "./theme.js";

export { termWidth } from "./theme.js";

function div(n = -1): string {
  const w = n > 0 ? n : termWidth();
  return paint(dimRgb(palette.faint, 0.9), "━".repeat(w));
}

export function renderPanel(title: string, content: string[], width?: number): string {
  return panel(title, content, width !== undefined ? { width } : {});
}

export function renderHeaderBar(
  modelName: string,
  providerLabel?: string,
  extra?: { ctxPct?: number; memoryCount?: number; sessionCost?: number },
): string {
  const model = (modelName.split("/").pop() || modelName).slice(0, 28);
  const prov = (providerLabel || "openrouter").slice(0, 16);
  const parts: string[] = [];
  parts.push(pill("model", model, (s) => accents.ink(s)));
  parts.push(pill("via", prov, (s) => accents.title(s)));
  if (extra?.ctxPct !== undefined) {
    const ctxColor =
      extra.ctxPct > 80 ? accents.bad : extra.ctxPct > 60 ? accents.warn : (s: string) => accents.soft(s);
    parts.push(pill("ctx", `${extra.ctxPct.toFixed(0)}%`, ctxColor));
  }
  if (extra?.memoryCount !== undefined) {
    parts.push(pill("mem", String(extra.memoryCount), (s) => accents.violet(s)));
  }
  if (extra?.sessionCost !== undefined && extra.sessionCost > 0) {
    parts.push(accents.gold(formatCost(extra.sessionCost)));
  }
  const brand = gradient(" NTOX ", palette.accent, palette.violet);
  const body = metaLine([brand, ...parts]);
  return panel("", [body], { accent: palette.accent });
}

export function renderStatusBar(
  usage: CostUsage,
  trace?: AgentTurnTrace | null,
  extra?: { memoryCount?: number; skillsCount?: number; mistakeCount?: number },
): string {
  const parts: string[] = [];
  parts.push(pill("in", formatTokenCount(usage.inputTokens), (s) => accents.soft(s)));
  parts.push(pill("out", formatTokenCount(usage.outputTokens), (s) => accents.ink(s)));
  const cost = (usage.inputTokens / 1000) * 0.00015 + (usage.outputTokens / 1000) * 0.0006;
  parts.push(accents.gold(formatCost(cost)));
  if (trace?.completedAt) {
    const secs = ((trace.completedAt - trace.startedAt) / 1000).toFixed(1);
    parts.push(accents.soft(`${secs}s`));
  }
  if (trace) {
    const tools = trace.toolCalls.length;
    if (tools > 0) parts.push(pill("tools", String(tools), (s) => accents.title(s)));
    const files = trace.fileChanges?.length || 0;
    if (files > 0) parts.push(pill("files", String(files), (s) => accents.violet(s)));
  }
  if (extra?.memoryCount !== undefined) parts.push(pill("mem", String(extra.memoryCount), (s) => accents.soft(s)));
  if (extra?.skillsCount !== undefined) parts.push(pill("skills", String(extra.skillsCount), (s) => accents.soft(s)));
  return panel("", [metaLine(parts)], { accent: dimRgb(palette.accent, 0.55) });
}

export function renderUserPrompt(msgCount: number, modelName?: string): string {
  const model = modelName ? chalk.dim(` ${modelName.split("/").pop() || ""}`) : "";
  return `${accents.title("❯")} ${chalk.dim(`[${msgCount}]`)}${model} ${accents.soft("›")} `;
}

export function renderAssistantLabel(): string {
  return paint(palette.accent, "│") + " ";
}

export function renderUserLabel(): string {
  return accents.good("›") + " ";
}

export function renderDivider(): string {
  return div();
}

export function renderInlineTag(tag: string, color?: (s: string) => string): string {
  const c = color || ((s: string) => accents.soft(s));
  return `\n${paint(dimRgb(palette.accent, 0.65), "│")} ${c("·")} ${c(tag)}`;
}

export function renderWelcome(modelName: string, providerLabel?: string): string {
  return renderHeaderBar(modelName, providerLabel);
}

export function renderHelp(): string {
  const groups = getCommandGroups();

  const cols: string[] = [];
  for (const g of groups) {
    let s = `  ${chalk.bold(accents.title(g.title))}\n`;
    for (const [cmd, desc] of g.items) {
      s += `    ${chalk.cyan(cmd.padEnd(16))} ${chalk.dim(desc)}\n`;
    }
    cols.push(s);
  }
  return [
    "",
    `  ${gradient("ntox quick guide", palette.accent, palette.violet)}`,
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
  const lines = ["", `  ${gradient("practical Ntox tips", palette.accent, palette.violet)}`, ""];
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
  const lines = ["", `  ${gradient("last turn", palette.accent, palette.violet)}`, `  ${renderTurnSummary(trace)}`];
  if (trace.toolCalls.length > 0) {
    const calls = trace.toolCalls.map((call) => {
      const status = call.success === false ? accents.bad("fail") : call.success ? accents.good("ok") : chalk.dim("?");
      const duration = call.durationMs !== undefined ? chalk.dim(` ${call.durationMs}ms`) : "";
      return `${chalk.cyan(call.name)} ${status}${duration}`;
    });
    lines.push(`  ${chalk.dim("tools")}     ${calls.join(", ")}`);
  }
  if (trace.fileChanges && trace.fileChanges.length > 0) {
    const files = trace.fileChanges.slice(0, 4).map((f) => `${f.action}:${f.path.split(/[\\/]/).pop() || f.path}`);
    lines.push(`  ${chalk.dim("files")}     ${files.join(", ")}${trace.fileChanges.length > 4 ? " ..." : ""}`);
  }
  if (trace.checkpointIds.length > 0) lines.push(`  ${chalk.dim("recover")}   /rollback ${trace.checkpointIds.at(-1)}`);
  if (trace.error) lines.push(`  ${chalk.dim("error")}     ${trace.error}`);
  lines.push(hintLine("  /trace for details  /diff for file changes  /retry to rerun"));
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
  m.push(`${chalk.dim("provider")}    ${accents.title(provider || "openrouter")}`);
  m.push(`${chalk.dim("model")}       ${accents.gold(modelId)}`);
  m.push(`${chalk.dim("max tokens")}  ${maxTokens}`);
  m.push(`${chalk.dim("temperature")} ${temperature}`);
  if (contextLength) m.push(`${chalk.dim("context")}     ${formatTokenCount(contextLength)}`);
  if (embeddingModel) m.push(`${chalk.dim("embedding")}   ${embeddingModel}`);
  if (apiBaseUrl) m.push(`${chalk.dim("base url")}    ${chalk.dim(apiBaseUrl)}`);
  if (memoryEnabled !== undefined)
    m.push(`${chalk.dim("memory")}      ${memoryEnabled ? accents.good("on") : chalk.dim("off")}`);
  if (memoryCount !== undefined) m.push(`${chalk.dim("episodes")}    ${memoryCount}`);
  if (uiMode) m.push(`${chalk.dim("ui")}          ${accents.title(uiMode)}`);
  if (telegramToken) m.push(`${chalk.dim("telegram")}    ${accents.good("set")}`);
  return `\n${gradient("config", palette.accent, palette.violet)}\n  ${m.join("\n  ")}\n`;
}

export function renderCosts(
  inT: number,
  outT: number,
  cost: number,
  totalIn: number,
  totalOut: number,
  totalCost: number,
  embeddingFallbacks = 0,
): string {
  const lines = [
    `${gradient("costs", palette.accent, palette.violet)}`,
    `  ${chalk.dim("session")}   in ${formatTokenCount(inT)}  out ${formatTokenCount(outT)}  ${accents.gold(formatCost(cost))}`,
    `  ${chalk.dim("lifetime")}  in ${formatTokenCount(totalIn)}  out ${formatTokenCount(totalOut)}  ${accents.gold(formatCost(totalCost))}`,
  ];
  if (embeddingFallbacks > 0) {
    lines.push(
      `  ${chalk.dim("embedding")} ${accents.warn(`API unavailable — ${embeddingFallbacks} fallback${embeddingFallbacks === 1 ? "" : "s"} to local hashing`)}`,
    );
  }
  return lines.join("\n");
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
  parts.push(accents.gold(formatCost(tc)));
  if (extraContext) {
    const pct = (extraContext.used / extraContext.limit) * 100;
    parts.push(chalk.dim(`ctx ${pct.toFixed(0)}%`));
  }
  parts.push(chalk.dim(model));
  return parts.join("  ");
}

export function renderModelsMenu(models: { id: string; name: string }[], current: string): string {
  const lines: string[] = ["", `${gradient(`models (${models.length})`, palette.accent, palette.violet)}`];
  const grouped = new Map<string, typeof models>();
  for (const m of models) {
    const p = m.id.split("/")[0] || "other";
    if (!grouped.has(p)) grouped.set(p, []);
    grouped.get(p)!.push(m);
  }
  for (const [p, list] of grouped) {
    lines.push(`  ${accents.title(p.toUpperCase())}`);
    for (let i = 0; i < Math.min(list.length, 20); i++) {
      const m = list[i];
      const active = m.id === current ? accents.good(" ◂ active") : "";
      lines.push(`  ${chalk.dim(String(models.indexOf(m) + 1).padStart(2))}. ${accents.gold(m.name)}${active}`);
    }
    if (list.length > 20) lines.push(chalk.dim(`  ... +${list.length - 20} more`));
  }
  lines.push(hintLine(`  /model <number> or /model <name> to switch  /model refresh to update OpenRouter models`));
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
    "",
    `${gradient("memory", palette.accent, palette.violet)}`,
    `  ${chalk.dim("episodes")} ${accents.title(String(stats.totalEpisodes))}`,
    `  ${chalk.dim("sessions")} ${stats.totalSessions}`,
    `  ${chalk.dim("range")}    ${from}..${to}`,
    `  ${chalk.dim("size")}     ${(stats.memorySizeBytes / 1024).toFixed(1)} KB`,
    hintLine(`  /memory search <q>  /memory last <n>  /memory clear`),
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
  const m: string[] = ["", `${gradient("meta", palette.accent, palette.violet)}`];
  m.push(`  ${chalk.dim("strategy")}   ${metaConfig.strategyEnabled ? accents.good("on") : chalk.dim("off")}`);
  m.push(`  ${chalk.dim("reflection")} ${metaConfig.reflectionEnabled ? accents.good("on") : chalk.dim("off")}`);
  m.push(
    `  ${chalk.dim("mistakes")}   ${metaConfig.mistakesEnabled ? accents.good("on") : chalk.dim("off")} (${mistakeStats.total})`,
  );
  m.push(`  ${chalk.dim("confidence")} ${(metaConfig.minConfidenceThreshold * 100).toFixed(0)}% min`);
  if (lastStrategy) m.push(`  ${chalk.dim("strategy")}   ${accents.violet(lastStrategy)}`);
  if (lastReflection) {
    const c = lastReflection.confidence;
    const color = c >= 0.7 ? accents.good : c >= 0.4 ? accents.warn : accents.bad;
    m.push(`  ${chalk.dim("conf")}       ${color((c * 100).toFixed(0) + "%")}`);
    if (lastReflection.knowledgeGaps.length) {
      m.push(`  ${chalk.dim("gaps")}       ${accents.warn(lastReflection.knowledgeGaps.join(", "))}`);
    }
  }
  return m.join("\n");
}

export function renderMistakeList(mistakes: MistakeEntry[]): string {
  if (mistakes.length === 0) return chalk.dim("  no mistakes logged");
  const m: string[] = ["", `${gradient(`mistakes (${mistakes.length})`, palette.accent, palette.violet)}`];
  for (const mk of mistakes) {
    const date = new Date(mk.timestamp).toISOString().slice(0, 10);
    const src = mk.source === "user-correction" ? accents.good("user") : accents.title("self");
    m.push(`  ${chalk.cyan(mk.id)} ${chalk.dim(date)} ${src}  ${chalk.dim(mk.topicKey)}`);
  }
  return m.join("\n");
}

export function renderSkillsMenu(domains: string[], total: number): string {
  const m: string[] = [
    "",
    `${gradient(`skill library (${total} skills, ${domains.length} domains)`, palette.accent, palette.violet)}`,
  ];
  for (const d of domains) m.push(`  ${chalk.cyan(d)}`);
  m.push(hintLine(`  /menu skills <domain> to browse`));
  return m.join("\n");
}

export function renderDomainSkills(
  domain: string,
  skills: { name: string; importance: number; description: string; voices: string[] }[],
): string {
  const m: string[] = ["", `${gradient(`${domain} (${skills.length})`, palette.accent, palette.violet)}`];
  for (let i = 0; i < skills.length; i++) {
    const s = skills[i];
    const voices = s.voices.length > 0 ? chalk.dim(` [${s.voices.join(", ")}]`) : "";
    m.push(`  ${chalk.cyan(String(i + 1))}. ${s.name} ${accents.gold(String(s.importance))}/10${voices}`);
    m.push(`     ${chalk.dim(s.description.slice(0, 80))}`);
  }
  m.push(hintLine(`  /skill load <number>  or  /skill load <name>`));
  return m.join("\n");
}

export function renderToolPill(name: string, status: "running" | "done" | "failed"): string {
  const icon = status === "running" ? accents.soft("◌") : status === "done" ? accents.good("✓") : accents.bad("✗");
  const color = status === "running" ? (s: string) => accents.soft(s) : status === "done" ? accents.good : accents.bad;
  return `${accents.soft("tool")} ${accents.soft("·")} ${color(name)} ${icon}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function oneLine(value: unknown, max = 120): string {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function checkpointSuffix(data: Record<string, unknown>): string {
  const id = data.autoCheckpointId ?? data.checkpointId;
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
    return [method, title || oneLine(data.url, 70), diagnostics ? accents.warn(diagnostics) : ""]
      .filter(Boolean)
      .join(" ");
  }
  if (name === "write" || name === "edit" || name === "checkpoint") {
    const text =
      typeof result.data === "string"
        ? result.data
        : oneLine(data.result ?? data.message ?? data.path ?? JSON.stringify(data), 120);
    return `${text}${checkpointSuffix(data)}`;
  }
  if (Array.isArray(result.data)) return `${result.data.length} item${result.data.length === 1 ? "" : "s"}`;
  if (typeof result.data === "string") return oneLine(result.data, 120);
  if (Object.keys(data).length > 0) return oneLine(JSON.stringify(data), 120);
  return "ok";
}

export function renderToolEvent(name: string, result: ToolResult, elapsedMs?: number): string {
  const icon = result.success ? accents.good("✓") : accents.bad("✗");
  const elapsed = elapsedMs !== undefined ? chalk.dim(` ${elapsedMs}ms`) : "";
  const detail = summarizeToolResult(name, result);
  const color = result.success ? accents.good : accents.bad;
  const head = `${accents.soft("tool")} ${accents.soft("·")} ${color(name)} ${icon}${elapsed}`;
  return detail ? `${head} ${accents.soft("▸")} ${chalk.dim(detail)}` : head;
}

export function renderMemoryPulse(action: "stored" | "recalled", count: number): string {
  const color = action === "stored" ? accents.good : accents.title;
  return `${accents.soft("mem")} ${accents.soft("·")} ${color(action)} ${chalk.dim(count)}`;
}

export function renderConvergenceLine(progress: number): string {
  const width = 20;
  const half = Math.floor(width / 2);
  const leftLen = Math.floor(half * progress);
  const rightLen = Math.floor(half * progress);

  const left = "─".repeat(leftLen) + (progress < 1 ? "╾" : "");
  const right = (progress < 1 ? "╼" : "") + "─".repeat(rightLen);
  const center = progress >= 1 ? accents.title("●") : chalk.dim("○");

  return `${accents.soft(left)} ${center} ${accents.soft(right)}`;
}

const BRIEF_SECTION_STYLE: Record<string, { icon: string; color: (s: string) => string }> = {
  focus: { icon: "◈", color: accents.title },
  goals: { icon: "▣", color: accents.good },
  risks: { icon: "▲", color: accents.bad },
  constraints: { icon: "◇", color: accents.warn },
  recent: { icon: "…", color: accents.violet },
  away: { icon: "◔", color: (s: string) => accents.gold(s) },
};

function wrapBriefLine(text: string, width: number): string[] {
  const plain = stripAnsi(text);
  if (plain.length <= width) return [text];
  const words = plain.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= width) cur += ` ${word}`;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function renderBriefCard(brief: Briefing, width?: number): string {
  if (brief.type === "none") return "";
  const w = width ?? Math.min(termWidth(), 100);
  const inner = w - 6;
  const body: string[] = [""];
  const typeLabel = paint(palette.violet, brief.type);

  for (const section of brief.sections) {
    const style = BRIEF_SECTION_STYLE[section.label.toLowerCase()] ?? { icon: "▪", color: accents.title };
    body.push(`  ${style.color(style.icon)} ${chalk.bold(style.color(section.label.toUpperCase()))}`);
    const rawLines = section.content.split("\n");
    for (const raw of rawLines) {
      const isBullet = /^\s*-\s/.test(raw);
      const text = isBullet ? raw.replace(/^\s*-\s/, "") : raw;
      const indent = isBullet ? "    " : "    ";
      for (const line of wrapBriefLine(text, inner - 6)) {
        body.push(isBullet ? `  ${style.color("•")} ${line}` : `${indent}${chalk.dim(line)}`);
      }
    }
    body.push("");
  }

  if (brief.question) {
    for (const line of wrapBriefLine(brief.question, inner - 6)) {
      body.push(`  ${accents.gold("?")} ${accents.gold(line)}`);
    }
    body.push("");
  }

  return panel(` ${gradient("brief", palette.accent, palette.violet)} ${accents.soft("·")} ${typeLabel} `, body, {
    accent: palette.accent,
    width: w,
  });
}

import chalk from "chalk";
import type { AgentTurnTrace, DurableMemory, Episode, MemoryLane, ModelInfo, NtoxConfig } from "../types/index.js";
import type { MemoryStore } from "../memory/episodic.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { SkillRegistry } from "../skills/registry.js";
import type { PolicyRuntime } from "./policy.js";
import { formatCost, formatTokenCount, getProviderNames } from "./llm.js";
import { loadCosts, patchConfig } from "./config.js";
import { renderSkillStats } from "../skills/lifecycle.js";
import { loadPlan, renderPlan as renderPlanState } from "../tools/plan.js";
import { resolveEmailConfig, type UnreadEmail } from "../tools/email.js";
import { renderDigest, type DigestAliveSource } from "./digest.js";
import { renderCosts, renderMemoryStats } from "../cli/render.js";

export interface ChannelAgent {
  getLastTrace(): AgentTurnTrace | null;
  removeLastTurn(): boolean;
  countTokens(): number;
}

export interface ChannelCommandContext {
  config: NtoxConfig;
  llm: { updateModel(model: string): void };
  tools?: ToolRegistry;
  skills?: SkillRegistry;
  memory?: MemoryStore;
  policy?: PolicyRuntime;
  agent?: ChannelAgent;
  models?: ModelInfo[];
  sessionId?: string;
  alive?: DigestAliveSource;
}

export interface ChannelCommandOutcome {
  text: string;
  record?: boolean;
}

export const UNIFIED_COMMANDS = [
  "status",
  "cost",
  "digest",
  "mail",
  "memory",
  "remember",
  "forget",
  "model",
  "skills",
  "tools",
  "plan",
  "undo",
] as const;

const UNIFIED_SET = new Set<string>(UNIFIED_COMMANDS);

const MEMORY_USAGE =
  "Usage: /memory [search <q> | last <n> | facts | preferences | decisions | tasks | notes | why <id>]";

const LANE_VALUES: MemoryLane[] = ["fact", "preference", "decision", "task", "note"];

function parseLane(raw: string): MemoryLane | null {
  const lane = raw.toLowerCase().replace(/s$/, "");
  return (LANE_VALUES as string[]).includes(lane) ? (lane as MemoryLane) : null;
}

export function parseChannelCommand(text: string): { name: string; arg: string } | null {
  const match = /^\/([a-zA-Z][a-zA-Z0-9-]*)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  const name = match[1].toLowerCase();
  if (!UNIFIED_SET.has(name)) return null;
  return { name, arg: (match[2] ?? "").trim() };
}

function formatDurableMemory(memory: DurableMemory): string {
  const date = new Date(memory.updatedAt).toISOString().slice(0, 10);
  return `${chalk.cyan(memory.id)} ${chalk.dim(date)} ${chalk.yellow(memory.lane)} ${memory.text}`;
}

function formatEpisode(episode: Episode): string {
  const when = new Date(episode.timestamp).toISOString().slice(0, 16).replace("T", " ");
  const summary = episode.summary || episode.userMessage || "(empty)";
  return `- ${when} ${chalk.dim(summary.slice(0, 160))}`;
}

function renderStatus(ctx: ChannelCommandContext): string {
  const lines: string[] = [chalk.bold("Status:")];
  lines.push(`  ${chalk.dim("model")}     ${chalk.yellow(ctx.config.model)}`);
  lines.push(`  ${chalk.dim("provider")}  ${getProviderNames()[ctx.config.provider] || ctx.config.provider}`);
  const modelInfo = ctx.models?.find((model) => model.id === ctx.config.model);
  if (ctx.agent && modelInfo?.context_length) {
    const used = ctx.agent.countTokens();
    lines.push(`  ${chalk.dim("context")}   ${((used / modelInfo.context_length) * 100).toFixed(0)}%`);
  }
  if (ctx.memory) lines.push(`  ${chalk.dim("memory")}    ${ctx.memory.count()} episodes`);
  if (ctx.skills) lines.push(`  ${chalk.dim("skills")}    ${ctx.skills.count()}`);
  if (ctx.tools) lines.push(`  ${chalk.dim("tools")}     ${ctx.tools.list().length}`);
  const profile = ctx.policy?.profile;
  if (profile) {
    lines.push(`  ${chalk.dim("workspace")} ${profile.name} (${profile.id})`);
    lines.push(
      `  ${chalk.dim("policy")}    shell ${profile.shellPolicy}, network ${profile.networkPolicy}, checkpoints ${profile.autoCheckpoint ? "auto" : "manual"}`,
    );
  }
  const trace = ctx.agent?.getLastTrace();
  if (trace) {
    const duration = trace.completedAt ? `${trace.completedAt - trace.startedAt}ms` : "open";
    const failed = trace.toolCalls.filter((call) => call.success === false).length;
    lines.push(
      `  ${chalk.dim("last turn")} ${trace.responseMode || "unknown"}, ${duration}, tools ${trace.toolCalls.length}, failed ${failed}`,
    );
  } else if (ctx.agent) {
    lines.push(`  ${chalk.dim("last turn")} none`);
  }
  return lines.join("\n");
}

function renderTools(ctx: ChannelCommandContext): string {
  const tools = ctx.tools!.list().sort((a, b) => a.name.localeCompare(b.name));
  const lines = [chalk.bold(`Tools (${tools.length}):`)];
  for (const tool of tools) {
    const description = tool.description.replace(/\s+/g, " ").slice(0, 90);
    lines.push(`  ${chalk.cyan(tool.name)} ${chalk.dim(description)}`);
  }
  const allowed = ctx.policy?.profile.allowedTools ?? [];
  lines.push(
    allowed.length > 0
      ? chalk.dim(`\nPolicy allowlist for this workspace: ${allowed.join(", ")}`)
      : chalk.dim("\nPolicy allowlist: all tools"),
  );
  return lines.join("\n");
}

function renderCost(ctx: ChannelCommandContext, arg: string): string {
  const lifetime = loadCosts();
  const detail = arg.trim().split(/\s+/)[0];
  if (detail === "session") {
    const modelInfo = ctx.models?.find((model) => model.id === ctx.config.model);
    const pricing = modelInfo?.pricing;
    const tc =
      (lifetime.totalInputTokens / 1000) * (pricing?.prompt ?? 0) +
      (lifetime.totalOutputTokens / 1000) * (pricing?.completion ?? 0);
    return [
      chalk.bold("Lifetime usage:"),
      `  ${chalk.dim("tokens")} ${formatTokenCount(lifetime.totalInputTokens)} in, ${formatTokenCount(lifetime.totalOutputTokens)} out`,
      `  ${chalk.dim("cost")}   ${formatCost(lifetime.totalCost)}`,
      pricing
        ? chalk.dim(`  Estimated at current model pricing: ${formatCost(tc)}`)
        : chalk.dim("  Session counters are REPL-only; pricing for this model is unknown."),
    ].join("\n");
  }
  return renderCosts(0, 0, 0, lifetime.totalInputTokens, lifetime.totalOutputTokens, lifetime.totalCost);
}

function renderMemory(ctx: ChannelCommandContext, arg: string): string {
  const memory = ctx.memory!;
  const [sub = "", ...rest] = arg.trim().split(/\s+/);
  if (sub === "") {
    const parts = [renderMemoryStats(memory.getStats())];
    const durable = memory.listDurableMemories();
    if (durable.length > 0) {
      parts.push(chalk.bold("Durable memories:"));
      for (const entry of durable.slice(0, 8)) parts.push(`  ${formatDurableMemory(entry)}`);
      if (durable.length > 8) parts.push(chalk.dim(`  ... +${durable.length - 8} more`));
    }
    return parts.join("\n");
  }
  if (sub === "search") {
    const query = rest.join(" ").trim();
    if (!query) return chalk.yellow("Usage: /memory search <query>");
    const episodes = memory.search(query, 5);
    if (episodes.length === 0) return chalk.dim("No episodes matched.");
    return [chalk.bold(`Matches for "${query}":`), ...episodes.map(formatEpisode)].join("\n");
  }
  if (sub === "last") {
    const count = Math.min(Math.max(Number(rest[0]) || 5, 1), 10);
    const episodes = memory.getRecent(count);
    if (episodes.length === 0) return chalk.dim("No episodes yet.");
    return [chalk.bold(`Last ${episodes.length} episode(s):`), ...episodes.map(formatEpisode)].join("\n");
  }
  if (sub === "why") {
    const id = rest[0];
    if (!id) return chalk.yellow("Usage: /memory why <memoryId>");
    const memoryEntry = memory.getDurableMemory(id);
    if (!memoryEntry) return chalk.yellow(`No durable memory found: ${id}`);
    return [
      chalk.bold(memoryEntry.id),
      `  ${chalk.dim("lane")}       ${memoryEntry.lane}`,
      `  ${chalk.dim("confidence")} ${(memoryEntry.confidence * 100).toFixed(0)}%`,
      `  ${chalk.dim("source")}     ${memoryEntry.source}`,
      `  ${chalk.dim("provenance")} ${memoryEntry.provenance}`,
      `  ${chalk.dim("created")}    ${new Date(memoryEntry.createdAt).toISOString()}`,
      `  ${chalk.dim("text")}       ${memoryEntry.text}`,
    ].join("\n");
  }
  const lane = parseLane(sub);
  if (lane) {
    const entries = memory.listDurableMemories(lane);
    if (entries.length === 0) return chalk.dim(`No ${sub} saved.`);
    return [chalk.bold(`${sub}:`), ...entries.map((entry) => `  ${formatDurableMemory(entry)}`)].join("\n");
  }
  return chalk.yellow(MEMORY_USAGE);
}

function renderRemember(ctx: ChannelCommandContext, arg: string): string {
  const [laneRaw = "", ...textParts] = arg.trim().split(/\s+/);
  const lane = parseLane(laneRaw);
  const text = textParts.join(" ").trim();
  if (!lane || !text) {
    return chalk.yellow("Usage: /remember <fact|preference|decision|task|note> <text>");
  }
  const created = ctx.memory!.addDurableMemory(lane, text, "manual /remember");
  return chalk.green(`Remembered ${created.id}`);
}

function renderForget(ctx: ChannelCommandContext, arg: string): string {
  const id = arg.trim();
  if (!id) return chalk.yellow("Usage: /forget <memoryId>");
  return ctx.memory!.deleteDurableMemory(id)
    ? chalk.dim(`Forgot ${id}.`)
    : chalk.yellow(`No durable memory found: ${id}`);
}

function renderModel(ctx: ChannelCommandContext, arg: string): string {
  const requested = arg.trim();
  const providerNames = getProviderNames();
  if (!requested) {
    const cached = ctx.models ?? [];
    const lines = [
      chalk.bold("Model:"),
      `  ${chalk.dim("current")} ${chalk.yellow(ctx.config.model)}`,
      `  ${chalk.dim("provider")} ${providerNames[ctx.config.provider] || ctx.config.provider}`,
    ];
    if (cached.length > 0) {
      lines.push(`  ${chalk.dim("known")}    ${cached.length} models`);
      for (const model of cached.slice(0, 12)) {
        lines.push(`    ${model.id === ctx.config.model ? chalk.green("*") : " "} ${model.id}`);
      }
      if (cached.length > 12) lines.push(chalk.dim(`    ... +${cached.length - 12} more`));
    }
    lines.push(chalk.dim("  /model <provider/model> to switch (models refresh in the REPL with /model refresh)"));
    return lines.join("\n");
  }
  const next = requested.replace(/\s+/g, "");
  ctx.llm.updateModel(next);
  const prefix = next.includes("/") ? next.split("/")[0] : "";
  const warning =
    prefix && providerNames[prefix] && prefix !== ctx.config.provider
      ? `\n${chalk.yellow(`Note: "${prefix}" is not your configured provider (${ctx.config.provider}). Use /provider ${prefix} if calls fail.`)}`
      : "";
  return `${chalk.green(`Switched model to ${next}.`)}${warning}`;
}

function switchModel(ctx: ChannelCommandContext, requested: string): void {
  const next = requested.replace(/\s+/g, "");
  ctx.llm.updateModel(next);
  ctx.config.model = next;
  void patchConfig({ model: next });
}

function renderSkills(ctx: ChannelCommandContext): string {
  return renderSkillStats(ctx.skills!.list());
}

function renderToolsCommand(ctx: ChannelCommandContext): string {
  if (!ctx.tools) return chalk.yellow("Tool registry unavailable.");
  return renderTools(ctx);
}

async function renderMailCommand(ctx: ChannelCommandContext, arg: string): Promise<string> {
  const [sub = "", ...rest] = arg.trim().split(/\s+/);
  const config = resolveEmailConfig(ctx.config as unknown as Record<string, unknown>);
  if (sub === "" || sub === "help") {
    const smtp = config.smtp
      ? `${config.smtp.host}:${config.smtp.port}${config.smtp.secure ? " TLS" : ""}`
      : "not configured";
    const imap = config.imap
      ? `${config.imap.host}:${config.imap.port}${config.imap.secure ? " TLS" : ""}`
      : "not configured";
    return [
      chalk.bold("Email:"),
      `  ${chalk.dim("smtp")}    ${smtp}`,
      `  ${chalk.dim("imap")}    ${imap}`,
      "",
      chalk.dim("/mail unread [n] — list unread mail · /mail help — this message"),
      chalk.dim('Send by asking: "email this to alice@example.com"'),
    ].join("\n");
  }
  if (sub === "unread") {
    if (!ctx.tools) return chalk.yellow("Tool registry unavailable.");
    const tool = ctx.tools.get("email_read");
    if (!tool) return chalk.yellow("email_read tool is not registered.");
    const requested = rest[0] === undefined ? 5 : Number(rest[0]);
    const result = await tool.execute({ limit: Number.isFinite(requested) ? requested : 5 });
    if (!result.success) return chalk.yellow(String(result.error ?? "Mail read failed."));
    const data = (result.data ?? {}) as { count?: number; unread?: UnreadEmail[] };
    const unread = data.unread ?? [];
    if (unread.length === 0) return chalk.dim("No unread mail.");
    return [
      chalk.bold(`Unread (${unread.length}):`),
      ...unread.map((mail) => {
        const preview = mail.preview ? `\n    ${chalk.dim(mail.preview.slice(0, 160))}` : "";
        return `  ${chalk.cyan(`#${mail.uid}`)} ${chalk.dim(mail.from)} · ${mail.subject}${preview}`;
      }),
    ].join("\n");
  }
  return chalk.yellow("Usage: /mail [unread [n] | help]");
}

function renderPlanCommand(ctx: ChannelCommandContext): string {
  const plan = loadPlan(ctx.sessionId);
  if (!plan) {
    return chalk.dim("No active plan. The agent starts one with the plan tool during multi-step tasks.");
  }
  return renderPlanState(plan);
}

function renderUndo(ctx: ChannelCommandContext): string {
  const agent = ctx.agent!;
  const trace = agent.getLastTrace();
  if (!agent.removeLastTurn()) return chalk.dim("No exchange to undo.");
  const changed = trace?.fileChanges?.length || 0;
  const fileNote =
    changed > 0
      ? chalk.dim(` Files unchanged; use /rollback for ${changed} file change${changed === 1 ? "" : "s"}.`)
      : "";
  return chalk.green(`Undid last exchange.${fileNote}`);
}

export async function handleChannelCommand(
  text: string,
  ctx: ChannelCommandContext,
): Promise<ChannelCommandOutcome | null> {
  const parsed = parseChannelCommand(text);
  if (!parsed) return null;
  const { name, arg } = parsed;

  if (name === "memory" || name === "remember" || name === "forget") {
    if (!ctx.memory) return { text: "Memory is unavailable in this session." };
    if (name === "memory") return { text: renderMemory(ctx, arg) };
    if (name === "remember") return { text: renderRemember(ctx, arg), record: true };
    return { text: renderForget(ctx, arg), record: true };
  }
  if (name === "model") {
    const requested = arg.trim();
    const output = renderModel(ctx, arg);
    if (requested) switchModel(ctx, requested);
    return { text: output, record: Boolean(requested) };
  }
  if (name === "status") return { text: renderStatus(ctx) };
  if (name === "tools") return { text: renderToolsCommand(ctx) };
  if (name === "skills") return { text: renderSkills(ctx) };
  if (name === "cost") return { text: renderCost(ctx, arg) };
  if (name === "digest") {
    return {
      text: renderDigest({ alive: ctx.alive, plan: loadPlan(ctx.sessionId), costs: loadCosts() }),
    };
  }
  if (name === "plan") return { text: renderPlanCommand(ctx) };
  if (name === "mail") return { text: await renderMailCommand(ctx, arg) };
  if (name === "undo") return { text: renderUndo(ctx) };
  return null;
}

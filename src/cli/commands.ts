export type CommandGroupId = "daily" | "recovery" | "memory" | "diagnostics" | "advanced" | "references";

export interface CommandDef {
  name: string;
  description: string;
  group: CommandGroupId;
  aliases?: string[];
  replOnly?: boolean;
}

export const COMMAND_GROUPS: { id: CommandGroupId; title: string }[] = [
  { id: "daily", title: "daily flow" },
  { id: "recovery", title: "recovery" },
  { id: "memory", title: "memory & skills" },
  { id: "diagnostics", title: "diagnostics" },
  { id: "advanced", title: "advanced" },
  { id: "references", title: "references" },
];

export const COMMANDS: CommandDef[] = [
  { name: "status", description: "compact agent dashboard", group: "daily" },
  { name: "last", description: "what just happened", group: "daily" },
  { name: "tips", description: "practical usage guide", group: "daily" },
  { name: "ui", description: "set interface mode", group: "daily" },
  { name: "model", description: "switch or refresh OpenRouter models", group: "daily" },
  { name: "provider", description: "switch provider", group: "daily" },
  { name: "cost", description: "token usage", group: "daily" },
  { name: "clear", description: "clear conversation", group: "daily", aliases: ["new"] },
  { name: "exit", description: "quit", group: "daily", aliases: ["quit"] },

  { name: "undo", description: "remove last exchange", group: "recovery" },
  { name: "retry", description: "rerun last prompt", group: "recovery" },
  { name: "diff", description: "last turn file diff", group: "recovery" },
  { name: "checkpoints", description: "list file checkpoints", group: "recovery" },
  { name: "rollback", description: "restore a checkpoint", group: "recovery" },
  { name: "doctor", description: "setup health checks", group: "recovery" },

  { name: "memory", description: "view / search / clear", group: "memory" },
  { name: "remember", description: "save durable memory", group: "memory" },
  { name: "forget", description: "delete durable memory", group: "memory" },
  { name: "memory why", description: "explain a durable memory", group: "memory" },
  { name: "memory update", description: "revise durable memory", group: "memory" },
  { name: "theories", description: "inspect learned theories", group: "memory" },
  { name: "patterns", description: "inspect cognitive patterns", group: "memory" },
  { name: "profile", description: "user preferences", group: "memory" },
  { name: "mistakes", description: "learnt corrections", group: "memory" },
  { name: "skill", description: "manage skills", group: "memory" },
  { name: "skill learn", description: "create a skill", group: "memory" },
  { name: "menu skills", description: "browse skill library", group: "memory" },

  { name: "meta", description: "meta-cognition status", group: "diagnostics" },
  { name: "analytics", description: "usage stats", group: "diagnostics" },
  { name: "trace", description: "last turn trace", group: "diagnostics" },
  { name: "alive", description: "host events and wake state", group: "diagnostics" },
  { name: "workspace", description: "active workspace", group: "diagnostics" },
  { name: "permissions", description: "tool policy status", group: "diagnostics" },
  { name: "agents", description: "subagent runs", group: "diagnostics" },

  { name: "config", description: "view / set config", group: "advanced" },
  { name: "approve", description: "allow a risky shell command", group: "diagnostics" },
  { name: "suggest", description: "proactive suggestion", group: "diagnostics" },
  { name: "benchmark", description: "test cognitive kernel", group: "advanced" },
  { name: "reset", description: "reset everything", group: "advanced" },

  { name: "@file.ts", description: "inline file contents", group: "references" },
  { name: "@https://url", description: "fetch URL content", group: "references" },
  { name: "@main", description: "last git commit", group: "references" },
  { name: "@~/dir", description: "list directory", group: "references" },
];

const ALIASES = new Map<string, string>();
for (const command of COMMANDS) {
  ALIASES.set(command.name.split(/\s+/)[0], command.name.split(/\s+/)[0]);
  for (const alias of command.aliases || []) {
    ALIASES.set(alias, command.name.split(/\s+/)[0]);
  }
}
ALIASES.set("ask", "help");

export function normalizeCommandName(name: string): string {
  return ALIASES.get(name) || name;
}

export function getCommandGroups(): { title: string; items: [string, string][] }[] {
  return COMMAND_GROUPS.map((group) => ({
    title: group.title,
    items: COMMANDS.filter((command) => command.group === group.id).map((command) => [
      command.name.startsWith("@") ? command.name : `/${command.name}`,
      command.description,
    ]),
  }));
}

export function getSlashCommandNames(): string[] {
  return COMMANDS.filter((command) => !command.name.startsWith("@"))
    .flatMap((command) => [command.name.split(/\s+/)[0], ...(command.aliases || [])])
    .filter((name, index, names) => names.indexOf(name) === index)
    .sort();
}

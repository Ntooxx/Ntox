import { describe, it, expect, vi } from "vitest";
import {
  parseChannelCommand,
  handleChannelCommand,
  UNIFIED_COMMANDS,
  type ChannelCommandContext,
} from "./channel-commands.js";
import { COMMANDS, getChannelCommandGroups, renderChannelHelp } from "../cli/commands.js";
import { stripAnsi } from "../cli/theme.js";
import { ToolRegistry } from "../tools/registry.js";
import { SkillRegistry } from "../skills/registry.js";
import { MemoryStore } from "../memory/episodic.js";
import { clearPlan, savePlan } from "../tools/plan.js";
import type { AgentTurnTrace, NtoxConfig, Tool } from "../types/index.js";
import type { PolicyRuntime } from "./policy.js";

function makeContext(overrides: Partial<ChannelCommandContext> = {}): ChannelCommandContext {
  return {
    config: { model: "openai/gpt-4o", provider: "openai", apiBaseUrl: "" } as NtoxConfig,
    llm: { updateModel: vi.fn() },
    ...overrides,
  };
}

function makePolicy(allowedTools: string[]): PolicyRuntime {
  return {
    profile: {
      id: "default",
      name: "Default Workspace",
      workspaceRoot: "/w",
      readRoots: ["/w"],
      writeRoots: ["/w"],
      allowedTools,
      shellPolicy: "approval-required",
      networkPolicy: "browser-allowed",
      autoCheckpoint: true,
    },
    decisions: [],
    checkpointIds: [],
  };
}

function makeTrace(overrides: Record<string, unknown> = {}): AgentTurnTrace {
  return {
    userInput: "do the thing",
    responseMode: "tool-execute",
    startedAt: 1000,
    completedAt: 1400,
    toolCalls: [{ name: "read", success: true }],
    memoryRecallCount: 0,
    searchUsed: false,
    policyDecisions: [],
    ...overrides,
  } as unknown as AgentTurnTrace;
}

function makeTools(): ToolRegistry {
  const registry = new ToolRegistry();
  const tool: Tool = {
    name: "web_read",
    description: "Read a URL and return page text",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ success: true, data: { content: "x" } }),
  };
  registry.register(tool);
  registry.register({ ...tool, name: "grep", description: "Search file contents" });
  return registry;
}

function plain(text: string): string {
  return stripAnsi(text);
}

describe("parseChannelCommand", () => {
  it("matches unified commands with and without arguments", () => {
    expect(parseChannelCommand("/status")).toEqual({ name: "status", arg: "" });
    expect(parseChannelCommand("/memory search deploy")).toEqual({ name: "memory", arg: "search deploy" });
    expect(parseChannelCommand("  /Cost session ")).toEqual({ name: "cost", arg: "session" });
  });

  it("ignores text that is not a unified command", () => {
    expect(parseChannelCommand("hello")).toBeNull();
    expect(parseChannelCommand("/help")).toBeNull();
    expect(parseChannelCommand("/skill run deploy")).toBeNull();
    expect(parseChannelCommand("/statuses")).toBeNull();
    expect(parseChannelCommand("look at /status now")).toBeNull();
  });

  it("covers every unified command name", () => {
    for (const name of UNIFIED_COMMANDS) {
      expect(parseChannelCommand(`/${name}`)).toEqual({ name, arg: "" });
    }
  });
});

describe("handleChannelCommand", () => {
  it("returns null for non-unified input so other handlers run", async () => {
    const ctx = makeContext();
    await expect(handleChannelCommand("/help", ctx)).resolves.toBeNull();
    await expect(handleChannelCommand("plain chat", ctx)).resolves.toBeNull();
  });

  it("renders status with model, counts, workspace policy, and last turn", async () => {
    const agent = {
      getLastTrace: () => makeTrace(),
      removeLastTurn: () => true,
      countTokens: () => 5000,
    };
    const outcome = await handleChannelCommand(
      "/status",
      makeContext({
        tools: makeTools(),
        skills: new SkillRegistry(),
        memory: new MemoryStore(),
        policy: makePolicy(["read", "shell"]),
        agent,
        models: [
          {
            id: "openai/gpt-4o",
            name: "GPT-4o",
            provider: "openai",
            context_length: 128000,
            pricing: { prompt: 0, completion: 0 },
          },
        ],
      }),
    );

    expect(outcome).not.toBeNull();
    const text = plain(outcome!.text);
    expect(text).toContain("Status:");
    expect(text).toContain("openai/gpt-4o");
    expect(text).toContain("4%"); /* 5000 / 128000 */
    expect(text).toContain("Default Workspace (default)");
    expect(text).toContain("shell approval-required");
    expect(text).toContain("tool-execute, 400ms, tools 1, failed 0");
    expect(outcome!.record).toBeFalsy();
  });

  it("renders status with only the config when optional deps are missing", async () => {
    const outcome = await handleChannelCommand("/status", makeContext());
    const text = plain(outcome!.text);
    expect(text).toContain("Status:");
    expect(text).toContain("openai/gpt-4o");
    expect(text).not.toContain("workspace");
  });

  it("lists tools and the workspace allowlist", async () => {
    const outcome = await handleChannelCommand(
      "/tools",
      makeContext({ tools: makeTools(), policy: makePolicy(["read", "shell"]) }),
    );
    const text = plain(outcome!.text);
    expect(text).toContain("Tools (2):");
    expect(text).toContain("grep");
    expect(text).toContain("web_read");
    expect(text).toContain("Policy allowlist for this workspace: read, shell");
  });

  it("reports installed skill stats through /skills", async () => {
    const outcome = await handleChannelCommand("/skills", makeContext({ skills: new SkillRegistry() }));
    expect(plain(outcome!.text).length).toBeGreaterThan(0);
  });

  it("answers /cost with lifetime usage", async () => {
    const outcome = await handleChannelCommand("/cost", makeContext());
    const text = plain(outcome!.text);
    expect(text.toLowerCase()).toContain("lifetime");
    expect(text).toContain("$0.00");
  });

  it("runs memory read commands without recording them", async () => {
    const ctx = makeContext({ memory: new MemoryStore() });

    const stats = await handleChannelCommand("/memory", ctx);
    expect(plain(stats!.text).toLowerCase()).toContain("episodes");
    expect(stats!.record).toBeFalsy();

    const noMatch = await handleChannelCommand("/memory search deploy", ctx);
    expect(plain(noMatch!.text)).toContain("No episodes matched.");

    const badLane = await handleChannelCommand("/memory memes", ctx);
    expect(plain(badLane!.text)).toContain("Usage: /memory");
  });

  it("writes and removes durable memories through /remember and /forget", async () => {
    const ctx = makeContext({ memory: new MemoryStore() });

    const remembered = await handleChannelCommand("/remember fact NTOX ships in dark mode", ctx);
    expect(plain(remembered!.text)).toContain("Remembered");
    expect(remembered!.record).toBe(true);
    const id = plain(remembered!.text).split(/\s+/).pop()!;

    const listed = await handleChannelCommand("/memory facts", ctx);
    expect(plain(listed!.text)).toContain("dark mode");

    const why = await handleChannelCommand(`/memory why ${id}`, ctx);
    expect(plain(why!.text)).toContain("NTOX ships in dark mode");

    const forgotten = await handleChannelCommand(`/forget ${id}`, ctx);
    expect(plain(forgotten!.text)).toContain("Forgot");
    expect(forgotten!.record).toBe(true);

    const missing = await handleChannelCommand(`/forget ${id}`, ctx);
    expect(plain(missing!.text)).toContain("No durable memory found");
  });

  it("shows the current model and switches on request", async () => {
    const updateModel = vi.fn();
    const config = { model: "openai/gpt-4o", provider: "openrouter" } as NtoxConfig;
    const ctx = makeContext({ config, llm: { updateModel } });

    const current = await handleChannelCommand("/model", ctx);
    expect(plain(current!.text)).toContain("openai/gpt-4o");
    expect(updateModel).not.toHaveBeenCalled();

    const switched = await handleChannelCommand("/model anthropic/claude-3-opus", ctx);
    expect(updateModel).toHaveBeenCalledWith("anthropic/claude-3-opus");
    expect(config.model).toBe("anthropic/claude-3-opus");
    expect(switched!.record).toBe(true);
    expect(plain(switched!.text)).toContain("Switched model to anthropic/claude-3-opus");
  });

  it("shows an empty plan and a saved plan", async () => {
    const sessionId = "channel-commands-test";
    clearPlan(sessionId);
    const empty = await handleChannelCommand("/plan", makeContext({ sessionId }));
    expect(plain(empty!.text)).toContain("No active plan");

    const now = Date.now();
    savePlan({
      sessionId,
      goal: "ship 3.1",
      createdAt: now,
      updatedAt: now,
      tasks: [
        { id: "t1", title: "unify commands", status: "completed", createdAt: now, updatedAt: now },
        { id: "t2", title: "verify", status: "in_progress", createdAt: now, updatedAt: now },
      ],
    });
    const plan = await handleChannelCommand("/plan", makeContext({ sessionId }));
    expect(plain(plan!.text)).toContain("ship 3.1");
    expect(plain(plan!.text)).toContain("unify commands");
    clearPlan(sessionId);
  });

  it("undoes the last exchange through the agent", async () => {
    const removeLastTurn = vi.fn(() => false);
    const outcome = await handleChannelCommand(
      "/undo",
      makeContext({ agent: { getLastTrace: () => null, removeLastTurn, countTokens: () => 0 } }),
    );
    expect(plain(outcome!.text)).toContain("No exchange to undo.");
    expect(removeLastTurn).toHaveBeenCalled();

    const removeSecond = vi.fn(() => true);
    const undone = await handleChannelCommand(
      "/undo",
      makeContext({
        agent: {
          getLastTrace: () =>
            makeTrace({ toolCalls: [], fileChanges: [{ path: "a.ts", action: "write", timestamp: 1 }] }),
          removeLastTurn: removeSecond,
          countTokens: () => 0,
        },
      }),
    );
    expect(plain(undone!.text)).toContain("Undid last exchange.");
    expect(plain(undone!.text)).toContain("/rollback");
  });

  it("reports missing memory instead of throwing", async () => {
    const outcome = await handleChannelCommand("/memory", makeContext());
    expect(plain(outcome!.text)).toContain("Memory is unavailable");
  });
});

describe("channel help registry", () => {
  it("keeps every unified command marked channel-available in the catalog", () => {
    for (const name of UNIFIED_COMMANDS) {
      expect(COMMANDS.find((command) => command.name === name)?.channel).toBe(true);
    }
  });

  it("excludes REPL-only commands from channel groups", () => {
    const names = getChannelCommandGroups()
      .flatMap((group) => group.items)
      .map(([cmd]) => cmd);
    expect(names).toContain("/status");
    expect(names).toContain("/tools");
    expect(names).toContain("/plan");
    expect(names).toContain("/help");
    expect(names).not.toContain("/rollback");
    expect(names).not.toContain("/doctor");
    expect(names).not.toContain("/tips");
  });

  it("renders plain help with groups, extras, and no ANSI", () => {
    const help = renderChannelHelp(["/voice on|off|auto — spoken replies"]);
    expect(help).not.toContain("\x1b[");
    expect(help).toContain("NTOX commands:");
    expect(help).toContain("/memory");
    expect(help).toContain("/skill run");
    expect(help).toContain("/voice on|off|auto — spoken replies");
    expect(help).toContain("reply instantly");
  });
});

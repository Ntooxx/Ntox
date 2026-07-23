import type { Tool } from "../types/index.js";
import { Agent } from "../core/agent.js";
import { createAgentConfig, createSessionInfra, createSharedInfra } from "../core/dispatcher.js";
import { loadConfig } from "../core/config.js";
import { randomUUID } from "node:crypto";

const SUBAGENT_TIMEOUT = 120_000;
const MAX_CONCURRENT = 3;

let activeCount = 0;

export const subagentTool: Tool = {
  name: "subagent",
  description: "Spawn an isolated subagent to handle a task independently. The subagent has its own message history and can use a filtered set of tools. Use for parallel or isolated work.",
  parameters: {
    type: "object",
    properties: {
      task: { type: "string", description: "Task description or prompt for the subagent" },
      tools: { type: "string", description: "Comma-separated list of tool names the subagent can use (default: all available tools)" },
    },
    required: ["task"],
  },
  async execute(args) {
    const task = String(args.task);
    if (!task) return { success: false, error: "task is required" };

    if (activeCount >= MAX_CONCURRENT) {
      return { success: false, error: `Max concurrent subagents (${MAX_CONCURRENT}) reached. Wait for one to finish.` };
    }

    activeCount++;
    try {
      const config = loadConfig();
      const shared = createSharedInfra(config);
      const session = createSessionInfra(shared);

      if (args.tools) {
        const allowed = String(args.tools).split(",").map((t) => t.trim()).filter(Boolean);
        const filtered = new (await import("../tools/registry.js")).ToolRegistry();
        for (const name of allowed) {
          const tool = shared.tools.get(name);
          if (tool) filtered.register(tool);
        }
        shared.tools = filtered;
      }

      const sessionId = `subagent-${randomUUID().slice(0, 8)}`;
      const agentConfig = createAgentConfig({ ...shared, ...session }, config, sessionId, {
        skipReflection: true,
        memoryEnabled: false,
        strategyEnabled: false,
        mistakesEnabled: false,
      });

      const agent = new Agent(agentConfig);
      let response = "";

      const timeoutPromise = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error("Subagent timed out after 120s")), SUBAGENT_TIMEOUT);
      });

      const workPromise = (async () => {
        const stream = agent.run(task, {
          onToken: (t) => { response += t; },
          onToolCall: () => {},
          onToolResult: () => {},
          onUsage: () => {},
          onThinking: () => {},
        });
        for await (const _ of stream) { /* drain */ }
        return response.trim();
      })();

      const result = await Promise.race([workPromise, timeoutPromise]);
      return { success: true, data: { response: result, sessionId } };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      activeCount--;
    }
  },
};
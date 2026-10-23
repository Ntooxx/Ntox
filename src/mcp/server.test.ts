import { describe, it, expect, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSkillMcpServer, skillToolName, SKILL_LIST_TOOL, SKILL_RUN_TOOL } from "./server.js";
import type { SkillServerDeps } from "./server.js";
import type { SkillDefinition } from "../types/index.js";

interface Session {
  client: Client;
  server: ReturnType<typeof createSkillMcpServer>;
}

const sessions: Session[] = [];

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: "morning-brief",
    description: "A short spoken morning brief",
    category: "planning",
    prompt: "Gather weather and headlines, then deliver a brief.",
    triggers: ["morning brief", "brief me"],
    tools: ["web_read"],
    examples: [],
    created: 1,
    updated: 1,
    usageCount: 0,
    ...overrides,
  };
}

async function startServer(deps: SkillServerDeps): Promise<Session> {
  const server = createSkillMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-host", version: "1.0.0" });
  await client.connect(clientTransport);
  const session = { client, server };
  sessions.push(session);
  return session;
}

function readText(result: { content?: Array<{ type: string; text?: string }> }): string {
  return (result.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    await session.client.close().catch(() => {});
    await session.server.close().catch(() => {});
  }
});

describe("skillToolName", () => {
  it("sanitizes skill names into MCP-safe tool names", () => {
    const taken = new Set<string>();
    expect(skillToolName("Morning Brief!", taken)).toBe("morning-brief");
    expect(skillToolName("Morning Brief?", taken)).toBe("morning-brief-2");
    expect(skillToolName("", taken)).toBe("skill");
  });

  it("never lets a skill shadow the meta tools", () => {
    const taken = new Set<string>();
    expect(skillToolName("skill_list", taken)).toBe("skill_list-run");
    expect(skillToolName("skill_run", taken)).toBe("skill_run-run");
  });
});

describe("createSkillMcpServer", () => {
  it("exposes skill_list, skill_run, and one tool per skill", async () => {
    const skills = [
      makeSkill(),
      makeSkill({ name: "deploy-checklist", description: "Check CI then tag", triggers: ["run deploy"] }),
    ];
    const { client } = await startServer({
      skills: () => skills,
      getSkill: (name) => skills.find((skill) => skill.name === name),
      runSkill: async () => "ok",
    });

    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);

    expect(names).toContain(SKILL_LIST_TOOL);
    expect(names).toContain(SKILL_RUN_TOOL);
    expect(names).toContain("morning-brief");
    expect(names).toContain("deploy-checklist");
    const briefTool = listed.tools.find((tool) => tool.name === "morning-brief");
    expect(briefTool?.description).toContain("spoken morning brief");
    expect(briefTool?.description).toContain("Triggers: morning brief, brief me");
    expect(briefTool?.inputSchema).toHaveProperty("properties.input");
  });

  it("lists skills with filters through skill_list", async () => {
    const skills = [makeSkill(), makeSkill({ name: "weather-alerts", description: "Warn about storms" })];
    const { client } = await startServer({
      skills: () => skills,
      getSkill: (name) => skills.find((skill) => skill.name === name),
      runSkill: async () => "ok",
    });

    const all = await client.callTool({ name: SKILL_LIST_TOOL, arguments: {} });
    expect(readText(all as { content?: Array<{ type: string; text?: string }> })).toContain("2 skill(s)");
    expect(readText(all as { content?: Array<{ type: string; text?: string }> })).toContain("morning-brief");

    const filtered = await client.callTool({ name: SKILL_LIST_TOOL, arguments: { query: "storms" } });
    const text = readText(filtered as { content?: Array<{ type: string; text?: string }> });
    expect(text).toContain("weather-alerts");
    expect(text).not.toContain("morning-brief");
  });

  it("runs a skill through skill_run with the provided input", async () => {
    const skills = [makeSkill({ steps: [{ kind: "llm", prompt: "brief for {{input}}" }] })];
    const calls: { name: string; input: string }[] = [];
    const { client } = await startServer({
      skills: () => skills,
      getSkill: (name) => skills.find((skill) => skill.name === name),
      runSkill: async (skill, input) => {
        calls.push({ name: skill.name, input });
        return "sunny, 21C";
      },
    });

    const result = await client.callTool({
      name: SKILL_RUN_TOOL,
      arguments: { name: "morning-brief", input: "Berlin" },
    });

    expect(result.isError).toBeFalsy();
    expect(readText(result as { content?: Array<{ type: string; text?: string }> })).toBe("sunny, 21C");
    expect(calls).toEqual([{ name: "morning-brief", input: "Berlin" }]);
  });

  it("reports unknown skills as tool errors", async () => {
    const skills = [makeSkill()];
    const { client } = await startServer({
      skills: () => skills,
      getSkill: () => undefined,
      runSkill: async () => "never",
    });

    const result = await client.callTool({ name: SKILL_RUN_TOOL, arguments: { name: "ghost" } });

    expect(result.isError).toBe(true);
    expect(readText(result as { content?: Array<{ type: string; text?: string }> })).toContain(
      'Skill "ghost" not found',
    );
  });

  it("reports skill failures as tool errors instead of protocol errors", async () => {
    const skills = [makeSkill()];
    const { client } = await startServer({
      skills: () => skills,
      getSkill: (name) => skills.find((skill) => skill.name === name),
      runSkill: async () => {
        throw new Error("provider unreachable");
      },
    });

    const viaMeta = await client.callTool({ name: SKILL_RUN_TOOL, arguments: { name: "morning-brief" } });
    expect(viaMeta.isError).toBe(true);
    expect(readText(viaMeta as { content?: Array<{ type: string; text?: string }> })).toContain("provider unreachable");

    const viaTool = await client.callTool({ name: "morning-brief", arguments: {} });
    expect(viaTool.isError).toBe(true);
    expect(readText(viaTool as { content?: Array<{ type: string; text?: string }> })).toContain("provider unreachable");
  });

  it("calls per-skill tools with their input", async () => {
    const skills = [makeSkill()];
    const inputs: string[] = [];
    const { client } = await startServer({
      skills: () => skills,
      getSkill: (name) => skills.find((skill) => skill.name === name),
      runSkill: async (_skill, input) => {
        inputs.push(input);
        return "done";
      },
    });

    const result = await client.callTool({ name: "morning-brief", arguments: { input: "make it short" } });

    expect(result.isError).toBeFalsy();
    expect(inputs).toEqual(["make it short"]);
  });

  it("keeps duplicate skill names from shadowing each other", async () => {
    const skills = [makeSkill({ name: "my skill" }), makeSkill({ name: "my-skill" })];
    const { client } = await startServer({
      skills: () => skills,
      getSkill: (name) => skills.find((skill) => skill.name === name),
      runSkill: async (skill) => `ran:${skill.name}`,
    });

    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    expect(names).toContain("my-skill");
    expect(names).toContain("my-skill-2");
  });
});

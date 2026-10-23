import { describe, it, expect, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { McpBridge, mcpToolName, renderMcpStatus } from "./bridge.js";
import { ToolRegistry } from "../tools/registry.js";
import type { McpServerEntry } from "../types/index.js";

interface Harness {
  bridge: McpBridge;
  registry: ToolRegistry;
  servers: McpServer[];
}

const harnesses: Harness[] = [];

interface HarnessOptions {
  servers: Record<string, McpServerEntry>;
  populate?: (server: McpServer) => void;
  connectTimeoutMs?: number;
  registry?: ToolRegistry;
  realTransports?: boolean;
}

function makeHarness(options: HarnessOptions): Harness {
  const registry = options.registry ?? new ToolRegistry();
  const created: McpServer[] = [];
  const bridge = new McpBridge({
    registry,
    servers: options.servers,
    connectTimeoutMs: options.connectTimeoutMs ?? 5_000,
    ...(options.realTransports
      ? {}
      : {
          createTransport: async () => {
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            const server = new McpServer({ name: "test-server", version: "1.0.0" });
            options.populate?.(server);
            await server.connect(serverTransport);
            created.push(server);
            return clientTransport;
          },
        }),
  });
  const harness = { bridge, registry, servers: created };
  harnesses.push(harness);
  return harness;
}

function populateDemoServer(server: McpServer): void {
  server.registerTool(
    "echo",
    { description: "Echoes text back", inputSchema: { text: z.string() } },
    async ({ text }) => ({ content: [{ type: "text", text: `echo:${text}` }] }),
  );
  server.registerTool("boom", { description: "Always fails" }, async () => ({
    content: [{ type: "text", text: "kaboom" }],
    isError: true,
  }));
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.bridge.disconnect().catch(() => {});
    for (const server of harness.servers) await server.close().catch(() => {});
  }
});

describe("mcpToolName", () => {
  it("builds an LLM-safe qualified name", () => {
    expect(mcpToolName("files", "read_file")).toBe("mcp_files_read_file");
    expect(mcpToolName("my server!", "tool/one")).toBe("mcp_my_server__tool_one");
  });

  it("truncates long names to the 64 character tool-name limit", () => {
    const name = mcpToolName("a".repeat(60), "b".repeat(60));
    expect(name.length).toBe(64);
    expect(name).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});

describe("McpBridge", () => {
  it("connects, lists remote tools, and registers them as qualified tools", async () => {
    const { bridge, registry } = makeHarness({
      servers: { demo: { command: "ignored-by-transport-seam" } },
      populate: populateDemoServer,
    });

    const statuses = await bridge.connectAll();

    expect(statuses).toHaveLength(1);
    expect(statuses[0].state).toBe("connected");
    expect(statuses[0].kind).toBe("stdio");
    expect(statuses[0].tools).toEqual(["mcp_demo_echo", "mcp_demo_boom"]);

    const tool = registry.get("mcp_demo_echo");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("Echoes text back");
    expect(tool!.description).toContain("MCP server: demo");
    expect(tool!.parameters.properties).toHaveProperty("text");
    expect(tool!.parameters.required).toEqual(["text"]);

    const openai = registry.toOpenAITools().find((t) => t.function.name === "mcp_demo_echo");
    expect(openai).toBeDefined();
    expect(openai!.function.parameters.required).toEqual(["text"]);
  });

  it("executes remote tools and normalizes text results", async () => {
    const { bridge, registry } = makeHarness({
      servers: { demo: { command: "ignored" } },
      populate: populateDemoServer,
    });
    await bridge.connectAll();

    const result = await registry.get("mcp_demo_echo")!.execute({ text: "hi" });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ content: "echo:hi", server: "demo", tool: "echo" });
  });

  it("surfaces tool-level failures as failed results", async () => {
    const { bridge, registry } = makeHarness({
      servers: { demo: { command: "ignored" } },
      populate: populateDemoServer,
    });
    await bridge.connectAll();

    const result = await registry.get("mcp_demo_boom")!.execute({});

    expect(result.success).toBe(false);
    expect(result.error).toContain("kaboom");
  });

  it("reports invalid arguments as failures instead of throwing", async () => {
    const { bridge, registry } = makeHarness({
      servers: { demo: { command: "ignored" } },
      populate: populateDemoServer,
    });
    await bridge.connectAll();

    const result = await registry.get("mcp_demo_echo")!.execute({});

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/-32602|validation/i);
  });

  it("skips tools whose qualified name already exists", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "mcp_demo_echo",
      description: "pre-existing",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ success: true, data: "local" }),
    });
    const { bridge } = makeHarness({
      servers: { demo: { command: "ignored" } },
      populate: populateDemoServer,
      registry,
    });

    const statuses = await bridge.connectAll();

    expect(statuses[0].tools).toEqual(["mcp_demo_boom"]);
    expect(statuses[0].warnings).toEqual(['tool "mcp_demo_echo" skipped: name collision']);
    expect((await registry.get("mcp_demo_echo")!.execute({})).data).toBe("local");
  });

  it("fails entries that have neither a command nor a url", async () => {
    const { bridge } = makeHarness({ servers: { broken: {} } });

    const [status] = await bridge.connectAll();

    expect(status.state).toBe("failed");
    expect(status.error).toContain('"command"');
    expect(status.error).toContain('"url"');
  });

  it("marks disabled entries without connecting", async () => {
    const { bridge } = makeHarness({ servers: { off: { command: "ignored", enabled: false } } });

    const [status] = await bridge.connectAll();

    expect(status.state).toBe("disabled");
    expect(status.tools).toEqual([]);
  });

  it("reports unreachable stdio servers as failed without throwing", async () => {
    const { bridge } = makeHarness({
      servers: { ghost: { command: "ntox-definitely-not-a-real-command" } },
      connectTimeoutMs: 5_000,
      realTransports: true,
    });

    const [status] = await bridge.connectAll();

    expect(status.state).toBe("failed");
    expect(status.kind).toBe("stdio");
    expect(status.error).toBeTruthy();
  });

  it("reports unreachable http endpoints as failed after the sse fallback", async () => {
    const { bridge } = makeHarness({
      servers: { remote: { url: "http://127.0.0.1:9/mcp" } },
      connectTimeoutMs: 2_000,
      realTransports: true,
    });

    const [status] = await bridge.connectAll();

    expect(status.state).toBe("failed");
    expect(status.kind).toBe("http");
    expect(status.error).toContain("http:");
    expect(status.error).toContain("sse:");
  });

  it("unregisters tools and closes clients on disconnect", async () => {
    const { bridge, registry } = makeHarness({
      servers: { demo: { command: "ignored" } },
      populate: populateDemoServer,
    });
    await bridge.connectAll();
    expect(bridge.registeredTools()).toHaveLength(2);

    await bridge.disconnect();

    expect(bridge.registeredTools()).toEqual([]);
    expect(registry.get("mcp_demo_echo")).toBeUndefined();
    expect(bridge.statuses()[0].state).toBe("closed");
  });

  it("reconnects cleanly when connectAll runs twice", async () => {
    const { bridge, registry } = makeHarness({
      servers: { demo: { command: "ignored" } },
      populate: populateDemoServer,
    });
    await bridge.connectAll();
    const first = registry.list().filter((tool) => tool.name.startsWith("mcp_")).length;

    await bridge.connectAll();

    const second = registry.list().filter((tool) => tool.name.startsWith("mcp_"));
    expect(second).toHaveLength(first);
    expect(bridge.statuses()[0].state).toBe("connected");
  });
});

describe("renderMcpStatus", () => {
  it("explains how to configure servers when none exist", () => {
    const text = renderMcpStatus([]);
    expect(text).toContain("No MCP servers configured");
    expect(text).toContain("mcpServers");
  });

  it("renders state, tools, and errors per server", () => {
    const text = renderMcpStatus([
      {
        name: "files",
        kind: "stdio",
        target: "npx -y mcp-files",
        state: "connected",
        tools: ["mcp_files_read"],
        warnings: [],
      },
      {
        name: "remote",
        kind: "http",
        target: "https://example.com/mcp",
        state: "failed",
        tools: [],
        error: "http: refused; sse: refused",
        warnings: [],
      },
    ]);

    expect(text).toContain("+ files");
    expect(text).toContain("mcp_files_read");
    expect(text).toContain("! remote");
    expect(text).toContain("http: refused; sse: refused");
  });
});

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult, Tool as RemoteTool } from "@modelcontextprotocol/sdk/types.js";
import type { McpServerEntry, ToolResult } from "../types/index.js";
import type { ToolRegistry } from "../tools/registry.js";
import { enforceToolPolicy } from "../core/policy.js";
import type { PolicyRuntime } from "../core/policy.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_CALL_TIMEOUT_MS = 30_000;
const MAX_TOOL_NAME_LENGTH = 64;

export type McpTransportKind = "stdio" | "http" | "sse";
export type McpServerState = "connected" | "failed" | "disabled" | "closed";

export interface McpServerStatus {
  name: string;
  kind: McpTransportKind;
  target: string;
  state: McpServerState;
  tools: string[];
  error?: string;
  warnings: string[];
}

export interface McpBridgeOptions {
  registry: ToolRegistry;
  policy: PolicyRuntime;
  servers?: Record<string, McpServerEntry>;
  connectTimeoutMs?: number;
  callTimeoutMs?: number;
  createTransport?: (name: string, entry: McpServerEntry, kind: McpTransportKind) => Transport | Promise<Transport>;
}

interface TransportCandidate {
  kind: McpTransportKind;
  make: () => Transport | Promise<Transport>;
}

interface ToolRoute {
  client: Client;
  remote: string;
  server: string;
}

export function mcpToolName(server: string, tool: string): string {
  const raw = `mcp_${server}_${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  return raw.slice(0, MAX_TOOL_NAME_LENGTH);
}

function transportCandidates(entry: McpServerEntry): TransportCandidate[] {
  if (entry.command) {
    return [
      {
        kind: "stdio",
        make: () =>
          new StdioClientTransport({
            command: entry.command!,
            args: entry.args ?? [],
            env: entry.env ?? {},
            stderr: process.stderr,
          }),
      },
    ];
  }
  if (entry.url) {
    const requestInit = entry.headers ? { headers: entry.headers } : undefined;
    return [
      {
        kind: "http",
        make: () => new StreamableHTTPClientTransport(new URL(entry.url!), { requestInit }),
      },
      {
        kind: "sse",
        make: () => new SSEClientTransport(new URL(entry.url!), { requestInit }),
      },
    ];
  }
  return [];
}

function describeRemoteTool(tool: RemoteTool, server: string): string {
  const base = tool.description?.trim();
  return base ? `${base}\n(MCP server: ${server})` : `MCP tool "${tool.name}" provided by server "${server}".`;
}

function normalizeResult(result: CallToolResult, qualified: string, server: string, remote: string): ToolResult {
  const blocks = Array.isArray(result.content) ? result.content : [];
  const text = blocks
    .filter((block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
  if (result.isError) {
    return { success: false, error: text || `MCP tool ${qualified} failed on server "${server}"` };
  }
  const content = text || JSON.stringify(blocks);
  return { success: true, data: { content, server, tool: remote } };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export class McpBridge {
  private readonly registry: ToolRegistry;
  private readonly policy: PolicyRuntime;
  private readonly servers: Record<string, McpServerEntry>;
  private readonly connectTimeoutMs: number;
  private readonly callTimeoutMs: number;
  private readonly createTransport?: McpBridgeOptions["createTransport"];
  private readonly clients = new Map<string, Client>();
  private readonly routes = new Map<string, ToolRoute>();
  private serverStatuses: McpServerStatus[] = [];

  constructor(options: McpBridgeOptions) {
    this.registry = options.registry;
    this.policy = options.policy;
    this.servers = options.servers ?? {};
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    this.createTransport = options.createTransport;
  }

  statuses(): McpServerStatus[] {
    return this.serverStatuses.map((status) => ({
      ...status,
      tools: [...status.tools],
      warnings: [...status.warnings],
    }));
  }

  registeredTools(): string[] {
    return Array.from(this.routes.keys());
  }

  has(name: string): boolean {
    return this.routes.has(name);
  }

  async connectAll(): Promise<McpServerStatus[]> {
    if (this.clients.size > 0) await this.disconnect();
    const statuses: McpServerStatus[] = [];
    for (const [name, entry] of Object.entries(this.servers)) {
      statuses.push(await this.connectOne(name, entry));
    }
    this.serverStatuses = statuses;
    return this.statuses();
  }

  private async connectOne(name: string, entry: McpServerEntry): Promise<McpServerStatus> {
    const target = entry.command ? [entry.command, ...(entry.args ?? [])].join(" ") : (entry.url ?? "");
    const base: McpServerStatus = {
      name,
      kind: entry.command ? "stdio" : "http",
      target,
      state: "failed",
      tools: [],
      warnings: [],
    };

    if (entry.enabled === false) {
      return { ...base, state: "disabled" };
    }

    if (!entry.command && !entry.url) {
      return { ...base, error: `server "${name}" needs a "command" (stdio) or "url" (http/sse)` };
    }

    const candidates = this.createTransport
      ? [{ kind: base.kind, make: () => this.createTransport!(name, entry, base.kind) }]
      : transportCandidates(entry);

    const failures: string[] = [];
    for (const candidate of candidates) {
      const client = new Client({ name: "ntox", version: "0.1.0" });
      try {
        const transport = await candidate.make();
        await withTimeout(client.connect(transport), this.connectTimeoutMs, `MCP "${name}" handshake`);
        const listed = await client.listTools();
        const status = await this.registerServerTools(name, client, listed.tools, { ...base, kind: candidate.kind });
        this.clients.set(name, client);
        return status;
      } catch (error) {
        failures.push(`${candidate.kind}: ${error instanceof Error ? error.message : String(error)}`);
        await client.close().catch(() => {});
      }
    }
    return { ...base, error: failures.join("; ") };
  }

  private async registerServerTools(
    name: string,
    client: Client,
    tools: RemoteTool[],
    status: McpServerStatus,
  ): Promise<McpServerStatus> {
    const registered: string[] = [];
    for (const tool of tools) {
      const qualified = mcpToolName(name, tool.name);
      if (this.registry.get(qualified) || this.routes.has(qualified)) {
        status.warnings.push(`tool "${qualified}" skipped: name collision`);
        continue;
      }
      const route: ToolRoute = { client, remote: tool.name, server: name };
      this.routes.set(qualified, route);
      this.registry.register(
        enforceToolPolicy(
          {
            name: qualified,
            description: describeRemoteTool(tool, name),
            parameters: {
              type: "object",
              properties: tool.inputSchema?.properties ?? {},
              required: tool.inputSchema?.required ?? [],
            },
            execute: (args) => this.callTool(qualified, route, args),
          },
          this.policy,
        ),
      );
      registered.push(qualified);
    }
    return { ...status, state: "connected", tools: registered };
  }

  private async callTool(qualified: string, route: ToolRoute, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const result = await route.client.callTool({ name: route.remote, arguments: args }, undefined, {
        timeout: this.callTimeoutMs,
      });
      return normalizeResult(result as CallToolResult, qualified, route.server, route.remote);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { success: false, error: `MCP ${qualified}: ${reason}` };
    }
  }

  async disconnect(): Promise<void> {
    for (const qualified of this.routes.keys()) {
      this.registry.unregister(qualified);
    }
    this.routes.clear();
    const clients = Array.from(this.clients.values());
    this.clients.clear();
    await Promise.all(clients.map((client) => client.close().catch(() => {})));
    this.serverStatuses = this.serverStatuses.map((status) =>
      status.state === "connected" ? { ...status, state: "closed", tools: [] } : status,
    );
  }
}

export function renderMcpStatus(statuses: McpServerStatus[]): string {
  if (statuses.length === 0) {
    return (
      "No MCP servers configured.\n" +
      'Add one to ~/.ntox/config.json under "mcpServers", for example:\n' +
      '  "mcpServers": { "files": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] } }'
    );
  }
  const width = Math.max(...statuses.map((status) => status.name.length));
  const lines: string[] = [`MCP servers (${statuses.length}):`];
  for (const status of statuses) {
    const mark = status.state === "connected" ? "+" : status.state === "disabled" ? "-" : "!";
    lines.push(`  ${mark} ${status.name.padEnd(width)}  ${status.kind}  ${status.target || "(no target)"}`);
    if (status.state === "connected") {
      lines.push(`      tools: ${status.tools.join(", ") || "(none)"}`);
    }
    if (status.error) lines.push(`      error: ${status.error}`);
    for (const warning of status.warnings) lines.push(`      warning: ${warning}`);
  }
  lines.push("", "Connected tools appear in your normal tool list as mcp_<server>_<tool>.");
  return lines.join("\n");
}

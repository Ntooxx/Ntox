import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadCachedModels, loadConfig } from "../core/config.js";
import { redactError } from "../core/redact.js";
import { stripAnsi } from "../cli/theme.js";
import {
  createSharedInfra,
  createSessionInfra,
  createAgentConfig,
  SessionManager,
  type SharedInfra,
} from "../core/dispatcher.js";
import { runAgentStream } from "../core/message-handler.js";
import { handleChannelCommand, UNIFIED_COMMANDS, type ChannelCommandContext } from "../core/channel-commands.js";
import type { Agent } from "../core/agent.js";
import type { NtoxConfig } from "../types/index.js";
import { createDesktopApi } from "./desktop.js";
import { recordUsage } from "./spend.js";
import { approvalBridge, APPROVAL_DECISIONS } from "./approvals.js";
import type { ApprovalDecision } from "../tools/approval.js";
import { getCron } from "../cron/index.js";
import { createGpuWatchdog, type GpuWatchdog } from "../alive/gpu.js";

export interface ApiServerOptions {
  port?: number;
  host?: string;
  authToken?: string;
  agentFactory?: (sessionId: string) => Agent;
  commandContext?: (sessionId: string) => ChannelCommandContext | null;
}

export interface RunningApiServer {
  port: number;
  host: string;
  stop(): Promise<void>;
}

const MAX_BODY_BYTES = 1_000_000;

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...corsHeaders(),
  });
  res.end(payload);
}

function sse(res: ServerResponse, event: string, data: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function authorized(req: IncomingMessage, authToken: string): boolean {
  if (!authToken) return true;
  const header = req.headers.authorization || "";
  return header === `Bearer ${authToken}`;
}

const COMMAND_HELP: Record<string, string> = {
  cost: "lifetime token spend and cost",
  status: "runtime status",
  digest: "plan, host events and costs",
  memory: "search and inspect memory",
  remember: "store a fact",
  forget: "delete a memory record",
  model: "show or switch the model",
  skills: "installed skills",
  tools: "registered tools",
  plan: "current plan",
  undo: "undo the last exchange",
  mail: "read and send mail",
};

function helpText(): string {
  const lines = ["NTOX commands:"];
  for (const name of UNIFIED_COMMANDS) lines.push(`  /${name} — ${COMMAND_HELP[name] ?? ""}`);
  lines.push("  /new — start a fresh conversation", "  /reset — forget this conversation", "  /help — this list");
  return lines.join("\n");
}

interface ApiRuntime {
  config: NtoxConfig;
  shared: SharedInfra;
  watchdog: GpuWatchdog | null;
  agent(sessionId: string): Agent;
  commandContext(sessionId: string): ChannelCommandContext;
}

function createDefaultRuntime(): ApiRuntime {
  const config = loadConfig();
  const shared: SharedInfra = createSharedInfra(config);
  const sessionInfras = new Map<string, ReturnType<typeof createSessionInfra>>();
  const sessions = new SessionManager();

  const infraFor = (sessionId: string): ReturnType<typeof createSessionInfra> => {
    if (!sessionInfras.has(sessionId)) sessionInfras.set(sessionId, createSessionInfra(shared, config));
    return sessionInfras.get(sessionId)!;
  };

  const cron = getCron();
  cron.setChannelFilter((channel) => !channel);
  cron.setExecutor(async (prompt, job) => {
    const id = `cron_${job.id}`;
    const agent = sessions.getOrCreate(id, createAgentConfig({ ...shared, ...infraFor(id) }, config, `api_${id}`));
    let output = "";
    try {
      await runAgentStream(agent, prompt, { onToken: (token) => { output += token; } }, AbortSignal.timeout(120_000));
    } catch (error) {
      const reason = `Scheduled "${job.name}" failed: ${redactError(error)}`;
      shared.alive.notify(reason);
      return reason;
    }
    const summary = output.trim() || "(scheduled run produced no output)";
    shared.alive.notify(`Scheduled "${job.name}": ${summary.slice(0, 500)}`);
    return summary;
  });
  cron.start();
  const watchdog = createGpuWatchdog(shared.alive);
  watchdog?.start();

  return {
    config,
    shared,
    watchdog,
    agent: (sessionId: string): Agent =>
      sessions.getOrCreate(sessionId, createAgentConfig({ ...shared, ...infraFor(sessionId) }, config, `api_${sessionId}`)),
    commandContext: (sessionId: string): ChannelCommandContext => ({
      config,
      llm: shared.llm,
      tools: shared.tools,
      skills: shared.skillRegistry,
      memory: infraFor(sessionId).memory,
      policy: shared.policy,
      agent: sessions.getOrCreate(sessionId, createAgentConfig({ ...shared, ...infraFor(sessionId) }, config, `api_${sessionId}`)),
      models: loadCachedModels() ?? [],
      sessionId,
      alive: shared.alive,
    }),
  };
}

export function createApiServer(options: ApiServerOptions = {}): {
  start(): Promise<RunningApiServer>;
} {
  const host = options.host ?? "127.0.0.1";
  const authToken = options.authToken ?? "";
  const configuredPort = options.port ?? 3100;
  let server: ReturnType<typeof createServer> | null = null;
  let runtime: ApiRuntime | null = null;
  const sessions = new SessionManager();
  let desktopApi: ReturnType<typeof createDesktopApi> | null = null;

  const getRuntime = (): ApiRuntime => (runtime ??= createDefaultRuntime());

  const getFactory = (): ((sessionId: string) => Agent) =>
    options.agentFactory ?? ((sessionId) => getRuntime().agent(sessionId));

  const commandContextFor = (sessionId: string): ChannelCommandContext | null => {
    if (options.commandContext) return options.commandContext(sessionId);
    if (options.agentFactory) return null;
    try {
      return getRuntime().commandContext(sessionId);
    } catch (error) {
      console.error(`[api] command context unavailable: ${redactError(error)}`);
      return null;
    }
  };

  const runSlashCommand = async (message: string, sessionId: string): Promise<string | null> => {
    const text = message.trim();
    if (!text.startsWith("/")) return null;
    const head = text.split(/\s+/)[0].toLowerCase();
    if (head === "/help") return helpText();
    if (head === "/new" || head === "/reset") {
      getFactory()(sessionId).resetConversation();
      return "Fresh start. Go ahead.";
    }
    const ctx = commandContextFor(sessionId);
    if (!ctx) return null;
    try {
      const outcome = await handleChannelCommand(text, ctx);
      return outcome ? stripAnsi(outcome.text) : null;
    } catch (error) {
      console.error(`[api] slash command failed: ${redactError(error)}`);
      return null;
    }
  };

  const handleHealth = (res: ServerResponse): void => {
    let model = "unknown";
    let provider = "unknown";
    try {
      const config = loadConfig();
      model = config.model;
      provider = config.provider;
    } catch {
      /* defaults */
    }
    json(res, 200, { ok: true, model, provider });
  };

  const handleChat = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let payload: { message?: unknown; sessionId?: unknown };
    try {
      payload = JSON.parse(await readBody(req)) as typeof payload;
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return;
    }
    const message = typeof payload.message === "string" ? payload.message.trim() : "";
    const sessionId =
      typeof payload.sessionId === "string" && payload.sessionId.trim()
        ? payload.sessionId.trim().slice(0, 128)
        : "default";
    if (!message) {
      json(res, 400, { error: "message is required" });
      return;
    }

    const factory = getFactory();
    if (sessions.isLocked(sessionId)) {
      json(res, 409, { error: "Session is busy", sessionId });
      return;
    }
    sessions.lock(sessionId);

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...corsHeaders(),
    });

    const unsubscribeApprovals = approvalBridge.subscribe((payload) => sse(res, "approval", payload));
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    let fullResponse = "";
    try {
      const slashCommand = await runSlashCommand(message, sessionId);
      if (slashCommand !== null) {
        sse(res, "event", { type: "command", command: message.split(/\s+/)[0] });
        sse(res, "token", { text: slashCommand });
        sse(res, "done", { response: slashCommand, sessionId, command: true });
        return;
      }

      const agent = factory(sessionId);
      const spendSource = options.agentFactory
        ? { model: loadConfig().model }
        : { model: getRuntime().config.model, fetchModels: () => getRuntime().shared.llm.fetchModels() };
      const result = await runAgentStream(
        agent,
        message,
        {
          onToken: (token) => {
            fullResponse += token;
            sse(res, "token", { text: token });
          },
          onToolCall: (name, args) => sse(res, "event", { type: "tool_call", name, args }),
          onToolResult: (name, toolResult) =>
            sse(res, "event", { type: "tool_result", name, success: toolResult.success, error: toolResult.error }),
          onPhase: (phase) => sse(res, "event", { type: "phase", phase }),
          onMemoryRecall: (count) => sse(res, "event", { type: "memory", action: "recalled", count }),
          onMemoryStore: () => sse(res, "event", { type: "memory", action: "stored", count: 1 }),
          onStrategy: (strategy) => sse(res, "event", { type: "strategy", strategy }),
          onUsage: (usage) => {
            recordUsage(usage, spendSource);
            sse(res, "event", {
              type: "usage",
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cost: usage.cost,
            });
          },
        },
        controller.signal,
      );

      if (result.error) {
        const message = redactError(result.error.message);
        console.error(`[api] chat stream failed (${sessionId}): ${message}`);
        sse(res, "error", { error: message, sessionId });
      } else {
        sse(res, "done", {
          response: fullResponse,
          sessionId,
          cancelled: result.cancelled,
          timedOut: result.timedOut,
          inputTokens: result.totalInputTokens,
          outputTokens: result.totalOutputTokens,
        });
      }
    } catch (e) {
      const msg = redactError(e);
      console.error(`[api] chat request failed (${sessionId}): ${msg}`);
      sse(res, "error", { error: msg, sessionId });
    } finally {
      unsubscribeApprovals();
      sessions.unlock(sessionId);
      if (!res.destroyed && !res.writableEnded) res.end();
    }
  };

  const handleReset = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let payload: { sessionId?: unknown } = { sessionId: "default" };
    try {
      const body = await readBody(req);
      if (body) payload = JSON.parse(body) as typeof payload;
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return;
    }
    const sessionId =
      typeof payload.sessionId === "string" && payload.sessionId.trim()
        ? payload.sessionId.trim().slice(0, 128)
        : "default";
    getFactory()(sessionId).resetConversation();
    json(res, 200, { ok: true, sessionId });
  };

  return {
    async start(): Promise<RunningApiServer> {
      approvalBridge.install();
      server = createServer((req, res) => {
        const path = (req.url || "/").split("?")[0];

        if (req.method === "OPTIONS") {
          res.writeHead(204, corsHeaders());
          res.end();
          return;
        }

        if (path === "/api/health" && req.method === "GET") {
          handleHealth(res);
          return;
        }

        if (!authorized(req, authToken)) {
          json(res, 401, { error: "Unauthorized — send Authorization: Bearer <token>" });
          return;
        }

        if (path === "/api/chat" && req.method === "POST") {
          void handleChat(req, res);
          return;
        }

        if (path === "/api/session/reset" && req.method === "POST") {
          void handleReset(req, res);
          return;
        }

        if (path === "/api/approvals" && req.method === "GET") {
          json(res, 200, { approvals: approvalBridge.list() });
          return;
        }

        if (path === "/api/approvals" && req.method === "POST") {
          void (async () => {
            let payload: { id?: unknown; decision?: unknown } = {};
            try {
              payload = JSON.parse(await readBody(req)) as typeof payload;
            } catch {
              json(res, 400, { error: "Invalid JSON body" });
              return;
            }
            const id = typeof payload.id === "string" ? payload.id : "";
            const decision = typeof payload.decision === "string" ? payload.decision : "";
            if (!id || !APPROVAL_DECISIONS.includes(decision as ApprovalDecision)) {
              json(res, 400, { error: "A pending approval id and a valid decision are required." });
              return;
            }
            if (!approvalBridge.resolve(id, decision as ApprovalDecision)) {
              json(res, 404, { error: "That approval request has already expired." });
              return;
            }
            json(res, 200, { resolved: true, id });
          })();
          return;
        }

        if (
          path.startsWith("/api/desktop") ||
          path.startsWith("/api/agents") ||
          path.startsWith("/api/tasks") ||
          path.startsWith("/api/memory") ||
          path.startsWith("/api/tools") ||
          path.startsWith("/api/evaluations") ||
          path.startsWith("/api/settings")
        ) {
          desktopApi ??= createDesktopApi({
            onReload: () => {
              runtime?.watchdog?.stop();
              runtime = null;
            },
            onBootstrap: () => {
              try {
                getRuntime();
              } catch (error) {
                console.error(`[api] runtime warm-up failed: ${redactError(error)}`);
              }
            },
          });
          void desktopApi(req, res, path, req.method || "GET");
          return;
        }

        json(res, 404, {
          error: "Not found",
          endpoints: [
            "/api/health",
            "/api/chat",
            "/api/session/reset",
            "/api/desktop/bootstrap",
            "/api/agents",
            "/api/tasks",
            "/api/memory",
            "/api/memory/graph",
            "/api/tools",
            "/api/evaluations",
            "/api/settings",
          ],
        });
      });

      const port = await new Promise<number>((resolve, reject) => {
        server!.on("error", reject);
        server!.listen(configuredPort, host, () => {
          const address = server!.address();
          resolve(typeof address === "object" && address ? address.port : configuredPort);
        });
      });

      return {
        port,
        host,
        stop: () =>
          new Promise<void>((resolve) => {
            if (!server) {
              resolve();
              return;
            }
            server.close(() => resolve());
            server = null;
          }),
      };
    },
  };
}

export async function runApi(): Promise<void> {
  const config = loadConfig();
  const authToken = process.env.NTOX_API_AUTH_TOKEN || config.apiAuthToken;
  const api = createApiServer({
    port: config.apiPort,
    host: "127.0.0.1",
    authToken,
  });
  const running = await api.start();
  const authNote = authToken ? "bearer auth enabled" : "no auth (local only)";
  console.log(`[api] http://${running.host}:${running.port}/api/chat (${authNote})`);
  console.log("[api] endpoints: POST /api/chat, POST /api/session/reset, GET /api/health");
  console.log(
    "[api] desktop endpoints: /api/desktop/bootstrap, /api/agents, /api/tasks, /api/memory, /api/tools, /api/evaluations, /api/settings",
  );
  console.log("[api] Ctrl+C to stop.");

  process.on("SIGINT", async () => {
    await running.stop();
    process.exit(0);
  });
}

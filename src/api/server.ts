import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "../core/config.js";
import {
  createSharedInfra,
  createSessionInfra,
  createAgentConfig,
  SessionManager,
  type SharedInfra,
} from "../core/dispatcher.js";
import { runAgentStream } from "../core/message-handler.js";
import type { Agent } from "../core/agent.js";

export interface ApiServerOptions {
  port?: number;
  host?: string;
  authToken?: string;
  agentFactory?: (sessionId: string) => Agent;
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function createDefaultAgentFactory(): (sessionId: string) => Agent {
  const config = loadConfig();
  const shared: SharedInfra = createSharedInfra(config);
  const sessionInfras = new Map<string, ReturnType<typeof createSessionInfra>>();
  const sessions = new SessionManager();

  return (sessionId: string): Agent => {
    if (!sessionInfras.has(sessionId)) {
      sessionInfras.set(sessionId, createSessionInfra(shared, config));
    }
    const infra = sessionInfras.get(sessionId)!;
    return sessions.getOrCreate(sessionId, createAgentConfig({ ...shared, ...infra }, config, `api_${sessionId}`));
  };
}

export function createApiServer(options: ApiServerOptions = {}): {
  start(): Promise<RunningApiServer>;
} {
  const host = options.host ?? "127.0.0.1";
  const authToken = options.authToken ?? "";
  const configuredPort = options.port ?? 3100;
  let server: ReturnType<typeof createServer> | null = null;
  let agentFactory = options.agentFactory;
  const sessions = new SessionManager();

  const getFactory = (): ((sessionId: string) => Agent) => {
    if (!agentFactory) {
      agentFactory = createDefaultAgentFactory();
    }
    return agentFactory;
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

    let fullResponse = "";
    try {
      const agent = factory(sessionId);
      const result = await runAgentStream(agent, message, {
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
        onUsage: (usage) =>
          sse(res, "event", {
            type: "usage",
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cost: usage.cost,
          }),
      });

      if (result.error) {
        sse(res, "error", { error: result.error.message, sessionId });
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
      const msg = e instanceof Error ? e.message : String(e);
      sse(res, "error", { error: msg, sessionId });
    } finally {
      sessions.unlock(sessionId);
      res.end();
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

        json(res, 404, { error: "Not found", endpoints: ["/api/health", "/api/chat", "/api/session/reset"] });
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
  const api = createApiServer({
    port: config.apiPort,
    host: "127.0.0.1",
    authToken: config.apiAuthToken,
  });
  const running = await api.start();
  const authNote = config.apiAuthToken ? "bearer auth enabled" : "no auth (local only)";
  console.log(`[api] http://${running.host}:${running.port}/api/chat (${authNote})`);
  console.log("[api] endpoints: POST /api/chat, POST /api/session/reset, GET /api/health");
  console.log("[api] Ctrl+C to stop.");

  process.on("SIGINT", async () => {
    await running.stop();
    process.exit(0);
  });
}

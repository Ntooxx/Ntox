import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { GatewayChannel } from "./types.js";
import type { ConversationStore } from "./conversations.js";
import { isValidConversationId } from "./conversations.js";
import type { WebInspectServices, ApprovalScope } from "./inspect.js";
import { extractApprovalCommand, isApprovalRequired } from "./inspect.js";
import { APPROVAL_SCOPES } from "../tools/approval.js";
import { clampTtsText, voiceAudioError } from "./voice.js";
import type { WebSettingsService } from "./settings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(__dirname, "..", "..", "web");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export interface WebVoiceHandlers {
  transcribe: (audio: string, mimeType: string) => Promise<{ success: boolean; text?: string; error?: string }>;
  synthesize: (text: string) => Promise<{ success: boolean; audio?: string; error?: string }>;
}

export interface WebConfig {
  port?: number;
  host?: string;
  authToken?: string;
  liveReload?: boolean;
  conversations?: ConversationStore;
  inspect?: WebInspectServices;
  settings?: WebSettingsService;
  voice?: WebVoiceHandlers;
  suggestPaths?: (prefix: string) => string[];
  onMessage: (
    chatId: string,
    text: string,
    username: string,
    onToken?: (token: string) => void,
    onEvent?: (event: Record<string, unknown>) => void,
    signal?: AbortSignal,
    mode?: "normal" | "regenerate",
  ) => Promise<string>;
  getStatus?: () => unknown;
}

function serveStatic(req: IncomingMessage, res: ServerResponse): boolean {
  const urlPath = (req.url || "/").split("?")[0];
  if (urlPath === "/" || urlPath === "/index.html") return false;
  if (!urlPath.startsWith("/")) return false;
  const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(WEB_ROOT, safePath);
  if (!filePath.startsWith(WEB_ROOT)) return false;
  const ext = extname(filePath).toLowerCase();
  if (!MIME[ext] || !existsSync(filePath)) return false;
  res.writeHead(200, {
    "Content-Type": MIME[ext],
    "Cache-Control": "no-store, must-revalidate",
  });
  res.end(readFileSync(filePath));
  return true;
}

const LIVE_RELOAD_FILES = ["index.html", "app.js", "app.css", "sw.js"];

function webVersion(): string {
  const parts = LIVE_RELOAD_FILES.map((f) => {
    try {
      const s = statSync(join(WEB_ROOT, f));
      return `${f}:${s.mtimeMs}:${s.size}`;
    } catch {
      return `${f}:0`;
    }
  });
  let h = 0;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const LIVERELOAD_SNIPPET = `<script>(function(){var v=null;function c(){fetch('/__livereload').then(function(r){return r.json()}).then(function(d){if(v===null){v=d.v;return}if(d.v!==v)location.reload()}).catch(function(){})}setInterval(c,1200);c()})();</script>`;

export function createWebChannel(config: WebConfig): GatewayChannel {
  const { onMessage, getStatus, conversations, inspect, settings, suggestPaths, voice } = config;
  const port = config.port ?? 3000;
  const host = config.host ?? "127.0.0.1";
  const authToken = config.authToken ?? "";
  let server: ReturnType<typeof createServer> | null = null;
  let io: import("socket.io").Server | null = null;

  const htmlPath = join(WEB_ROOT, "index.html");
  const readHtml = (): string => {
    try {
      return readFileSync(htmlPath, "utf-8");
    } catch {
      return `<!DOCTYPE html><html><body>Web UI not found — create web/index.html</body></html>`;
    }
  };

  const WEB_USER = "web_user";

  const unauthorized = (res: ServerResponse) => {
    res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Unauthorized — open the web UI with ?token=..." }));
  };

  const tokenFromRequest = (req: IncomingMessage): string | null => {
    if (!authToken) return "";
    const header = req.headers.authorization || "";
    if (header.startsWith("Bearer ")) return header.slice(7);
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    return url.searchParams.get("token");
  };

  const authorized = (req: IncomingMessage): boolean => {
    if (!authToken) return true;
    const supplied = tokenFromRequest(req);
    if (!supplied) return false;
    return supplied === authToken;
  };

  const liveReload = config.liveReload ?? /^(127\.0\.0\.1|localhost)$/.test(host);

  return {
    name: "web",

    async start() {
      const http = await import("node:http");
      server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
        if (!authorized(req)) {
          unauthorized(res);
          return;
        }
        if (req.url?.startsWith("/__livereload")) {
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          });
          res.end(JSON.stringify({ v: webVersion() }));
          return;
        }
        if (req.url?.startsWith("/status.json") && getStatus) {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(getStatus(), null, 2));
          return;
        }
        if (serveStatic(req, res)) return;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        const html = readHtml();
        res.end(liveReload && html.includes("</body>") ? html.replace("</body>", LIVERELOAD_SNIPPET + "</body>") : html);
      });

      const { Server } = await import("socket.io");
      io = new Server(server, {
        cors: { origin: [`http://localhost:${port}`, `http://127.0.0.1:${port}`] },
        maxHttpBufferSize: 1e6,
        pingTimeout: 60000,
      });

      if (authToken) {
        io.use((socket: import("socket.io").Socket, next: (err?: Error) => void) => {
          const supplied =
            socket.handshake.auth?.token || socket.handshake.headers.authorization?.replace("Bearer ", "");
          if (typeof supplied === "string" && supplied === authToken) {
            next();
          } else {
            next(new Error("Unauthorized"));
          }
        });
      }

      io.on("connection", (socket: import("socket.io").Socket) => {
        let sessionId: string | null = null;
        let pending = false;
        let abort: AbortController | null = null;

        const emitChats = () => {
          if (conversations) socket.emit("chats", conversations.list());
        };

        socket.on("join", (payload: { sessionId?: string } = {}) => {
          const requested = String(payload?.sessionId || "").trim();
          if (!isValidConversationId(requested)) {
            socket.emit("joined", { error: "invalid session id" });
            return;
          }
          sessionId = requested;
          socket.join(sessionId);
          if (conversations) {
            const conv = conversations.get(sessionId) || conversations.create(sessionId);
            socket.emit("history", { sessionId, title: conv.title, messages: conv.messages });
            emitChats();
          } else {
            socket.emit("history", { sessionId, title: "New chat", messages: [] });
          }
          socket.emit("joined", { sessionId });
        });

        socket.on("list_chats", () => emitChats());

        socket.on("rename_chat", (payload: { sessionId?: string; title?: string }) => {
          if (!conversations) return;
          const id = String(payload?.sessionId || "");
          if (!isValidConversationId(id)) return;
          conversations.rename(id, String(payload?.title || ""));
          emitChats();
        });

        socket.on("delete_chat", (payload: { sessionId?: string }) => {
          if (!conversations) return;
          const id = String(payload?.sessionId || "");
          if (!isValidConversationId(id)) return;
          conversations.delete(id);
          if (sessionId === id) sessionId = null;
          emitChats();
        });

        socket.on("clear_chat", () => {
          if (!sessionId || !conversations) return;
          conversations.clearMessages(sessionId);
          socket.emit("history", { sessionId, title: conversations.get(sessionId)?.title || "New chat", messages: [] });
        });

        socket.on("stop", () => {
          abort?.abort();
        });

        socket.on("get_settings", () => {
          if (!settings) return;
          socket.emit("settings", settings.get());
        });

        socket.on("get_models", () => {
          if (!settings) return;
          socket.emit("models", { models: settings.listModels() });
        });

        socket.on("refresh_models", async () => {
          if (!settings) return;
          try {
            const models = await settings.refreshModels();
            socket.emit("models", { models, refreshed: true });
          } catch (e) {
            socket.emit("models", { models: settings.listModels(), error: e instanceof Error ? e.message : String(e) });
          }
        });

        socket.on("set_model", (payload: { model?: string }) => {
          if (!settings) return;
          const result = settings.setModel(String(payload?.model || ""));
          socket.emit("settings", result.settings);
          socket.emit("model_changed", { ok: result.ok, model: result.settings.model });
        });

        socket.on("set_provider", (payload: { provider?: string }) => {
          if (!settings) return;
          const result = settings.setProvider(String(payload?.provider || ""));
          socket.emit("settings", result.settings);
          socket.emit("model_changed", { ok: result.ok, provider: result.settings.provider });
        });

        socket.on("suggest_paths", (payload: { prefix?: string }) => {
          if (!suggestPaths) return;
          const prefix = String(payload?.prefix || "").slice(0, 200);
          socket.emit("path_suggestions", { prefix, paths: suggestPaths(prefix) });
        });

        socket.on("stt", async (payload: { audio?: string; mimeType?: string }) => {
          if (!voice) {
            socket.emit("stt_result", { error: "Voice input is not configured on this gateway." });
            return;
          }
          const audio = typeof payload?.audio === "string" ? payload.audio : "";
          const mimeType = typeof payload?.mimeType === "string" ? payload.mimeType : "";
          const invalid = voiceAudioError(audio, mimeType);
          if (invalid) {
            socket.emit("stt_result", { error: invalid });
            return;
          }
          try {
            const result = await voice.transcribe(audio, mimeType);
            socket.emit(
              "stt_result",
              result.success && result.text
                ? { text: result.text }
                : { error: result.error || "Transcription failed." },
            );
          } catch (e) {
            socket.emit("stt_result", { error: e instanceof Error ? e.message : String(e) });
          }
        });

        socket.on("tts", async (payload: { text?: string }) => {
          if (!voice) {
            socket.emit("tts_audio", { error: "Voice output is not configured on this gateway." });
            return;
          }
          const text = clampTtsText(String(payload?.text || ""));
          if (!text) {
            socket.emit("tts_audio", { error: "Nothing to speak." });
            return;
          }
          try {
            const result = await voice.synthesize(text);
            socket.emit(
              "tts_audio",
              result.success && result.audio
                ? { audio: result.audio }
                : { error: result.error || "Speech synthesis failed." },
            );
          } catch (e) {
            socket.emit("tts_audio", { error: e instanceof Error ? e.message : String(e) });
          }
        });

        const requireSession = (): string | null => {
          if (!sessionId) {
            socket.emit("inspect_error", { error: "No active session" });
            return null;
          }
          return sessionId;
        };

        socket.on("get_trace", () => {
          if (!inspect) return;
          const sid = requireSession();
          if (!sid) return;
          socket.emit("trace", { trace: inspect.getTrace(sid), why: inspect.getWhy(sid) });
        });

        socket.on("get_changes", () => {
          if (!inspect) return;
          const sid = requireSession();
          if (!sid) return;
          socket.emit("changes", { changes: inspect.getChanges(sid) });
        });

        socket.on("get_memory", () => {
          if (!inspect) return;
          const sid = requireSession();
          if (!sid) return;
          socket.emit("memory", inspect.getMemory(sid));
        });

        socket.on("update_memory", (payload: { id?: string; text?: string }) => {
          if (!inspect) return;
          const sid = requireSession();
          if (!sid) return;
          const id = String(payload?.id || "");
          const text = String(payload?.text || "").trim();
          if (!id || !text) return;
          inspect.updateMemory(sid, id, text);
          socket.emit("memory", inspect.getMemory(sid));
        });

        socket.on("delete_memory", (payload: { id?: string }) => {
          if (!inspect) return;
          const sid = requireSession();
          if (!sid) return;
          const id = String(payload?.id || "");
          if (!id) return;
          inspect.deleteMemory(sid, id);
          socket.emit("memory", inspect.getMemory(sid));
        });

        socket.on("get_beliefs", () => {
          if (!inspect) return;
          const sid = requireSession();
          if (!sid) return;
          socket.emit("beliefs", inspect.getBeliefs(sid));
        });

        socket.on("vote_theory", (payload: { id?: string; vote?: string }) => {
          if (!inspect) return;
          const id = String(payload?.id || "");
          const vote = payload?.vote === "confirm" ? "confirm" : "reject";
          if (!id) return;
          inspect.voteTheory(id, vote);
          const sid = requireSession();
          if (sid) socket.emit("beliefs", inspect.getBeliefs(sid));
        });

        socket.on("approve", (payload: { command?: string; scope?: string }) => {
          if (!inspect) return;
          const command = String(payload?.command || "");
          const scope = APPROVAL_SCOPES.includes(payload?.scope as ApprovalScope)
            ? (payload?.scope as ApprovalScope)
            : "once";
          const ok = inspect.approveCommand(command, scope);
          socket.emit("approved", { ok, command, scope });
        });

        socket.on("rollback", async (payload: { checkpointId?: string }) => {
          if (!inspect) return;
          const checkpointId = String(payload?.checkpointId || "");
          const result = await inspect.rollback(checkpointId);
          socket.emit("rolled_back", { ...result, checkpointId });
        });

        const runTurn = async (text: string, mode: "normal" | "regenerate" = "normal") => {
          if (!sessionId || pending) return;
          pending = true;
          abort = new AbortController();
          socket.emit("event", { type: "phase", phase: "queued" });

          try {
            const streamedTokens: string[] = [];
            const onToken = (token: string) => {
              streamedTokens.push(token);
              socket.emit("token", { text: token, done: false });
            };
            const onEvent = (event: Record<string, unknown>) => {
              if (event.type === "tool_result" && !event.success && isApprovalRequired(event.error as string)) {
                const command = extractApprovalCommand(String(event.error || ""));
                if (command) socket.emit("approval_required", { command });
              }
              socket.emit("event", event);
            };
            const response = await onMessage(sessionId, text, WEB_USER, onToken, onEvent, abort.signal, mode);
            if (streamedTokens.length === 0 && response) {
              socket.emit("token", { text: response, done: false });
            }
            const cancelled = abort.signal.aborted;
            socket.emit("token", { text: "", done: true, full: response, cancelled });
            if (conversations && !cancelled && !text.startsWith("/")) {
              if (response && !response.startsWith("Error:")) {
                conversations.appendMessage(sessionId, { role: "user", content: text });
                conversations.appendMessage(sessionId, { role: "assistant", content: response });
              }
              emitChats();
            }
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            socket.emit("error", { text: errMsg });
          } finally {
            pending = false;
            abort = null;
          }
        };

        socket.on("message", async (text: string) => {
          if (!text?.trim()) return;
          if (!sessionId) {
            sessionId = `conv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
            if (conversations) conversations.create(sessionId);
            socket.emit("joined", { sessionId });
          }
          await runTurn(text);
        });

        socket.on("regenerate", async (payload?: { text?: string }) => {
          if (!sessionId || !conversations || pending) return;
          const conv = conversations.get(sessionId);
          if (!conv) return;
          const override = typeof payload?.text === "string" ? payload.text.trim() : "";
          let targetText = override;
          if (!targetText) {
            const lastUser = [...conv.messages].reverse().find((m) => m.role === "user");
            if (!lastUser) return;
            targetText = lastUser.content;
          }
          conversations.popLastExchange(sessionId);
          const after = conversations.get(sessionId);
          socket.emit("history", {
            sessionId,
            title: after?.title || conv.title,
            messages: after?.messages || [],
          });
          await runTurn(targetText, "regenerate");
        });
      });

      await new Promise<void>((resolve) => {
        server!.listen(port, host, resolve);
      });
      console.log(`[web] http://${host}:${port}`);
    },

    async stop() {
      if (io) {
        io.close();
        io = null;
      }
      if (server) {
        await new Promise<void>((r) => server!.close(() => r()));
        server = null;
      }
      console.log("[web] stopped");
    },

    notifyTyping: async () => {},
  };
}

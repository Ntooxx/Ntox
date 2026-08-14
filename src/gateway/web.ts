import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { GatewayChannel } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface WebConfig {
  port?: number;
  host?: string;
  onMessage: (
    chatId: string,
    text: string,
    username: string,
    onToken?: (token: string) => void,
    onEvent?: (event: Record<string, unknown>) => void,
  ) => Promise<string>;
  getStatus?: () => unknown;
}

export function createWebChannel(config: WebConfig): GatewayChannel {
  const { onMessage, getStatus } = config;
  const port = config.port ?? 3000;
  const host = config.host ?? "127.0.0.1";
  let server: ReturnType<typeof createServer> | null = null;
  let io: import("socket.io").Server | null = null;

  const htmlPath = join(__dirname, "..", "..", "web", "index.html");
  let htmlContent = "";
  try { htmlContent = readFileSync(htmlPath, "utf-8"); } catch {
    htmlContent = `<!DOCTYPE html><html><body>Web UI not found — create web/index.html</body></html>`;
  }

  const WEB_USER = "web_user";

  return {
    name: "web",

    async start() {
      const http = await import("node:http");
      server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
        if (req.url === "/status.json" && getStatus) {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(getStatus(), null, 2));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(htmlContent);
      });

      const { Server } = await import("socket.io");
      io = new Server(server, {
        cors: { origin: [`http://localhost:${port}`, `http://127.0.0.1:${port}`] },
        maxHttpBufferSize: 1e6,
        pingTimeout: 60000,
      });

      io.on("connection", (socket: import("socket.io").Socket) => {
        const sid = `web_${socket.id}`;
        let pending = false;

        socket.on("message", async (text: string) => {
          if (!text?.trim() || pending) return;
          pending = true;
          socket.emit("event", { type: "phase", phase: "queued" });

          try {
            const streamedTokens: string[] = [];
            const onToken = (token: string) => {
              streamedTokens.push(token);
              socket.emit("token", { text: token, done: false });
            };
            const onEvent = (event: Record<string, unknown>) => {
              socket.emit("event", event);
            };
            const response = await onMessage(sid, text, WEB_USER, onToken, onEvent);
            if (streamedTokens.length === 0) {
              socket.emit("token", { text: response, done: false });
            }
            socket.emit("token", { text: "", done: true, full: response });
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            socket.emit("error", { text: errMsg });
          } finally {
            pending = false;
          }
        });
      });

      await new Promise<void>((resolve) => {
        server!.listen(port, host, resolve);
      });
      console.log(`[web] http://${host}:${port}`);
    },

    async stop() {
      if (io) { io.close(); io = null; }
      if (server) { await new Promise<void>((r) => server!.close(() => r())); server = null; }
      console.log("[web] stopped");
    },

    notifyTyping: async () => {},
  };
}

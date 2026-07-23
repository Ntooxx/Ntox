import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { GatewayChannel } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface WebConfig {
  port?: number;
  onMessage: (chatId: string, text: string, username: string) => Promise<string>;
}

export function createWebChannel(config: WebConfig): GatewayChannel {
  const { onMessage } = config;
  const port = config.port ?? 3000;
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
      server = http.createServer((_req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(htmlContent);
      });

      const { Server } = await import("socket.io");
      io = new Server(server, {
        cors: { origin: "http://localhost:3000" },
        maxHttpBufferSize: 1e6,
        pingTimeout: 60000,
      });

      io.on("connection", (socket: import("socket.io").Socket) => {
        const sid = `web_${socket.id}`;
        let pending = false;

        socket.on("message", async (text: string) => {
          if (!text?.trim() || pending) return;
          pending = true;

          try {
            const response = await onMessage(sid, text, WEB_USER);
            const words = response.split(/(\s+)/);
            for (const word of words) {
              if (word) {
                socket.emit("token", { text: word, done: false });
                await new Promise((r) => setTimeout(r, 5));
              }
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
        server!.listen(port, resolve);
      });
      console.log(`[web] http://localhost:${port}`);
    },

    async stop() {
      if (io) { io.close(); io = null; }
      if (server) { await new Promise<void>((r) => server!.close(() => r())); server = null; }
      console.log("[web] stopped");
    },

    notifyTyping: async () => {},
  };
}

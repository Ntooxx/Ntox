const { app, BrowserWindow, ipcMain, protocol } = require("electron");
const { spawn } = require("node:child_process");
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

protocol.registerSchemesAsPrivileged([{ scheme: "ntox", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const repoRoot = path.resolve(__dirname, "..");
const configPath = path.join(process.env.NTOX_DIR || path.join(os.homedir(), ".ntox"), "config.json");
let config = {};
let apiProcess = null;
let apiPort = 3100;
let mainWindow = null;
const chatStorePath = () => path.join(app.getPath("userData"), "desktop-conversations.json");
const activeRequests = new Map();

try {
  if (existsSync(configPath)) config = JSON.parse(readFileSync(configPath, "utf8"));
} catch {
  config = {};
}

apiPort = Number.isInteger(config.apiPort) ? config.apiPort : 3100;
const apiUrl = `http://127.0.0.1:${apiPort}`;

async function apiIsReady() {
  try {
    const response = await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureApi() {
  if (await apiIsReady()) return;
  apiProcess = spawn(process.env.NTOX_NODE_BIN || "node", ["dist/index.js", "api"], {
    cwd: repoRoot,
    env: process.env,
    stdio: "ignore",
    windowsHide: true,
  });
  apiProcess.on("error", () => {});
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (apiProcess.exitCode !== null) throw new Error("NTOX API stopped before it became ready. Build NTOX and check the local runtime configuration.");
    if (await apiIsReady()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`NTOX API did not become ready on port ${apiPort}.`);
}

function validSender(event) {
  return mainWindow && event.sender === mainWindow.webContents && event.senderFrame?.url === "ntox://app/index.html";
}

async function sendMessage(event, payload) {
  if (!validSender(event)) throw new Error("Untrusted desktop renderer.");
  const message = typeof payload?.message === "string" ? payload.message.trim() : "";
  const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId.slice(0, 120) : "";
  if (!message || message.length > 50000 || !/^desktop_[a-zA-Z0-9-]+$/.test(sessionId)) {
    throw new Error("Message or desktop session is invalid.");
  }
  await ensureApi();
  const headers = { "Content-Type": "application/json" };
  if (config.apiAuthToken) headers.Authorization = `Bearer ${config.apiAuthToken}`;
  const controller = new AbortController();
  const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(requestId)) throw new Error("Invalid request id.");
  activeRequests.set(requestId, controller);
  const response = await fetch(`${apiUrl}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message, sessionId }),
    signal: controller.signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `NTOX API returned ${response.status}.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const eventName = block.match(/^event:\s*(.+)$/m)?.[1];
      const dataLine = block.match(/^data:\s*(.+)$/m)?.[1];
      if (!dataLine) continue;
      const data = JSON.parse(dataLine);
      if (mainWindow && eventName) mainWindow.webContents.send("ntox:chat-event", { requestId, event: eventName, data });
      if (eventName === "error") throw new Error(data.error || "NTOX could not complete the request.");
      if (eventName === "done") result = data.response || result;
    }
    if (done) break;
  }
  activeRequests.delete(requestId);
  return result || "NTOX returned an empty response.";
}

ipcMain.handle("ntox:send-message", sendMessage);
ipcMain.handle("ntox:cancel-message", (event, requestId) => {
  if (!validSender(event)) throw new Error("Untrusted desktop renderer.");
  activeRequests.get(String(requestId))?.abort();
  activeRequests.delete(String(requestId));
  return true;
});
ipcMain.handle("ntox:desktop-request", async (event, input) => {
  if (!validSender(event)) throw new Error("Untrusted desktop renderer.");
  const route = typeof input?.route === "string" ? input.route : "";
  const method = typeof input?.method === "string" ? input.method : "GET";
  const allowed = /^\/api\/(desktop\/bootstrap|agents|tasks(?:\/[^/]+(?:\/(?:cancel|retry))?)?|memory(?:\/graph|\/[^/]+)?|tools|evaluations|settings)$/;
  const routePath = route.split("?")[0];
  if (!allowed.test(routePath) || !["GET", "POST", "PATCH", "DELETE"].includes(method)) throw new Error("Desktop API request is not allowed.");
  await ensureApi();
  const headers = { "Content-Type": "application/json" };
  if (config.apiAuthToken) headers.Authorization = `Bearer ${config.apiAuthToken}`;
  const response = await fetch(`${apiUrl}${route}`, { method, headers, ...(input.body ? { body: JSON.stringify(input.body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `NTOX API returned ${response.status}.`);
  return data;
});
ipcMain.handle("ntox:load-conversations", event => {
  if (!validSender(event)) throw new Error("Untrusted desktop renderer.");
  try { return JSON.parse(readFileSync(chatStorePath(), "utf8")); } catch { return []; }
});
ipcMain.handle("ntox:save-conversations", (event, conversations) => {
  if (!validSender(event) || !Array.isArray(conversations)) throw new Error("Invalid desktop conversation data.");
  const safe = conversations.slice(0, 80).map(item => ({ id: String(item.id || "").slice(0, 80), title: String(item.title || "New conversation").slice(0, 300), updatedAt: Number(item.updatedAt) || Date.now(), messages: Array.isArray(item.messages) ? item.messages.slice(-200).map(message => ({ role: message.role === "user" ? "user" : "assistant", content: String(message.content || "").slice(0, 100000) })) : [] }));
  mkdirSync(path.dirname(chatStorePath()), { recursive: true });
  writeFileSync(chatStorePath(), JSON.stringify(safe), "utf8");
  return true;
});
ipcMain.handle("ntox:runtime-status", async event => {
  if (!validSender(event)) throw new Error("Untrusted desktop renderer.");
  return { connected: await apiIsReady(), port: apiPort };
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: "#070808",
    title: "NTOX Desktop",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", event => event.preventDefault());
  mainWindow.loadURL("ntox://app/index.html");
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(() => {
  const assets = new Map([
    ["/index.html", "text/html; charset=utf-8"],
    ["/dashboard.js", "text/javascript; charset=utf-8"],
    ["/dashboard.css", "text/css; charset=utf-8"],
    ["/runtime.css", "text/css; charset=utf-8"],
    ["/chat.js", "text/javascript; charset=utf-8"],
    ["/chat.css", "text/css; charset=utf-8"],
  ]);
  protocol.handle("ntox", request => {
    const url = new URL(request.url);
    const contentType = assets.get(url.pathname);
    if (url.hostname !== "app" || !contentType) return new Response("Not found", { status: 404 });
    return new Response(readFileSync(path.join(__dirname, url.pathname.slice(1))), { headers: { "Content-Type": contentType } });
  });
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("before-quit", () => {
  if (apiProcess && apiProcess.exitCode === null) apiProcess.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

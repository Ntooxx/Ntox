const { app, BrowserWindow, ipcMain, protocol, safeStorage } = require("electron");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, createWriteStream, statSync, appendFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveRuntimeAccess } = require("./runtime-auth.cjs");

app.commandLine.appendSwitch("disk-cache-dir", path.join(app.getPath("userData"), "runtime-cache-v1"));
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");

protocol.registerSchemesAsPrivileged([{ scheme: "ntox", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

if (process.env.NTOX_DESKTOP_ENABLE_GPU === "0") {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu-compositing");
}

const repoRoot = path.resolve(__dirname, "..");
const APP_URL = "ntox://app/index.html";
const dataDir = process.env.NTOX_DIR || path.join(os.homedir(), ".ntox");
const configPath = path.join(dataDir, "config.json");
const credentialsPath = path.join(dataDir, "credentials.json");
const encryptedCredentialsPath = path.join(dataDir, "credentials.enc.json");
const LOCAL_PROVIDERS = ["ollama", "lmstudio"];
let config = {};
let apiProcess = null;
let apiPort = 3100;
let mainWindow = null;
let ownedToken = null;
let ownsApi = false;
let providerCache = null;
const chatStorePath = () => path.join(app.getPath("userData"), "desktop-conversations.json");
const activeRequests = new Map();

process.on("uncaughtException", error => console.error("[desktop] uncaught exception:", redactText(String(error))));
process.on("unhandledRejection", error => console.error("[desktop] unhandled rejection:", redactText(String(error))));

function redactText(text) {
  let output = String(text);
  for (const secret of knownSecrets()) if (secret) output = output.split(secret).join("[redacted]");
  return output.replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted]").replace(/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g, "[redacted]");
}

function knownSecrets() {
  return [...authCandidates(), ...Object.values(readEncryptedSecrets().providers || {}).map(item => (item && item.apiKey) || "")];
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function loadDesktopConfig() {
  try {
    return existsSync(configPath) ? JSON.parse(stripBom(readFileSync(configPath, "utf8"))) : {};
  } catch {
    return {};
  }
}

config = loadDesktopConfig();

apiPort = Number.isInteger(config.apiPort) ? config.apiPort : 3100;
const apiUrl = `http://127.0.0.1:${apiPort}`;

function encryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function readEncryptedSecrets() {
  if (!encryptionAvailable() || !existsSync(encryptedCredentialsPath)) return { providers: {}, http: {} };
  try {
    const parsed = JSON.parse(readFileSync(encryptedCredentialsPath, "utf8"));
    if (parsed.schemaVersion !== 1 || typeof parsed.blob !== "string") return { providers: {}, http: {}, unreadable: true };
    const decoded = JSON.parse(safeStorage.decryptString(Buffer.from(parsed.blob, "base64")));
    return decoded && typeof decoded === "object" ? decoded : { providers: {}, http: {}, unreadable: true };
  } catch {
    return { providers: {}, http: {}, unreadable: true };
  }
}

function writeEncryptedSecrets(secrets) {
  if (readEncryptedSecrets().unreadable) throw new Error("Saved credentials cannot be decrypted in this desktop profile. Reopen the original profile before changing credentials.");
  mkdirSync(dataDir, { recursive: true });
  const blob = safeStorage.encryptString(JSON.stringify({ schemaVersion: 1, providers: secrets.providers || {}, http: secrets.http || {} })).toString("base64");
  const temp = `${encryptedCredentialsPath}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ schemaVersion: 1, blob }), "utf8");
  renameSync(temp, encryptedCredentialsPath);
}

function readStoredAuthToken() {
  const encrypted = readEncryptedSecrets().http || {};
  if (typeof encrypted.apiAuthToken === "string" && encrypted.apiAuthToken) return encrypted.apiAuthToken;
  const stored = readPlaintextCredentials();
  if (stored && stored.http && typeof stored.http.apiAuthToken === "string") return stored.http.apiAuthToken;
  if (typeof config.apiAuthToken === "string" && config.apiAuthToken) return config.apiAuthToken;
  return "";
}

function readPlaintextCredentials() {
  try {
    const parsed = JSON.parse(stripBom(readFileSync(credentialsPath, "utf8")));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writePlaintextCredentials(data) {
  mkdirSync(dataDir, { recursive: true });
  const temp = `${credentialsPath}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(data, null, 2), "utf8");
  renameSync(temp, credentialsPath);
}

function removePlaintextProvider(provider) {
  const plain = readPlaintextCredentials();
  if (!plain || !plain.providers || !plain.providers[provider]) return;
  delete plain.providers[provider];
  writePlaintextCredentials(plain);
}

function migratePlaintextSecretsToEncryptedStore() {
  if (!encryptionAvailable()) return;
  const plain = readPlaintextCredentials();
  if (!plain) return;
  const encrypted = readEncryptedSecrets();
  encrypted.providers = encrypted.providers || {};
  encrypted.http = encrypted.http || {};
  let moved = false;
  for (const [provider, record] of Object.entries(plain.providers || {})) {
    if (record && record.apiKey && !encrypted.providers[provider]) {
      encrypted.providers[provider] = { apiKey: record.apiKey, baseUrl: record.baseUrl, updatedAt: record.updatedAt || Date.now() };
      delete plain.providers[provider];
      moved = true;
    }
  }
  for (const field of ["apiAuthToken", "webAuthToken"]) {
    const value = plain.http && plain.http[field];
    if (typeof value === "string" && value && !encrypted.http[field]) {
      encrypted.http[field] = value;
      delete plain.http[field];
      moved = true;
    }
  }
  if (!moved) return;
  writeEncryptedSecrets(encrypted);
  writePlaintextCredentials(plain);
  if (typeof config.apiAuthToken === "string" && config.apiAuthToken) {
    const nextConfig = { ...loadDesktopConfig() };
    delete nextConfig.apiAuthToken;
    writeFileSync(configPath, JSON.stringify(nextConfig, null, 2), "utf8");
    config = nextConfig;
  }
}

function currentAuthToken() {
  return ownedToken || readStoredAuthToken();
}

function authCandidates() {
  return [ownedToken, process.env.NTOX_API_AUTH_TOKEN, readPlaintextCredentials()?.http?.apiAuthToken, loadDesktopConfig().apiAuthToken, readStoredAuthToken()];
}

function activeProvider() {
  const model = typeof config.model === "string" ? config.model : "";
  for (const provider of LOCAL_PROVIDERS) if (model.startsWith(`${provider}/`)) return provider;
  if (typeof config.provider === "string" && config.provider) return config.provider;
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(0, slash) : "openrouter";
}

function apiProcessEnv() {
  const env = { ...process.env };
  const provider = activeProvider();
  const stored = readEncryptedSecrets().providers[provider];
  delete env.NTOX_API_KEY;
  delete env.NTOX_API_KEY_PROVIDER;
  if (stored && stored.apiKey) {
    env.NTOX_API_KEY = stored.apiKey;
    env.NTOX_API_KEY_PROVIDER = provider;
  }
  if (ownedToken) env.NTOX_API_AUTH_TOKEN = ownedToken;
  return env;
}

async function apiIsReady() {
  const access = await resolveRuntimeAccess({ baseUrl: apiUrl, tokens: authCandidates() });
  if (access.connected) ownedToken = access.token;
  return access.connected;
}

let apiStartup = null;
let apiLogPath = "";

function resolveApiLogFile() {
  try {
    const dir = path.join(dataDir, "logs");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "api.log");
    if (existsSync(file) && statSync(file).size > 2_000_000) {
      const rotated = path.join(dir, "api.log.old");
      if (existsSync(rotated)) unlinkSync(rotated);
      renameSync(file, rotated);
    }
    apiLogPath = file;
    return file;
  } catch {
    apiLogPath = "";
    return "";
  }
}

function createApiLogStream() {
  const file = resolveApiLogFile();
  return file ? createWriteStream(file, { flags: "a" }) : null;
}

function desktopLog(line) {
  try {
    const file = apiLogPath || resolveApiLogFile();
    if (!file) return;
    appendFileSync(file, `[desktop] ${new Date().toISOString()} ${line}\n`);
  } catch {}
}

async function ensureApi() {
  if (await apiIsReady()) return;
  if (!apiStartup) apiStartup = startApi().finally(() => { apiStartup = null; });
  return apiStartup;
}

async function startApi() {
  if (!ownedToken) ownedToken = authCandidates().find(Boolean) || randomBytes(32).toString("hex");
  if (encryptionAvailable()) {
    const secrets = readEncryptedSecrets();
    secrets.http = { ...secrets.http, apiAuthToken: ownedToken };
    writeEncryptedSecrets(secrets);
  } else {
    const secrets = readPlaintextCredentials() || { schemaVersion: 1, providers: {}, http: {} };
    secrets.http = { ...secrets.http, apiAuthToken: ownedToken };
    writePlaintextCredentials(secrets);
  }
  const logStream = createApiLogStream();
  const secrets = knownSecrets().filter(Boolean);
  const redactChunk = chunk => {
    let output = String(chunk);
    for (const secret of secrets) output = output.split(secret).join("[redacted]");
    return output.replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted]").replace(/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g, "[redacted]");
  };
  const child = spawn(process.env.NTOX_NODE_BIN || "node", ["dist/index.js", "api"], {
    cwd: repoRoot,
    env: apiProcessEnv(),
    stdio: logStream ? ["ignore", "pipe", "pipe"] : "ignore",
    windowsHide: true,
  });
  if (logStream) {
    const write = chunk => { try { logStream.write(redactChunk(chunk)); } catch {} };
    child.stdout?.on("data", write);
    child.stderr?.on("data", write);
    write(`\n[desktop] ${new Date().toISOString()} starting NTOX API on port ${apiPort}\n`);
    child.on("exit", (code, signal) => { write(`[desktop] NTOX API exited (code=${code}, signal=${signal})\n`); try { logStream.end(); } catch {} });
  }
  child.on("error", error => { if (logStream) { try { logStream.write(`[desktop] NTOX API spawn error: ${error}\n`); } catch {} } });
  apiProcess = child;
  ownsApi = true;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      apiProcess = null;
      ownsApi = false;
      if (await apiIsReady()) return;
      throw new Error(`NTOX API stopped before it became ready. Build NTOX and check the local runtime configuration.${apiLogPath ? ` Runtime log: ${apiLogPath}` : ""}`);
    }
    if (await apiIsReady()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`NTOX API did not become ready on port ${apiPort}.${apiLogPath ? ` Runtime log: ${apiLogPath}` : ""}`);
}

async function restartApi() {
  if (apiProcess && apiProcess.exitCode === null) {
    apiProcess.kill();
    apiProcess = null;
  }
  ownsApi = false;
  ownedToken = null;
  apiStartup = null;
  await new Promise(resolve => setTimeout(resolve, 400));
  await ensureApi();
}

function senderFrameUrl(event) {
  try {
    return event.senderFrame && event.senderFrame.url ? event.senderFrame.url : "";
  } catch {
    return "";
  }
}

const rejectedSenders = new Set();

function validSender(event) {
  const sameWindow = Boolean(mainWindow) && event.sender === mainWindow.webContents;
  const url = senderFrameUrl(event);
  const ok = sameWindow && (url === APP_URL || url.startsWith("ntox://app/") || url === "");
  if (!ok) {
    const key = `${sameWindow}|${url}`;
    if (!rejectedSenders.has(key)) {
      rejectedSenders.add(key);
      console.error(`[desktop] rejected IPC: sameWindow=${sameWindow} frameUrl=${url || "(empty)"} windowExists=${Boolean(mainWindow)}`);
    }
  }
  return ok;
}

async function apiFetch(route, method = "GET", body) {
  await ensureApi();
  const headers = { "Content-Type": "application/json" };
  const token = currentAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${apiUrl}${route}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(redactText(data.error || `NTOX API returned ${response.status}.`));
  return data;
}

async function allowedProviders() {
  if (providerCache) return providerCache;
  try {
    const data = await apiFetch("/api/settings/providers");
    providerCache = (data.providers || []).map(item => item.id);
  } catch {
    providerCache = ["openrouter", "openai", "groq", "deepseek", "together", "mistral", "anthropic", "openai-compatible", "ollama", "lmstudio"];
  }
  return providerCache;
}

async function saveCredential(event, payload) {
  if (!validSender(event)) throw new Error("Untrusted desktop renderer.");
  const provider = typeof payload?.provider === "string" ? payload.provider.trim() : "";
  const apiKey = typeof payload?.apiKey === "string" ? payload.apiKey.trim() : "";
  const baseUrl = typeof payload?.baseUrl === "string" ? payload.baseUrl.trim() : "";
  if (!(await allowedProviders()).includes(provider)) throw new Error("Unknown provider.");
  if (apiKey.length > 4000 || baseUrl.length > 400) throw new Error("That credential is too long.");
  if (!apiKey) throw new Error("Enter an API key before saving.");
  if (encryptionAvailable()) {
    const secrets = readEncryptedSecrets();
    secrets.providers = secrets.providers || {};
    secrets.providers[provider] = { apiKey, baseUrl: baseUrl || undefined, updatedAt: Date.now() };
    writeEncryptedSecrets(secrets);
    removePlaintextProvider(provider);
    config = loadDesktopConfig();
    providerCache = null;
    if (ownsApi) await restartApi();
    else await apiFetch(`/api/settings/credentials/${provider}`, "PUT", { apiKey, baseUrl: baseUrl || undefined });
  } else {
    await apiFetch(`/api/settings/credentials/${provider}`, "PUT", { apiKey, baseUrl: baseUrl || undefined });
    await apiFetch("/api/settings/reload", "POST");
  }
  return { stored: true, encrypted: encryptionAvailable() };
}

async function deleteCredential(event, payload) {
  if (!validSender(event)) throw new Error("Untrusted desktop renderer.");
  const provider = typeof payload?.provider === "string" ? payload.provider.trim() : "";
  if (!(await allowedProviders()).includes(provider)) throw new Error("Unknown provider.");
  const secrets = readEncryptedSecrets();
  if (secrets.providers && secrets.providers[provider]) {
    delete secrets.providers[provider];
    writeEncryptedSecrets(secrets);
    if (ownsApi) await restartApi();
  }
  try {
    await apiFetch(`/api/settings/credentials/${provider}`, "DELETE");
    await apiFetch("/api/settings/reload", "POST");
  } catch {}
  return { deleted: true };
}

async function testCredential(event, payload) {
  if (!validSender(event)) throw new Error("Untrusted desktop renderer.");
  const provider = typeof payload?.provider === "string" ? payload.provider.trim() : "";
  const apiKey = typeof payload?.apiKey === "string" ? payload.apiKey.trim() : "";
  const baseUrl = typeof payload?.baseUrl === "string" ? payload.baseUrl.trim() : "";
  if (!(await allowedProviders()).includes(provider)) throw new Error("Unknown provider.");
  if (apiKey.length > 4000) throw new Error("That API key is too long.");
  try {
    return await apiFetch(`/api/settings/credentials/${provider}/test`, "POST", { apiKey, baseUrl: baseUrl || undefined });
  } catch (error) {
    return { ok: false, provider, error: redactText(error.message) };
  }
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
  const token = currentAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
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

ipcMain.handle("ntox:send-message", async (event, payload) => {
  try { return await sendMessage(event, payload); }
  catch (error) {
    activeRequests.delete(String(payload?.requestId || ""));
    desktopLog(`chat request failed: ${redactText(String((error && error.message) || error))}`);
    throw error;
  }
});
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
  const allowed = /^\/api\/(desktop\/(?:bootstrap|permissions)|agents|tasks(?:\/[^/]+(?:\/(?:cancel|retry))?)?|memory(?:\/graph|\/[^/]+)?|tools|evaluations|approvals|settings(?:\/(?:providers|reload))?)$/;
  const routePath = route.split("?")[0];
  if (!allowed.test(routePath) || !["GET", "POST", "PATCH", "DELETE"].includes(method)) throw new Error("Desktop API request is not allowed.");
  return apiFetch(route, method, input.body);
});
ipcMain.handle("ntox:secret-store-status", async event => {
  if (!validSender(event)) throw new Error("Untrusted desktop renderer.");
  const stored = readEncryptedSecrets().providers || {};
  return { encrypted: encryptionAvailable(), activeProvider: activeProvider(), storedProviders: Object.keys(stored).filter(key => stored[key] && stored[key].apiKey) };
});
ipcMain.handle("ntox:save-credential", (event, payload) => saveCredential(event, payload));
ipcMain.handle("ntox:delete-credential", (event, payload) => deleteCredential(event, payload));
ipcMain.handle("ntox:test-credential", (event, payload) => testCredential(event, payload));
ipcMain.handle("ntox:reload-runtime", async event => {
  if (!validSender(event)) throw new Error("Untrusted desktop renderer.");
  config = loadDesktopConfig();
  providerCache = null;
  return apiFetch("/api/settings/reload", "POST");
});
ipcMain.handle("ntox:approve", async (event, payload) => {
  if (!validSender(event)) throw new Error("Untrusted desktop renderer.");
  const id = typeof payload?.id === "string" ? payload.id : "";
  const decision = typeof payload?.decision === "string" ? payload.decision : "";
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error("Invalid approval id.");
  if (!["allow-once", "allow-session", "allow-always", "deny"].includes(decision)) throw new Error("Invalid approval decision.");
  return apiFetch("/api/approvals", "POST", { id, decision });
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
    minWidth: 760,
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
  migratePlaintextSecretsToEncryptedStore();
  const assets = new Map([
    ["/index.html", "text/html; charset=utf-8"],
    ["/dashboard.js", "text/javascript; charset=utf-8"],
    ["/dashboard.css", "text/css; charset=utf-8"],
    ["/landing.css", "text/css; charset=utf-8"],
    ["/landscape.js", "text/javascript; charset=utf-8"],
    ["/runtime.css", "text/css; charset=utf-8"],
    ["/console.css", "text/css; charset=utf-8"],
    ["/assets/lunar-horizon.png", "image/png"],
    ["/glyph-motion.js", "text/javascript; charset=utf-8"],
    ["/glyph-motion.css", "text/css; charset=utf-8"],
    ["/glyphs/catalog.js", "text/javascript; charset=utf-8"],
    ["/glyphs/geometry.js", "text/javascript; charset=utf-8"],
    ["/chat.js", "text/javascript; charset=utf-8"],
    ["/chat.css", "text/css; charset=utf-8"],
  ]);
  const glyphIds = JSON.parse(readFileSync(path.join(__dirname, "glyphs/manifest.json"), "utf8"));
  for (const id of glyphIds) {
    if (typeof id === "string" && /^[a-z-]+$/.test(id)) assets.set(`/glyphs/artwork/${id}.svg`, "image/svg+xml");
  }
  protocol.handle("ntox", request => {
    const url = new URL(request.url);
    const contentType = assets.get(url.pathname);
    if (url.hostname !== "app" || !contentType) return new Response("Not found", { status: 404 });
    return new Response(readFileSync(path.join(__dirname, url.pathname.slice(1))), { headers: { "Content-Type": contentType } });
  });
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => {
  console.error("[desktop] startup failed:", error);
  app.quit();
});

app.on("render-process-gone", (_event, webContents, details) => console.error("[desktop] renderer exited:", webContents.getURL(), details));

app.on("child-process-gone", (_event, details) => console.error("[desktop] child process exited:", details.type, details.reason, details.exitCode));

app.on("before-quit", () => {
  if (apiProcess && apiProcess.exitCode === null) apiProcess.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

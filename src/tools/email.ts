import { connect as connectNet } from "node:net";
import { connect as connectTls } from "node:tls";
import type { Socket } from "node:net";
import type { Tool, ToolResult } from "../types/index.js";
import { loadConfig } from "../core/config.js";
import { approvalStore, buildApprovalKey, recordApprovalRequest, requestInteractiveApproval } from "./approval.js";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

export interface EmailConfig {
  smtp?: SmtpConfig;
  imap?: ImapConfig;
}

export interface OutboundEmail {
  to: string[];
  subject: string;
  text: string;
  from?: string;
}

export interface UnreadEmail {
  uid: number;
  from: string;
  subject: string;
  date: string;
  preview: string;
}

export type ConnectFn = (host: string, port: number, secure: boolean) => Promise<Socket>;

const READ_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 15_000;

const EMAIL_PATTERN = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export function looksLikeEmail(address: string): boolean {
  return EMAIL_PATTERN.test(address.trim());
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function pickStr(env: string, fallback: unknown): string | undefined {
  const fromEnv = process.env[env]?.trim() ? process.env[env].trim() : undefined;
  if (fromEnv) return fromEnv;
  return typeof fallback === "string" && fallback.trim() ? fallback.trim() : undefined;
}

function pickNum(env: string, fallback: unknown): number | undefined {
  const raw = process.env[env]?.trim() ? process.env[env] : fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function pickBool(env: string, fallback: unknown): boolean | undefined {
  const raw = process.env[env]?.trim() ? process.env[env] : fallback;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    if (/^(1|true|yes|on)$/i.test(raw)) return true;
    if (/^(0|false|no|off)$/i.test(raw)) return false;
  }
  return undefined;
}

export function resolveEmailConfig(source?: Record<string, unknown>): EmailConfig {
  const root = source ?? (loadConfig() as unknown as Record<string, unknown>);
  const email = asRecord(root.email);
  const smtpRaw = asRecord(email.smtp);
  const imapRaw = asRecord(email.imap);

  const smtpHost = pickStr("NTOX_EMAIL_SMTP_HOST", smtpRaw.host);
  const smtpUser = pickStr("NTOX_EMAIL_SMTP_USER", smtpRaw.user);
  const smtpPass = pickStr("NTOX_EMAIL_SMTP_PASS", smtpRaw.pass);
  const smtpPortExplicit = pickNum("NTOX_EMAIL_SMTP_PORT", smtpRaw.port);
  const smtpSecure = pickBool("NTOX_EMAIL_SMTP_SECURE", smtpRaw.secure) ?? smtpPortExplicit === 465;
  const smtpPort = smtpPortExplicit ?? (smtpSecure ? 465 : 587);
  const smtpFrom = pickStr("NTOX_EMAIL_FROM", smtpRaw.from) ?? smtpUser ?? "";

  const imapHost = pickStr("NTOX_EMAIL_IMAP_HOST", imapRaw.host);
  const imapUser = pickStr("NTOX_EMAIL_IMAP_USER", imapRaw.user);
  const imapPass = pickStr("NTOX_EMAIL_IMAP_PASS", imapRaw.pass);
  const imapPortExplicit = pickNum("NTOX_EMAIL_IMAP_PORT", imapRaw.port);
  const imapSecure = pickBool("NTOX_EMAIL_IMAP_SECURE", imapRaw.secure) ?? imapPortExplicit !== 143;
  const imapPort = imapPortExplicit ?? (imapSecure ? 993 : 143);

  const config: EmailConfig = {};
  if (smtpHost && smtpUser && smtpPass) {
    config.smtp = {
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      user: smtpUser,
      pass: smtpPass,
      from: smtpFrom,
    };
  }
  if (imapHost && imapUser && imapPass) {
    config.imap = { host: imapHost, port: imapPort, secure: imapSecure, user: imapUser, pass: imapPass };
  }
  return config;
}

export const defaultConnect: ConnectFn = (host, port, secure) =>
  new Promise<Socket>((resolve, reject) => {
    const socket = secure ? connectTls({ host, port }) : connectNet({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Connection to ${host}:${port} timed out`));
    }, CONNECT_TIMEOUT_MS);
    const onError = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };
    socket.once(secure ? "secureConnect" : "connect", () => {
      clearTimeout(timer);
      socket.removeListener("error", onError);
      resolve(socket);
    });
    socket.once("error", onError);
  });

export class SocketReader {
  private buffer: Buffer = Buffer.alloc(0);
  private ended: Error | null = null;
  private wakes: Array<() => void> = [];
  private readonly onData: (chunk: Buffer) => void;
  private readonly onFail: (error: Error) => void;
  private readonly onEnd: () => void;

  constructor(private socket: Socket) {
    this.onData = (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.wakeAll();
    };
    this.onFail = (error: Error) => {
      this.ended ??= error;
      this.wakeAll();
    };
    this.onEnd = () => {
      this.ended ??= new Error("Connection closed by peer");
      this.wakeAll();
    };
    socket.on("data", this.onData);
    socket.on("error", this.onFail);
    socket.on("end", this.onEnd);
    socket.on("close", this.onEnd);
  }

  detach(): void {
    this.socket.removeListener("data", this.onData);
    this.socket.removeListener("error", this.onFail);
    this.socket.removeListener("end", this.onEnd);
    this.socket.removeListener("close", this.onEnd);
  }

  private wakeAll(): void {
    for (const wake of this.wakes.splice(0)) wake();
  }

  private wait(): Promise<void> {
    return new Promise((resolve) => this.wakes.push(resolve));
  }

  private async spin(ready: () => boolean): Promise<void> {
    const deadline = Date.now() + READ_TIMEOUT_MS;
    while (!ready()) {
      if (this.ended) throw this.ended;
      if (Date.now() >= deadline) throw new Error("Socket read timed out");
      await this.wait();
    }
  }

  async readLine(): Promise<string> {
    await this.spin(() => this.buffer.indexOf("\r\n") >= 0);
    const idx = this.buffer.indexOf("\r\n");
    const line = this.buffer.subarray(0, idx).toString("utf8");
    this.buffer = this.buffer.subarray(idx + 2);
    return line;
  }

  async readBytes(count: number): Promise<Buffer> {
    await this.spin(() => this.buffer.length >= count);
    const out = this.buffer.subarray(0, count);
    this.buffer = this.buffer.subarray(count);
    return Buffer.from(out);
  }
}

function writeLine(socket: Socket, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(`${line}\r\n`, (error) => (error ? reject(error) : resolve()));
  });
}

function writeRaw(socket: Socket, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(data, (error) => (error ? reject(error) : resolve()));
  });
}

async function upgradeToTls(
  reader: SocketReader,
  socket: Socket,
  host: string,
): Promise<{ socket: Socket; reader: SocketReader }> {
  reader.detach();
  const tlsSocket = connectTls({ socket, servername: host });
  await new Promise<void>((resolve, reject) => {
    tlsSocket.once("secureConnect", resolve);
    tlsSocket.once("error", reject);
  });
  return { socket: tlsSocket, reader: new SocketReader(tlsSocket) };
}

interface SmtpReply {
  code: number;
  lines: string[];
}

const SMTP_REPLY = /^(\d{3})([ -])(.*)$/;

async function readSmtpReply(reader: SocketReader): Promise<SmtpReply> {
  const first = await reader.readLine();
  const match = SMTP_REPLY.exec(first);
  if (!match) throw new Error(`Unexpected SMTP response: ${first}`);
  const code = Number(match[1]);
  const lines = [match[3]];
  let separator = match[2];
  while (separator === "-") {
    const next = await reader.readLine();
    const cont = SMTP_REPLY.exec(next);
    if (!cont) {
      lines.push(next);
      break;
    }
    lines.push(cont[3]);
    separator = cont[2];
  }
  return { code, lines };
}

function capability(reply: SmtpReply, name: string): boolean {
  return reply.lines.some((line) => line.toUpperCase().split(/\s+/).includes(name));
}

function base64Body(text: string): string {
  const encoded = Buffer.from(text, "utf8").toString("base64");
  const wrapped: string[] = [];
  for (let i = 0; i < encoded.length; i += 76) wrapped.push(encoded.slice(i, i + 76));
  return wrapped.join("\r\n");
}

function encodeHeaderValue(value: string): string {
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export function buildMessage(email: OutboundEmail, from: string): string {
  return [
    `From: ${encodeHeaderValue(from)}`,
    `To: ${email.to.join(", ")}`,
    `Subject: ${encodeHeaderValue(email.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(email.text),
  ].join("\r\n");
}

export interface SendEmailDeps {
  connect?: ConnectFn;
}

export async function sendEmail(
  config: SmtpConfig,
  email: OutboundEmail,
  deps: SendEmailDeps = {},
): Promise<{ accepted: string[] }> {
  if (!looksLikeEmail(config.from)) throw new Error("email.smtp.from must be an email address");
  for (const address of email.to) {
    if (!looksLikeEmail(address)) throw new Error(`Invalid recipient address: ${address}`);
  }
  const connect = deps.connect ?? defaultConnect;
  const firstSocket = await connect(config.host, config.port, config.secure);
  let channel: { socket: Socket; reader: SocketReader } = {
    socket: firstSocket,
    reader: new SocketReader(firstSocket),
  };
  try {
    const greeting = await readSmtpReply(channel.reader);
    if (greeting.code !== 220) throw new Error(`SMTP greeting failed: ${greeting.lines.join(" ")}`);

    await writeLine(channel.socket, "EHLO ntox");
    let caps = await readSmtpReply(channel.reader);
    if (caps.code !== 250) throw new Error(`EHLO failed: ${caps.lines.join(" ")}`);

    if (!config.secure && capability(caps, "STARTTLS")) {
      await writeLine(channel.socket, "STARTTLS");
      const upgrade = await readSmtpReply(channel.reader);
      if (upgrade.code !== 220) throw new Error(`STARTTLS refused: ${upgrade.lines.join(" ")}`);
      channel = await upgradeToTls(channel.reader, channel.socket, config.host);
      await writeLine(channel.socket, "EHLO ntox");
      caps = await readSmtpReply(channel.reader);
      if (caps.code !== 250) throw new Error(`EHLO after STARTTLS failed: ${caps.lines.join(" ")}`);
    }

    const plain = Buffer.from(`\0${config.user}\0${config.pass}`).toString("base64");
    await writeLine(channel.socket, `AUTH PLAIN ${plain}`);
    let auth = await readSmtpReply(channel.reader);
    if (auth.code === 504 || auth.code === 500 || auth.code === 501) {
      await writeLine(channel.socket, "AUTH LOGIN");
      const userStep = await readSmtpReply(channel.reader);
      if (userStep.code !== 334) throw new Error(`SMTP AUTH LOGIN refused: ${userStep.lines.join(" ")}`);
      await writeLine(channel.socket, Buffer.from(config.user).toString("base64"));
      const passStep = await readSmtpReply(channel.reader);
      if (passStep.code !== 334) throw new Error(`SMTP AUTH LOGIN password step refused: ${passStep.lines.join(" ")}`);
      await writeLine(channel.socket, Buffer.from(config.pass).toString("base64"));
      auth = await readSmtpReply(channel.reader);
    }
    if (auth.code !== 235) throw new Error(`SMTP AUTH failed: ${auth.code} ${auth.lines.join(" ")}`);

    await writeLine(channel.socket, `MAIL FROM:<${config.from}>`);
    const fromReply = await readSmtpReply(channel.reader);
    if (fromReply.code !== 250) throw new Error(`MAIL FROM rejected: ${fromReply.code} ${fromReply.lines.join(" ")}`);

    for (const address of email.to) {
      await writeLine(channel.socket, `RCPT TO:<${address}>`);
      const rcpt = await readSmtpReply(channel.reader);
      if (rcpt.code !== 250 && rcpt.code !== 251) {
        throw new Error(`RCPT TO <${address}> rejected: ${rcpt.code} ${rcpt.lines.join(" ")}`);
      }
    }

    await writeLine(channel.socket, "DATA");
    const dataStep = await readSmtpReply(channel.reader);
    if (dataStep.code !== 354) throw new Error(`DATA refused: ${dataStep.code} ${dataStep.lines.join(" ")}`);

    await writeRaw(channel.socket, `${buildMessage(email, config.from)}\r\n.\r\n`);
    const accepted = await readSmtpReply(channel.reader);
    if (accepted.code !== 250 && accepted.code !== 251) {
      throw new Error(`Message rejected: ${accepted.code} ${accepted.lines.join(" ")}`);
    }

    try {
      await writeLine(channel.socket, "QUIT");
      await readSmtpReply(channel.reader);
    } catch {
      /* closing the socket is enough if QUIT fails */
    }
    return { accepted: email.to };
  } finally {
    channel.socket.destroy();
  }
}

function quote(value: string): string {
  return `"${value.replace(/["\\]/g, (match) => `\\${match}`)}"`;
}

function decodeEncodedWord(value: string): string {
  return value.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_match, _charset, encoding, payload: string) => {
    try {
      if (encoding.toUpperCase() === "B") return Buffer.from(payload, "base64").toString("utf8");
      const bytes = payload
        .replace(/_/g, " ")
        .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      return Buffer.from(bytes, "binary").toString("utf8");
    } catch {
      return payload;
    }
  });
}

function parseHeaders(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  let current = "";
  for (const line of block.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && current) {
      headers[current] += ` ${line.trim()}`;
      continue;
    }
    const match = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    current = match[1].toLowerCase();
    headers[current] = match[2];
  }
  return headers;
}

function decodeField(value: string | undefined): string {
  if (!value) return "";
  return decodeEncodedWord(value).replace(/\s+/g, " ").trim();
}

interface ImapTagged {
  lines: string[];
  literals: string[];
}

async function readTaggedReply(reader: SocketReader, tag: string): Promise<ImapTagged> {
  const lines: string[] = [];
  const literals: string[] = [];
  for (;;) {
    const line = await reader.readLine();
    if (line.startsWith(`${tag} `)) {
      const status = line
        .slice(tag.length + 1)
        .split(" ")[0]
        .toUpperCase();
      if (status !== "OK") throw new Error(`IMAP ${status}: ${line}`);
      return { lines, literals };
    }
    const literal = /\{(\d+)\}$/.exec(line);
    lines.push(line);
    if (literal) {
      literals.push((await reader.readBytes(Number(literal[1]))).toString("utf8"));
    }
  }
}

export interface ReadUnreadDeps {
  connect?: ConnectFn;
}

export async function readUnreadEmail(
  config: ImapConfig,
  limit = 5,
  deps: ReadUnreadDeps = {},
): Promise<UnreadEmail[]> {
  const connect = deps.connect ?? defaultConnect;
  const firstSocket = await connect(config.host, config.port, config.secure);
  let channel: { socket: Socket; reader: SocketReader } = {
    socket: firstSocket,
    reader: new SocketReader(firstSocket),
  };
  let tagCount = 0;
  const run = async (command: string): Promise<ImapTagged> => {
    const tag = `A${++tagCount}`;
    await writeLine(channel.socket, `${tag} ${command}`);
    return readTaggedReply(channel.reader, tag);
  };
  try {
    const greeting = await channel.reader.readLine();
    if (!/^\* (OK|PREAUTH)/i.test(greeting)) throw new Error(`IMAP greeting failed: ${greeting}`);

    if (!config.secure && /\bSTARTTLS\b/i.test(greeting)) {
      const tag = `A${++tagCount}`;
      await writeLine(channel.socket, `${tag} STARTTLS`);
      const reply = await channel.reader.readLine();
      if (!reply.startsWith(`${tag} OK`)) throw new Error(`IMAP STARTTLS refused: ${reply}`);
      channel = await upgradeToTls(channel.reader, channel.socket, config.host);
    }

    await run(`LOGIN ${quote(config.user)} ${quote(config.pass)}`);
    await run("SELECT INBOX");
    const search = await run("UID SEARCH UNSEEN");
    const searchLine = search.lines.find((line) => /^\* SEARCH/i.test(line)) ?? "";
    const uids = (searchLine.match(/\d+/g) ?? []).map(Number);
    const picked = uids.slice(-Math.max(1, limit));

    const unread: UnreadEmail[] = [];
    for (const uid of picked) {
      const fetched = await run(
        `UID FETCH ${uid} (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)] BODY.PEEK[TEXT]<0.400>)`,
      );
      const headers = parseHeaders(fetched.literals[0] ?? "");
      const preview = (fetched.literals[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
      unread.push({
        uid,
        from: decodeField(headers.from),
        subject: decodeField(headers.subject),
        date: decodeField(headers.date),
        preview,
      });
    }

    await run("LOGOUT").catch(() => undefined);
    return unread;
  } finally {
    channel.socket.destroy();
  }
}

export function approvalCommand(to: string, subject: string): string {
  const clean = (value: string) =>
    value
      .replace(/["\r\n]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const subjectPart = clean(subject).slice(0, 90);
  return `send email to ${clean(to)} subject ${subjectPart}`.slice(0, 180);
}

let configSource: (() => Record<string, unknown>) | null = null;

export function setEmailConfigSource(source: (() => Record<string, unknown>) | null): void {
  configSource = source;
}

function currentEmailConfig(): EmailConfig {
  return resolveEmailConfig(configSource ? configSource() : undefined);
}

const EMAIL_SEND_TOOL: Tool = {
  name: "email_send",
  description: "Send an email through the configured SMTP server. Requires user approval before sending.",
  parameters: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email address" },
      subject: { type: "string", description: "Subject line" },
      text: { type: "string", description: "Plain text body of the email" },
    },
    required: ["to", "subject", "text"],
  },
  async execute(args): Promise<ToolResult> {
    const to = String(args.to ?? "").trim();
    const subject = String(args.subject ?? "")
      .replace(/\r?\n/g, " ")
      .trim();
    const text = String(args.text ?? "");
    if (!to || !subject || !text) {
      return { success: false, error: "email_send requires to, subject and text" };
    }
    if (!looksLikeEmail(to)) return { success: false, error: `Invalid recipient address: ${to}` };

    const command = approvalCommand(to, subject);
    recordApprovalRequest("email_send", command);
    const key = { command };
    let decision = approvalStore.check("email_send", key);
    const stored = decision;
    if (!decision) decision = await requestInteractiveApproval("email_send", command);
    if (!decision || decision === "deny") {
      return {
        success: false,
        error: `APPROVAL_REQUIRED: Command "${command}" requires approval. Use approval system to allow or deny.`,
      };
    }
    if (decision !== "allow-once" && !stored) {
      approvalStore.store("email_send", buildApprovalKey("email_send", command), decision);
    }

    const config = currentEmailConfig().smtp;
    if (!config) {
      return {
        success: false,
        error:
          "SMTP is not configured. Set email.smtp { host, port, secure, user, pass, from } in ~/.ntox/config.json or the NTOX_EMAIL_SMTP_* env vars.",
      };
    }
    try {
      const result = await sendEmail(config, { to: [to], subject, text });
      return { success: true, data: { to, subject, accepted: result.accepted } };
    } catch (error) {
      return { success: false, error: `SMTP send failed: ${error instanceof Error ? error.message : error}` };
    }
  },
};

const EMAIL_READ_TOOL: Tool = {
  name: "email_read",
  description: "List recent unread emails from the configured IMAP inbox (subject, sender, preview).",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", description: "How many unread messages to return (default 5, max 25)" },
    },
  },
  async execute(args): Promise<ToolResult> {
    const config = currentEmailConfig().imap;
    if (!config) {
      return {
        success: false,
        error:
          "IMAP is not configured. Set email.imap { host, port, secure, user, pass } in ~/.ntox/config.json or the NTOX_EMAIL_IMAP_* env vars.",
      };
    }
    const requested = Number(args.limit ?? 5);
    const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 5, 1), 25);
    try {
      const unread = await readUnreadEmail(config, limit);
      return { success: true, data: { count: unread.length, unread } };
    } catch (error) {
      return { success: false, error: `IMAP read failed: ${error instanceof Error ? error.message : error}` };
    }
  },
};

export const emailSendTool = EMAIL_SEND_TOOL;
export const emailReadTool = EMAIL_READ_TOOL;

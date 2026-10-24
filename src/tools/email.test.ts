import { createServer } from "node:net";
import type { Socket, AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  approvalCommand,
  buildMessage,
  emailReadTool,
  emailSendTool,
  readUnreadEmail,
  resolveEmailConfig,
  sendEmail,
  setEmailConfigSource,
  type ImapConfig,
  type OutboundEmail,
  type SmtpConfig,
} from "./email.js";
import {
  approvalStore,
  buildApprovalKey,
  recordApprovalRequest,
  setInteractiveApproval,
  storeApprovalDecision,
  toolNameForCommand,
} from "./approval.js";

interface FakeServer {
  port: number;
  commands: string[];
  close: () => Promise<void>;
}

function startServer(onSocket: (socket: Socket, server: FakeServer) => void): Promise<FakeServer> {
  const sockets = new Set<Socket>();
  const server: FakeServer = {
    port: 0,
    commands: [],
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => netServer.close(() => resolve()));
    },
  };
  const netServer = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
    onSocket(socket, server);
  });
  return new Promise<FakeServer>((resolve) => {
    netServer.listen(0, "127.0.0.1", () => {
      server.port = (netServer.address() as AddressInfo).port;
      resolve(server);
    });
  });
}

interface SmtpOptions {
  user?: string;
  pass?: string;
  rejectRcpt?: boolean;
}

function startFakeSmtp(options: SmtpOptions = {}): Promise<FakeServer & { data: string }> {
  const expectedUser = options.user ?? "alice@fake.local";
  const expectedPass = options.pass ?? "secret";
  return startServer((socket, server) => {
    const state = server as FakeServer & { data: string };
    let buffer = "";
    let inData = false;
    socket.write("220 fake.local ESMTP ready\r\n");
    const handle = (line: string) => {
      server.commands.push(line);
      const upper = line.toUpperCase();
      if (upper.startsWith("EHLO")) {
        socket.write("250-fake.local\r\n250 AUTH PLAIN LOGIN\r\n");
      } else if (upper.startsWith("AUTH PLAIN")) {
        const payload = line.slice("AUTH PLAIN".length).trim();
        const decoded = Buffer.from(payload, "base64").toString("utf8");
        const [, user, pass] = decoded.split("\0");
        if (user === expectedUser && pass === expectedPass) socket.write("235 2.7.0 accepted\r\n");
        else socket.write("535 5.7.8 invalid credentials\r\n");
      } else if (upper.startsWith("MAIL FROM")) {
        socket.write("250 2.1.0 Ok\r\n");
      } else if (upper.startsWith("RCPT TO")) {
        if (options.rejectRcpt) socket.write("550 5.1.1 no such user\r\n");
        else socket.write("250 2.1.5 Ok\r\n");
      } else if (upper.startsWith("DATA")) {
        inData = true;
        socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
      } else if (upper.startsWith("QUIT")) {
        socket.write("221 2.0.0 bye\r\n");
        socket.end();
      } else {
        socket.write("502 5.5.2 unimplemented\r\n");
      }
    };
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          state.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          socket.write("250 2.0.0 queued\r\n");
          continue;
        }
        const nl = buffer.indexOf("\r\n");
        if (nl < 0) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        handle(line);
      }
    });
  }).then((server) => Object.assign(server, { data: "" }) as FakeServer & { data: string });
}

interface FakeMessage {
  uid: number;
  headers: string;
  text: string;
}

interface ImapOptions {
  messages?: FakeMessage[];
  failLogin?: boolean;
}

function startFakeImap(options: ImapOptions = {}): Promise<FakeServer> {
  const messages = options.messages ?? [];
  return startServer((socket, server) => {
    let buffer = "";
    socket.write("* OK [CAPABILITY IMAP4rev1] fake ready\r\n");
    const respond = (line: string) => {
      server.commands.push(line);
      const space = line.indexOf(" ");
      const tag = line.slice(0, space);
      const command = line.slice(space + 1);
      const upper = command.toUpperCase();
      if (upper.startsWith("LOGIN")) {
        if (options.failLogin) socket.write(`${tag} NO [AUTHENTICATIONFAILED] invalid credentials\r\n`);
        else socket.write(`${tag} OK [CAPABILITY IMAP4rev1] LOGIN completed\r\n`);
      } else if (upper.startsWith("SELECT")) {
        socket.write(`* ${messages.length} EXISTS\r\n${tag} OK [READ-WRITE] SELECT completed\r\n`);
      } else if (upper.startsWith("UID SEARCH")) {
        const uids = messages.map((message) => message.uid).join(" ");
        socket.write(`* SEARCH ${uids}\r\n${tag} OK SEARCH completed\r\n`);
      } else if (upper.startsWith("UID FETCH")) {
        const uid = Number(/UID FETCH (\d+)/i.exec(command)?.[1]);
        const message = messages.find((item) => item.uid === uid);
        if (!message) {
          socket.write(`${tag} OK FETCH completed\r\n`);
          return;
        }
        const headerBytes = Buffer.byteLength(message.headers, "utf8");
        const textBytes = Buffer.byteLength(message.text, "utf8");
        socket.write(
          `* 1 FETCH (UID ${uid} BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {${headerBytes}}\r\n${message.headers}` +
            `) BODY[TEXT]<0> {${textBytes}}\r\n${message.text})\r\n${tag} OK FETCH completed\r\n`,
        );
      } else if (upper.startsWith("LOGOUT")) {
        socket.write(`* BYE\r\n${tag} OK LOGOUT completed\r\n`);
        socket.end();
      } else {
        socket.write(`${tag} BAD unexpected command\r\n`);
      }
    };
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const nl = buffer.indexOf("\r\n");
        if (nl < 0) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        respond(line);
      }
    });
  });
}

const SMTP_CONFIG = (port: number): SmtpConfig => ({
  host: "127.0.0.1",
  port,
  secure: false,
  user: "alice@fake.local",
  pass: "secret",
  from: "alice@fake.local",
});

const IMAP_CONFIG = (port: number): ImapConfig => ({
  host: "127.0.0.1",
  port,
  secure: false,
  user: "alice@fake.local",
  pass: "secret",
});

const EMAIL: OutboundEmail = {
  to: ["bob@example.com"],
  subject: "Release notes",
  text: "NTOX ships Pillar 4 today.",
};

const UNREAD_MESSAGES: FakeMessage[] = [
  {
    uid: 101,
    headers:
      `From: Ana <ana@example.com>\r\nSubject: =?UTF-8?B?${Buffer.from("Café résumé", "utf8").toString("base64")}?=` +
      "\r\nDate: Fri, 23 Oct 2026 09:00:00 +0000",
    text: "First message body",
  },
  {
    uid: 102,
    headers: "From: ben@example.com\r\nSubject: Standup notes\r\nDate: Sat, 24 Oct 2026 08:00:00 +0000",
    text: "Second message body",
  },
];

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeEach(() => {
  setInteractiveApproval(null);
  setEmailConfigSource(null);
  approvalStore.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  setEmailConfigSource(null);
});

describe("resolveEmailConfig", () => {
  it("builds both transports from an email block", () => {
    const config = resolveEmailConfig({
      email: {
        smtp: { host: "smtp.example.com", user: "me@example.com", pass: "pw" },
        imap: { host: "imap.example.com", user: "me@example.com", pass: "pw" },
      },
    });

    expect(config.smtp).toEqual({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      user: "me@example.com",
      pass: "pw",
      from: "me@example.com",
    });
    expect(config.imap).toEqual({
      host: "imap.example.com",
      port: 993,
      secure: true,
      user: "me@example.com",
      pass: "pw",
    });
  });

  it("defaults secure from the explicit port and honours env overrides", () => {
    vi.stubEnv("NTOX_EMAIL_SMTP_HOST", "smtp.env.example");
    vi.stubEnv("NTOX_EMAIL_SMTP_PORT", "465");
    vi.stubEnv("NTOX_EMAIL_SMTP_SECURE", "false");
    vi.stubEnv("NTOX_EMAIL_SMTP_USER", "env@example.com");
    vi.stubEnv("NTOX_EMAIL_SMTP_PASS", "env-pass");
    vi.stubEnv("NTOX_EMAIL_IMAP_HOST", "imap.env.example");
    vi.stubEnv("NTOX_EMAIL_IMAP_USER", "env@example.com");
    vi.stubEnv("NTOX_EMAIL_IMAP_PASS", "env-pass");
    vi.stubEnv("NTOX_EMAIL_IMAP_PORT", "143");

    const config = resolveEmailConfig({ email: { smtp: { host: "ignored", user: "ignored", pass: "ignored" } } });

    expect(config.smtp).toMatchObject({ host: "smtp.env.example", port: 465, secure: false, user: "env@example.com" });
    expect(config.imap).toMatchObject({ host: "imap.env.example", port: 143, secure: false });
  });

  it("returns nothing when credentials are incomplete", () => {
    expect(resolveEmailConfig({ email: { smtp: { host: "smtp.example.com" } } })).toEqual({});
    expect(resolveEmailConfig({})).toEqual({});
  });
});

describe("sendEmail against a fake SMTP server", () => {
  it("runs the EHLO/AUTH/MAIL/RCPT/DATA dialogue and delivers the message", async () => {
    const smtp = await startFakeSmtp();

    const result = await sendEmail(SMTP_CONFIG(smtp.port), EMAIL);

    expect(result.accepted).toEqual(["bob@example.com"]);
    expect(smtp.commands[0]).toMatch(/^EHLO /);
    expect(smtp.commands[1]).toMatch(/^AUTH PLAIN /);
    expect(smtp.commands[2]).toBe("MAIL FROM:<alice@fake.local>");
    expect(smtp.commands[3]).toBe("RCPT TO:<bob@example.com>");
    expect(smtp.commands[4]).toBe("DATA");
    expect(smtp.commands[5]).toBe("QUIT");
    expect(smtp.data).toContain("To: bob@example.com");
    expect(smtp.data).toContain("Content-Transfer-Encoding: base64");
    const body = smtp.data
      .split(/\r\n\r\n/)
      .slice(1)
      .join("\r\n\r\n");
    expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe(EMAIL.text);
    await smtp.close();
  });

  it("encodes non-ascii subjects with RFC 2047", async () => {
    const message = buildMessage({ ...EMAIL, subject: "Café résumé" }, "alice@fake.local");
    expect(message).toContain("Subject: =?UTF-8?B?");

    const smtp = await startFakeSmtp();
    await sendEmail(SMTP_CONFIG(smtp.port), { ...EMAIL, subject: "Café résumé" });
    expect(smtp.data).toContain("=?UTF-8?B?");
    await smtp.close();
  });

  it("surfaces authentication failures", async () => {
    const smtp = await startFakeSmtp({ pass: "different" });
    await expect(sendEmail(SMTP_CONFIG(smtp.port), EMAIL)).rejects.toThrow(/SMTP AUTH failed: 535/);
    await smtp.close();
  });

  it("surfaces a rejected recipient", async () => {
    const smtp = await startFakeSmtp({ rejectRcpt: true });
    await expect(sendEmail(SMTP_CONFIG(smtp.port), EMAIL)).rejects.toThrow(/RCPT TO <bob@example.com> rejected: 550/);
    await smtp.close();
  });

  it("validates addresses before opening a connection", async () => {
    const smtp = await startFakeSmtp();
    await expect(sendEmail(SMTP_CONFIG(smtp.port), { ...EMAIL, to: ["not-an-address"] })).rejects.toThrow(
      "Invalid recipient address",
    );
    await expect(sendEmail({ ...SMTP_CONFIG(smtp.port), from: "broken" }, EMAIL)).rejects.toThrow(
      "email.smtp.from must be an email address",
    );
    expect(smtp.commands).toEqual([]);
    await smtp.close();
  });
});

describe("readUnreadEmail against a fake IMAP server", () => {
  it("logs in, searches unseen, and decodes headers with previews", async () => {
    const imap = await startFakeImap({ messages: UNREAD_MESSAGES });

    const unread = await readUnreadEmail(IMAP_CONFIG(imap.port), 5);

    expect(unread).toHaveLength(2);
    expect(unread[0]).toMatchObject({
      uid: 101,
      from: "Ana <ana@example.com>",
      subject: "Café résumé",
      preview: "First message body",
    });
    expect(unread[1]).toMatchObject({ uid: 102, from: "ben@example.com", subject: "Standup notes" });
    expect(imap.commands[0]).toMatch(/^A1 LOGIN "alice@fake.local" "secret"$/);
    expect(imap.commands[1]).toBe("A2 SELECT INBOX");
    expect(imap.commands[2]).toBe("A3 UID SEARCH UNSEEN");
    await imap.close();
  });

  it("honours the limit by taking the newest uids", async () => {
    const imap = await startFakeImap({ messages: UNREAD_MESSAGES });

    const unread = await readUnreadEmail(IMAP_CONFIG(imap.port), 1);

    expect(unread.map((mail) => mail.uid)).toEqual([102]);
    await imap.close();
  });

  it("returns an empty list for an empty inbox", async () => {
    const imap = await startFakeImap({ messages: [] });

    await expect(readUnreadEmail(IMAP_CONFIG(imap.port))).resolves.toEqual([]);
    await imap.close();
  });

  it("surfaces a login rejection", async () => {
    const imap = await startFakeImap({ failLogin: true });

    await expect(readUnreadEmail(IMAP_CONFIG(imap.port))).rejects.toThrow(/IMAP NO/);
    await imap.close();
  });
});

describe("email_send tool", () => {
  const args = { to: "bob@example.com", subject: "Release notes", text: "Pillar 4 is live." };

  it("asks for approval first and records which tool asked", async () => {
    const smtp = await startFakeSmtp();
    setEmailConfigSource(() => ({ email: { smtp: SMTP_CONFIG(smtp.port) } }));

    const result = await emailSendTool.execute(args);

    expect(result.success).toBe(false);
    expect(result.error).toContain("APPROVAL_REQUIRED");
    expect(result.error).toContain("send email to bob@example.com subject Release notes");
    expect(toolNameForCommand(approvalCommand(args.to, args.subject))).toBe("email_send");
    expect(smtp.commands).toEqual([]);
    await smtp.close();
  });

  it("sends once a session approval exists", async () => {
    const smtp = await startFakeSmtp();
    setEmailConfigSource(() => ({ email: { smtp: SMTP_CONFIG(smtp.port) } }));
    const command = approvalCommand(args.to, args.subject);
    approvalStore.store("email_send", buildApprovalKey("email_send", command), "allow-session");

    const result = await emailSendTool.execute(args);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ to: "bob@example.com", subject: "Release notes" });
    await waitFor(() => smtp.data.length > 0);
    const body = smtp.data
      .split(/\r\n\r\n/)
      .slice(1)
      .join("\r\n\r\n");
    expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe("Pillar 4 is live.");
    await smtp.close();
  });

  it("reports missing configuration after approval", async () => {
    setEmailConfigSource(() => ({}));
    const command = approvalCommand(args.to, args.subject);
    approvalStore.store("email_send", buildApprovalKey("email_send", command), "allow-once");

    const result = await emailSendTool.execute(args);

    expect(result.success).toBe(false);
    expect(result.error).toContain("SMTP is not configured");
  });

  it("rejects bad recipients before asking for approval", async () => {
    const result = await emailSendTool.execute({ ...args, to: "nope" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid recipient address");
    expect(result.error).not.toContain("APPROVAL_REQUIRED");
  });

  it("requires to, subject and text", async () => {
    const result = await emailSendTool.execute({ to: "bob@example.com" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("requires to, subject and text");
  });
});

describe("email_read tool", () => {
  it("lists unread mail through the configured IMAP server", async () => {
    const imap = await startFakeImap({ messages: UNREAD_MESSAGES });
    setEmailConfigSource(() => ({ email: { imap: IMAP_CONFIG(imap.port) } }));

    const result = await emailReadTool.execute({ limit: 1 });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ count: 1 });
    const unread = (result.data as { unread: Array<{ subject: string }> }).unread;
    expect(unread[0].subject).toBe("Standup notes");
    await imap.close();
  });

  it("reports missing configuration", async () => {
    setEmailConfigSource(() => ({}));

    const result = await emailReadTool.execute({});

    expect(result.success).toBe(false);
    expect(result.error).toContain("IMAP is not configured");
  });

  it("propagates IMAP failures", async () => {
    const imap = await startFakeImap({ failLogin: true });
    setEmailConfigSource(() => ({ email: { imap: IMAP_CONFIG(imap.port) } }));

    const result = await emailReadTool.execute({});

    expect(result.success).toBe(false);
    expect(result.error).toContain("IMAP read failed");
    await imap.close();
  });
});

describe("approval attribution", () => {
  it("routes a decision to the tool that requested approval", () => {
    const command = "send email to bob@example.com subject hi";
    recordApprovalRequest("email_send", command);

    expect(toolNameForCommand(command)).toBe("email_send");
    expect(toolNameForCommand("git push origin main")).toBe("shell");

    storeApprovalDecision(command, "allow-always");
    expect(approvalStore.check("email_send", { command })).toBe("allow-always");
    approvalStore.clear();
  });

  it("falls back to the shell namespace without a fresh request", () => {
    expect(toolNameForCommand("git push origin main")).toBe("shell");
  });
});

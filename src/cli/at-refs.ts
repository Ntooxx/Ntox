import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const MAX_REFS = 5;
const MAX_REF_SIZE = 50 * 1024;

function validateUrlInternal(raw: string): string | null {
  if (raw.length > 4096) return "URL exceeds maximum length";
  let url: URL;
  try { url = new URL(raw); } catch { return "Invalid URL format"; }
  if (!["http:", "https:"].includes(url.protocol)) return `Blocked protocol: ${url.protocol}`;
  const blocked = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
  const host = url.hostname.toLowerCase();
  if (blocked.includes(host) || blocked.some((h) => host.endsWith(`.${h}`))) {
    return `Blocked host: ${host}`;
  }
  return null;
}

function extractRefs(input: string): string[] {
  const pattern = /@(?!@)((?:(?:https?:\/\/)|(?:~\/)|(?:\.{0,2}\/)|(?:[A-Za-z]:\\)|(?:HEAD|main|master|dev))(?:\S*))/g;
  const refs: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    if (refs.length >= MAX_REFS) break;
    refs.push(match[1]);
  }
  return refs;
}

function isUrl(ref: string): boolean {
  return ref.startsWith("http://") || ref.startsWith("https://");
}

function isGitRef(ref: string): boolean {
  return /^(HEAD|main|master|dev)$/.test(ref);
}

function isDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function isFile(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
}

function readFileContent(filePath: string): string {
  const raw = readFileSync(filePath, "utf-8");
  return raw.length > MAX_REF_SIZE ? raw.slice(0, MAX_REF_SIZE) + "\n... [truncated]" : raw;
}

function listDir(dirPath: string): string {
  const entries = readdirSync(dirPath);
  const lines = entries.map((e) => {
    const full = resolve(dirPath, e);
    try { return statSync(full).isDirectory() ? `${e}/` : e; } catch { return e; }
  });
  const content = lines.join("\n");
  return content.length > MAX_REF_SIZE ? content.slice(0, MAX_REF_SIZE) + "\n... [truncated]" : content;
}

function resolveGitRef(ref: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(ref)) return `[Error: Invalid git ref: ${ref}]`;
  try {
    let output: string;
    if (ref === "HEAD") {
      output = execSync("git log -1 --stat -p", {
        encoding: "utf-8",
        maxBuffer: MAX_REF_SIZE + 1024,
        timeout: 10000,
        windowsHide: true,
      });
    } else {
      output = execSync(`git show ${ref} --stat`, {
        encoding: "utf-8",
        maxBuffer: MAX_REF_SIZE + 1024,
        timeout: 10000,
        windowsHide: true,
      });
    }
    return output.length > MAX_REF_SIZE ? output.slice(0, MAX_REF_SIZE) + "\n... [truncated]" : output;
  } catch (e) {
    return `[Error resolving git ref @${ref}: ${e instanceof Error ? e.message : String(e)}]`;
  }
}

async function fetchUrlContent(url: string): Promise<string> {
  const blockReason = validateUrlInternal(url);
  if (blockReason) return `[Error: ${blockReason}]`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Ntox-Agent/1.0" },
    });
    if (!res.ok) return `[Error: HTTP ${res.status} ${res.statusText}]`;
    const cl = res.headers.get("content-length");
    if (cl && parseInt(cl) > MAX_REF_SIZE) return "[Error: Response too large]";
    const text = await res.text();
    return text.length > MAX_REF_SIZE ? text.slice(0, MAX_REF_SIZE) + "\n... [truncated]" : text;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return "[Error: Fetch timed out after 30s]";
    return `[Error: ${e instanceof Error ? e.message : String(e)}]`;
  } finally {
    clearTimeout(timeout);
  }
}

function resolveFilePath(ref: string): string {
  if (ref.startsWith("~/")) {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    return resolve(home, ref.slice(2));
  }
  return resolve(ref);
}

async function resolveRef(ref: string): Promise<string> {
  if (isUrl(ref)) {
    const content = await fetchUrlContent(ref);
    return `[URL: ${ref}]\n${content}\n`;
  }

  if (isGitRef(ref)) {
    const content = resolveGitRef(ref);
    return `[Git: @${ref}]\n${content}\n`;
  }

  const filePath = resolveFilePath(ref);

  if (isDirectory(filePath)) {
    const content = listDir(filePath);
    return `[Dir: ${filePath}]\n${content}\n`;
  }

  if (isFile(filePath)) {
    const content = readFileContent(filePath);
    return `[File: ${filePath}]\n\`\`\`\n${content}\n\`\`\`\n`;
  }

  return `[Error: Path not found: ${filePath}]`;
}

export async function processAtReferences(input: string): Promise<string> {
  const refs = extractRefs(input);
  if (refs.length === 0) return input;

  const limited = refs.slice(0, MAX_REFS);
  const resolved = await Promise.all(limited.map((r) => resolveRef(r)));

  let output = input;
  for (let i = 0; i < limited.length; i++) {
    output = output.replace(`@${limited[i]}`, resolved[i]);
  }
  return output;
}

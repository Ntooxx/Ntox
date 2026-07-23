import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { getBaseDir } from "../core/config.js";

export type ApprovalDecision = "allow-once" | "allow-session" | "allow-always" | "deny";

interface StoredApproval {
  toolName: string;
  pattern: string;
  decision: Exclude<ApprovalDecision, "allow-once">;
  createdAt: number;
}

interface ApprovalRecord {
  toolName: string;
  pattern: string;
  decision: ApprovalDecision;
}

const APPROVALS_PATH = join(getBaseDir(), "approvals.json");

function loadPersisted(): StoredApproval[] {
  if (!existsSync(APPROVALS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(APPROVALS_PATH, "utf-8")) as StoredApproval[];
  } catch {
    return [];
  }
}

function persistApprovals(approvals: StoredApproval[]): void {
  const dir = dirname(APPROVALS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(APPROVALS_PATH, JSON.stringify(approvals, null, 2));
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

export class ApprovalStore {
  private sessionApprovals: ApprovalRecord[] = [];

  check(toolName: string, args: Record<string, unknown>): ApprovalDecision | null {
    const command = String(args.command || "");
    const key = `${toolName}:${command}`;

    const sessionMatch = this.sessionApprovals.find(
      (a) => a.toolName === toolName && patternToRegex(a.pattern).test(key)
    );
    if (sessionMatch) {
      if (sessionMatch.decision === "allow-once") {
        this.sessionApprovals = this.sessionApprovals.filter((a) => a !== sessionMatch);
        return "allow-once";
      }
      return sessionMatch.decision;
    }

    const persisted = loadPersisted();
    const persistMatch = persisted.find(
      (a) => a.toolName === toolName && patternToRegex(a.pattern).test(key)
    );
    if (persistMatch) return persistMatch.decision;

    return null;
  }

  store(toolName: string, pattern: string, decision: ApprovalDecision): void {
    if (decision === "allow-once") {
      this.sessionApprovals.push({ toolName, pattern, decision });
      return;
    }

    if (decision === "allow-session") {
      this.sessionApprovals.push({ toolName, pattern, decision });
      return;
    }

    const persisted = loadPersisted();
    const existing = persisted.findIndex(
      (a) => a.toolName === toolName && a.pattern === pattern
    );
    const entry: StoredApproval = {
      toolName,
      pattern,
      decision: decision as Exclude<ApprovalDecision, "allow-once">,
      createdAt: Date.now(),
    };
    if (existing >= 0) {
      persisted[existing] = entry;
    } else {
      persisted.push(entry);
    }
    persistApprovals(persisted);
  }

  clear(): void {
    this.sessionApprovals = [];
    if (existsSync(APPROVALS_PATH)) {
      writeFileSync(APPROVALS_PATH, "[]");
    }
  }

  clearSession(): void {
    this.sessionApprovals = [];
  }
}

const DETRUCTIVE_PATTERNS = [
  /\brm\b/i,
  /\bdel\b/i,
  /\bRemove-Item\b/i,
  /\bkill\b/i,
  /\bStop-Process\b/i,
  /\bgit\s+push\b/i,
  /\bgit\s+reset\b/i,
  /\bgit\s+clean\b/i,
  /\bnpm\s+publish\b/i,
  /\bdocker\s+rm\b/i,
  /\bdocker\s+kill\b/i,
  /\bmv\b/i,
  /\bMove-Item\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
];

const ALWAYS_BLOCKED = [
  /\brm\s+-[a-z]*r[a-z]*\s+\/(?:\s|$)/i,
  /\brm\s+-rf\s+/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bsudo\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bformat\s+[A-Z]:/i,
];

export function needsApproval(command: string): boolean {
  if (ALWAYS_BLOCKED.some((p) => p.test(command))) return false;
  return DETRUCTIVE_PATTERNS.some((p) => p.test(command));
}

export function buildApprovalKey(toolName: string, command: string): string {
  return `${toolName}:${command}`;
}

export const approvalStore = new ApprovalStore();

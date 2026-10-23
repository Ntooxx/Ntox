import type { NtoxAliveBridge } from "../alive/ntox.js";
import { SKILL_INSTALL_USAGE } from "../skills/installer.js";
import { APPROVAL_SCOPES, SCOPE_TO_DECISION, type ApprovalDecision, type ApprovalScope } from "../tools/approval.js";
import type { SkillDefinition } from "../types/index.js";

type AliveSnapshot = ReturnType<NtoxAliveBridge["inspect"]>;

interface GatewayTranscript {
  addMessage(message: { role: "user" | "assistant"; content: string }): void;
}

function compact(value: unknown, max = 80): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const ALIVE_SUBJECT = "\\b(notice|noticed|recent|events?|wake|state)\\b";
const ALIVE_NEAR_SUBJECT = new RegExp(
  `\\balive\\b[\\s\\S]{0,60}${ALIVE_SUBJECT}|${ALIVE_SUBJECT}[\\s\\S]{0,60}\\balive\\b`,
);

export function isAliveQuery(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (normalized === "/alive") return true;
  if (normalized.length > 200) return false;
  return ALIVE_NEAR_SUBJECT.test(normalized);
}

export function renderAliveStatus(snapshot: AliveSnapshot): string {
  const lines = ["NTOX Alive"];

  if (
    snapshot.events.length === 0 &&
    snapshot.pendingActions.length === 0 &&
    snapshot.predictions.length === 0 &&
    snapshot.openLoops.length === 0
  ) {
    return "NTOX Alive\n\nNo recent host events, pending wake actions, predictions, or open loops yet.";
  }

  if (snapshot.pendingActions.length > 0) {
    lines.push("", "Pending wake actions:");
    for (const action of snapshot.pendingActions.slice(0, 5)) {
      lines.push(`- ${action.kind}: ${action.reason}`);
    }
  }

  if (snapshot.events.length > 0) {
    lines.push("", "Recent events:");
    for (const event of snapshot.events.slice(0, 8)) {
      const path = typeof event.payload.path === "string" ? ` ${event.payload.path}` : "";
      const status = typeof event.payload.status === "string" ? ` ${event.payload.status}` : "";
      const nextStep = typeof event.payload.nextStep === "string" ? ` Next: ${event.payload.nextStep}` : "";
      lines.push(`- ${event.type}${status}${path} from ${event.source}.${nextStep}`);
    }
  }

  if (snapshot.openLoops.length > 0) {
    lines.push("", "Open loops:");
    for (const loop of snapshot.openLoops.slice(0, 5)) {
      lines.push(`- ${loop.status}: ${compact(loop.goal)}`);
    }
  }

  if (snapshot.predictions.length > 0) {
    lines.push("", "Predictions:");
    for (const prediction of snapshot.predictions.slice(0, 5)) {
      const error = prediction.predictionError === undefined ? "" : ` error=${prediction.predictionError.toFixed(2)}`;
      lines.push(`- ${prediction.status}${error}: ${compact(prediction.statement)}`);
    }
  }

  return lines.join("\n");
}

export function recordDirectGatewayResponse(agent: GatewayTranscript, userText: string, response: string): void {
  agent.addMessage({ role: "user", content: userText });
  agent.addMessage({ role: "assistant", content: response });
}

export interface PendingApproval {
  command: string;
  prompt: string;
}

export type ApproveParse =
  | { kind: "not-approve" }
  | { kind: "invalid"; message: string }
  | { kind: "approve"; scope: ApprovalScope; command: string | null };

export const APPROVE_USAGE = "Usage: /approve <once|session|always|deny> <command>";

export function parseApproveCommand(text: string): ApproveParse {
  const trimmed = text.trim();
  if (!/^\/approve(\s|$)/i.test(trimmed)) return { kind: "not-approve" };

  const rest = trimmed.replace(/^\/approve\s*/i, "");
  if (!rest) return { kind: "invalid", message: APPROVE_USAGE };

  const splitAt = rest.search(/\s/);
  const scopeToken = (splitAt === -1 ? rest : rest.slice(0, splitAt)).toLowerCase();
  if (!APPROVAL_SCOPES.includes(scopeToken as ApprovalScope)) {
    return { kind: "invalid", message: `Unknown scope "${scopeToken}". ${APPROVE_USAGE}` };
  }

  const command = splitAt === -1 ? "" : rest.slice(splitAt).trim();
  return { kind: "approve", scope: scopeToken as ApprovalScope, command: command || null };
}

export interface ApprovalResolution {
  ok: true;
  scope: ApprovalScope;
  decision: ApprovalDecision;
  command: string;
  retryPrompt: string | null;
}

export type ApprovalOutcome = ApprovalResolution | { ok: false; message: string };

export function resolveApproval(
  scope: ApprovalScope,
  command: string | null,
  pending?: PendingApproval,
): ApprovalOutcome {
  const target = (command ?? pending?.command ?? "").trim();
  if (!target) return { ok: false, message: `Nothing waiting for approval. ${APPROVE_USAGE}` };

  const decision = SCOPE_TO_DECISION[scope];
  const matchesPending = pending !== undefined && pending.command === target;

  return {
    ok: true,
    scope,
    decision,
    command: target,
    retryPrompt: decision === "deny" || !matchesPending ? null : pending.prompt,
  };
}

export function renderApprovalRequest(command: string): string {
  return [
    `Approval required: ${command}`,
    "",
    `Reply: /approve once ${command}`,
    "Scopes: once | session | always | deny",
  ].join("\n");
}

export function renderApprovalRequestInteractive(command: string): string {
  return `Approval required: ${command}\n\nTap a button below, or reply /approve <scope> <command>.`;
}

export const APPROVAL_CALLBACK_PREFIX = "approve:";

export function parseApprovalCallbackData(data: string): ApprovalScope | null {
  if (!data.startsWith(APPROVAL_CALLBACK_PREFIX)) return null;
  const scope = data.slice(APPROVAL_CALLBACK_PREFIX.length).toLowerCase();
  return APPROVAL_SCOPES.includes(scope as ApprovalScope) ? (scope as ApprovalScope) : null;
}

export function renderApprovalOutcome(resolution: ApprovalResolution): string {
  if (resolution.decision === "deny") return `Denied: ${resolution.command}`;
  return `Approved (${resolution.scope}): ${resolution.command}`;
}

export const SKILL_SAVE_NO_PENDING =
  "No skill proposal waiting. After a successful multi-step task Ntox may propose one — then reply /skill save <name>.";

export type SkillSaveParse = { kind: "not-skill-save" } | { kind: "save"; name: string | null };

export function parseSkillSaveCommand(text: string): SkillSaveParse {
  const trimmed = text.trim();
  if (!/^\/skill(\s|$)/i.test(trimmed)) return { kind: "not-skill-save" };
  const rest = trimmed.replace(/^\/skill\s*/i, "");
  const saveMatch = rest.match(/^save\s*(.*)$/i);
  if (!saveMatch) return { kind: "not-skill-save" };
  const name = saveMatch[1].trim().toLowerCase() || null;
  return { kind: "save", name };
}

export type SkillInstallParse =
  | { kind: "not-skill-install" }
  | { kind: "invalid"; message: string }
  | { kind: "install"; source: string; force: boolean };

export type SkillMarketplaceParse = { kind: "not-skill-marketplace" } | { kind: "marketplace"; query: string | null };

export function parseSkillMarketplaceCommand(text: string): SkillMarketplaceParse {
  const trimmed = text.trim();
  if (!/^\/skill(\s|$)/i.test(trimmed)) return { kind: "not-skill-marketplace" };
  const rest = trimmed.replace(/^\/skill\s*/i, "");
  const match = rest.match(/^marketplace(?:\s+([\s\S]*))?$/i);
  if (!match) return { kind: "not-skill-marketplace" };
  const query = (match[1] ?? "").trim();
  return { kind: "marketplace", query: query || null };
}

export type SkillLifecycleParse =
  | { kind: "not-skill-lifecycle" }
  | { kind: "stats" }
  | { kind: "run"; name: string | null }
  | { kind: "diff"; name: string | null; source: string | null }
  | { kind: "export"; name: string | null };

export function parseSkillLifecycleCommand(text: string): SkillLifecycleParse {
  const trimmed = text.trim();
  if (!/^\/skill(\s|$)/i.test(trimmed)) return { kind: "not-skill-lifecycle" };
  const rest = trimmed.replace(/^\/skill\s*/i, "");
  if (/^stats$/i.test(rest)) return { kind: "stats" };

  const run = /^run(?:\s+([\s\S]+))?$/i.exec(rest);
  if (run) return { kind: "run", name: (run[1] ?? "").trim().toLowerCase() || null };

  const diff = /^diff(?:\s+([\s\S]+))?$/i.exec(rest);
  if (diff) {
    const args = (diff[1] ?? "").trim();
    if (!args) return { kind: "diff", name: null, source: null };
    const splitAt = args.search(/\s/);
    const name = (splitAt === -1 ? args : args.slice(0, splitAt)).toLowerCase();
    const source = splitAt === -1 ? null : args.slice(splitAt).trim() || null;
    return { kind: "diff", name, source };
  }

  const exp = /^export(?:\s+([\s\S]+))?$/i.exec(rest);
  if (exp) return { kind: "export", name: (exp[1] ?? "").trim().toLowerCase() || null };

  return { kind: "not-skill-lifecycle" };
}

export function parseSkillInstallCommand(text: string): SkillInstallParse {
  const trimmed = text.trim();
  if (!/^\/skill(\s|$)/i.test(trimmed)) return { kind: "not-skill-install" };
  const rest = trimmed.replace(/^\/skill\s*/i, "");
  const installMatch = rest.match(/^install(?:\s+([\s\S]*))?$/i);
  if (!installMatch) return { kind: "not-skill-install" };
  const args = (installMatch[1] ?? "").trim();
  if (!args) return { kind: "invalid", message: `Missing source. Usage: ${SKILL_INSTALL_USAGE}` };
  const force = /(^|\s)--force(\s|$)/.test(args);
  const source = args.replace(/\s*--force\b/g, "").trim();
  if (!source) return { kind: "invalid", message: `Missing source. Usage: ${SKILL_INSTALL_USAGE}` };
  return { kind: "install", source, force };
}

export type SkillSaveOutcome = { ok: true; skill: SkillDefinition } | { ok: false; message: string };

export function resolveSkillSave(name: string | null, pending?: SkillDefinition): SkillSaveOutcome {
  if (!pending) return { ok: false, message: SKILL_SAVE_NO_PENDING };
  if (name && name !== pending.name.toLowerCase()) {
    return { ok: false, message: `No pending proposal named "${name}". Waiting: ${pending.name}` };
  }
  return { ok: true, skill: pending };
}

export function renderSkillSaveOutcome(skill: SkillDefinition): string {
  return `Skill saved: ${skill.name}\nActivates on: ${skill.triggers.join(", ")}`;
}

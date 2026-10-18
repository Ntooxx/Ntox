import type { NtoxAliveBridge } from "../alive/ntox.js";
import { APPROVAL_SCOPES, SCOPE_TO_DECISION, type ApprovalDecision, type ApprovalScope } from "../tools/approval.js";

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

export function isAliveQuery(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (normalized === "/alive") return true;
  return normalized.includes("alive") && /\b(notice|noticed|recent|events?|wake|state)\b/.test(normalized);
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

export function renderApprovalOutcome(resolution: ApprovalResolution): string {
  if (resolution.decision === "deny") return `Denied: ${resolution.command}`;
  return `Approved (${resolution.scope}): ${resolution.command}`;
}

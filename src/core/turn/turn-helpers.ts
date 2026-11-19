import { loadPlan, type PlanTask } from "../../tools/plan.js";
import type { AgentToolTrace, ToolCall } from "../../types/index.js";

export const RESEARCH_QUESTION_PATTERN =
  /\b(novel(?:ty)?|original(?:ity)?|saturat(?:ed|ion)|prior work|related work|literature|state of the art|research gap|already (?:been )?done|has anyone|anyone (?:working|studying)|contribute to (?:ai|artificial intelligence) research|recent papers?)\b/i;
export const RECOMMENDATION_QUESTION_PATTERN =
  /\b(what should i|what do you recommend|what would you recommend|should i|advise me|personal advice|what to build next|what would you build next|what should we build|next feature|which option|best next step)\b/i;
export const DEFAULT_SYSTEM_CONTEXT_TOKEN_BUDGET = 6000;
export const TOOL_CONCURRENCY = 4;
export const MAX_TOOL_CALLS_PER_RESPONSE = 8;
export const MAX_TOOL_CALLS_PER_TURN = 40;
export const MAX_WEB_TOOL_CALLS_PER_TURN = 8;
export const WEB_TOOL_NAMES = new Set(["search", "web_fetch", "web_read", "browse"]);
export const MAX_ACTION_NUDGES = 2;
export const MAX_TURN_ATTEMPTS = 30;
export const MAX_STREAM_RETRIES = 2;
export const STREAM_RETRY_BACKOFF_MS = 400;
export const MAX_PLAN_CONTINUES = 8;
export const MAX_FAILURE_EXPLAINS = 1;

const LEGACY_TOOL_CALL_BLOCK = /<?\s*\/?\s*tool_call\s*>?\s*(\{[\s\S]*?\})\s*<?\s*\/?\s*tool_call\s*>?/gi;

const ACTION_COMMITMENT_PATTERNS = [
  /\b(creating|building|writing|setting up|putting together|scaffolding|generating|deploying)\b.{0,60}\b(now|sec|moment|second|right away)\b/i,
  /\b(one|just a|gimme a) sec\b/i,
  /\bworking on (it|that|this)\b/i,
  /\bi'?m on it\b/i,
  /\blet me (create|build|write|make|generate|set up|scaffold)\b/i,
  /\bwill (now )?(create|build|write|make|generate|set up)\b/i,
  /\babout to (create|build|write|make|generate)\b/i,
  /\bcreating it now\b/i,
  /\bbuilding it now\b/i,
];

export function commitsToImmediateAction(text: string): boolean {
  if (!text || text.length > 2000) return false;
  return ACTION_COMMITMENT_PATTERNS.some((p) => p.test(text));
}

export function unfinishedPlanTasks(sessionId: string): PlanTask[] {
  try {
    const plan = loadPlan(sessionId);
    if (!plan) return [];
    return plan.tasks.filter((task) => task.status === "pending" || task.status === "in_progress");
  } catch {
    return [];
  }
}

export function collectTurnFailures(
  trace: { toolCalls: AgentToolTrace[] } | null | undefined,
): { name: string; error: string }[] {
  if (!trace) return [];
  const seen = new Set<string>();
  const failures: { name: string; error: string }[] = [];
  for (const call of trace.toolCalls) {
    if (call.success !== false || !call.error || call.reason) continue;
    const key = `${call.name}:${call.error}`;
    if (seen.has(key)) continue;
    seen.add(key);
    failures.push({ name: call.name, error: call.error });
  }
  return failures;
}

const FAILURE_ADDRESS_MARKERS = [
  /\bfail/i,
  /\berror\b/i,
  /could ?n[o']t|couldn'?t/i,
  /can ?n[o']t|can't/i,
  /\bunable\b/i,
  /\bdenied\b/i,
  /\bunavailable\b/i,
  /\bnot available\b/i,
  /\bnot installed\b/i,
  /\bisn'?t installed\b/i,
  /\bno such\b/i,
  /\bnot found\b/i,
  /\bno (app|application)\b/i,
  /\bblocked\b/i,
  /\bmissing\b/i,
  /\bredirect/i,
  /\bbounc/i,
  /\bstore\b/i,
  /\bwrong\b/i,
  /\bdoes ?n[o']t work\b/i,
  /\bno longer\b/i,
  /\bwasn'?t able\b/i,
];

export function responseAddressesFailures(response: string, failures: { name: string; error: string }[]): boolean {
  if (failures.length === 0) return true;
  if (FAILURE_ADDRESS_MARKERS.some((pattern) => pattern.test(response))) return true;
  const lower = response.toLowerCase();
  for (const failure of failures) {
    const words = failure.error
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 5);
    if (words.some((word) => lower.includes(word))) return true;
  }
  return false;
}

export function extractLegacyXmlToolCalls(
  text: string,
  isKnownTool: (name: string) => boolean,
): { calls: ToolCall[]; cleaned: string } {
  const calls: ToolCall[] = [];
  let cleaned = text;
  for (const match of [...text.matchAll(LEGACY_TOOL_CALL_BLOCK)]) {
    const raw = match[1];
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as { name?: unknown; args?: unknown; arguments?: unknown };
      const name = typeof parsed.name === "string" ? parsed.name : "";
      if (!name || !isKnownTool(name)) continue;
      const args = parsed.args ?? parsed.arguments ?? {};
      calls.push({
        id: `xml_${calls.length}_${Date.now().toString(36)}`,
        name,
        arguments: typeof args === "string" ? args : JSON.stringify(args),
      });
      cleaned = cleaned.replace(match[0], "");
    } catch {
      continue;
    }
  }
  return { calls, cleaned: cleaned.trim() };
}

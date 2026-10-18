import type { LLMClient } from "../core/llm.js";
import { extractJsonCandidate } from "../mind/llm-predictor.js";
import { estimateTokens } from "../mind/util.js";

export interface ModelCritique {
  gaps: string[];
  retry: boolean;
}

export interface ModelCritiqueOptions {
  timeoutMs?: number;
  maxOutputTokens?: number;
}

const CRITIQUE_SYSTEM_PROMPT = [
  "You are a strict reviewer of one agent answer. Reply with ONLY a compact JSON object:",
  '{"gaps":["specific missing or wrong part","another gap"],"retry":true}',
  '"retry" must be true ONLY if re-answering would likely produce a materially better answer.',
  "List at most 3 concrete gaps. Never exceed 120 tokens. No prose outside the JSON.",
].join("\n");

export function parseCritique(text: string): ModelCritique | null {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const gaps = Array.isArray(obj.gaps)
    ? obj.gaps
        .filter((g): g is string => typeof g === "string")
        .map((g) => g.trim().slice(0, 200))
        .filter((g) => g.length > 0)
    : [];
  if (typeof obj.retry !== "boolean") return null;
  return { gaps: gaps.slice(0, 3), retry: obj.retry };
}

export async function modelCritique(
  llm: Pick<LLMClient, "stream">,
  input: { query: string; response: string },
  options: ModelCritiqueOptions = {},
): Promise<ModelCritique | null> {
  const timeoutMs = Math.max(200, options.timeoutMs ?? 3_000);
  const maxOutputTokens = Math.max(32, options.maxOutputTokens ?? 120);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let text = "";
  try {
    const stream = llm.stream(
      [
        {
          role: "user",
          content: `QUERY:\n${input.query.slice(0, 1500)}\n\nANSWER:\n${input.response.slice(0, 3000)}`,
        },
      ],
      CRITIQUE_SYSTEM_PROMPT,
      undefined,
      controller.signal,
    );
    for await (const chunk of stream) {
      if (chunk.delta) text += chunk.delta;
      if (estimateTokens(text) >= maxOutputTokens) {
        controller.abort();
        break;
      }
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  return parseCritique(text);
}

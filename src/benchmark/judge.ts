import { LLMClient } from "../core/llm.js";

export interface JudgeScore {
  accuracy: number;
  depth: number;
  completeness: number;
  overall: number;
  reasoning: string;
}

const JUDGE_SYSTEM = `You are an expert evaluator. Score the response on 3 dimensions (1-10 each).

accuracy: Is the answer factually correct? Are there errors?
depth: Does it explain WHY, not just WHAT? Does it go beyond surface-level?
completeness: Does it cover the key aspects of the question? Are important points missing?

Respond with ONLY a JSON object:
{"accuracy": N, "depth": N, "completeness": N, "reasoning": "brief explanation"}`;

const FALLBACK: JudgeScore = { accuracy: 5, depth: 5, completeness: 5, overall: 5, reasoning: "judge failed" };

export async function judgeResponse(
  llm: LLMClient,
  query: string,
  response: string,
): Promise<JudgeScore> {
  try {
    const prompt = `Query: ${query.slice(0, 500)}

Response: ${response.slice(0, 2000)}

Score this response.`;

    const messages = [{ role: "user" as const, content: prompt }];
    let fullText = "";

    const stream = llm.stream(messages, JUDGE_SYSTEM);
    for await (const chunk of stream) {
      if (chunk.delta) fullText += chunk.delta;
    }

    const jsonMatch = fullText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return FALLBACK;

    const parsed = JSON.parse(jsonMatch[0]);
    const accuracy = clamp(parsed.accuracy, 1, 10);
    const depth = clamp(parsed.depth, 1, 10);
    const completeness = clamp(parsed.completeness, 1, 10);
    const overall = Math.round((accuracy + depth + completeness) / 3 * 10) / 10;

    return {
      accuracy,
      depth,
      completeness,
      overall,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 300) : "",
    };
  } catch {
    return FALLBACK;
  }
}

function clamp(val: unknown, min: number, max: number): number {
  const n = typeof val === "number" ? val : 5;
  return Math.max(min, Math.min(max, Math.round(n)));
}

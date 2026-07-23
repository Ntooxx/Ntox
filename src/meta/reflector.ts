import { LLMClient } from "../core/llm.js";
import type { Reflection } from "../types/index.js";

const REFLECTION_SYSTEM = `You are a response quality analyzer. Your only job is to evaluate whether an assistant's response correctly addresses the user's query.

Current date: {DATE}

Rate the response on:
1. Does it directly answer the query?
2. Are facts correct and specific?
3. Is it honest about uncertainty?

Confidence is how well the response answers the query. 0.0 = completely wrong or evasive. 1.0 = perfectly correct and specific. If the assistant searched the web and found a factual answer, confidence should be high (0.8+).`;

const REFLECTION_PROMPT = `Query: {QUERY}
Response: {RESPONSE}

Return ONLY valid JSON (no markdown, no extra text):
{
  "confidence": <0.0-1.0>,
  "addressed": <true/false>,
  "knowledgeGaps": [<topics the response was uncertain about or got wrong>],
  "improvement": "<one-sentence improvement suggestion or 'none'>"
}`;

export class Reflector {
  private llm: LLMClient;
  private enabled: boolean;

  constructor(llm: LLMClient, enabled: boolean) {
    this.llm = llm;
    this.enabled = enabled;
  }

  setEnabled(val: boolean): void {
    this.enabled = val;
  }

  async reflect(query: string, response: string): Promise<Reflection | null> {
    if (!this.enabled) return null;

    const responseLen = response.length;
    if (responseLen < 10) return null;

    // Truncate to avoid excessive token usage
    const truncatedQuery = query.length > 500 ? query.slice(0, 500) + "..." : query;
    const truncatedResp = response.length > 1500 ? response.slice(0, 1500) + "..." : response;

    const prompt = REFLECTION_PROMPT
      .replace("{QUERY}", truncatedQuery)
      .replace("{RESPONSE}", truncatedResp);

    try {
      const result: Reflection = {
        confidence: 0.5,
        addressed: true,
        knowledgeGaps: [],
        improvement: "",
        timestamp: Date.now(),
      };

      // Use a single non-streaming call for reflection
      const messages = [{ role: "user" as const, content: prompt }];
      let fullText = "";

      const systemPrompt = REFLECTION_SYSTEM.replace("{DATE}", new Date().toISOString().slice(0, 10));
      const stream = this.llm.stream(messages, systemPrompt);
      for await (const chunk of stream) {
        if (chunk.delta) fullText += chunk.delta;
      }

      // Parse JSON from the response
      const jsonMatch = fullText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]);
      result.confidence = typeof parsed.confidence === "number" ? parsed.confidence : result.confidence;
      result.addressed = parsed.addressed !== false;
      result.knowledgeGaps = Array.isArray(parsed.knowledgeGaps) ? parsed.knowledgeGaps : [];
      result.improvement = typeof parsed.improvement === "string" ? parsed.improvement : "";

      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[reflector] LLM stream failed:", msg);
      return null;
    }
  }
}

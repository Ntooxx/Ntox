import { describe, expect, it } from "vitest";
import { modelCritique, parseCritique } from "./model-critique.js";

function fakeLLM(chunks: string[] | "hang" | "throw") {
  return {
    async *stream(_m: unknown[], _s?: unknown, _t?: unknown, signal?: AbortSignal) {
      if (chunks === "throw") throw new Error("provider down");
      if (chunks === "hang") {
        await new Promise<void>((_, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        });
        return;
      }
      for (const chunk of chunks) {
        if (signal?.aborted) throw new Error("cancelled");
        yield { delta: chunk };
      }
    },
  };
}

describe("parseCritique", () => {
  it("parses structured gaps and retry decision", () => {
    const result = parseCritique('Result: {"gaps":["missing error handling","no test"],"retry":true} done');
    expect(result).toEqual({ gaps: ["missing error handling", "no test"], retry: true });
  });

  it("caps gaps at three and trims them", () => {
    const result = parseCritique('{"gaps":["a","b","c","d"],"retry":false}');
    expect(result?.gaps).toHaveLength(3);
    expect(result?.retry).toBe(false);
  });

  it("rejects missing retry decision or non-json", () => {
    expect(parseCritique('{"gaps":["x"]}')).toBeNull();
    expect(parseCritique("looks good to me")).toBeNull();
  });
});

describe("modelCritique", () => {
  const input = { query: "fix the parser", response: "the parser is fine" };

  it("returns structured critique from a valid response", async () => {
    const llm = fakeLLM(['{"gaps":["ignores escape sequences"],"retry":true}']);
    const result = await modelCritique(llm, input, { timeoutMs: 200 });
    expect(result).toEqual({ gaps: ["ignores escape sequences"], retry: true });
  });

  it("returns null when the provider throws", async () => {
    expect(await modelCritique(fakeLLM("throw"), input, { timeoutMs: 200 })).toBeNull();
  });

  it("returns null when the provider hangs past the timeout", async () => {
    const start = Date.now();
    const result = await modelCritique(fakeLLM("hang"), input, { timeoutMs: 200 });
    expect(result).toBeNull();
    expect(Date.now() - start).toBeLessThan(2_000);
  });

  it("returns null on unparseable output", async () => {
    expect(await modelCritique(fakeLLM(["no json here"]), input, { timeoutMs: 200 })).toBeNull();
  });
});

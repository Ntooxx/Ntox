import { afterEach, describe, it, expect, vi } from "vitest";
import {
  LLMClient,
  getProviderNames,
  getProviders,
  formatTokenCount,
  formatCost,
  countTokens,
  countMessageTokens,
  providerRequiresKey,
  estimateCost,
  modelSupportsTools,
  warnIfToolsUnsupported,
  LOCAL_PROVIDERS,
  toOpenAIMessages,
} from "./llm.js";
import type { ModelInfo } from "../types/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("countTokens", () => {
  it("counts tokens in text", () => {
    expect(countTokens("")).toBe(0);
    expect(countTokens("hello")).toBeGreaterThan(0);
  });

  it("counts longer text proportionally", () => {
    const short = countTokens("hi");
    const long = countTokens("this is a much longer piece of text with many words");
    expect(long).toBeGreaterThan(short);
  });
});

describe("countMessageTokens", () => {
  it("sums tokens across messages", () => {
    const total = countMessageTokens([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);
    expect(total).toBeGreaterThan(0);
  });

  it("returns 0 for empty array", () => {
    expect(countMessageTokens([])).toBe(0);
  });
});

describe("toOpenAIMessages", () => {
  it("wraps internal tool calls in OpenAI function envelopes", () => {
    const messages = toOpenAIMessages(
      [
        { role: "user", content: "browse this" },
        {
          role: "assistant",
          content: "(tool call)",
          tool_calls: [{ id: "call_1", name: "browse", arguments: '{"url":"https://example.com"}' }],
        },
        { role: "tool", tool_call_id: "call_1", name: "browse", content: '{"success":true}' },
      ],
      "system",
    );

    expect(messages[0]).toEqual({ role: "system", content: "system" });
    expect(messages[2].tool_calls?.[0]).toEqual({
      id: "call_1",
      type: "function",
      function: { name: "browse", arguments: '{"url":"https://example.com"}' },
    });
    expect(messages[3]).toEqual({ role: "tool", content: '{"success":true}', tool_call_id: "call_1" });
  });
});

describe("providerRequiresKey", () => {
  it("openrouter requires key", () => {
    expect(providerRequiresKey("openrouter")).toBe(true);
  });

  it("ollama does not require key", () => {
    expect(providerRequiresKey("ollama")).toBe(false);
  });

  it("lmstudio does not require key", () => {
    expect(providerRequiresKey("lmstudio")).toBe(false);
  });
});

describe("LOCAL_PROVIDERS", () => {
  it("includes ollama and lmstudio", () => {
    expect(LOCAL_PROVIDERS).toContain("ollama");
    expect(LOCAL_PROVIDERS).toContain("lmstudio");
  });
});

describe("estimateCost", () => {
  const models: ModelInfo[] = [
    {
      id: "test-model",
      name: "Test Model",
      provider: "openai",
      pricing: { prompt: 0.5, completion: 1.5 },
      context_length: 4096,
    },
  ];

  it("estimates cost based on pricing", () => {
    const cost = estimateCost("test-model", 1000, 500, models);
    expect(cost).toBeGreaterThan(0);
  });

  it("returns 0 for unknown model", () => {
    const cost = estimateCost("unknown/model", 1000, 500, []);
    expect(cost).toBe(0);
  });
  it("returns 0 for empty model list", () => {
    const cost = estimateCost("test-model", 1000, 500, []);
    expect(cost).toBe(0);
  });

  it("handles zero tokens", () => {
    const cost = estimateCost("test-model", 0, 0, models);
    expect(cost).toBe(0);
  });
});

describe("getProviders", () => {
  it("returns all provider IDs", () => {
    const providers = getProviders();
    expect(providers).toContain("openrouter");
    expect(providers).toContain("openai");
    expect(providers).toContain("anthropic");
    expect(providers).toContain("groq");
    expect(providers).toContain("deepseek");
    expect(providers).toContain("ollama");
    expect(providers).toContain("lmstudio");
  });

  it("includes openai-compatible", () => {
    expect(getProviders()).toContain("openai-compatible");
  });
});

describe("getProviderNames", () => {
  it("returns human-readable names", () => {
    const names = getProviderNames();
    expect(names.openrouter).toBe("OpenRouter");
    expect(names.openai).toBe("OpenAI");
    expect(names.anthropic).toBe("Anthropic");
  });
});

describe("OpenRouter model discovery", () => {
  it("returns only the live OpenRouter catalog and normalizes its metadata", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "zeta/model",
              name: "Zeta",
              context_length: 200000,
              pricing: { prompt: "0.2", completion: "0.4" },
              supported_parameters: ["tools", "reasoning"],
            },
            {
              id: "alpha/model",
              name: "Alpha",
              context_length: 128000,
              pricing: { prompt: "0", completion: "0" },
              supported_parameters: ["temperature"],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const client = new LLMClient("key", "alpha/model", "openai/text-embedding-3-small", 1024, 0.7);

    const models = await client.fetchModels();

    expect(fetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({ headers: { Authorization: "Bearer key" } }),
    );
    expect(models.map((model) => model.id)).toEqual(["alpha/model", "zeta/model"]);
    expect(models[0]).toMatchObject({
      provider: "openrouter",
      pricing: { prompt: 0, completion: 0 },
      context_length: 128000,
      supported_parameters: ["temperature"],
    });
    expect(modelSupportsTools(models[0])).toBe(false);
    expect(modelSupportsTools(models[1])).toBe(true);
  });
});

describe("modelSupportsTools", () => {
  it("returns null when capability metadata is missing", () => {
    expect(modelSupportsTools(undefined)).toBeNull();
    expect(modelSupportsTools(null)).toBeNull();
    expect(modelSupportsTools({})).toBeNull();
    expect(modelSupportsTools({ supported_parameters: [] })).toBeNull();
  });

  it("returns false only when tools are explicitly absent", () => {
    expect(modelSupportsTools({ supported_parameters: ["temperature", "reasoning"] })).toBe(false);
    expect(modelSupportsTools({ supported_parameters: ["tools"] })).toBe(true);
  });
});

describe("warnIfToolsUnsupported", () => {
  it("warns when the selected model explicitly lacks tools", () => {
    const models = [
      { id: "vendor/no-tools", supported_parameters: ["temperature"] } as ModelInfo,
      { id: "vendor/with-tools", supported_parameters: ["tools"] } as ModelInfo,
    ];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(warnIfToolsUnsupported(models, "vendor/no-tools")).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain("does not advertise tool support");
    expect(warnIfToolsUnsupported(models, "vendor/with-tools")).toBe(false);
    expect(warnIfToolsUnsupported(models, "vendor/with-tools", "[test]")).toBe(false);
    expect(warnIfToolsUnsupported([], "unknown/model")).toBe(false);
    spy.mockRestore();
  });
});

describe("formatTokenCount", () => {
  it("formats small numbers", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(500)).toBe("500");
    expect(formatTokenCount(999)).toBe("999");
  });

  it("formats thousands", () => {
    expect(formatTokenCount(1000)).toBe("1.0k");
    expect(formatTokenCount(1500)).toBe("1.5k");
    expect(formatTokenCount(12345)).toBe("12.3k");
  });
});

describe("formatCost", () => {
  it("formats zero", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("formats small costs", () => {
    expect(formatCost(0.0001)).toBe("$0.00");
    expect(formatCost(0.001)).toBe("$0.0010");
    expect(formatCost(0.005)).toBe("$0.0050");
  });

  it("formats normal costs", () => {
    expect(formatCost(0.01)).toBe("$0.010");
    expect(formatCost(0.15)).toBe("$0.150");
    expect(formatCost(1.5)).toBe("$1.500");
  });
});

describe("LLMClient.stream (Ollama)", () => {
  function ollamaChunkLine(payload: Record<string, unknown>): string {
    return JSON.stringify(payload);
  }

  function streamResponse(lines: string[]): Response {
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(lines.join("\n") + "\n"));
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
    );
  }

  const tools: {
    type: "function";
    function: { name: string; description: string; parameters: { type: string; properties: Record<string, never> } };
  }[] = [
    {
      type: "function",
      function: {
        name: "read",
        description: "Read a file",
        parameters: { type: "object", properties: {} },
      },
    },
  ];

  it("parses tool calls from the Ollama stream", async () => {
    const fetch = vi.fn().mockResolvedValue(
      streamResponse([
        ollamaChunkLine({ model: "llama3", message: { role: "assistant", content: "" }, done: false }),
        ollamaChunkLine({
          model: "llama3",
          message: { role: "assistant", tool_calls: [{ index: 0, function: { name: "read", arguments: '{"path":' } }] },
          done: false,
        }),
        ollamaChunkLine({
          model: "llama3",
          message: { role: "assistant", tool_calls: [{ index: 0, function: { arguments: '"test.txt"}' } }] },
          done: false,
        }),
        ollamaChunkLine({ model: "llama3", message: { role: "assistant", content: "Done." }, done: true }),
      ]),
    );
    vi.stubGlobal("fetch", fetch);
    const client = new LLMClient("", "ollama/llama3", "openai/text-embedding-3-small", 1024, 0.7);

    const chunks: { delta: string; toolCalls?: { id: string; name: string; arguments: string }[] }[] = [];
    for await (const chunk of client.stream([{ role: "user", content: "read test.txt" }], undefined, tools)) {
      chunks.push(chunk as { delta: string; toolCalls?: { id: string; name: string; arguments: string }[] });
    }

    const toolCallChunk = chunks.find((c) => c.toolCalls && c.toolCalls.length > 0);
    expect(toolCallChunk).toBeDefined();
    expect(toolCallChunk?.toolCalls?.[0]).toEqual({
      id: "call_0",
      name: "read",
      arguments: '{"path":"test.txt"}',
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/chat",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("still streams plain content when no tools are called", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        streamResponse([
          ollamaChunkLine({ model: "llama3", message: { role: "assistant", content: "Hello " }, done: false }),
          ollamaChunkLine({ model: "llama3", message: { role: "assistant", content: "world" }, done: true }),
        ]),
      );
    vi.stubGlobal("fetch", fetch);
    const client = new LLMClient("", "ollama/llama3", "openai/text-embedding-3-small", 1024, 0.7);

    let text = "";
    for await (const chunk of client.stream([{ role: "user", content: "hi" }])) {
      text += chunk.delta;
    }

    expect(text).toBe("Hello world");
  });
});

describe("LLMClient.stream (Anthropic)", () => {
  function sseResponse(lines: string[]): Response {
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(lines.join("\n") + "\n"));
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  const tools = [
    {
      type: "function" as const,
      function: {
        name: "read",
        description: "Read a file",
        parameters: { type: "object", properties: {}, required: [] as string[] },
      },
    },
  ];

  it("accumulates tool arguments from index-based input_json_delta events", async () => {
    const fetch = vi.fn().mockResolvedValue(
      sseResponse([
        `data: ${JSON.stringify({
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_1", name: "read" },
        })}`,
        `data: ${JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"path":' },
        })}`,
        `data: ${JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '"test.txt"}' },
        })}`,
        `data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}`,
        `data: ${JSON.stringify({ type: "message_delta", delta: {}, usage: { output_tokens: 5 } })}`,
      ]),
    );
    vi.stubGlobal("fetch", fetch);
    const client = new LLMClient(
      "key",
      "anthropic/claude-3",
      "openai/text-embedding-3-small",
      1024,
      0.7,
      "",
      "anthropic",
    );

    const chunks: { delta: string; toolCalls?: { id: string; name: string; arguments: string }[] }[] = [];
    for await (const chunk of client.stream([{ role: "user", content: "read test" }], "sys", tools)) {
      chunks.push(chunk as { delta: string; toolCalls?: { id: string; name: string; arguments: string }[] });
    }

    const toolCallChunk = chunks.find((c) => c.toolCalls && c.toolCalls.length > 0);
    expect(toolCallChunk).toBeDefined();
    expect(toolCallChunk?.toolCalls?.[0]).toEqual({
      id: "toolu_1",
      name: "read",
      arguments: '{"path":"test.txt"}',
    });
  });

  it("merges consecutive tool results into one user message and preserves assistant text with tool_use", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return Promise.resolve(
        sseResponse([
          `data: ${JSON.stringify({
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          })}`,
          `data: ${JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "ok" },
          })}`,
          `data: ${JSON.stringify({ type: "message_stop" })}`,
        ]),
      );
    });
    vi.stubGlobal("fetch", fetch);
    const client = new LLMClient(
      "key",
      "anthropic/claude-3",
      "openai/text-embedding-3-small",
      1024,
      0.7,
      "",
      "anthropic",
    );

    const messages = [
      { role: "user" as const, content: "do stuff" },
      {
        role: "assistant" as const,
        content: "checking two files",
        tool_calls: [
          { id: "call_1", name: "read", arguments: '{"path":"a"}' },
          { id: "call_2", name: "read", arguments: '{"path":"b"}' },
        ],
      },
      { role: "tool" as const, tool_call_id: "call_1", content: "A" },
      { role: "tool" as const, tool_call_id: "call_2", content: "B" },
    ];

    for await (const _chunk of client.stream(messages, undefined, tools)) {
      void _chunk;
    }

    expect(requestBody).toBeDefined();
    const outMessages = requestBody!.messages as {
      role: string;
      content: unknown;
    }[];
    expect(outMessages).toHaveLength(3);

    const assistant = outMessages[1];
    expect(assistant.role).toBe("assistant");
    expect(Array.isArray(assistant.content)).toBe(true);
    const assistantBlocks = assistant.content as { type: string; text?: string }[];
    expect(assistantBlocks[0]).toEqual({ type: "text", text: "checking two files" });
    expect(assistantBlocks.filter((b) => b.type === "tool_use")).toHaveLength(2);

    const toolResults = outMessages[2];
    expect(toolResults.role).toBe("user");
    expect(Array.isArray(toolResults.content)).toBe(true);
    const resultBlocks = toolResults.content as { type: string; tool_use_id: string }[];
    expect(resultBlocks).toHaveLength(2);
    expect(resultBlocks.map((b) => b.tool_use_id)).toEqual(["call_1", "call_2"]);
  });
});

describe("LLMClient.stream (OpenAI-compatible reasoning)", () => {
  function sse(lines: string[]): Response {
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(lines.join("\n") + "\n"));
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  const line = (delta: Record<string, unknown>) => `data: ${JSON.stringify({ choices: [{ delta }] })}`;

  it("yields reasoning deltas as thinking, not as visible content", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          sse([
            line({ role: "assistant", reasoning: "planning the " }),
            line({ reasoning: "approach first" }),
            line({ content: "Here is the result." }),
          ]),
        ),
    );
    const client = new LLMClient("key", "openrouter/mimo", "openai/text-embedding-3-small", 4096, 0.7);

    const chunks: { delta: string; thinking?: string }[] = [];
    for await (const chunk of client.stream([{ role: "user", content: "go" }])) {
      chunks.push(chunk);
    }

    const thinking = chunks.filter((c) => c.thinking).map((c) => c.thinking);
    expect(thinking.join("")).toBe("planning the approach first");

    const visible = chunks
      .filter((c) => c.delta)
      .map((c) => c.delta)
      .join("");
    expect(visible).toBe("Here is the result.");
    expect(visible).not.toContain("planning");
  });

  it("uses updated output token and temperature settings on the next request", async () => {
    const fetch = vi.fn().mockResolvedValue(sse([line({ content: "done" })]));
    vi.stubGlobal("fetch", fetch);
    const client = new LLMClient("key", "openrouter/mimo", "openai/text-embedding-3-small", 4096, 0.7);
    client.updateParams(64000, 0.3);

    for await (const _chunk of client.stream([{ role: "user", content: "continue" }])) {
      void _chunk;
    }

    const body = JSON.parse(String(fetch.mock.calls[0][1].body)) as Record<string, unknown>;
    expect(body.max_tokens).toBe(64000);
    expect(body.temperature).toBe(0.3);
  });

  it("stops reading a provider response after eight tool calls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sse([
          line({
            tool_calls: Array.from({ length: 40 }, (_, index) => ({
              index,
              id: `call_${index}`,
              function: { name: "web_read", arguments: JSON.stringify({ url: `https://example.com/${index}` }) },
            })),
          }),
          "data: [DONE]",
        ]),
      ),
    );
    const client = new LLMClient("key", "openrouter/mimo", "openai/text-embedding-3-small", 150000, 0.7);
    const chunks: {
      delta: string;
      toolCalls?: { id: string; name: string; arguments: string }[];
      toolCallLimitReached?: boolean;
    }[] = [];

    for await (const chunk of client.stream([{ role: "user", content: "read pages" }])) chunks.push(chunk);

    expect(chunks.flatMap((chunk) => chunk.toolCalls ?? [])).toHaveLength(8);
    expect(chunks.some((chunk) => chunk.toolCallLimitReached)).toBe(true);
  });

  it("does not throw EmptyResponseError for a reasoning-only turn", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          sse([line({ reasoning: "thinking hard about this" }), line({ reasoning: "still thinking" })]),
        ),
    );
    const client = new LLMClient("key", "openrouter/mimo", "openai/text-embedding-3-small", 4096, 0.7);

    const chunks: { delta: string; thinking?: string }[] = [];
    for await (const chunk of client.stream([{ role: "user", content: "go" }])) {
      chunks.push(chunk);
    }

    expect(chunks.filter((c) => c.thinking)).toHaveLength(2);
    expect(chunks.filter((c) => c.delta)).toHaveLength(0);
  });
});

describe("LLMClient.updateKey", () => {
  it("sends the new key on subsequent requests without a restart", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ embedding: [0.1] }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const client = new LLMClient("old-key", "openrouter/model", "openrouter/text-embedding-3-small", 1024, 0.7);

    await client.embed("first");
    const firstAuth = (fetch.mock.calls[0][1].headers as Record<string, string>).Authorization;

    client.updateKey("new-key");
    await client.embed("second");
    const secondAuth = (fetch.mock.calls[1][1].headers as Record<string, string>).Authorization;

    expect(firstAuth).toBe("Bearer old-key");
    expect(secondAuth).toBe("Bearer new-key");
    expect(firstAuth).not.toBe(secondAuth);
  });
});

describe("LLMClient.embed", () => {
  it("returns embeddings from the endpoint", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const client = new LLMClient("key", "openrouter/model", "openrouter/text-embedding-3-small", 1024, 0.7);

    const result = await client.embed("hello world");

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("embedWithMeta tags the producing model", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ embedding: [0.4, 0.5] }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const client = new LLMClient("key", "openrouter/model", "openrouter/text-embedding-3-small", 1024, 0.7);

    const meta = await client.embedWithMeta("tagged query");
    expect(meta?.vector).toEqual([0.4, 0.5]);
    expect(meta?.model).toBe("remote:openrouter/openrouter/text-embedding-3-small");
  });

  it("embedWithMeta tags local fallback as local-hash", async () => {
    vi.stubEnv("NTOX_EMBED_BUDGET_MS", "5000");
    const fetch = vi.fn().mockResolvedValue(new Response("server error", { status: 500 }));
    vi.stubGlobal("fetch", fetch);
    const client = new LLMClient("key", "openrouter/model", "openrouter/text-embedding-3-small", 1024, 0.7);

    const meta = await client.embedWithMeta("fallback query");
    expect(meta?.model).toBe("local-hash");
    expect(meta?.vector.length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it("caches embeddings so repeat queries skip the network", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ embedding: [0.5, 0.6] }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const client = new LLMClient("key", "openrouter/model", "openrouter/text-embedding-3-small", 1024, 0.7);

    await client.embed("repeat me");
    const second = await client.embed("repeat me");

    expect(second).toEqual([0.5, 0.6]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns null instead of blocking when the endpoint exceeds the budget", async () => {
    vi.stubEnv("NTOX_EMBED_BUDGET_MS", "300");
    const hang = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    vi.stubGlobal("fetch", vi.fn(hang));
    const client = new LLMClient("key", "openrouter/model", "openrouter/text-embedding-3-small", 1024, 0.7);

    const started = Date.now();
    const result = await client.embed("slow endpoint");

    expect(result).toBeNull();
    expect(Date.now() - started).toBeLessThan(2500);
    vi.unstubAllGlobals();
  });
});

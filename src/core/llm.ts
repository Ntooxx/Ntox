import type { Message, ModelInfo, CostUsage, ToolCall } from "../types/index.js";
import type { OpenAITool } from "../tools/registry.js";
import { localEmbed } from "./local-embed.js";
import { encode } from "gpt-tokenizer";
import {
  ApiError, StreamError, NetworkError, TimeoutError,
  EmptyResponseError, ConfigError, isRetryableError,
} from "./errors.js";
import { StreamLineParser } from "./stream-parser.js";

export function countTokens(text: string): number {
  return encode(text).length;
}

export function countMessageTokens(messages: Message[]): number {
  return messages.reduce((s, m) => s + countTokens(m.content), 0);
}

interface ProviderConfig {
  name: string;
  chatUrl: string | null;
  embedUrl: string | null;
  modelsUrl: string | null;
  headers: (apiKey: string) => Record<string, string>;
  format: "openai" | "anthropic" | "ollama" | "google";
  apiKeyRequired: boolean;
}

const PROVIDERS: Record<string, ProviderConfig> = {
  openrouter: {
    name: "OpenRouter",
    chatUrl: "https://openrouter.ai/api/v1/chat/completions",
    embedUrl: "https://openrouter.ai/api/v1/embeddings",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    headers: (key) => ({
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://ntox.ai",
      "X-Title": "Ntox Agent",
    }),
    format: "openai",
    apiKeyRequired: true,
  },
  openai: {
    name: "OpenAI",
    chatUrl: "https://api.openai.com/v1/chat/completions",
    embedUrl: "https://api.openai.com/v1/embeddings",
    modelsUrl: "https://api.openai.com/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    format: "openai",
    apiKeyRequired: true,
  },
  groq: {
    name: "Groq",
    chatUrl: "https://api.groq.com/openai/v1/chat/completions",
    embedUrl: null,
    modelsUrl: "https://api.groq.com/openai/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    format: "openai",
    apiKeyRequired: true,
  },
  deepseek: {
    name: "DeepSeek",
    chatUrl: "https://api.deepseek.com/v1/chat/completions",
    embedUrl: null,
    modelsUrl: null,
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    format: "openai",
    apiKeyRequired: true,
  },
  together: {
    name: "Together AI",
    chatUrl: "https://api.together.xyz/v1/chat/completions",
    embedUrl: null,
    modelsUrl: null,
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    format: "openai",
    apiKeyRequired: true,
  },
  mistral: {
    name: "Mistral AI",
    chatUrl: "https://api.mistral.ai/v1/chat/completions",
    embedUrl: null,
    modelsUrl: null,
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    format: "openai",
    apiKeyRequired: true,
  },
  anthropic: {
    name: "Anthropic",
    chatUrl: "https://api.anthropic.com/v1/messages",
    embedUrl: null,
    modelsUrl: null,
    headers: (key) => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    }),
    format: "anthropic",
    apiKeyRequired: true,
  },
  "openai-compatible": {
    name: "OpenAI Compatible",
    chatUrl: null,
    embedUrl: null,
    modelsUrl: null,
    headers: (key) => {
      const h: Record<string, string> = {};
      if (key) h.Authorization = `Bearer ${key}`;
      return h;
    },
    format: "openai",
    apiKeyRequired: false,
  },
  ollama: {
    name: "Ollama",
    chatUrl: "http://localhost:11434/api/chat",
    embedUrl: "http://localhost:11434/api/embeddings",
    modelsUrl: "http://localhost:11434/api/tags",
    headers: () => ({}),
    format: "ollama",
    apiKeyRequired: false,
  },
  lmstudio: {
    name: "LM Studio",
    chatUrl: "http://localhost:1234/v1/chat/completions",
    embedUrl: "http://localhost:1234/v1/embeddings",
    modelsUrl: "http://localhost:1234/v1/models",
    headers: () => ({}),
    format: "openai",
    apiKeyRequired: false,
  },
};

const PROVIDER_LIST = Object.keys(PROVIDERS);

function stripPrefix(modelId: string, provider: string): string {
  if (modelId.startsWith(provider + "/")) {
    return modelId.slice(provider.length + 1);
  }
  return modelId;
}

function getProviderConfig(provider: string): ProviderConfig | undefined {
  return PROVIDERS[provider];
}

const FETCH_TIMEOUT = 120000;
const EMBED_TIMEOUT = 10000;

function resolveProvider(configuredProvider: string, modelId: string): string {
  // Model prefix overrides configured provider for local providers
  const LOCAL = ["ollama", "lmstudio"];
  for (const p of LOCAL) {
    if (modelId.startsWith(p + "/")) return p;
  }
  if (configuredProvider && PROVIDERS[configuredProvider]) return configuredProvider;
  for (const p of PROVIDER_LIST) {
    if (modelId.startsWith(p + "/")) return p;
  }
  return "openrouter";
}

async function* streamOpenAICompatible(
  baseUrl: string,
  messages: Message[],
  system: string | undefined,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  client: LLMClient
): AsyncGenerator<{ delta: string; usage?: CostUsage; toolCalls?: ToolCall[] }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("abort") || msg.includes("AbortError")) {
      throw new TimeoutError(`Request timed out after ${FETCH_TIMEOUT / 1000}s — the model may be overloaded or unavailable`);
    }
    throw new NetworkError(`Network error reaching ${baseUrl}: ${msg}`);
  }
  clearTimeout(timeout);

  if (!res.ok) {
    let hint = "";
    if (res.status === 401) hint = " — Check your API key (/config) and provider settings (/provider)";
    if (res.status === 402) hint = " — Insufficient credits. Check your plan.";
    if (res.status === 429) hint = " — Rate limited. Waiting before retry.";
    if (res.status === 404) hint = " — Model not found. Check /model for available models.";
    if (res.status === 400) hint = " — Bad request. The model may not support the requested parameters.";
    if (res.status === 502 || res.status === 503) hint = " — Provider temporarily unavailable. Try again in a moment.";
    const errBody = await res.text();
    const snippet = errBody.length > 200 ? errBody.slice(0, 197) + "..." : errBody;
    throw new ApiError(`API error ${res.status}${hint}: ${snippet}`, res.status, "openai");
  }

  const reader = res.body?.getReader();
  if (!reader) throw new ApiError("No response body — the API returned an empty response", 0, "openai");

  let yieldedAnyContent = false;
  let yieldedUsage = false;
  const toolCallAccumulator = new Map<number, { id: string; name: string; args: string }>();

  for await (const line of StreamLineParser.readLines(reader)) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6);
    if (data === "[DONE]") {
      for (const [, tc] of toolCallAccumulator) {
        if (tc.name) {
          yield { delta: "", toolCalls: [{ id: tc.id, name: tc.name, arguments: tc.args }] };
        }
      }
      return;
    }

    try {
      const parsed = JSON.parse(data) as {
        error?: { message?: string; code?: string | number };
        choices?: { delta: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
        usage?: { prompt_tokens: number; completion_tokens: number };
      };

      if (parsed.error) {
        const code = parsed.error.code ? `[${parsed.error.code}] ` : "";
        throw new StreamError(`Stream error ${code}${parsed.error.message || "unknown error"}`, parsed.error.code);
      }

      const delta = parsed.choices?.[0]?.delta;
      const deltaCalls = delta?.tool_calls;

      if (deltaCalls) {
        for (const tc of deltaCalls) {
          const acc = toolCallAccumulator.get(tc.index) || { id: "", name: "", args: "" };
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.args += tc.function.arguments;
          toolCallAccumulator.set(tc.index, acc);
        }
      }

      const content = delta?.content;
      if (content) {
        yieldedAnyContent = true;
        client.outputTokens += Math.ceil(content.split(/\s+/).length * 1.3);
        yield { delta: content };
      }

      if (parsed.usage) {
        yieldedUsage = true;
        yield {
          delta: "",
          usage: {
            inputTokens: parsed.usage.prompt_tokens,
            outputTokens: parsed.usage.completion_tokens,
            cost: 0,
          },
        };
      }
    } catch (e) {
      if (e instanceof StreamError) throw e;
    }
  }

  if (!yieldedAnyContent && !yieldedUsage) {
    throw new EmptyResponseError(
      "Model returned no content — the API may not recognize this model. " +
      `Verify the model is available on this provider (model: "${body.model}").`
    );
  }
}

async function* streamAnthropic(
  messages: Message[],
  system: string | undefined,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  client: LLMClient
): AsyncGenerator<{ delta: string; usage?: CostUsage; toolCalls?: ToolCall[] }> {
  const anthropicBody: Record<string, unknown> = {
    model: body.model,
    max_tokens: body.max_tokens || 4096,
    stream: true,
    messages: messages.map((m) => {
      const msg: Record<string, unknown> = { role: m.role === "assistant" ? "assistant" : "user" };
      if (m.content) msg.content = m.content;
      if (m.tool_calls && m.role === "assistant") {
        msg.content = m.tool_calls.map((tc) => ({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: JSON.parse(tc.arguments || "{}"),
        }));
      }
      if (m.role === "tool") {
        msg.role = "user";
        msg.content = [{ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content }];
      }
      return msg;
    }),
  };
  if (system) anthropicBody.system = system;

  const tools = body.tools as OpenAITool[] | undefined;
  if (tools && tools.length > 0) {
    anthropicBody.tools = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify(anthropicBody),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("abort") || msg.includes("AbortError")) {
      throw new TimeoutError(`Anthropic request timed out after ${FETCH_TIMEOUT / 1000}s`);
    }
    throw new NetworkError(`Network error reaching Anthropic: ${msg}`);
  }
  clearTimeout(timeout);

  if (!res.ok) {
    let hint = "";
    if (res.status === 401) hint = " — Check your API key (/config)";
    if (res.status === 402) hint = " — Insufficient credits";
    if (res.status === 429) hint = " — Rate limited. Wait before retry.";
    if (res.status === 404) hint = " — Model not found";
    if (res.status === 400) hint = " — Bad request. Model may not support these parameters.";
    if (res.status === 502 || res.status === 503) hint = " — Provider temporarily unavailable";
    const errBody = await res.text();
    const snippet = errBody.length > 200 ? errBody.slice(0, 197) + "..." : errBody;
    throw new ApiError(`Anthropic error ${res.status}${hint}: ${snippet}`, res.status, "anthropic");
  }

  const reader = res.body?.getReader();
  if (!reader) throw new ApiError("Anthropic returned no response body", 0, "anthropic");

  let yieldedAnyContent = false;
  const toolUseAcc = new Map<string, { id: string; name: string; args: string }>();

  for await (const line of StreamLineParser.readLines(reader)) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6);
    try {
      const parsed = JSON.parse(data) as {
        type?: string;
        delta?: { text?: string; type?: string; partial_json?: string };
        content_block?: { type?: string; id?: string; name?: string; text?: string };
        error?: { message?: string; type?: string };
        message?: { usage?: { input_tokens: number; output_tokens: number } };
      };

      if (parsed.type === "error" && parsed.error) {
        throw new StreamError(`Anthropic stream error [${parsed.error.type || "unknown"}]: ${parsed.error.message || "stream error"}`, parsed.error.type);
      }

      if (parsed.type === "content_block_start" && parsed.content_block?.type === "tool_use") {
        const id = parsed.content_block.id || "";
        const name = parsed.content_block.name || "";
        toolUseAcc.set(id, { id, name, args: "" });
      }

      if (parsed.type === "content_block_delta" && parsed.delta?.type === "input_json_delta") {
        const block = parsed.content_block;
        const delta = parsed.delta;
        if (block && delta.partial_json) {
          const acc = toolUseAcc.get(String(block.id || ""));
          if (acc) acc.args += delta.partial_json;
        }
      }

      if (parsed.type === "content_block_delta" && parsed.delta?.text) {
        yieldedAnyContent = true;
        client.outputTokens += parsed.delta.text.length / 4;
        yield { delta: parsed.delta.text };
      }

      if (parsed.type === "message_delta" && parsed.delta?.text) {
        yieldedAnyContent = true;
        client.outputTokens += parsed.delta.text.length / 4;
        yield { delta: parsed.delta.text };
      }
    } catch (e) {
      if (e instanceof StreamError) throw e;
    }
  }

  if (toolUseAcc.size > 0) {
    const toolCalls: ToolCall[] = [];
    for (const [, acc] of toolUseAcc) {
      if (acc.name) toolCalls.push({ id: acc.id, name: acc.name, arguments: acc.args });
    }
    if (toolCalls.length > 0) {
      yield { delta: "", toolCalls };
    }
  }

  if (!yieldedAnyContent && toolUseAcc.size === 0) {
    throw new EmptyResponseError(
      `Anthropic returned no content — model "${body.model}" may not be available or the request was rejected silently.`
    );
  }
}

async function* streamOllama(
  messages: Message[],
  system: string | undefined,
  body: Record<string, unknown>,
  _client: LLMClient
): AsyncGenerator<{ delta: string; usage?: CostUsage }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  let res: Response;
  try {
    res = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: body.model,
        messages: system ? [{ role: "system", content: system }, ...messages] : messages,
        stream: true,
        options: { num_predict: body.max_tokens, temperature: body.temperature },
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("abort") || msg.includes("AbortError")) {
      throw new TimeoutError(`Ollama request timed out after ${FETCH_TIMEOUT / 1000}s — is the model loaded?`);
    }
    throw new NetworkError(`Ollama connection failed — is Ollama running? (${msg})`);
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const errBody = await res.text();
    throw new ApiError(`Ollama error ${res.status}: ${errBody}`, res.status, "ollama");
  }

  const reader = res.body?.getReader();
  if (!reader) throw new ApiError("Ollama returned no response body", 0, "ollama");

  let yieldedAnyContent = false;

  for await (const line of StreamLineParser.readLines(reader)) {
    try {
      const parsed = JSON.parse(line) as {
        message?: { content: string };
        error?: string;
        done: boolean;
      };
      if (parsed.error) {
        throw new StreamError(`Ollama stream error: ${parsed.error}`);
      }
      if (parsed.message?.content) {
        yieldedAnyContent = true;
        _client.outputTokens += parsed.message.content.length / 4;
        yield { delta: parsed.message.content };
      }
    } catch (e) {
      if (e instanceof StreamError) throw e;
    }
  }

  if (!yieldedAnyContent) {
    throw new EmptyResponseError(
      `Ollama returned no content — model "${body.model}" may not be pulled. Run: ollama pull ${body.model}`
    );
  }
}

export async function detectLocalProviders(): Promise<{
  ollama: boolean;
  lmstudio: boolean;
  ollamaModels: ModelInfo[];
  lmstudioModels: ModelInfo[];
}> {
  const result = { ollama: false, lmstudio: false, ollamaModels: [] as ModelInfo[], lmstudioModels: [] as ModelInfo[] };

  try {
    const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      result.ollama = true;
      const body = (await res.json()) as { models: { name: string }[] };
      result.ollamaModels = (body.models || []).map((m) => ({
        id: `ollama/${m.name}`,
        name: m.name,
        provider: "ollama",
        pricing: { prompt: 0, completion: 0 },
        context_length: 8192,
      }));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("abort") && !msg.includes("timeout") && !msg.includes("ECONNREFUSED")) {
      console.error("[llm] Ollama local check failed:", msg);
    }
  }

  try {
    const res = await fetch("http://localhost:1234/v1/models", { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      result.lmstudio = true;
      const body = (await res.json()) as { data: { id: string }[] };
      result.lmstudioModels = (body.data || []).map((m) => ({
        id: `lmstudio/${m.id}`,
        name: m.id,
        provider: "lmstudio",
        pricing: { prompt: 0, completion: 0 },
        context_length: 8192,
      }));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("abort") && !msg.includes("timeout") && !msg.includes("ECONNREFUSED")) {
      console.error("[llm] LM Studio local check failed:", msg);
    }
  }

  return result;
}

export class LLMClient {
  private apiKey: string;
  private modelId: string;
  private embeddingModelId: string;
  private maxTokens: number;
  private temperature: number;
  private apiBaseUrl: string;
  private configuredProvider: string;
  private embedCache = new Map<string, number[]>();

  inputTokens = 0;
  outputTokens = 0;
  embeddingTokens = 0;

  constructor(
    apiKey: string,
    modelId: string,
    embeddingModelId: string,
    maxTokens: number,
    temperature: number,
    apiBaseUrl: string = "",
    configuredProvider: string = ""
  ) {
    this.apiKey = apiKey;
    this.modelId = modelId;
    this.embeddingModelId = embeddingModelId;
    this.maxTokens = maxTokens;
    this.temperature = temperature;
    this.apiBaseUrl = apiBaseUrl;
    this.configuredProvider = configuredProvider;
  }

  updateModel(modelId: string): void { this.modelId = modelId; }
  updateProvider(provider: string): void { this.configuredProvider = provider; }
  updateEmbeddingModel(modelId: string): void { this.embeddingModelId = modelId; }
  updateParams(maxTokens: number, temperature: number): void { this.maxTokens = maxTokens; this.temperature = temperature; }

  getProvider(): string {
    return resolveProvider(this.configuredProvider, this.modelId);
  }

  private getProviderInfo(): ProviderConfig {
    const provider = this.getProvider();
    return getProviderConfig(provider) || PROVIDERS.openrouter;
  }

  async embed(text: string): Promise<number[]> {
    const cached = this.embedCache.get(text);
    if (cached) return cached;

    const provider = this.getProvider();
    const info = this.getProviderInfo();

    const primary = await this.tryEmbed(provider, info, text, this.embeddingModelId);
    if (primary) { this.embedCache.set(text, primary); return primary; }

    if (this.embeddingModelId !== "openai/text-embedding-ada-002" && this.apiKey) {
      console.error(`[embed] primary model failed, trying fallback: openai/text-embedding-ada-002`);
      const fallback = await this.tryEmbed(provider, info, text, "openai/text-embedding-ada-002");
      if (fallback) { this.embedCache.set(text, fallback); return fallback; }
    }

    console.error("[embed] API embedding unavailable, using local fallback");
    const local = localEmbed(text);
    if (this.embedCache.size > 100) {
      const first = this.embedCache.keys().next().value;
      if (first) this.embedCache.delete(first);
    }
    this.embedCache.set(text, local);
    return local;
  }

  private async tryEmbed(provider: string, info: ProviderConfig, text: string, modelId: string): Promise<number[] | null> {
    const embedModel = stripPrefix(modelId, provider);

    if (provider === "ollama") {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT);
      try {
        const res = await fetch("http://localhost:11434/api/embeddings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: embedModel, prompt: text }),
          signal: controller.signal,
        });
        if (res.ok) {
          const body = (await res.json()) as { embedding: number[] };
          if (body.embedding?.length) return body.embedding;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("abort")) console.error("[embed] ollama failed:", msg);
      } finally {
        clearTimeout(timeout);
      }
      return null;
    }

    if (info.format === "openai") {
      const embedUrl = info.embedUrl;
      if (embedUrl) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT);
        try {
          const res = await fetch(embedUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...info.headers(this.apiKey) },
            body: JSON.stringify({ model: embedModel, input: text }),
            signal: controller.signal,
          });
          if (res.ok) {
            const body = (await res.json()) as { data: { embedding: number[] }[]; usage?: { prompt_tokens: number } };
            if (body.data?.[0]?.embedding?.length) return body.data[0].embedding;
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!msg.includes("abort")) console.error(`[embed] ${provider} failed:`, msg);
        } finally {
          clearTimeout(timeout);
        }
        return null;
      }
    }

    if (this.apiKey) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT);
      try {
        const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "HTTP-Referer": "https://ntox.ai",
            "X-Title": "Ntox Agent",
          },
          body: JSON.stringify({ model: modelId, input: text }),
          signal: controller.signal,
        });
        if (res.ok) {
          const body = (await res.json()) as { data: { embedding: number[] }[]; usage?: { prompt_tokens: number } };
          if (body.usage?.prompt_tokens) this.embeddingTokens += body.usage.prompt_tokens;
          if (body.data?.[0]?.embedding?.length) return body.data[0].embedding;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("abort")) console.error("[embed] openrouter failed:", msg);
      } finally {
        clearTimeout(timeout);
      }
      return null;
    }

    return null;
  }

  async fetchModels(): Promise<ModelInfo[]> {
    const local = await detectLocalProviders();
    const openRouterModels = await this.fetchOpenRouterModels();
    return [...openRouterModels, ...local.ollamaModels, ...local.lmstudioModels]
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async fetchOpenRouterModels(): Promise<ModelInfo[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          console.error("[llm] OpenRouter auth failed — check your API key (/config)");
        } else {
          console.error(`[llm] OpenRouter models fetch returned ${res.status}`);
        }
        return [];
      }
      const body = (await res.json()) as { data: ModelInfo[] };
      return body.data.map((m) => ({
        ...m,
        pricing: {
          prompt: Number(m.pricing?.prompt ?? 0),
          completion: Number(m.pricing?.completion ?? 0),
        },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("abort") && !msg.includes("AbortError")) {
        console.error(`[llm] OpenRouter models fetch failed: ${msg}`);
      }
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  async *stream(messages: Message[], system?: string, tools?: OpenAITool[]): AsyncGenerator<{ delta: string; usage?: CostUsage; toolCalls?: ToolCall[] }> {
    const provider = this.getProvider();
    const info = this.getProviderInfo();
    const rawModel = stripPrefix(this.modelId, provider);

    const body: Record<string, unknown> = {
      model: rawModel,
      messages: system ? [{ role: "system", content: system }, ...messages] : messages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      stream: true,
    };

    if (info.format === "openai") {
      body.stream_options = { include_usage: true };
    }

    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const MAX_RETRIES = 3;
    let lastError: Error | null = null;
    let yieldedAny = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const inner = this.streamInner(provider, info, messages, system, body);
        for await (const chunk of inner) {
          yieldedAny = true;
          yield chunk;
        }
        return;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (yieldedAny) throw lastError;
        if (attempt === MAX_RETRIES) break;
        if (isRetryableError(lastError)) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        break;
      }
    }

    // Enrich the final error with provider/model context
    const enriched = new Error(
      `[${info.name}/${rawModel}] ${lastError?.message || "Unknown error"}`
    );
    throw enriched;
  }

  private async *streamInner(
    provider: string,
    info: ProviderConfig,
    messages: Message[],
    system: string | undefined,
    body: Record<string, unknown>
  ): AsyncGenerator<{ delta: string; usage?: CostUsage; toolCalls?: ToolCall[] }> {
    if (provider === "ollama") {
      yield* streamOllama(messages, system, body, this);
      return;
    }

    if (info.format === "anthropic") {
      yield* streamAnthropic(messages, system, body, info.headers(this.apiKey), this);
      return;
    }

    if (info.format === "openai") {
      const baseUrl = this.apiBaseUrl || info.chatUrl?.replace("/chat/completions", "") || "";
      if (!baseUrl) throw new ConfigError(`No API base URL configured for ${provider}`);
      yield* streamOpenAICompatible(baseUrl, messages, system, body, info.headers(this.apiKey), this);
      return;
    }

    throw new ConfigError(`Unsupported provider format: ${info.format}`);
  }

  resetSessionTokens(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.embeddingTokens = 0;
  }
}

export function getProviders(): string[] {
  return PROVIDER_LIST;
}

export function getProviderNames(): Record<string, string> {
  const names: Record<string, string> = {};
  for (const [key, config] of Object.entries(PROVIDERS)) {
    names[key] = config.name;
  }
  return names;
}

export function providerRequiresKey(provider: string): boolean {
  const config = PROVIDERS[provider];
  return config ? config.apiKeyRequired : true;
}

export const LOCAL_PROVIDERS = ["ollama", "lmstudio"];

export function estimateCost(modelId: string, inputTokens: number, outputTokens: number, models: ModelInfo[]): number {
  const model = models.find((m) => m.id === modelId);
  if (!model) return 0;
  return (inputTokens / 1000) * model.pricing.prompt + (outputTokens / 1000) * model.pricing.completion;
}

export function formatTokenCount(n: number): string {
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}

export function formatCost(cost: number): string {
  if (cost < 0.001) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

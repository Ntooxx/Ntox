import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGroqStt,
  createLocalAudio,
  createOpenAiAudio,
  resolveAudioProviders,
  ttsInstructionsFromProfile,
} from "./index.js";
import type { AudioConfig } from "./types.js";

const base: AudioConfig = {
  apiKey: "llm-key",
  sttProvider: "openai",
  sttModel: "gpt-4o-mini-transcribe",
  ttsProvider: "openai",
  ttsModel: "tts-1",
  ttsVoice: "nova",
  ttsStyle: "profile",
  audioBaseUrl: "",
  sttApiKey: "",
  ttsApiKey: "",
};

function audioResponse(text = "hello"): Response {
  return new Response(JSON.stringify({ text }), { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GROQ_API_KEY;
  delete process.env.NTOX_LOCAL_STT_URL;
  delete process.env.NTOX_LOCAL_TTS_URL;
});

describe("audio provider isolation", () => {
  it("uses the TTS key and model instead of the LLM key", async () => {
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAiAudio({ ...base, ttsApiKey: "audio-key", ttsModel: "gpt-4o-mini-tts" });
    const result = await provider.synthesize("ciao", { instructions: "be brief" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.openai.com/v1/audio/speech");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer audio-key");
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "gpt-4o-mini-tts", instructions: "be brief" });
    expect(result.voice).toBe("nova");
  });

  it("honours a custom audio base URL", async () => {
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ text: "ok" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAiAudio({ ...base, sttApiKey: "audio-key", audioBaseUrl: "http://127.0.0.1:9000/v1/" });
    await provider.transcribe(new Uint8Array([1]), { filename: "audio.webm" });
    expect(String(fetchMock.mock.calls[0]![0])).toBe("http://127.0.0.1:9000/v1/audio/transcriptions");
  });

  it("uses the Groq key for STT", async () => {
    process.env.GROQ_API_KEY = "groq-key";
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => audioResponse("trascritto"));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createGroqStt(base);
    const result = await provider.transcribe(new Uint8Array([1]));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("api.groq.com");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer groq-key");
    expect(result.text).toBe("trascritto");
  });

  it("calls a local endpoint without credentials", async () => {
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(new Uint8Array([7]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = createLocalAudio({ ...base, audioBaseUrl: "http://127.0.0.1:8080" });
    const result = await provider.synthesize("ciao", { format: "wav" });
    expect(String(fetchMock.mock.calls[0]![0])).toBe("http://127.0.0.1:8080/audio/speech");
    expect(result.mimeType).toBe("audio/wav");
  });

  it("resolves providers from config", () => {
    const providers = resolveAudioProviders({ ...base, sttProvider: "local", ttsProvider: "openrouter" });
    expect(providers.stt).toBeDefined();
    expect(providers.tts).toBeDefined();
  });
});

describe("identity voice", () => {
  it("maps directness and verbosity into TTS instructions", () => {
    const blunt = ttsInstructionsFromProfile({ directness: 0.9, verbosity: 0.1 });
    const gentle = ttsInstructionsFromProfile({ directness: 0.2, verbosity: 0.9 });
    expect(blunt).toContain("straight to the point");
    expect(gentle).toContain("brief acknowledgements");
    expect(blunt).not.toBe(gentle);
  });
});

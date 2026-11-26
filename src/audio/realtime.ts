import WebSocket from "ws";
import type { AudioConfig } from "./types.js";

export interface RealtimeSocket {
  send(data: string): void;
  close(): void;
  on(event: string, listener: (...args: any[]) => void): void;
}

export type RealtimeSocketFactory = (url: string) => RealtimeSocket;

export interface RealtimeSessionOptions {
  model?: string;
  voice?: string;
  instructions?: string;
  baseUrl?: string;
  apiKey?: string;
  socketFactory?: RealtimeSocketFactory;
}

export interface RealtimeSession {
  ready: Promise<void>;
  sendAudio(bytes: Uint8Array): void;
  commitAudio(): void;
  requestResponse(): void;
  interrupt(): void;
  close(): void;
  onAudio(listener: (bytes: Uint8Array) => void): void;
  onTranscript(listener: (text: string) => void): void;
}

function defaultSocketFactory(url: string, apiKey: string): RealtimeSocket {
  const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  return {
    send: (data) => socket.send(data),
    close: () => socket.close(),
    on: (event, listener) => socket.on(event, listener),
  };
}

export function createRealtimeSession(config: AudioConfig, options: RealtimeSessionOptions = {}): RealtimeSession {
  const apiKey = options.apiKey || config.apiKey;
  if (!apiKey) throw new Error("Realtime audio requires an API key.");
  const base = (options.baseUrl || "wss://api.openai.com/v1/realtime").replace(/\/$/, "");
  const model = options.model || "gpt-4o-realtime-preview";
  const url = `${base}?model=${encodeURIComponent(model)}`;
  const factory = options.socketFactory ?? ((target: string) => defaultSocketFactory(target, apiKey));
  const socket = factory(url);

  const audioListeners: ((bytes: Uint8Array) => void)[] = [];
  const transcriptListeners: ((text: string) => void)[] = [];
  const ready = new Promise<void>((resolve, reject) => {
    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          type: "session.update",
          session: {
            model,
            voice: options.voice || config.ttsVoice,
            instructions: options.instructions,
            input_audio_transcription: { model: "whisper-1" },
          },
        }),
      );
      resolve();
    });
    socket.on("error", reject);
    socket.on("message", (raw: unknown) => {
      const event = JSON.parse(String(raw)) as {
        type?: string;
        delta?: string;
        audio?: string;
        transcript?: string;
      };
      if (event.type === "response.audio.delta" && event.delta) {
        const bytes = new Uint8Array(Buffer.from(event.delta, "base64"));
        for (const listener of audioListeners) listener(bytes);
      }
      if (
        (event.type === "response.audio_transcript.delta" ||
          event.type === "conversation.item.input_audio_transcription.delta") &&
        event.delta
      ) {
        for (const listener of transcriptListeners) listener(event.delta);
      }
    });
  });

  return {
    ready,
    sendAudio(bytes) {
      socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: Buffer.from(bytes).toString("base64") }));
    },
    commitAudio() {
      socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    },
    requestResponse() {
      socket.send(JSON.stringify({ type: "response.create" }));
    },
    interrupt() {
      socket.send(JSON.stringify({ type: "response.cancel" }));
    },
    close() {
      socket.close();
    },
    onAudio(listener) {
      audioListeners.push(listener);
    },
    onTranscript(listener) {
      transcriptListeners.push(listener);
    },
  };
}

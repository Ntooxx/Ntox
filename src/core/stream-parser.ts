import { TimeoutError } from "./errors.js";

export interface StreamReadOptions {
  idleTimeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_IDLE_TIMEOUT_MS = 90000;

export class StreamLineParser {
  static async *readLines(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    options: StreamReadOptions = {},
  ): AsyncGenerator<string> {
    const decoder = new TextDecoder();
    let buffer = "";
    const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    const signal = options.signal;

    const readOnce = async (): Promise<{ done: boolean; value?: Uint8Array }> => {
      const read = reader.read();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;

      const guards: Promise<never>[] = [];
      if (idleTimeoutMs > 0) {
        guards.push(
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new TimeoutError(
                    `No data from the model for ${(idleTimeoutMs / 1000).toFixed(0)}s — the stream stalled and the turn was aborted`,
                  ),
                ),
              idleTimeoutMs,
            );
          }),
        );
      }
      if (signal) {
        guards.push(
          new Promise<never>((_, reject) => {
            if (signal.aborted) return reject(new Error("cancelled"));
            onAbort = () => reject(new Error("cancelled"));
            signal.addEventListener("abort", onAbort, { once: true });
          }),
        );
      }

      try {
        if (guards.length === 0) return await read;
        return await Promise.race([read, ...guards]);
      } finally {
        if (timer) clearTimeout(timer);
        if (onAbort) signal?.removeEventListener("abort", onAbort);
      }
    };

    try {
      while (true) {
        let result: { done: boolean; value?: Uint8Array };
        try {
          result = await readOnce();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          try {
            await reader.cancel().catch(() => undefined);
          } catch {
            /* ignore */
          }
          if (e instanceof TimeoutError) throw e;
          if (msg.includes("cancelled")) throw new Error("cancelled", { cause: e });
          throw e;
        }
        const { done, value } = result;
        if (done) {
          if (buffer.trim()) yield buffer.trim();
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) yield trimmed;
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
  }
}

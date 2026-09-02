import { describe, expect, it } from "vitest";
import { StreamLineParser } from "./stream-parser.js";
import { TimeoutError } from "./errors.js";

function stalledStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start() {},
  });
}

describe("StreamLineParser.readLines", () => {
  it("yields lines split across streamed chunks", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: hi\n"));
        controller.enqueue(new TextEncoder().encode("data: there"));
        controller.enqueue(new TextEncoder().encode("\n"));
        controller.close();
      },
    });
    const lines: string[] = [];
    for await (const line of StreamLineParser.readLines(stream.getReader())) {
      lines.push(line);
    }
    expect(lines).toEqual(["data: hi", "data: there"]);
  });

  it("rejects with TimeoutError when the stream stalls", async () => {
    const iterator = StreamLineParser.readLines(stalledStream().getReader(), { idleTimeoutMs: 30 });
    await expect(iterator.next()).rejects.toBeInstanceOf(TimeoutError);
  });

  it("rejects with cancelled when the supplied signal aborts mid-stream", async () => {
    const reader = stalledStream().getReader();
    const controller = new AbortController();
    const iterator = StreamLineParser.readLines(reader, { idleTimeoutMs: 5000, signal: controller.signal });
    const pending = iterator.next();
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
  });

  it("does not timeout when data keeps flowing", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: one\n"));
      },
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("data: flowing\n"));
      },
      cancel() {},
    });
    const iterator = StreamLineParser.readLines(stream.getReader(), { idleTimeoutMs: 20 });
    const first = await iterator.next();
    expect(first.value).toBe("data: one");
    await iterator.return(undefined);
  });
});

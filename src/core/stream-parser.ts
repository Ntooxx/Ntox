export class StreamLineParser {
  static async *readLines(
    reader: ReadableStreamDefaultReader<Uint8Array>
  ): AsyncGenerator<string> {
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
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
      reader.releaseLock();
    }
  }
}

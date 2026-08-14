import { describe, expect, it } from "vitest";
import { ChatRenderer } from "./chat-renderer.js";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function makeStream(columns = 80): NodeJS.WriteStream {
  const chunks: string[] = [];
  return {
    columns,
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
    output: () => chunks.join(""),
  } as unknown as NodeJS.WriteStream;
}

describe("ChatRenderer", () => {
  it("streams normal prose through the line writer", () => {
    const stream = makeStream();
    const renderer = new ChatRenderer(stream, "| ");
    renderer.startLine();
    renderer.write("hello world");
    renderer.flush();
    expect(stripAnsi((stream as unknown as { output: () => string }).output())).toBe("| hello world");
  });

  it("renders fenced code blocks with a gutter", () => {
    const stream = makeStream();
    const renderer = new ChatRenderer(stream, "| ");
    renderer.startLine();
    renderer.write("```ts\nconst user_id = 1;\n```\nDone");
    renderer.flush();
    const out = stripAnsi((stream as unknown as { output: () => string }).output());
    expect(out).toContain("| ┌");
    expect(out).toContain("ts");
    expect(out).toContain("| │ const user_id = 1;");
    expect(out).toContain("│");
    expect(out).toContain("| └ ─");
    expect(out).toContain("| Done");
  });

  it("renders headings without markdown hashes", () => {
    const stream = makeStream();
    const renderer = new ChatRenderer(stream, "| ");
    renderer.startLine();
    renderer.write("## Result\nBody");
    renderer.flush();
    expect(stripAnsi((stream as unknown as { output: () => string }).output())).toContain("| Result\n| Body");
  });

  it("closes open code blocks before tags", () => {
    const stream = makeStream();
    const renderer = new ChatRenderer(stream, "| ");
    renderer.startLine();
    renderer.write("```js\nconst x = 1;");
    renderer.writeTag("\n- tool done");
    renderer.flush();
    const out = stripAnsi((stream as unknown as { output: () => string }).output());
    expect(out).toContain("| │ const x = 1;");
    expect(out).toContain("| └ ─");
    expect(out).toContain("- tool done");
  });
});

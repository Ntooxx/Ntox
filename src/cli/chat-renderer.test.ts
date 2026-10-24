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

  it("keeps prose after a tag on a fresh line instead of gluing words", () => {
    const stream = makeStream();
    const renderer = new ChatRenderer(stream, "| ");
    renderer.startLine();
    renderer.write("Checking current state:");
    renderer.writeTag("\n· tool: read_file done (0.2s)");
    renderer.write("The job exists, but nothing constructs an engine.");
    renderer.flush();
    const out = stripAnsi((stream as unknown as { output: () => string }).output());
    expect(out).toContain("· tool: read_file done (0.2s)\n");
    expect(out).toContain("\n| The job exists");
    expect(out).not.toContain("done (0.2s)The");
  });

  it("wraps long code lines instead of truncating them", () => {
    const stream = makeStream(80);
    const renderer = new ChatRenderer(stream, "| ");
    renderer.startLine();
    const line =
      "const result = await someVeryLongFunctionName(argumentOne, argumentTwo, argumentThree, argumentFour);";
    renderer.write("```ts\n" + line + "\n```\nDone");
    renderer.flush();
    const out = stripAnsi((stream as unknown as { output: () => string }).output());
    expect(out).not.toContain("…");
    const rows = out
      .split("\n")
      .filter((l) => l.startsWith("| │ "))
      .map((l) => l.slice(4, l.length - 2).trimEnd());
    expect(rows.join("")).toBe(line);
  });
});

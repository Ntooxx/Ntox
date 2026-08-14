import { describe, expect, it } from "vitest";
import { LineWriter } from "./line-writer.js";

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

describe("LineWriter", () => {
  it("preserves underscores in code identifiers", () => {
    const stream = makeStream();
    const writer = new LineWriter(stream, "");
    writer.write("const user_id = get_user_id();");
    writer.flush();
    expect((stream as unknown as { output: () => string }).output()).toBe("const user_id = get_user_id();");
  });

  it("preserves markdown markers instead of mutating code-like text", () => {
    const stream = makeStream();
    const writer = new LineWriter(stream, "");
    writer.write("**bold** _name_");
    writer.flush();
    expect((stream as unknown as { output: () => string }).output()).toBe("**bold** _name_");
  });

  it("prefixes indented lines", () => {
    const stream = makeStream();
    const writer = new LineWriter(stream, "| ");
    writer.startLine();
    writer.write("code\n  indented");
    writer.flush();
    expect((stream as unknown as { output: () => string }).output()).toBe("| code\n|   indented");
  });
});

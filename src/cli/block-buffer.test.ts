import { describe, expect, it } from "vitest";
import { BlockBuffer } from "./block-buffer.js";

describe("BlockBuffer", () => {
  it("flushes on natural boundaries after the minimum size", () => {
    const chunks: string[] = [];
    const buffer = new BlockBuffer((text) => chunks.push(text), 5, 100, 10_000);
    buffer.write("hello");
    expect(chunks).toEqual([]);
    buffer.write(" ");
    expect(chunks).toEqual(["hello "]);
  });

  it("flushes immediately at max size", () => {
    const chunks: string[] = [];
    const buffer = new BlockBuffer((text) => chunks.push(text), 50, 6, 10_000);
    buffer.write("abcdef");
    expect(chunks).toEqual(["abcdef"]);
  });
});

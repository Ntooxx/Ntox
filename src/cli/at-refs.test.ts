import { describe, expect, it } from "vitest";
import { processAtReferences } from "./at-refs.js";

describe("processAtReferences", () => {
  it("blocks local URLs", async () => {
    const result = await processAtReferences("read @http://127.0.0.1:3000");
    expect(result).toContain("[Error:");
    expect(result).toContain("127.0.0.1");
  });

  it("inlines missing file errors", async () => {
    const result = await processAtReferences("read @./definitely-missing-file.txt");
    expect(result).toContain("[Error: Path not found:");
  });
});

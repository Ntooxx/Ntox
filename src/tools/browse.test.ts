import { describe, it, expect } from "vitest";
import { browseTool } from "./browse.js";

describe("browseTool URL validation", () => {
  it("blocks localhost before launching browser", async () => {
    const r = await browseTool.execute({ url: "http://localhost:3000", action: "snapshot" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Blocked host");
  });

  it("blocks private network URLs before launching browser", async () => {
    const r = await browseTool.execute({ url: "http://192.168.1.1", action: "snapshot" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Blocked host");
  });
});

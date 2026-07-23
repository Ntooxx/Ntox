import { describe, it, expect } from "vitest";
import { webFetchTool } from "./web.js";

describe("webFetchTool — URL validation", () => {
  it("blocks file:// protocol", async () => {
    const r = await webFetchTool.execute({ url: "file:///etc/passwd" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Blocked protocol");
  });

  it("blocks localhost", async () => {
    const r = await webFetchTool.execute({ url: "http://localhost:8080/admin" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Blocked host");
  });

  it("blocks 127.0.0.1", async () => {
    const r = await webFetchTool.execute({ url: "http://127.0.0.1:3000" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Blocked host");
  });

  it("blocks private 10.x range", async () => {
    const r = await webFetchTool.execute({ url: "http://10.0.0.1/api" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Blocked host");
  });

  it("blocks 192.168.x range", async () => {
    const r = await webFetchTool.execute({ url: "http://192.168.1.1" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Blocked host");
  });

  it("blocks 169.254.x range", async () => {
    const r = await webFetchTool.execute({ url: "http://169.254.169.254/latest/meta-data/" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Blocked host");
  });

  it("blocks 0.0.0.0", async () => {
    const r = await webFetchTool.execute({ url: "http://0.0.0.0:8000" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Blocked host");
  });

  it("blocks data: URLs", async () => {
    const r = await webFetchTool.execute({ url: "data:text/html,<script>alert(1)</script>" });
    expect(r.success).toBe(false);
  });

  it("rejects invalid URLs", async () => {
    const r = await webFetchTool.execute({ url: "not-a-url" });
    expect(r.success).toBe(false);
  });

  it("rejects excessively long URLs", async () => {
    const longUrl = "https://example.com/" + "x".repeat(5000);
    const r = await webFetchTool.execute({ url: longUrl });
    expect(r.success).toBe(false);
    expect(r.error).toContain("maximum length");
  });
});

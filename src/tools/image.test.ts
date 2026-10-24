import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveImageUrl } from "./image.js";

const root = join(tmpdir(), `ntox-image-tool-${Date.now()}`);
mkdirSync(root, { recursive: true });
const pngPath = join(root, "shot.png");
const jpgPath = join(root, "photo.jpeg");
const missingPath = join(root, "gone.png");
writeFileSync(pngPath, "png-bytes");
writeFileSync(jpgPath, "jpeg-bytes");

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveImageUrl", () => {
  it("passes http and data URLs through untouched", () => {
    expect(resolveImageUrl("https://example.com/pic.png")).toEqual({ url: "https://example.com/pic.png" });
    expect(resolveImageUrl("http://example.com/pic.png")).toEqual({ url: "http://example.com/pic.png" });
    expect(resolveImageUrl("data:image/png;base64,AAAA")).toEqual({ url: "data:image/png;base64,AAAA" });
  });

  it("wraps raw base64 as a png data URL", () => {
    expect(resolveImageUrl("iVBORw0KGgo")).toEqual({ url: "data:image/png;base64,iVBORw0KGgo" });
  });

  it("reads a local png into a data URL", () => {
    const resolved = resolveImageUrl(pngPath);
    expect("url" in resolved).toBe(true);
    if ("url" in resolved) {
      expect(resolved.url.startsWith("data:image/png;base64,")).toBe(true);
      expect(resolved.url).toContain(Buffer.from("png-bytes").toString("base64"));
    }
  });

  it("maps jpeg extensions to the right mime", () => {
    const resolved = resolveImageUrl(jpgPath);
    expect("url" in resolved && resolved.url.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("reports missing image files instead of sending garbage base64", () => {
    const resolved = resolveImageUrl(missingPath);
    expect("error" in resolved).toBe(true);
    if ("error" in resolved) expect(resolved.error).toContain("Cannot read image file");
  });

  it("rejects image files over the 20MB vision limit", () => {
    const bigPath = join(root, "big.png");
    writeFileSync(bigPath, Buffer.alloc(20 * 1024 * 1024 + 1));
    const resolved = resolveImageUrl(bigPath);
    rmSync(bigPath, { force: true });
    expect("error" in resolved).toBe(true);
    if ("error" in resolved) expect(resolved.error).toContain("too large");
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { MEDIA_DIR, decodeDataUrl, imageAttachmentNote, saveDataUrlImage, saveMediaFile } from "./media.js";

beforeEach(() => {
  mkdirSync(MEDIA_DIR, { recursive: true });
  for (const name of readdirSync(MEDIA_DIR)) rmSync(join(MEDIA_DIR, name), { force: true });
});

describe("saveMediaFile", () => {
  it("writes bytes under the media directory with a mime-derived extension", () => {
    const path = saveMediaFile(Buffer.from("jpeg-bytes"), "image/jpeg");

    expect(path.startsWith(MEDIA_DIR)).toBe(true);
    expect(path.endsWith(".jpg")).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe("jpeg-bytes");
    expect(existsSync(path)).toBe(true);
  });

  it("handles mime parameters and unknown types", () => {
    expect(saveMediaFile(Buffer.from("x"), "image/png; charset=binary").endsWith(".png")).toBe(true);
    expect(saveMediaFile(Buffer.from("x"), "application/x-mystery").endsWith(".bin")).toBe(true);
  });

  it("prunes the directory back to the 50 newest files", () => {
    for (let i = 0; i < 55; i++) saveMediaFile(Buffer.from(`payload-${i}`), "image/png");
    const count = readdirSync(MEDIA_DIR).filter((name) => name.startsWith("media_")).length;
    expect(count).toBeLessThanOrEqual(50);
    expect(count).toBeGreaterThanOrEqual(49);
  });
});

describe("decodeDataUrl", () => {
  it("decodes base64 payloads with their mime type", () => {
    const decoded = decodeDataUrl(`data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`);
    expect(decoded).toEqual({ bytes: Buffer.from("png-bytes"), mimeType: "image/png" });
  });

  it("decodes percent-encoded payloads as utf-8", () => {
    const decoded = decodeDataUrl("data:text/plain;charset=utf-8,hello%20world");
    expect(decoded?.mimeType).toBe("text/plain");
    expect(decoded?.bytes.toString("utf-8")).toBe("hello world");
  });

  it("returns null for input that is not a data URL", () => {
    expect(decodeDataUrl("https://example.com/x.png")).toBeNull();
    expect(decodeDataUrl("just text")).toBeNull();
    expect(decodeDataUrl("")).toBeNull();
  });
});

describe("saveDataUrlImage", () => {
  it("persists an image data URL into the media directory", () => {
    const path = saveDataUrlImage(`data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`);
    expect(path).toBeTruthy();
    expect(path!.startsWith(MEDIA_DIR)).toBe(true);
    expect(path!.endsWith(".png")).toBe(true);
    expect(readFileSync(path!, "utf-8")).toBe("png-bytes");
    rmSync(path!, { force: true });
  });

  it("refuses non-image payloads and garbage", () => {
    expect(saveDataUrlImage("data:text/plain;base64,aGk=")).toBeNull();
    expect(saveDataUrlImage("not a data url")).toBeNull();
  });
});

describe("imageAttachmentNote", () => {
  it("builds an instruction with the saved path", () => {
    const note = imageAttachmentNote("/tmp/media_1.png");
    expect(note).toContain("[Attached image: /tmp/media_1.png");
    expect(note).toContain("image tool");
    expect(note).not.toContain("undefined");
  });

  it("keeps the caption in front of the note", () => {
    const note = imageAttachmentNote("/tmp/media_1.png", "what is this?");
    expect(note.startsWith("what is this?")).toBe(true);
    expect(note).toContain("[Attached image:");
  });

  it("drops empty captions instead of printing them", () => {
    const note = imageAttachmentNote("/tmp/media_1.png", "   ");
    expect(note.startsWith("[Attached image:")).toBe(true);
  });
});

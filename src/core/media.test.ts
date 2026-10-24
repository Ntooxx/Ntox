import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { MEDIA_DIR, imageAttachmentNote, saveMediaFile } from "./media.js";

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

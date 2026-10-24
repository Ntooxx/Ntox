import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NTOX_DIR } from "./config.js";

export const MEDIA_DIR = join(NTOX_DIR, "media");
const MAX_MEDIA_FILES = 50;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "application/pdf": "pdf",
  "text/plain": "txt",
};

export function saveMediaFile(bytes: Buffer, mimeType: string): string {
  if (!existsSync(MEDIA_DIR)) mkdirSync(MEDIA_DIR, { recursive: true });
  const ext = EXT_BY_MIME[mimeType.split(";")[0].trim().toLowerCase()] || "bin";
  const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const path = join(MEDIA_DIR, `media_${unique}.${ext}`);
  writeFileSync(path, bytes);
  pruneMedia();
  return path;
}

function pruneMedia(): void {
  try {
    const files = readdirSync(MEDIA_DIR)
      .map((name) => ({ path: join(MEDIA_DIR, name), mtime: statSync(join(MEDIA_DIR, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const stale of files.slice(MAX_MEDIA_FILES)) unlinkSync(stale.path);
  } catch {
    /* best effort */
  }
}

export function imageAttachmentNote(path: string, caption?: string): string {
  const note = `[Attached image: ${path} — analyze it with the image tool (it accepts this local path), or answer directly if no analysis is needed.]`;
  const clean = caption?.trim();
  return clean ? `${clean}\n\n${note}` : note;
}

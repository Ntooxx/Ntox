import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

export interface WorldFact {
  path: string;
  exists: boolean;
  isFile: boolean;
  isDir: boolean;
  size: number;
  content?: string;
}

export class FileSystemWorldModel {
  private basePath: string;

  constructor(basePath: string) {
    if (!existsSync(basePath)) throw new Error(`Base path does not exist: ${basePath}`);
    if (!statSync(basePath).isDirectory()) throw new Error(`Base path must be a directory: ${basePath}`);
    this.basePath = resolve(basePath);
  }

  safeJoin(...segments: string[]): string | null {
    const resolved = resolve(this.basePath, ...segments);
    if (!resolved.startsWith(this.basePath)) return null;
    return resolved;
  }

  getFileFact(...segments: string[]): WorldFact | null {
    const path = this.safeJoin(...segments);
    if (!path) return null;
    try {
      if (existsSync(path) && statSync(path).isFile()) {
        return {
          path,
          exists: true,
          isFile: true,
          isDir: false,
          size: statSync(path).size,
          content: readFileSync(path, "utf-8"),
        };
      }
    } catch { /* not accessible */ }
    return { path, exists: false, isFile: false, isDir: false, size: 0 };
  }

  getDirFact(...segments: string[]): WorldFact | null {
    const path = this.safeJoin(...segments);
    if (!path) return null;
    try {
      if (existsSync(path) && statSync(path).isDirectory()) {
        return {
          path,
          exists: true,
          isFile: false,
          isDir: true,
          size: 0,
        };
      }
    } catch { /* not accessible */ }
    return { path, exists: false, isFile: false, isDir: false, size: 0 };
  }

  getExtraFact(key: string): unknown {
    return (this as Record<string, unknown>)[`_extra_${key}`];
  }

  setExtraFact(key: string, value: unknown): void {
    (this as Record<string, unknown>)[`_extra_${key}`] = value;
  }

  unsetExtraFact(key: string): void {
    delete (this as Record<string, unknown>)[`_extra_${key}`];
  }
}

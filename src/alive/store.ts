import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AliveState, AliveStore } from "./engine.js";

export class InMemoryAliveStore implements AliveStore {
  private state: AliveState | null = null;

  load(): AliveState | null {
    return this.state ? structuredClone(this.state) : null;
  }

  save(state: AliveState): void {
    this.state = structuredClone(state);
  }
}

export class JsonFileAliveStore implements AliveStore {
  constructor(private readonly filePath: string) {}

  load(): AliveState | null {
    if (!existsSync(this.filePath)) return null;
    try {
      const state = JSON.parse(readFileSync(this.filePath, "utf8")) as AliveState;
      if (!Array.isArray(state.events) || !Array.isArray(state.predictions) || !Array.isArray(state.openLoops))
        return null;
      return state;
    } catch {
      return null;
    }
  }

  save(state: AliveState): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(temporaryPath, this.filePath);
  }
}

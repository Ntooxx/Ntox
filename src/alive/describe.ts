import type { AliveEvent } from "./engine.js";

function shortText(value: unknown, max = 120): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function describeAliveEvent(event: AliveEvent): string | null {
  const payload = event.payload;
  const changedFiles = typeof payload.changedFiles === "number" ? payload.changedFiles : undefined;
  switch (event.type) {
    case "git_commit": {
      const head = shortText(payload.head, 7);
      const files = changedFiles === undefined ? "" : ` (${changedFiles} file${changedFiles === 1 ? "" : "s"})`;
      return `Git: new commit ${head}${files}`;
    }
    case "git_state_changed":
      return `Git: working tree now has ${changedFiles ?? 0} changed file${changedFiles === 1 ? "" : "s"}`;
    case "file_changed": {
      const change = shortText(payload.change, 20);
      return `Workspace: ${shortText(payload.path)}${change ? ` (${change})` : ""}`;
    }
    case "tool_succeeded":
    case "tool_failed":
    case "process_exited":
    case "test_finished": {
      const tool = shortText(payload.toolName) || event.type;
      const status = shortText(payload.status) || (event.type === "tool_failed" ? "failed" : "finished");
      const error = shortText(payload.error, 100);
      return `${tool}: ${status}${error ? ` — ${error}` : ""}`;
    }
    default:
      return null;
  }
}

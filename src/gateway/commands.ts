import type { NtoxAliveBridge } from "../alive/ntox.js";

type AliveSnapshot = ReturnType<NtoxAliveBridge["inspect"]>;

function compact(value: unknown, max = 80): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function isAliveQuery(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (normalized === "/alive") return true;
  return normalized.includes("alive") && /\b(notice|noticed|recent|events?|wake|state)\b/.test(normalized);
}

export function renderAliveStatus(snapshot: AliveSnapshot): string {
  const lines = ["NTOX Alive"];

  if (
    snapshot.events.length === 0 &&
    snapshot.pendingActions.length === 0 &&
    snapshot.predictions.length === 0 &&
    snapshot.openLoops.length === 0
  ) {
    return "NTOX Alive\n\nNo recent host events, pending wake actions, predictions, or open loops yet.";
  }

  if (snapshot.pendingActions.length > 0) {
    lines.push("", "Pending wake actions:");
    for (const action of snapshot.pendingActions.slice(0, 5)) {
      lines.push(`- ${action.kind}: ${action.reason}`);
    }
  }

  if (snapshot.events.length > 0) {
    lines.push("", "Recent events:");
    for (const event of snapshot.events.slice(0, 8)) {
      const path = typeof event.payload.path === "string" ? ` ${event.payload.path}` : "";
      const status = typeof event.payload.status === "string" ? ` ${event.payload.status}` : "";
      const nextStep = typeof event.payload.nextStep === "string" ? ` Next: ${event.payload.nextStep}` : "";
      lines.push(`- ${event.type}${status}${path} from ${event.source}.${nextStep}`);
    }
  }

  if (snapshot.openLoops.length > 0) {
    lines.push("", "Open loops:");
    for (const loop of snapshot.openLoops.slice(0, 5)) {
      lines.push(`- ${loop.status}: ${compact(loop.goal)}`);
    }
  }

  if (snapshot.predictions.length > 0) {
    lines.push("", "Predictions:");
    for (const prediction of snapshot.predictions.slice(0, 5)) {
      const error =
        prediction.predictionError === undefined ? "" : ` error=${prediction.predictionError.toFixed(2)}`;
      lines.push(`- ${prediction.status}${error}: ${compact(prediction.statement)}`);
    }
  }

  return lines.join("\n");
}

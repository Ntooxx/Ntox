import { createHash } from "node:crypto";
import type { HarnessCheck } from "./types.js";

export function allChecksPassed(checks: HarnessCheck[]): boolean {
  return checks.length > 0 && checks.every((check) => check.passed);
}

export function mechanicalReuseCheck(detail: string): HarnessCheck {
  return { target: "procedure", type: "mechanical-reuse", passed: true, detail };
}

export function environmentFingerprint(parts: Record<string, string | number>): string {
  const ordered = Object.keys(parts)
    .sort()
    .map((key) => [key, parts[key]]);
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

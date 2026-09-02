import type { CognitivePattern } from "../types/index.js";

export interface TheorySnapshot {
  observations: { id: string; description: string; domain: string; confidence: number; timestamp: number }[];
  patterns: { id: string; name: string; generalization: string; confidence: number; timestamp: number }[];
  theories: { id: string; name: string; explanation: string; predictions: string[]; falsificationCriteria: string; confirmed: boolean; confidence: number; timestamp: number; evidence?: { signal: string; source: string; summary: string; timestamp: number }[] }[];
  metaTheories: { id: string; name: string; synthesis: string; confidence: number; timestamp: number }[];
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function date(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function shorten(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 3) + "..." : clean;
}

export function formatTheoryOverview(snapshot: TheorySnapshot, limit = 10): string {
  const lines: string[] = [];
  lines.push(`theories ${snapshot.theories.length} | confirmed ${snapshot.theories.filter((t) => t.confirmed).length} | patterns ${snapshot.patterns.length} | observations ${snapshot.observations.length}`);
  if (snapshot.theories.length === 0) {
    lines.push("no theories yet");
    return lines.join("\n");
  }
  for (const theory of snapshot.theories.slice(0, limit)) {
    const status = theory.confirmed ? "confirmed" : "tentative";
    lines.push(`${theory.id} ${pct(theory.confidence)} ${status} ${date(theory.timestamp)} ${theory.name}`);
    lines.push(`  ${shorten(theory.explanation)}`);
  }
  if (snapshot.theories.length > limit) lines.push(`... ${snapshot.theories.length - limit} more`);
  return lines.join("\n");
}

export function formatTheoryDetail(snapshot: TheorySnapshot, id: string): string {
  const theory = snapshot.theories.find((t) => t.id === id);
  if (!theory) return `theory not found: ${id}`;
  const lines: string[] = [];
  lines.push(`${theory.id} ${theory.name}`);
  lines.push(`confidence ${pct(theory.confidence)} | ${theory.confirmed ? "confirmed" : "tentative"} | ${date(theory.timestamp)}`);
  lines.push(`explanation: ${theory.explanation}`);
  lines.push(`falsification: ${theory.falsificationCriteria}`);
  if (theory.predictions.length > 0) {
    lines.push("predictions:");
    for (const prediction of theory.predictions) lines.push(`  - ${prediction}`);
  }
  const evidence = theory.evidence || [];
  lines.push(`evidence: ${evidence.length}`);
  for (const item of evidence.slice(-5)) {
    lines.push(`  - ${item.signal}/${item.source} ${date(item.timestamp)} ${shorten(item.summary, 100)}`);
  }
  return lines.join("\n");
}

export function formatTheoryEvidence(snapshot: TheorySnapshot, id: string): string {
  const theory = snapshot.theories.find((t) => t.id === id);
  if (!theory) return `theory not found: ${id}`;
  const evidence = theory.evidence || [];
  const lines = [`${theory.id} evidence ${evidence.length}`];
  if (evidence.length === 0) {
    lines.push("no evidence yet");
    return lines.join("\n");
  }
  for (const item of evidence) {
    lines.push(`${item.signal} ${item.source} ${date(item.timestamp)} ${shorten(item.summary, 140)}`);
  }
  return lines.join("\n");
}

export function formatPatternOverview(patterns: CognitivePattern[], limit = 10): string {
  const lines: string[] = [];
  lines.push(`patterns ${patterns.length}`);
  if (patterns.length === 0) {
    lines.push("no patterns yet");
    return lines.join("\n");
  }
  for (const pattern of patterns.slice(0, limit)) {
    const compiled = pattern.compiledTemplate ? "compiled" : "raw";
    lines.push(`${pattern.id} ${pct(pattern.strength)} ${compiled} hits ${pattern.hitCount} compile ${pattern.compileCount}/5 ${pattern.name}`);
    lines.push(`  ${pattern.domains.join(", ")}`);
  }
  if (patterns.length > limit) lines.push(`... ${patterns.length - limit} more`);
  return lines.join("\n");
}

export function formatPatternDetail(patterns: CognitivePattern[], id: string): string {
  const pattern = patterns.find((p) => p.id === id);
  if (!pattern) return `pattern not found: ${id}`;
  const lines: string[] = [];
  lines.push(`${pattern.id} ${pattern.name}`);
  lines.push(`strength ${pct(pattern.strength)} | hits ${pattern.hitCount} | compile ${pattern.compileCount}/5`);
  lines.push(`domains: ${pattern.domains.join(", ") || "none"}`);
  lines.push(`created: ${date(pattern.created)} | last activated: ${date(pattern.lastActivated)}`);
  lines.push(`template: ${pattern.reasoningTemplate}`);
  if (pattern.compiledTemplate) lines.push(`compiled: ${pattern.compiledTemplate}`);
  return lines.join("\n");
}

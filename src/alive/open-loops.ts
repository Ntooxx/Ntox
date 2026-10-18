import type { CreateOpenLoopInput } from "./engine.js";

const COMMITMENT_PATTERNS: {
  pattern: RegExp;
  goal: (subject: string) => string;
  nextEvidence: (subject: string) => string;
}[] = [
  {
    pattern: /\bI'?ll\s+(?:check|look into|verify|test|find out|review|investigate)\s+([^\n.!?.]{6,90})/gi,
    goal: (subject) => `Check ${subject}`,
    nextEvidence: (subject) => `Verify or refute: ${subject}`,
  },
  {
    pattern: /\b(?:we|I)\s+still\s+(?:don'?t know|need to (?:find out|decide|confirm|figure out))\s+([^\n.!?]{5,90})/gi,
    goal: (subject) => `Resolve open question: ${subject}`,
    nextEvidence: (subject) => `Gather evidence for: ${subject}`,
  },
  {
    pattern: /\bneed to (?:find out|figure out|confirm)\s+([^\n.!?]{5,90})/gi,
    goal: (subject) => `Confirm ${subject}`,
    nextEvidence: (subject) => `Gather evidence for: ${subject}`,
  },
  {
    pattern: /\bTODO:?\s+([^\n.!?]{5,90})/gi,
    goal: (subject) => subject,
    nextEvidence: (subject) => `Complete: ${subject}`,
  },
];

export function normalizeLoopGoal(goal: string): string {
  return goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 120);
}

function clean(subject: string): string {
  return subject
    .replace(/\s+/g, " ")
    .replace(/[,;:\s]+$/, "")
    .trim();
}

export function extractOpenLoops(text: string, max = 2): CreateOpenLoopInput[] {
  const loops: CreateOpenLoopInput[] = [];
  const seen = new Set<string>();
  for (const entry of COMMITMENT_PATTERNS) {
    if (loops.length >= max) break;
    entry.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = entry.pattern.exec(text)) !== null && loops.length < max) {
      const subject = clean(match[1] ?? "");
      if (subject.length < 5) continue;
      const goal = entry.goal(subject);
      const key = normalizeLoopGoal(goal);
      if (seen.has(key)) continue;
      seen.add(key);
      loops.push({ goal, nextEvidence: entry.nextEvidence(subject), status: "waiting_evidence" });
      if (loops.length >= max) break;
    }
  }
  return loops;
}

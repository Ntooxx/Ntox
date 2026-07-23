import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";

interface Observation { id: string; description: string; domain: string; confidence: number; timestamp: number; }
interface StoredPattern { id: string; name: string; observations: string[]; generalization: string; confidence: number; timestamp: number; }
interface StoredPrimitive { id: string; name: string; patterns: string[]; abstraction: string; confidence: number; timestamp: number; }
interface Theory { id: string; name: string; primitives: string[]; explanation: string; predictions: string[]; falsificationCriteria: string; confirmed: boolean; confidence: number; timestamp: number; }
interface MetaTheory { id: string; name: string; theories: string[]; synthesis: string; confidence: number; timestamp: number; }

interface TheoryStoreData {
  observations: Observation[];
  patterns: StoredPattern[];
  theories: Theory[];
  metaTheories: MetaTheory[];
  nextObsId: number;
  nextPatId: number;
  nextTheoryId: number;
  nextMetaId: number;
}

const THEORY_PATH = join(NTOX_DIR, "theories.json");

let observations: Observation[] = [];
let patterns: StoredPattern[] = [];
let theories: Theory[] = [];
let metaTheories: MetaTheory[] = [];
let nextObsId = 1, nextPatId = 1, nextTheoryId = 1, nextMetaId = 1;

function persist(): void {
  const data: TheoryStoreData = { observations, patterns, theories, metaTheories, nextObsId, nextPatId, nextTheoryId, nextMetaId };
  writeFileSync(THEORY_PATH, JSON.stringify(data, null, 2));
}

export function loadTheoryStore(): void {
  if (!existsSync(THEORY_PATH)) return;
  try {
    const data = JSON.parse(readFileSync(THEORY_PATH, "utf-8")) as TheoryStoreData;
    observations = data.observations || [];
    patterns = data.patterns || [];
    theories = data.theories || [];
    metaTheories = data.metaTheories || [];
    nextObsId = data.nextObsId || 1;
    nextPatId = data.nextPatId || 1;
    nextTheoryId = data.nextTheoryId || 1;
    nextMetaId = data.nextMetaId || 1;
  } catch { /* corrupt file, start fresh */ }
}

export function recordObservation(description: string, domain: string, confidence: number = 0.3): Observation {
  const existing = observations.find((o) => o.description === description);
  if (existing) return existing;
  const obs: Observation = { id: `obs_${nextObsId++}`, description, domain, confidence, timestamp: Date.now() };
  observations.push(obs);
  if (observations.length > 500) observations.splice(0, observations.length - 500);
  persist();
  tryGeneralize();
  reevaluateTheories(domain);
  return obs;
}

function reevaluateTheories(domain: string): void {
  let changed = false;
  for (const t of theories) {
    if (t.confirmed) continue;
    const text = (t.name + " " + t.explanation).toLowerCase();
    const domainWords = [domain, ...domain.split("_")];
    const hit = domainWords.some((w) => w.length > 2 && text.includes(w));
    if (hit) {
      t.confidence = Math.min(1, t.confidence + 0.15);
      if (t.confidence >= 0.6) { t.confirmed = true; }
      changed = true;
    }
  }
  if (changed) { persist(); synthesize(); }
}

function tryGeneralize(): StoredPattern | null {
  if (observations.length < 2) return null;
  const recent = observations.slice(-3);
  const domains = [...new Set(recent.map((o) => o.domain))];
  if (domains.length >= 2) {
    const name = `Cross-domain pattern from ${domains.slice(0, 2).join(", ")}`;
    const existing = patterns.find((p) => p.name === name);
    if (existing) { existing.confidence = Math.min(1, existing.confidence + 0.1); persist(); return existing; }
    const p: StoredPattern = { id: `pat_${nextPatId++}`, name, observations: recent.map((o) => o.id), generalization: recent.map((o) => o.description).join("; "), confidence: 0.3, timestamp: Date.now() };
    patterns.push(p);
    if (patterns.length > 100) patterns.splice(0, patterns.length - 100);
    persist();
    tryAbstract();
    return p;
  }
  return null;
}

function tryAbstract(): void {
  if (patterns.length < 2) return;
  const top = [...patterns].sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  if (top.length >= 2) {
    const words = findShared(top.map((p) => p.generalization));
    if (words.length >= 2) {
      const prim: StoredPrimitive = { id: `prim_${nextPatId++}`, name: `Primitive: ${words.slice(0, 2).join(" ")}`, patterns: top.map((p) => p.id), abstraction: `Common in: ${top.map((p) => p.name).join(", ")}`, confidence: 0.3, timestamp: Date.now() };
      for (const cp of ["invariant", "symmetry", "trade_off", "feedback", "emergence", "conservation", "transformation"]) if (prim.name.toLowerCase().includes(cp)) prim.confidence = 0.5;
      buildTheory(prim);
    }
  }
}

function buildTheory(prim: StoredPrimitive): void {
  const theory: Theory = { id: `theory_${nextTheoryId++}`, name: `Theory: ${prim.name.replace("Primitive:", "explains")}`, primitives: [prim.id], explanation: `Observation of ${prim.abstraction} suggests a recurring reasoning structure`, predictions: ["This primitive should apply to unseen problems in related domains", "Violating this primitive should lead to characteristic failure modes"], falsificationCriteria: "Find a problem where applying this primitive produces worse outcomes", confirmed: false, confidence: 0.2, timestamp: Date.now() };
  theories.push(theory);
  if (theories.length > 50) theories.splice(0, theories.length - 50);
  persist();
  synthesize();
}

function synthesize(): void {
  const confirmed = theories.filter((t) => t.confirmed);
  if (confirmed.length < 2) return;
  metaTheories.push({ id: `meta_${nextMetaId++}`, name: `Meta-theory (${confirmed.length} theories)`, theories: confirmed.map((t) => t.id), synthesis: confirmed.map((t) => t.explanation).join("; "), confidence: 0.3, timestamp: Date.now() });
  if (metaTheories.length > 20) metaTheories.splice(0, metaTheories.length - 20);
  persist();
}

function findShared(texts: string[]): string[] {
  const freq: Record<string, number> = {};
  for (const text of texts) for (const w of [...new Set(text.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter((w) => w.length > 4))]) freq[w] = (freq[w] || 0) + 1;
  return Object.entries(freq).filter(([, c]) => c >= texts.length * 0.5).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
}

export function confirmTheory(theoryId: string): void { const t = theories.find((t) => t.id === theoryId); if (t) { t.confirmed = true; t.confidence = Math.min(1, t.confidence + 0.4); persist(); synthesize(); } }
export function disconfirmTheory(theoryId: string): void { const t = theories.find((t) => t.id === theoryId); if (t) { t.confirmed = false; t.confidence = Math.max(0, t.confidence - 0.3); persist(); } }

export function getTheoryHierarchy() { return { observations: [...observations], patterns: [...patterns], theories: [...theories], metaTheories: [...metaTheories] }; }
export function getTheoryStats() { return { totalObservations: observations.length, totalPatterns: patterns.length, totalTheories: theories.length, confirmedTheories: theories.filter((t) => t.confirmed).length, totalMetaTheories: metaTheories.length }; }

export function resetTheoryStore(): void {
  observations.length = 0; patterns.length = 0; theories.length = 0; metaTheories.length = 0;
  nextObsId = 1; nextPatId = 1; nextTheoryId = 1; nextMetaId = 1;
  if (existsSync(THEORY_PATH)) { try { writeFileSync(THEORY_PATH, JSON.stringify({ observations: [], patterns: [], theories: [], metaTheories: [], nextObsId: 1, nextPatId: 1, nextTheoryId: 1, nextMetaId: 1 })); } catch { /* ignore */ } }
}

export function extractObservationFromEpisode(userMessage: string, assistantResponse: string): { description: string; domain: string } | null {
  const topic = userMessage.toLowerCase().split(/\s+/).filter((w) => w.length > 4).slice(0, 5).join(" ");
  if (!topic) return null;
  const responsePreview = assistantResponse.slice(0, 200).replace(/\s+/g, " ");
  const domain = detectDomain(userMessage);
  return { description: `User asked about "${topic}": ${responsePreview}`, domain };
}

function detectDomain(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(code|program|function|api|app|software|script|bug|deploy|build|compile|test)\b/i.test(lower)) return "programming";
  if (/\b(math|equation|formula|proof|calculate|statistic|probability|algebra|calculus)\b/i.test(lower)) return "mathematics";
  if (/\b(physics|force|energy|quantum|mechanics|thermo|wave|field|particle)\b/i.test(lower)) return "physics";
  if (/\b(ai|model|neural|train|dataset|learning|llm|embedding|token|attention|transformer)\b/i.test(lower)) return "ai";
  if (/\b(design|architecture|system|distributed|database|network|protocol|cache|load|scale)\b/i.test(lower)) return "architecture";
  if (/\b(econ|market|price|trade|game|strategy|incentive|auction|equilibrium)\b/i.test(lower)) return "economics";
  return "general";
}

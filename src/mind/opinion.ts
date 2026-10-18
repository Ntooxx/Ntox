import type { MentalModel, MentalModelEntry } from "../meta/mental-model.js";
import { clamp } from "./util.js";
import type { IdentityPosition, IdentityStore } from "./identity.js";

export interface PromoteOpinionsOptions {
  minMentions?: number;
  maxConfidence?: number;
  maxNew?: number;
}

const DEFAULT_MIN_MENTIONS = 3;

function slug(statement: string): string {
  return statement
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join("-");
}

function opinionConfidence(entry: MentalModelEntry, minMentions: number, maxConfidence: number): number {
  const surplus = Math.max(0, entry.mentionCount - minMentions);
  return clamp(0.35 + 0.07 * surplus, 0.35, maxConfidence);
}

export function promoteOpinions(
  model: MentalModel,
  identity: IdentityStore,
  options: PromoteOpinionsOptions = {},
): IdentityPosition[] {
  const minMentions = options.minMentions ?? DEFAULT_MIN_MENTIONS;
  const maxConfidence = options.maxConfidence ?? 0.8;
  const maxNew = options.maxNew ?? 5;
  const existing = new Map(identity.get().positions.map((p) => [p.topic, p]));
  const promoted: IdentityPosition[] = [];

  const candidates = model
    .getAllEntries()
    .filter((entry) => entry.status === "active" && entry.mentionCount >= minMentions)
    .sort((a, b) => b.mentionCount - a.mentionCount);

  for (const entry of candidates) {
    if (promoted.length >= maxNew) break;
    const topic = `${entry.category}:${slug(entry.statement)}`.slice(0, 80);
    const current = existing.get(topic);
    const confidence = opinionConfidence(entry, minMentions, maxConfidence);
    if (current && current.confidence >= confidence) continue;
    const position = identity.addPosition(topic, entry.statement.slice(0, 300), confidence, [
      `mental-model:${entry.id}`,
    ]);
    promoted.push(position);
  }

  return promoted;
}

export function attributePositionOutcome(
  identity: IdentityStore,
  topicKey: string,
  helpful: boolean,
): IdentityPosition | null {
  if (helpful) return identity.strengthenPosition(topicKey, 0.08);
  return identity.challengePosition(topicKey, "outcome on this topic required correction", 0.8);
}

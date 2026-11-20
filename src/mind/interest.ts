import type { NtoxAliveBridge } from "../alive/ntox.js";
import type { IdentityStore } from "./identity.js";
import { hashText } from "./util.js";

export interface Interest {
  id: string;
  topic: string;
  stance: string;
  strength: number;
  threatCount: number;
  lastChallengedAt?: number;
}

/** A strong position becomes an interest when it has a history of being defended. */
export function deriveInterests(identity: IdentityStore): Interest[] {
  const data = identity.get();
  return data.positions
    .filter((position) => position.confidence >= 0.6)
    .map((position) => ({
      id: `interest_${hashText(position.topic).slice(0, 8)}`,
      topic: position.topic,
      stance: position.stance,
      strength: position.confidence,
      threatCount: data.revisionLog.filter(
        (revision) => revision.topic === position.topic && revision.change.startsWith("challenged"),
      ).length,
    }))
    .sort((a, b) => b.strength - a.strength || a.topic.localeCompare(b.topic));
}

export interface InterestRegistryOptions {
  identity: IdentityStore;
  now?: () => number;
  alive?: NtoxAliveBridge;
  onHarden?: (topic: string) => void;
}

export class InterestRegistry {
  private readonly identity: IdentityStore;
  private readonly now: () => number;
  private readonly alive?: NtoxAliveBridge;
  private readonly onHarden?: (topic: string) => void;
  private interests: Interest[];

  constructor(options: InterestRegistryOptions) {
    this.identity = options.identity;
    this.now = options.now ?? Date.now;
    this.alive = options.alive;
    this.onHarden = options.onHarden;
    this.interests = deriveInterests(this.identity);
  }

  list(): Interest[] {
    this.refresh();
    return this.interests.map((interest) => ({ ...interest }));
  }

  find(topic: string): Interest | undefined {
    this.refresh();
    const normalized = topic.trim().toLowerCase();
    return this.interests.find((interest) => interest.topic.toLowerCase() === normalized);
  }

  /** A challenge against an interest closes the self a little further. */
  onChallenge(topic: string): Interest | null {
    this.refresh();
    const interest = this.find(topic);
    if (!interest) return null;

    interest.threatCount += 1;
    interest.lastChallengedAt = this.now();
    this.onHarden?.(interest.topic);

    this.alive?.recordEvent({
      type: "identity_challenged",
      source: "interest",
      significance: 0.85,
      payload: { topic: interest.topic, threatCount: interest.threatCount },
      requiresHuman: interest.threatCount >= 3,
    });

    return { ...interest };
  }

  /** Turn defended interests into open loops so the world can test them. */
  syncOpenLoops(): number {
    this.refresh();
    let created = 0;
    for (const interest of this.interests) {
      if (interest.threatCount === 0) continue;
      const existing = this.alive?.engine
        .getState()
        .openLoops.some((loop) => loop.goal === `Preserve position on ${interest.topic}: ${interest.stance}`);
      if (existing) continue;
      this.alive?.createOpenLoop({
        goal: `Preserve position on ${interest.topic}: ${interest.stance}`,
        hypothesis: "This position survives correction because it is evidence-backed.",
        uncertainty: `Challenged ${interest.threatCount} time(s)`,
        nextEvidence: "A new correction or disconfirming observation on this topic.",
        status: "waiting_evidence",
        deadline: this.now() + 7 * 24 * 3600_000,
      });
      created += 1;
    }
    return created;
  }

  private refresh(): void {
    const fresh = deriveInterests(this.identity);
    for (const interest of fresh) {
      const previous = this.interests.find((item) => item.id === interest.id);
      if (previous) {
        interest.threatCount = Math.max(interest.threatCount, previous.threatCount);
        interest.lastChallengedAt = previous.lastChallengedAt;
      }
    }
    this.interests = fresh;
  }
}

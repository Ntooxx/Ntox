import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import { getIntentLabel, type SessionIntent } from "./session-intent.js";
import type { UserProfile } from "../types/index.js";

const AWARENESS_PATH = join(NTOX_DIR, "self-aware.json");

export type DiscoveryType =
  | "style-discovery"
  | "vocabulary-discovery"
  | "project-discovery"
  | "mood-discovery"
  | "intent-discovery"
  | "bond-milestone";

export interface Discovery {
  type: DiscoveryType;
  message: string;
  timestamp: number;
  announced: boolean;
  priority: number;
}

interface AwarenessState {
  discoveries: Discovery[];
  feedbackRequestedThisSession: boolean;
  lastFeedbackRequest: number;
  sessionSummary: string[];
  totalAnnouncements: number;
}

function defaultState(): AwarenessState {
  return {
    discoveries: [],
    feedbackRequestedThisSession: false,
    lastFeedbackRequest: 0,
    sessionSummary: [],
    totalAnnouncements: 0,
  };
}

export interface FeedbackRequest {
  question: string;
  reason: "low-confidence" | "after-correction" | "solved-complex";
}

export class SelfAwareness {
  private state: AwarenessState;
  private dirty = false;
  private announcementsThisSession = 0;
  private maxAnnouncementsPerSession = 2;

  constructor() {
    this.state = this.load();
  }

  private load(): AwarenessState {
    if (!existsSync(AWARENESS_PATH)) return defaultState();
    try {
      return { ...defaultState(), ...JSON.parse(readFileSync(AWARENESS_PATH, "utf-8")) };
    } catch {
      return defaultState();
    }
  }

  private save(): void {
    const tmp = AWARENESS_PATH + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(this.state, null, 2));
      writeFileSync(AWARENESS_PATH, readFileSync(tmp, "utf-8"));
    } catch { /* best effort */ }
  }

  private persist(): void {
    if (this.dirty) { this.save(); this.dirty = false; }
  }

  startSession(): void {
    this.state.feedbackRequestedThisSession = false;
    this.announcementsThisSession = 0;
    this.state.sessionSummary = [];
  }

  discover(type: DiscoveryType, message: string, priority: number = 5): void {
    const exists = this.state.discoveries.some(
      (d) => d.type === type && d.message === message && !d.announced
    );
    if (exists) return;
    this.state.discoveries.push({ type, message, timestamp: Date.now(), announced: false, priority });
    this.state.sessionSummary.push(message);
    this.dirty = true;
    this.persist();
  }

  getNextAnnouncement(): string | null {
    if (this.announcementsThisSession >= this.maxAnnouncementsPerSession) return null;

    const unannounced = this.state.discoveries
      .filter((d) => !d.announced)
      .sort((a, b) => b.priority - a.priority);

    if (unannounced.length === 0) return null;

    const next = unannounced[0];
    next.announced = true;
    this.announcementsThisSession++;
    this.dirty = true;
    this.persist();
    return next.message;
  }

  shouldRequestFeedback(responseConfidence: number, wasCorrection: boolean, solved: boolean): FeedbackRequest | null {
    if (this.state.feedbackRequestedThisSession) return null;

    const now = Date.now();
    if (now - this.state.lastFeedbackRequest < 300000) return null;

    if (wasCorrection) {
      this.state.feedbackRequestedThisSession = true;
      this.state.lastFeedbackRequest = now;
      this.dirty = true;
      this.persist();
      return { question: "Did that address your concern, or is there more to fix?", reason: "after-correction" };
    }

    if (responseConfidence < 0.4 && solved === false) {
      this.state.feedbackRequestedThisSession = true;
      this.state.lastFeedbackRequest = now;
      this.dirty = true;
      this.persist();
      return { question: "Was that helpful? I want to make sure I'm on the right track.", reason: "low-confidence" };
    }

    return null;
  }

  discoverFromProfile(profile: UserProfile): void {
    if (profile.communicationStyle !== "adaptive") {
      this.discover(
        "style-discovery",
        `I've noticed you communicate in a ${profile.communicationStyle} style — I'll match that.`,
        6
      );
    }

    if (profile.learningStyle !== "adaptive") {
      this.discover(
        "style-discovery",
        `You seem to learn best via ${profile.learningStyle.replace("-", " ")} approaches — I'll adjust.`,
        5
      );
    }

    const newTerms = profile.personalVocabulary.filter((v) => v.count >= 2);
    if (newTerms.length >= 3) {
      const terms = newTerms.slice(-3).map((t) => t.term).join(", ");
      this.discover(
        "vocabulary-discovery",
        `I've picked up ${newTerms.length} terms you use: ${terms}. I'll use them naturally.`,
        4
      );
    }

    const activeProjects = profile.projectAssociations.filter((p) => p.mentionCount >= 2);
    if (activeProjects.length >= 2) {
      const names = activeProjects.map((p) => p.projectName).join(", ");
      this.discover(
        "project-discovery",
        `I've noticed you're working on: ${names}. I'll keep project context.`,
        4
      );
    }

    const recentMood = profile.moodHistory.slice(-10);
    if (recentMood.length >= 5) {
      const negatives = recentMood.filter((m) => m.score < -0.2).length;
      const sessionCount = profile.sessionsCount;
      if (negatives >= 4 && sessionCount >= 5) {
        this.discover(
          "mood-discovery",
          "I've noticed some frustration patterns. I'm learning to adapt my tone to help.",
          3
        );
      }
    }
  }

  discoverFromIntent(intent: SessionIntent, queryCount: number): void {
    if (queryCount >= 3 && intent !== "casual") {
      this.discover(
        "intent-discovery",
        `This looks like a ${getIntentLabel(intent)} — I'll adjust my approach accordingly.`,
        3
      );
    }
  }

  endSession(): string {
    const summary = this.state.sessionSummary.slice(-5);
    this.state.sessionSummary = [];
    this.state.feedbackRequestedThisSession = false;
    this.dirty = true;
    this.persist();
    if (summary.length === 0) return "";
    return summary.join(" · ");
  }

  getUnannouncedCount(): number {
    return this.state.discoveries.filter((d) => !d.announced).length;
  }

  reset(): void {
    this.state = defaultState();
    this.dirty = true;
    this.persist();
  }
}

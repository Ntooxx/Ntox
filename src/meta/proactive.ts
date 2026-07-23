import type { UserProfile } from "../types/index.js";
import { Analytics } from "./analytics.js";
import { buildTimeContext, shouldSuppressProactive } from "./time-adapter.js";

export interface ProactiveSuggestion {
  message: string;
  type: "goal-reminder" | "skill-suggestion" | "pattern-insight" | "tip" | "habit" | "milestone" | "feedback-prompt";
  priority: number;
}

export class ProactiveEngine {
  private analytics: Analytics;
  private lastSuggestionTime = 0;
  private minIntervalMs = 120000;
  private lastMemoryMilestone = 0;
  private saidMilestones: Set<string> = new Set();

  constructor(analytics: Analytics) {
    this.analytics = analytics;
  }

  setBondLevel(bondLevel: number, milestones: string[]): void {
    this.currentBondLevel = bondLevel;
    this.currentMilestones = milestones;
  }

  private currentBondLevel = 0;
  private currentMilestones: string[] = [];

  generate(
    userProfile: UserProfile,
    messageCount: number,
    skillsCount: number,
    memoryCount: number,
    sessionIntent?: string
  ): ProactiveSuggestion | null {
    const now = Date.now();

    if (now - this.lastSuggestionTime < this.minIntervalMs) return null;
    if (messageCount < 3) return null;

    const timeCtx = buildTimeContext(userProfile.lastActive);
    if (shouldSuppressProactive(timeCtx)) return null;
    if (sessionIntent === "deep-work" || sessionIntent === "debugging") return null;

    const suggestions: ProactiveSuggestion[] = [];

    // Milestone celebration
    if (this.currentMilestones.length > 0) {
      const unsaid = this.currentMilestones.filter((m) => !this.saidMilestones?.has(m));
      if (unsaid.length > 0) {
        if (!this.saidMilestones) this.saidMilestones = new Set();
        for (const m of unsaid) this.saidMilestones.add(m);
        suggestions.push({
          message: unsaid.join(". "),
          type: "milestone",
          priority: 6,
        });
      }
    }
    if (!this.saidMilestones) this.saidMilestones = new Set();

    // Goal reminders
    const activeGoals = userProfile.goals.filter((g) => g.status === "active");
    if (activeGoals.length > 0) {
      suggestions.push({
        message: `You have ${activeGoals.length} active goal${activeGoals.length > 1 ? "s" : ""}: ${activeGoals.map((g) => g.description).join(", ")}. Keep going!`,
        type: "goal-reminder",
        priority: 3,
      });
    }

    // Skill suggestions
    if (skillsCount <= 3) {
      const topTools = this.analytics.getMostUsedTools(1);
      if (topTools.length > 0 && topTools[0].count >= 3) {
        suggestions.push({
          message: `You've used "${topTools[0].name}" ${topTools[0].count} times. Create a skill to automate it.`,
          type: "skill-suggestion",
          priority: 5,
        });
      }
    }

    // Memory milestone (prevent firing on load)
    if (memoryCount > 0 && memoryCount % 50 === 0 && memoryCount !== this.lastMemoryMilestone) {
      this.lastMemoryMilestone = memoryCount;
      suggestions.push({
        message: `${memoryCount} memories stored! Ntox is getting smarter.`,
        type: "pattern-insight",
        priority: 1,
      });
    }

    // Habit hints
    if (timeCtx.isWeekend && timeCtx.timeOfDay === "morning") {
      suggestions.push({
        message: "Weekend — good time to catch up on side projects.",
        type: "habit",
        priority: 2,
      });
    }

    // Domain discovery
    if (userProfile.personalVocabulary.length >= 5 && userProfile.domains.length < 4) {
      suggestions.push({
        message: `I've noticed ${userProfile.personalVocabulary.length} unique terms you use. Want me to learn a custom domain? Try /profile set domain <name>.`,
        type: "skill-suggestion",
        priority: 3,
      });
    }

    // Tool pattern
    if (messageCount >= 5) {
      const toolCount = Object.keys(userProfile.expertise).length;
      if (toolCount >= 3 && userProfile.patterns.prefersCodeBlocks) {
        suggestions.push({
          message: "You've been doing a lot of coding sessions. I'm adapting to be more code-aware.",
          type: "pattern-insight",
          priority: 2,
        });
      }
    }

    // Correction rate
    const totalMsgs = userProfile.patterns.totalMessages;
    const correctionRate = totalMsgs > 0
      ? userProfile.patterns.correctionsReceived / totalMsgs
      : 0;
    if (correctionRate > 0.2 && totalMsgs > 10) {
      suggestions.push({
        message: `Corrected ${(correctionRate * 100).toFixed(0)}% of the time — learning from it.`,
        type: "pattern-insight",
        priority: 4,
      });
    }

    if (suggestions.length === 0) return null;

    suggestions.sort((a, b) => b.priority - a.priority);
    this.lastSuggestionTime = now;
    return suggestions[0];
  }
}

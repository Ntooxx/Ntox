import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import { DOMAIN_KEYWORDS } from "../cognition/domains.js";
import { analyzeMood } from "../meta/mood.js";
import type {
  UserProfile, UserGoal, Expertise, MoodEntry,
  CommunicationStyle, LearningStyle,
} from "../types/index.js";

const PROFILE_PATH = join(NTOX_DIR, "user-model.json");

const DEFAULT_PROFILE: UserProfile = {
  name: "",
  expertise: {},
  preferences: {
    verbosity: "balanced",
    technicalLevel: "intermediate",
    tone: "adaptive",
    codeExamples: "when-helpful",
  },
  goals: [],
  patterns: {
    averageMessageLength: 0,
    totalMessages: 0,
    correctionsReceived: 0,
    prefersCodeBlocks: false,
    prefersBulletPoints: false,
  },
  domains: [],
  lastActive: Date.now(),
  sessionsCount: 0,
  createdAt: Date.now(),

  communicationStyle: "adaptive",
  learningStyle: "adaptive",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  moodHistory: [],
  personalVocabulary: [],
  projectAssociations: [],
  closenessScore: 0,
  lastSessionEnd: Date.now(),
};

const COMMUNICATION_STYLE_PATTERNS: Record<CommunicationStyle, RegExp[]> = {
  direct: [/^(fix|show|give|make|run|do|find|tell)\b/i, /^[^-*\s]{1,10}$/],
  narrative: [/^(so |i was |i've been |let me tell|the thing is|basically|actually)/i, /\b(because|since|after|before|while)\b.{20,}/],
  visual: [/\b(diagram|chart|graph|draw|visualize|layout|sketch|map|flow)\b/i, /\b(show me|looks like|appear|display)\b/i],
  adaptive: [],
};

const LEARNING_STYLE_PATTERNS: Record<LearningStyle, RegExp[]> = {
  "example-driven": [/\b(example|sample|instance|demo|show me|like)\b/i, /\b(give me an|for instance|e\.?g\.?)\b/i],
  conceptual: [/\b(explain|why|how does|principle|concept|theory|understand|reason)\b/i, /\b(what is|define|meaning|mechanics)\b/i],
  "hands-on": [/\b(try|step|walk me through|how to|guide|tutorial|practice|do it)\b/i, /\b(let me|i'll|i want to try)\b/i],
  adaptive: [],
};

const PROJECT_PATTERNS = [
  /(?:project|repo|repository|app|service)\s+["']?(\w[\w\s-]+?)["']?/i,
  /(?:working on|building|developing|writing)\s+(?:a|an|the|my)?\s*["']?(\w[\w\s-]+?)["']?/i,
  /(?:in|for)\s+(?:the\s+)?(\w[\w\s-]+?)\s+(?:project|repo|app)/i,
];

const VOCABULARY_PATTERNS = [
  /["']([\w-]+)["']\s+(?:means?|is|refers? to)/i,
  /(?:call|call it|known as|referred to as)\s+["']?([\w-]+)["']?/i,
];

const CAPITALIZED_TERM = /\b([A-Z][a-z]+[A-Z][a-z]+)\b/g;

export class UserModel {
  private profile: UserProfile;
  private dirty = false;
  private codeExampleHits = 0;

  constructor() {
    this.profile = this.load();
  }

  private deepMerge(defaults: UserProfile, saved: Partial<UserProfile>): UserProfile {
    const merged = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof UserProfile)[]) {
      const dVal = defaults[key];
      const sVal = saved[key];
      if (sVal === undefined || sVal === null) continue;
      if (typeof dVal === "object" && !Array.isArray(dVal) && dVal !== null) {
        (merged as Record<string, unknown>)[key] = { ...(dVal as Record<string, unknown>), ...(sVal as Record<string, unknown>) };
      } else {
        (merged as Record<string, unknown>)[key] = sVal as unknown;
      }
    }
    return merged;
  }

  private load(): UserProfile {
    if (!existsSync(PROFILE_PATH)) {
      this.save(DEFAULT_PROFILE);
      return { ...DEFAULT_PROFILE };
    }
    try {
      const raw = readFileSync(PROFILE_PATH, "utf-8");
      return this.deepMerge(DEFAULT_PROFILE, JSON.parse(raw));
    } catch {
      return { ...DEFAULT_PROFILE };
    }
  }

  private save(profile: UserProfile): void {
    const data = JSON.stringify(profile, null, 2);
    const tmp = PROFILE_PATH + ".tmp";
    writeFileSync(tmp, data, "utf-8");
    writeFileSync(PROFILE_PATH, data, "utf-8");
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }

  private persist(): void {
    if (!this.dirty) return;
    this.save(this.profile);
    this.dirty = false;
  }

  flush(): void {
    if (this.dirty) {
      this.save(this.profile);
      this.dirty = false;
    }
  }

  getProfile(): UserProfile {
    return JSON.parse(JSON.stringify(this.profile));
  }

  startSession(): void {
    this.profile.sessionsCount++;
    this.profile.lastActive = Date.now();
    this.dirty = true;
    this.persist();
  }

  endSession(): void {
    this.profile.lastSessionEnd = Date.now();
    this.dirty = true;
    this.persist();
  }

  extractFromConversation(userMessage: string, wasCorrection: boolean): void {
    const p = this.profile;

    p.patterns.totalMessages++;
    const msgLen = userMessage.length;
    p.patterns.averageMessageLength =
      p.patterns.averageMessageLength === 0
        ? msgLen
        : (p.patterns.averageMessageLength * (p.patterns.totalMessages - 1) + msgLen) / p.patterns.totalMessages;

    if (wasCorrection) {
      p.patterns.correctionsReceived++;
    }

    // Verbosity detection
    const lower = userMessage.toLowerCase();
    if (/\b(brief|short|concise|tl;dr|summarize|quickly)\b/i.test(lower)) {
      p.preferences.verbosity = "concise";
      this.dirty = true;
    } else if (/\b(detail|in depth|thorough|comprehensive|elaborate|explain.*in detail)\b/i.test(lower)) {
      p.preferences.verbosity = "detailed";
      this.dirty = true;
    }

    // Technical level
    if (/\b(explain like I'm 5|eli5|simplify|basic|beginner|noob)\b/i.test(lower)) {
      p.preferences.technicalLevel = "beginner";
      this.dirty = true;
    } else if (/\b(advanced|expert|senior|architect|complex)\b/i.test(lower)) {
      p.preferences.technicalLevel = "expert";
      this.dirty = true;
    }

    // Code blocks — require multiple signals before flipping permanently
    if (/show me (the )?code\b/i.test(lower)) {
      p.preferences.codeExamples = "always";
      this.dirty = true;
    } else if (/\b(example|snippet)\b/i.test(lower) && p.preferences.codeExamples !== "always") {
      // Single mention of "example" just bumps temporarily, not permanently
      if (!this.codeExampleHits) this.codeExampleHits = 0;
      this.codeExampleHits++;
      if (this.codeExampleHits >= 3) {
        p.preferences.codeExamples = "always";
        this.dirty = true;
      }
    }

    // Domains
    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      if (keywords.some((kw) => lower.includes(kw))) {
        if (!p.domains.includes(domain)) {
          p.domains.push(domain);
          if (!p.expertise[domain]) {
            p.expertise[domain] = "intermediate";
          }
          this.dirty = true;
        }
      }
    }

    // Bullet points
    if (/^[-*\d.]\s/m.test(lower)) {
      p.patterns.prefersBulletPoints = true;
      this.dirty = true;
    }

    // Code blocks
    if (lower.includes("```") || lower.includes("~~~")) {
      p.patterns.prefersCodeBlocks = true;
      this.dirty = true;
    }

    // Mood tracking
    const mood = analyzeMood(userMessage);
    const last = p.moodHistory[p.moodHistory.length - 1];
    if (!last || mood.sentiment !== last.sentiment || mood.energy !== last.energy || Math.abs(mood.score - last.score) > 0.2) {
      p.moodHistory.push(mood);
      if (p.moodHistory.length > 50) p.moodHistory = p.moodHistory.slice(-50);
      this.dirty = true;
    }

    // Communication style detection
    const detectedStyle = this.detectCommunicationStyle(userMessage);
    if (detectedStyle !== "adaptive") {
      this.adjustCommunicationStyle(detectedStyle);
    }

    // Learning style detection
    const detectedLearning = this.detectLearningStyle(userMessage);
    if (detectedLearning !== "adaptive") {
      this.adjustLearningStyle(detectedLearning);
    }

    // Project extraction
    this.extractProjects(userMessage);

    // Personal vocabulary
    this.extractVocabulary(userMessage);

    // Closeness score
    p.closenessScore = Math.min(1, p.closenessScore + 0.002);
    p.closenessScore = Math.max(0, p.closenessScore - 0.001);

    p.lastActive = Date.now();
    this.dirty = true;
    this.persist();
  }

  private detectCommunicationStyle(text: string): CommunicationStyle {
    for (const [style, patterns] of Object.entries(COMMUNICATION_STYLE_PATTERNS)) {
      if (style === "adaptive") continue;
      const matches = patterns.filter((p) => p.test(text));
      if (matches.length >= 1) return style as CommunicationStyle;
    }
    return "adaptive";
  }

  private detectLearningStyle(text: string): LearningStyle {
    for (const [style, patterns] of Object.entries(LEARNING_STYLE_PATTERNS)) {
      if (style === "adaptive") continue;
      const matches = patterns.filter((p) => p.test(text));
      if (matches.length >= 1) return style as LearningStyle;
    }
    return "adaptive";
  }

  private adjustCommunicationStyle(detected: CommunicationStyle): void {
    const current = this.profile.communicationStyle;
    if (current === "adaptive") {
      this.profile.communicationStyle = detected;
      this.dirty = true;
      return;
    }
    if (current !== detected && Math.random() < 0.15) {
      this.profile.communicationStyle = detected;
      this.dirty = true;
    }
  }

  private adjustLearningStyle(detected: LearningStyle): void {
    const current = this.profile.learningStyle;
    if (current === "adaptive") {
      this.profile.learningStyle = detected;
      this.dirty = true;
      return;
    }
    if (current !== detected && Math.random() < 0.15) {
      this.profile.learningStyle = detected;
      this.dirty = true;
    }
  }

  private extractProjects(text: string): void {
    for (const pattern of PROJECT_PATTERNS) {
      const match = pattern.exec(text);
      if (match && match[1]) {
        const name = match[1].trim();
        if (name.length > 1) {
          const existing = this.profile.projectAssociations.find(
            (p) => p.projectName.toLowerCase() === name.toLowerCase()
          );
          if (existing) {
            existing.lastMentioned = Date.now();
            existing.mentionCount++;
          } else {
            this.profile.projectAssociations.push({
              projectId: `proj_${randomUUID().slice(0, 8)}`,
              projectName: name,
              description: "",
              firstMentioned: Date.now(),
              lastMentioned: Date.now(),
              mentionCount: 1,
              tags: [],
            });
          }
          this.dirty = true;
        }
      }
    }
    // Keep max 50 projects
    if (this.profile.projectAssociations.length > 50) {
      this.profile.projectAssociations.sort((a, b) => b.lastMentioned - a.lastMentioned);
      this.profile.projectAssociations = this.profile.projectAssociations.slice(0, 50);
      this.dirty = true;
    }
  }

  private extractVocabulary(text: string): void {
    // Explicit definitions
    for (const pattern of VOCABULARY_PATTERNS) {
      const match = pattern.exec(text);
      if (match && match[1]) {
        const term = match[1].trim();
        if (term.length > 1) {
          const existing = this.profile.personalVocabulary.find(
            (v) => v.term.toLowerCase() === term.toLowerCase()
          );
          if (existing) {
            existing.count++;
            existing.lastUsed = Date.now();
          } else {
            this.profile.personalVocabulary.push({
              term,
              meaning: "",
              firstSeen: Date.now(),
              lastUsed: Date.now(),
              count: 1,
            });
          }
          this.dirty = true;
        }
      }
    }

    // CamelCase terms as potential project/tech names
    const capitalized = text.match(CAPITALIZED_TERM);
    if (capitalized) {
      for (const term of capitalized) {
        if (term.length > 2 && !this.profile.personalVocabulary.some((v) => v.term === term)) {
          const existing = this.profile.personalVocabulary.find(
            (v) => v.term.toLowerCase() === term.toLowerCase()
          );
          if (!existing) {
            this.profile.personalVocabulary.push({
              term,
              meaning: "",
              firstSeen: Date.now(),
              lastUsed: Date.now(),
              count: 1,
            });
            this.dirty = true;
          }
        }
      }
    }

    // Keep max 100 terms
    if (this.profile.personalVocabulary.length > 100) {
      this.profile.personalVocabulary.sort((a, b) => b.count - a.count);
      this.profile.personalVocabulary = this.profile.personalVocabulary.slice(0, 100);
      this.dirty = true;
    }
  }

  getRecentMood(window: number = 5): MoodEntry[] {
    return this.profile.moodHistory.slice(-window);
  }

  getDominantSentiment(window: number = 5): string {
    const recent = this.getRecentMood(window);
    if (recent.length === 0) return "neutral";
    const counts: Record<string, number> = {};
    for (const m of recent) {
      counts[m.sentiment] = (counts[m.sentiment] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  setPreference<K extends keyof UserProfile["preferences"]>(
    key: K,
    value: UserProfile["preferences"][K]
  ): void {
    this.profile.preferences[key] = value;
    this.dirty = true;
    this.persist();
  }

  setExpertise(domain: string, level: Expertise): void {
    this.profile.expertise[domain] = level;
    if (!this.profile.domains.includes(domain)) {
      this.profile.domains.push(domain);
    }
    this.dirty = true;
    this.persist();
  }

  setName(name: string): void {
    this.profile.name = name;
    this.dirty = true;
    this.persist();
  }

  addGoal(description: string, category: string = "general", targetDate?: number): UserGoal {
    const goal: UserGoal = {
      id: `goal_${randomUUID().slice(0, 8)}`,
      description,
      category,
      startedAt: Date.now(),
      targetDate,
      status: "active",
      progress: 0,
    };
    this.profile.goals.push(goal);
    this.dirty = true;
    this.persist();
    return goal;
  }

  updateGoalProgress(goalId: string, progress: number): void {
    const goal = this.profile.goals.find((g) => g.id === goalId);
    if (goal) {
      goal.progress = Math.min(100, Math.max(0, progress));
      if (progress >= 100) goal.status = "completed";
      this.dirty = true;
      this.persist();
    }
  }

  completeGoal(goalId: string): void {
    const goal = this.profile.goals.find((g) => g.id === goalId);
    if (goal) {
      goal.status = "completed";
      goal.progress = 100;
      this.dirty = true;
      this.persist();
    }
  }

  removeGoal(goalId: string): void {
    this.profile.goals = this.profile.goals.filter((g) => g.id !== goalId);
    this.dirty = true;
    this.persist();
  }

  getActiveGoals(): UserGoal[] {
    return this.profile.goals.filter((g) => g.status === "active");
  }

  buildUserContext(): string {
    const p = this.profile;
    const parts: string[] = [];

    if (p.name) {
      parts.push(`- User's name: ${p.name}`);
    }

    if (p.domains.length > 0) {
      parts.push(`- Known domains: ${p.domains.join(", ")}`);
    }

    if (Object.keys(p.expertise).length > 0) {
      const exps = Object.entries(p.expertise)
        .map(([d, l]) => `${d}: ${l}`)
        .join(", ");
      parts.push(`- Expertise levels: ${exps}`);
    }

    const prefs = p.preferences;
    const prefLine = [
      prefs.verbosity !== "balanced" ? `verbosity: ${prefs.verbosity}` : "",
      prefs.technicalLevel !== "intermediate" ? `technical level: ${prefs.technicalLevel}` : "",
      prefs.codeExamples !== "when-helpful" ? `code examples: ${prefs.codeExamples}` : "",
    ]
      .filter(Boolean)
      .join(", ");
    if (prefLine) parts.push(`- Preferences: ${prefLine}`);

    if (p.communicationStyle !== "adaptive") {
      parts.push(`- Communication style: ${p.communicationStyle} (they tend to be ${p.communicationStyle})`);
    }
    if (p.learningStyle !== "adaptive") {
      parts.push(`- Learning style: ${p.learningStyle} (they learn best via ${p.learningStyle.replace("-", " ")})`);
    }

    if (p.personalVocabulary.length > 0) {
      const recentTerms = p.personalVocabulary
        .sort((a, b) => b.lastUsed - a.lastUsed)
        .slice(0, 5)
        .map((v) => v.term)
        .join(", ");
      parts.push(`- Their personal terms: ${recentTerms}`);
    }

    if (p.projectAssociations.length > 0) {
      const recent = p.projectAssociations
        .sort((a, b) => b.lastMentioned - a.lastMentioned)
        .slice(0, 3)
        .map((p) => p.projectName)
        .join(", ");
      parts.push(`- Recent projects: ${recent}`);
    }

    const recentMood = this.getRecentMood(3);
    if (recentMood.length > 0) {
      const avgScore = recentMood.reduce((s, m) => s + m.score, 0) / recentMood.length;
      if (avgScore <= -0.3) {
        parts.push(`- Current mood: seems frustrated. Be patient, clear, and supportive.`);
      } else if (avgScore >= 0.3) {
        parts.push(`- Current mood: positive. Friendly and warm tone appropriate.`);
      }
    }

    const activeGoals = this.getActiveGoals();
    if (activeGoals.length > 0) {
      const goalLines = activeGoals.map((g) => `  - ${g.description} (${g.progress}%)`).join("\n");
      parts.push(`- Active goals:\n${goalLines}`);
    }

    if (p.patterns.correctionsReceived > 5) {
      parts.push("- Note: User frequently corrects — be more careful");
    }

    if (p.closenessScore > 0.1) {
      const closenessLabel = p.closenessScore > 0.5 ? "high" : p.closenessScore > 0.2 ? "medium" : "low";
      parts.push(`- Relationship closeness: ${closenessLabel}`);
    }

    return parts.length > 0 ? `\n\n## User Profile\n${parts.join("\n")}` : "";
  }

  getSummary(): string {
    const p = this.profile;
    const lines: string[] = [];

    lines.push(`Name: ${p.name || "(not set)"}`);
    lines.push(`Preferences: ${p.preferences.verbosity}, ${p.preferences.technicalLevel}, ${p.preferences.tone}`);
    lines.push(`Communication style: ${p.communicationStyle}`);
    lines.push(`Learning style: ${p.learningStyle}`);
    lines.push(`Domains: ${p.domains.length > 0 ? p.domains.join(", ") : "none detected"}`);
    lines.push(`Total Messages: ${p.patterns.totalMessages}`);
    lines.push(`Corrections: ${p.patterns.correctionsReceived}`);
    lines.push(`Sessions: ${p.sessionsCount}`);
    lines.push(`Closeness: ${(p.closenessScore * 100).toFixed(0)}%`);
    lines.push(`Active Goals: ${this.getActiveGoals().length}`);
    lines.push(`Vocabulary: ${p.personalVocabulary.length} terms`);
    lines.push(`Projects: ${p.projectAssociations.length} detected`);

    const recentMood = this.getRecentMood(1);
    if (recentMood.length > 0) {
      lines.push(`Last mood: ${recentMood[0].sentiment} (${recentMood[0].energy} energy)`);
    }

    if (Object.keys(p.expertise).length > 0) {
      lines.push(`Expertise:`);
      for (const [domain, level] of Object.entries(p.expertise)) {
        lines.push(`  ${domain}: ${level}`);
      }
    }

    if (p.goals.length > 0) {
      lines.push(`Goals:`);
      for (const g of p.goals) {
        lines.push(`  [${g.status}] ${g.description} (${g.progress}%)`);
      }
    }

    if (p.projectAssociations.length > 0) {
      lines.push(`Recent projects:`);
      for (const proj of p.projectAssociations.slice(-5)) {
        lines.push(`  ${proj.projectName} (${proj.mentionCount}x)`);
      }
    }

    return lines.join("\n");
  }

  reset(): void {
    this.profile = { ...DEFAULT_PROFILE, createdAt: Date.now(), lastActive: Date.now(), lastSessionEnd: Date.now() };
    this.dirty = true;
    this.persist();
  }
}

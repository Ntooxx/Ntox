export type SessionIntent = "deep-work" | "quick-question" | "debugging" | "exploration" | "casual" | "planning" | "learning";

export interface SessionContext {
  intent: SessionIntent;
  startedAt: number;
  queryCount: number;
  consecutiveTechnical: number;
  lastIntentShift: number;
  shiftCount: number;
}

const DEEP_WORK_PATTERNS = [
  /\b(implement|build|create|develop|design|architect|write|refactor|optimize)\b/i,
  /\b(project|feature|module|component|system)\b/i,
  /\b(let's|we need|i need to)\b.{20,}/i,
];

const QUICK_QUESTION_PATTERNS = [
  /^(what|who|when|where|how|why|is|are|can|does|do)\s/i,
  /^.{1,60}\?$/,
  /\b(quick|short|simple|just|briefly)\b/i,
];

const DEBUGGING_PATTERNS = [
  /\b(bug|error|crash|fail|broken|wrong|not working|issue|problem|exception|stack trace|debug)\b/i,
  /\b(why (isn't|doesn't|won't)|what's wrong|help me fix)\b/i,
  /`[^`]+`.*(?:error|fail|broken)/i,
];

const EXPLORATION_PATTERNS = [
  /\b(what is|tell me about|explain|how does|what are|what's)\b/i,
  /\b(learn|understand|curious|overview|introduction|concept)\b/i,
  /^.{80,}$/,
];

const PLANNING_PATTERNS = [
  /\b(plan|roadmap|steps|timeline|milestone|strategy|approach)\b/i,
  /\b(should i|how should|what's the best way|what approach)\b/i,
  /\b(compare|vs|versus|pros|cons|tradeoff|alternative)\b/i,
];

const LEARNING_PATTERNS = [
  /\b(tutorial|guide|learn|study|course|lesson|practice|understand)\b/i,
  /\b(how to|walk through|step by step|beginner|basics)\b/i,
  /\b(explain like|eli5|dummies|simple terms|intuitive)\b/i,
];

const TECHNICAL_KEYWORDS = [
  "code", "function", "class", "api", "error", "bug", "debug", "compile",
  "syntax", "server", "database", "config", "deploy", "test", "build",
  "npm", "git", "docker", "python", "javascript", "typescript", "sql",
  "algorithm", "data structure", "async", "promise", "callback",
];

export interface IntentResult {
  intent: SessionIntent;
  confidence: number;
  scores: Record<string, number>;
}

export function classifySessionIntent(query: string): SessionIntent {
  return classifyIntentWithConfidence(query).intent;
}

export function classifyIntentWithConfidence(query: string): IntentResult {
  const rawScores: [SessionIntent, number][] = [
    ["debugging", DEBUGGING_PATTERNS.filter((p) => p.test(query)).length * 2],
    ["planning", PLANNING_PATTERNS.filter((p) => p.test(query)).length * 1.5],
    ["learning", LEARNING_PATTERNS.filter((p) => p.test(query)).length * 1.5],
    ["deep-work", DEEP_WORK_PATTERNS.filter((p) => p.test(query)).length * 1.5],
    ["exploration", EXPLORATION_PATTERNS.filter((p) => p.test(query)).length],
    ["quick-question", QUICK_QUESTION_PATTERNS.filter((p) => p.test(query)).length],
  ];

  rawScores.sort((a, b) => b[1] - a[1]);

  const maxScore = rawScores[0][1];
  const totalScore = rawScores.reduce((s, [, v]) => s + v, 0);

  const scores: Record<string, number> = {};
  for (const [intent, score] of rawScores) scores[intent] = score;

  if (maxScore <= 0) {
    return { intent: "casual", confidence: 0, scores };
  }

  const confidence = totalScore > 0 ? maxScore / totalScore : 0;
  return { intent: rawScores[0][0], confidence, scores };
}

export function isTechnicalQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return TECHNICAL_KEYWORDS.some((kw) => lower.includes(kw));
}

export function getIntentLabel(intent: SessionIntent): string {
  switch (intent) {
    case "deep-work": return "focused work session";
    case "quick-question": return "quick Q&A";
    case "debugging": return "debugging session";
    case "exploration": return "exploring ideas";
    case "casual": return "casual conversation";
    case "planning": return "planning & strategy";
    case "learning": return "learning & study";
  }
}

export function getIntentGuidance(intent: SessionIntent): string {
  switch (intent) {
    case "deep-work":
      return "- Session type: deep work. Stay focused. No casual tangents. Prioritize actionable output.";
    case "quick-question":
      return "- Session type: quick question. Be concise. Answer directly. Don't add unnecessary context.";
    case "debugging":
      return "- Session type: debugging. Be systematic. Consider edge cases. Show diagnostic steps.";
    case "exploration":
      return "- Session type: exploration. Provide overview first, then offer to dive deeper. Encourage curiosity.";
    case "casual":
      return "- Session type: casual. Friendly tone. Can be conversational and relaxed.";
    case "planning":
      return "- Session type: planning. Structure thoughts. Identify dependencies. Provide clear options.";
    case "learning":
      return "- Session type: learning. Start with fundamentals. Build up gradually. Check understanding.";
  }
}

export function shouldShiftIntent(current: SessionIntent, newQuery: string, consecutiveTechnical: number): SessionIntent | null {
  const result = classifyIntentWithConfidence(newQuery);
  const newIntent = result.intent;
  if (newIntent === current) return null;

  // Only shift if confidence is meaningful
  if (result.confidence < 0.4) return null;

  // Don't shift from deep-work to casual unless very strong signal
  if (current === "deep-work" && newIntent === "casual") {
    if (result.confidence < 0.6) return null;
    const isTech = isTechnicalQuery(newQuery);
    if (isTech || consecutiveTechnical > 0) return null;
  }

  // Shift from quick-question to debugging if error detected
  if (current === "quick-question" && newIntent === "debugging" && result.confidence >= 0.5) return "debugging";

  // Allow shifts that increase focus
  const focusOrder: SessionIntent[] = ["casual", "exploration", "quick-question", "learning", "planning", "debugging", "deep-work"];
  const currentIdx = focusOrder.indexOf(current);
  const newIdx = focusOrder.indexOf(newIntent);

  if (newIdx > currentIdx && result.confidence >= 0.4) return newIntent;

  // Downward shifts require higher confidence
  if (newIdx < currentIdx && result.confidence >= 0.6) return newIntent;

  return null;
}

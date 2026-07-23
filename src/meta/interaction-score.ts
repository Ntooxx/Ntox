import { analyzeMood } from "./mood.js";

export interface InteractionScore {
  solved: boolean;
  satisfaction: number;
  engagement: "high" | "medium" | "low";
  sentimentShift: number;
}

const SOLVED_PATTERNS = [
  /(got it|that works|working now|solved|fixed|made it work|resolved|perfect)\b/i,
  /(thanks|thank you|that helped|useful|exactly what i needed)\b/i,
  /\b(done|completed|finished|working|pass|success)\b/i,
];

const FRUSTRATION_PATTERNS = [
  /(still|not working|same (error|problem|issue)|doesn't work|still broken)\b/i,
  /(no[,.]|that's not|wrong|incorrect|not what I)\b/i,
  /(never mind|forget it|skip|whatever|useless|not helpful)\b/i,
];

const CONTINUATION_PATTERNS = [
  /^(and|so|then|next|also|what about|how about|one more|another)\b/i,
  /\b(follow.up|next step|what else|now what)\b/i,
  /^.{15,}\?$/,
];

export function scoreInteraction(
  userMessage: string,
  assistantResponse: string,
  nextUserMessage?: string
): InteractionScore {
  if (!nextUserMessage) {
    // No feedback yet — neutral score based on response quality
    return {
      solved: false,
      satisfaction: 0,
      engagement: "low",
      sentimentShift: 0,
    };
  }

  const next = nextUserMessage;

  // Detect solved
  const solved = SOLVED_PATTERNS.some((p) => p.test(next));

  // Detect frustration/failure
  const frustrated = FRUSTRATION_PATTERNS.some((p) => p.test(next));

  // Detect engagement level
  let engagement: "high" | "medium" | "low" = "low";
  if (CONTINUATION_PATTERNS.some((p) => p.test(next)) || next.length > 80) {
    engagement = "high";
  } else if (next.length > 20 || next.includes("?")) {
    engagement = "medium";
  }

  // Sentiment shift
  const userMood = analyzeMood(userMessage);
  const nextMood = analyzeMood(next);
  const sentimentShift = nextMood.score - userMood.score;

  // Satisfaction score
  let satisfaction = 0;
  if (solved) satisfaction = 0.8;
  else if (frustrated) satisfaction = -0.7;
  else if (engagement === "high") satisfaction = 0.3;
  else if (engagement === "medium") satisfaction = 0.1;

  // Clamp
  satisfaction = Math.max(-1, Math.min(1, satisfaction));

  return { solved, satisfaction, engagement, sentimentShift };
}

export function getSatisfactionLabel(satisfaction: number): string {
  if (satisfaction >= 0.7) return "thrilled";
  if (satisfaction >= 0.3) return "pleased";
  if (satisfaction >= 0.1) return "content";
  if (satisfaction > -0.1) return "neutral";
  if (satisfaction > -0.4) return "disappointed";
  return "frustrated";
}

const POSITIVE_SIGNALS = [
  "thanks", "thank you", "perfect", "exactly", "great", "awesome",
  "that works", "that's what I needed", "yes", "correct", "nice",
  "good", "works now", "got it", "makes sense", "understood",
  "that helped", "useful", "brilliant", "eureka", "finally",
];

const NEGATIVE_SIGNALS = [
  /\bwrong\b/i, /\bincorrect\b/i, /that'?s\s+not\b/i, /not\s+what\s+I/i,
  /didn'?t\s+work\b/i, /\bstill\b/i, /\bagain\b/i, /same\s+(problem|error|issue)/i,
  /not\s+(working|helpful)\b/i, /that'?s\s+not\s+what\s+I\s+asked/i,
  /you\s+misunderstood/i, /actually[,;]/i, /that'?s\s+wrong\b/i, /not\s+what\s+I\s+meant/i,
  /try\s+again/i, /nope\b/i, /nah\b/i,
];

const CORRECTION_SIGNALS = [
  "no,", "actually,", "that's not", "wrong", "incorrect",
  "you're wrong", "you are wrong", "not quite",
];

export interface EffectivenessResult {
  score: number;
  isPositive: boolean;
  isNegative: boolean;
  isCorrection: boolean;
  signal: PraiseSignal | CorrectionSignal | "neutral";
}

export type PraiseSignal = "thanks" | "confirms" | "continues" | "solved";
export type CorrectionSignal = "explicit-correction" | "repeat-attempt" | "dismissal";

function detectPraiseSignal(text: string): PraiseSignal | null {
  const lower = text.toLowerCase();
  if (/thanks|thank you|cheers|appreciate/i.test(lower)) return "thanks";
  if (/yes|exactly|correct|that('s| is) right|perfect|works/i.test(lower)) return "confirms";
  if (/^(and|so|then|next|also|what about|how about)/i.test(lower)) return "continues";
  if (/got it|makes sense|understood|that helped|solved|fixed/i.test(lower)) return "solved";
  return null;
}

function detectCorrectionSignal(text: string): CorrectionSignal | null {
  const lower = text.toLowerCase();
  if (CORRECTION_SIGNALS.some((s) => lower.startsWith(s))) return "explicit-correction";
  if (/(still|again|same (problem|issue|error)|not working|doesn't work)/i.test(lower)) return "repeat-attempt";
  if (/never mind|forget it|skip|whatever|nevermind|don't worry about it/i.test(lower)) return "dismissal";
  return null;
}

export function scoreEffectiveness(userMessage: string, previousResponse: string): EffectivenessResult {
  const lower = userMessage.toLowerCase();
  const prevLen = previousResponse.length;

  let score = 0;
  let isPositive = false;
  let isNegative = false;

  // Positive signals
  for (const signal of POSITIVE_SIGNALS) {
    if (lower.includes(signal)) {
      score += 0.3;
      isPositive = true;
    }
  }

  // Negative signals
  for (const signal of NEGATIVE_SIGNALS) {
    if (signal.test(userMessage)) {
      score -= 0.4;
      isNegative = true;
    }
  }

  // Very short follow-up question after a long response → likely positive (they engaged)
  if (userMessage.length < 30 && prevLen > 200 && !isNegative) {
    score += 0.1;
    isPositive = true;
  }

  // Abandon topic → negative
  if (/never mind|forget it|skip|whatever/i.test(lower)) {
    score -= 0.5;
    isNegative = true;
  }

  // Follow-up question that builds on the response → positive
  if (/^(and |so |then |what about|how about|also,? )/i.test(lower) && !isNegative) {
    score += 0.2;
    isPositive = true;
  }

  score = Math.max(-1, Math.min(1, score));

  const praiseSignal = detectPraiseSignal(userMessage);
  const correctionSignal = detectCorrectionSignal(userMessage);

  return {
    score,
    isPositive,
    isNegative,
    isCorrection: correctionSignal === "explicit-correction",
    signal: praiseSignal || correctionSignal || "neutral",
  };
}

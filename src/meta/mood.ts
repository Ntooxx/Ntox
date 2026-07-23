import type { Sentiment, Energy, MoodEntry } from "../types/index.js";

const POSITIVE_WORDS = [
  /\bgreat\b/, /\bawesome\b/, /\bnice\b/, /\bgood\b/, /\blove\b/, /\bperfect\b/,
  /\bamazing\b/, /\bcool\b/, /\bfantastic\b/, /\bexcellent\b/, /\bwonderful\b/,
  /\bhappy\b/, /\bglad\b/, /\bthanks\b/, /\bthank\b/, /\bbeautiful\b/, /\bbrilliant\b/,
  /\bsuperb\b/, /\blovely\b/, /\bdelightful\b/, /\bsplendid\b/,
];

const NEGATIVE_WORDS = [
  /\bbad\b/, /\bterrible\b/, /\bawful\b/, /\bhate\b/, /\bhorrible\b/, /\bworst\b/,
  /\bsucks\b/, /\bstupid\b/, /\buseless\b/, /\bbroken\b/, /\bdisaster\b/,
  /\bpathetic\b/, /\bdisgusting\b/, /\bdreadful\b/, /\bannoying\b/, /\bwaste\b/,
  /\bcrap\b/, /\btrash\b/, /\bugly\b/, /\bmiserable\b/,
];

const FRUSTRATED_WORDS = [
  /\bfrustrat(ing|ed|ion)\b/, /\bannoy(ing|ed)\b/, /\bugh\b/, /\bdamn\b/, /\bhell\b/,
  /why\s+won'?t\b/, /not\s+working\b/, /doesn'?t\s+work\b/, /still\s+broken\b/,
  /same\s+(problem|error)\b/, /\baggravat(ing|ed)\b/, /\bexasperat(ing|ed)\b/,
  /fed\s+up\b/, /sick\s+of\b/, /tired\s+of\b/,
];

const EXCITED_WORDS = [
  /\bwow\b/, /\bincredible\b/, /\bmind[-\s]?blown\b/, /\bholy\b/, /\bgenius\b/,
  /\bbreakthrough\b/, /finally\s+got\s+it\b/, /it\s+works\b/, /\beureka\b/, /\byes!\b/,
  /\bwoohoo\b/, /\bexcited\b/, /\bthrilled\b/, /\bstoked\b/, /\bpumped\b/,
];

const TIRED_WORDS = [
  /\btired\b/, /\bexhausted\b/, /\bsleepy\b/, /long\s+day\b/, /\blate\b/,
  /\bburnout\b/, /\bdrained\b/, /worn\s+out\b/, /\bfatigue\b/, /can'?t\s+think\b/,
  /brain[-\s]?dead\b/, /\bzzz\b/,
];

const HIGH_ENERGY = [
  /!!/, /\burgent\b/, /\bquick\b/, /\bfast\b/, /\basap\b/, /\bhurry\b/,
  /\bimmediately\b/, /right\s+now\b/, /\bstoked\b/, /\bpumped\b/, /let'?s\s+go\b/,
  /let'?s\s+do\b/,
];

const LOW_ENERGY = [
  /\btired\b/, /\bslow\b/, /\bzzz\b/, /\bwhatever\b/, /\bmeh\b/, /\be[h]+h?\b/,
  /\bdunno\b/, /\blazy\b/,
];

const NEGATION_WORDS = /\b(not|don'?t|doesn'?t|didn'?t|won'?t|can'?t|couldn'?t|shouldn'?t|isn'?t|aren'?t|wasn'?t|weren'?t|never|no)\b/i;

const EMOJI_SENTIMENT: Record<string, number> = {
  "😊": 0.3, "😄": 0.4, "😂": 0.3, "🥳": 0.5, "🎉": 0.4, "🔥": 0.3,
  "❤️": 0.3, "👍": 0.2, "✅": 0.3, "🙌": 0.4, "✨": 0.3, "💯": 0.4,
  "😢": -0.3, "😠": -0.4, "😡": -0.5, "💀": -0.2, "😤": -0.3,
  "😴": -0.2, "🥱": -0.2, "💤": -0.1,
};

export function detectSentiment(text: string): Sentiment {
  const lower = text.toLowerCase();

  const hasFrustrated = FRUSTRATED_WORDS.some((r) => r.test(lower));
  const hasExcited = EXCITED_WORDS.some((r) => r.test(lower));
  const hasTired = TIRED_WORDS.some((r) => r.test(lower));
  const hasPositive = POSITIVE_WORDS.some((r) => r.test(lower));
  const hasNegative = NEGATIVE_WORDS.some((r) => r.test(lower));

  if (hasFrustrated) return "frustrated";
  if (hasTired) return "tired";
  if (hasExcited) return "excited";
  if (hasPositive && !hasNegative) return "positive";
  if (hasNegative && !hasPositive) return "negative";
  if (hasPositive && hasNegative) return "neutral";

  return "neutral";
}

export function detectEnergy(text: string): Energy {
  const lower = text.toLowerCase();
  if (HIGH_ENERGY.some((r) => r.test(lower))) return "high";
  if (LOW_ENERGY.some((r) => r.test(lower))) return "low";
  const capRatio = text.length > 0 ? text.split("").filter((c) => c >= "A" && c <= "Z").length / text.length : 0;
  const exclams = (text.match(/!/g) || []).length;
  if (exclams > 1 || capRatio > 0.3) return "high";
  return "medium";
}

export function computeSentimentScore(text: string): number {
  const sentences = text.split(/[.!?]+/).filter(Boolean);
  let score = 0;

  for (const sentence of sentences) {
    const senLower = sentence.toLowerCase();
    const isNegated = NEGATION_WORDS.test(senLower);
    let sentScore = 0;

    for (const r of POSITIVE_WORDS) {
      if (r.test(senLower)) sentScore += 0.15;
    }
    for (const r of NEGATIVE_WORDS) {
      if (r.test(senLower)) sentScore -= 0.2;
    }
    for (const r of FRUSTRATED_WORDS) {
      if (r.test(senLower)) sentScore -= 0.25;
    }
    for (const r of EXCITED_WORDS) {
      if (r.test(senLower)) sentScore += 0.3;
    }
    if (isNegated) sentScore = -sentScore;
    score += sentScore;
  }

  // Emoji
  for (const char of text) {
    if (EMOJI_SENTIMENT[char]) score += EMOJI_SENTIMENT[char];
  }

  return Math.max(-1, Math.min(1, score));
}

export function analyzeMood(text: string): MoodEntry {
  return {
    timestamp: Date.now(),
    sentiment: detectSentiment(text),
    energy: detectEnergy(text),
    score: computeSentimentScore(text),
  };
}

export function summarizeSentiment(sentiment: Sentiment): string {
  switch (sentiment) {
    case "positive": return "in a positive mood";
    case "negative": return "frustrated or unhappy";
    case "frustrated": return "visibly frustrated";
    case "excited": return "excited or energized";
    case "tired": return "tired or low energy";
    case "neutral": return "neutral";
  }
}

export function moodToTone(sentiment: Sentiment, energy: Energy): string {
  if (sentiment === "frustrated") return "Be patient, supportive, and extra clear. Avoid jargon. Offer solutions calmly.";
  if (sentiment === "tired") return "Be concise and direct. Minimize cognitive load. Skip unnecessary details.";
  if (sentiment === "excited") return "Match the energy. Be enthusiastic and encouraging.";
  if (sentiment === "positive") return "Friendly and warm. Maintain the good vibe.";
  if (sentiment === "negative") return "Empathetic and helpful. Focus on solutions.";
  if (energy === "high") return "Energetic and responsive. Keep pace.";
  if (energy === "low") return "Gentle and clear. Don't overwhelm.";
  return "Neutral and adaptive.";
}

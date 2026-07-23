import type { Episode, UserProfile } from "../types/index.js";

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toISOString().slice(0, 10);
}

function detectTopicRepeated(episodes: Episode[]): string | null {
  const topics = new Map<string, number>();
  for (const ep of episodes) {
    const words = ep.summary.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    for (const w of words) {
      topics.set(w, (topics.get(w) || 0) + 1);
    }
  }
  let maxCount = 0;
  let maxTopic = "";
  for (const [topic, count] of topics) {
    if (count > maxCount && count >= 3) {
      maxCount = count;
      maxTopic = topic;
    }
  }
  return maxTopic || null;
}

function detectEmotionalContinuity(profile: UserProfile): string | null {
  const recentMood = profile.moodHistory.slice(-5);
  if (recentMood.length < 3) return null;

  // Check if last session ended negatively
  const lastFew = recentMood.slice(-3);
  const frustrated = lastFew.filter((m) => m.score < -0.3).length;
  if (frustrated >= 2) {
    return "Noticed some frustration last time — approach with extra patience";
  }

  // Check if last session ended positively
  const positive = lastFew.filter((m) => m.score > 0.3).length;
  if (positive >= 2) {
    return "Last session ended on a high note — keep the momentum";
  }

  return null;
}

function detectFrustrationTopic(profile: UserProfile): string | null {
  const recentMood = profile.moodHistory.slice(-10);
  const frustrationEpisodes = recentMood.filter((m) => m.score < -0.3);
  if (frustrationEpisodes.length >= 2) {
    return "Be extra clear and patient — recent interactions had some friction";
  }
  return null;
}

export function buildNarrative(memory: Episode[], profile: UserProfile): string {
  if (memory.length === 0) return "";

  const recent = memory.slice(-5).reverse();
  const thisSession = recent.filter((e) => e.timestamp >= profile.lastSessionEnd);

  const parts: string[] = [];

  const lastTimestamp = recent.length > 0 ? recent[recent.length - 1].timestamp : 0;
  if (lastTimestamp > 0) {
    const last = recent[recent.length - 1];
    const when = formatDate(last.timestamp);
    if (thisSession.length === 0) {
      parts.push(`Last seen ${when}: "${last.summary}"`);
    } else {
      parts.push(`Picking up from ${when}`);
    }
  }

  const activeProjects = profile.projectAssociations
    .filter((p) => p.mentionCount > 1)
    .sort((a, b) => b.lastMentioned - a.lastMentioned)
    .slice(0, 3);

  if (activeProjects.length > 0) {
    const names = activeProjects.map((p) => p.projectName).join(", ");
    parts.push(`Active projects: ${names}`);
  }

  const repeatedTopic = detectTopicRepeated(memory);
  if (repeatedTopic) {
    parts.push(`You've been focused on "${repeatedTopic}" lately`);
  }

  // Emotional continuity
  const emotionalNote = detectEmotionalContinuity(profile);
  if (emotionalNote) {
    parts.push(emotionalNote);
  }

  const frustrationNote = detectFrustrationTopic(profile);
  if (frustrationNote && !emotionalNote) {
    parts.push(frustrationNote);
  }

  if (profile.goals.some((g) => g.status === "active")) {
    const active = profile.goals.filter((g) => g.status === "active");
    parts.push(`${active.length} active goal${active.length > 1 ? "s" : ""} in progress`);
  }

  return parts.join(" · ");
}

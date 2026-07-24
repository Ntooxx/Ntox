import type { ObservedSession } from "./observation.js";
import type { MentalModelEntry } from "./mental-model.js";
import type { ExecGoal } from "./executive.js";

export interface FounderPattern {
  id: string;
  description: string;
  frequency: number;
  confidence: number;
  evidence: string[];
  firstDetected: number;
  lastSeen: number;
}

export interface FounderInsight {
  pattern: string;
  insight: string;
  confidence: number;
  evidence: string[];
}

export class FounderIntelligence {

  analyzePatterns(observations: ObservedSession[]): FounderPattern[] {
    if (observations.length < 10) return [];

    const patterns: FounderPattern[] = [];

    const sessionByDay = this.groupByDay(observations);
    const morningSessions = observations.filter((o) => {
      const hour = new Date(o.timestamp).getHours();
      return hour >= 6 && hour < 12;
    });
    const afternoonSessions = observations.filter((o) => {
      const hour = new Date(o.timestamp).getHours();
      return hour >= 12 && hour < 18;
    });
    const eveningSessions = observations.filter((o) => {
      const hour = new Date(o.timestamp).getHours();
      return hour >= 18 || hour < 6;
    });

    if (morningSessions.length > observations.length * 0.4) {
      patterns.push({
        id: "pat_morning_focus",
        description: "You tend to do your most focused work in the morning",
        frequency: morningSessions.length,
        confidence: Math.min(1, morningSessions.length / observations.length),
        evidence: [`${morningSessions.length}/${observations.length} sessions in morning`],
        firstDetected: morningSessions[0].timestamp,
        lastSeen: morningSessions[morningSessions.length - 1].timestamp,
      });
    }

    if (eveningSessions.length > observations.length * 0.4) {
      patterns.push({
        id: "pat_evening_focus",
        description: "You tend to do your most focused work in the evening",
        frequency: eveningSessions.length,
        confidence: Math.min(1, eveningSessions.length / observations.length),
        evidence: [`${eveningSessions.length}/${observations.length} sessions in evening`],
        firstDetected: eveningSessions[0].timestamp,
        lastSeen: eveningSessions[eveningSessions.length - 1].timestamp,
      });
    }

    const topicFrequency = new Map<string, number>();
    for (const obs of observations) {
      for (const topic of obs.topics.slice(0, 3)) {
        topicFrequency.set(topic, (topicFrequency.get(topic) || 0) + 1);
      }
    }

    const dominantTopics = [...topicFrequency.entries()]
      .filter(([, count]) => count >= Math.floor(observations.length * 0.3))
      .sort((a, b) => b[1] - a[1]);

    for (const [topic, count] of dominantTopics) {
      patterns.push({
        id: `pat_topic_${topic.replace(/\s+/g, "_")}`,
        description: `"${topic}" is a recurring focus (${count} sessions)`,
        frequency: count,
        confidence: Math.min(1, count / observations.length),
        evidence: [`${count}/${observations.length} sessions mention "${topic}"`],
        firstDetected: observations.find((o) => o.topics.includes(topic))?.timestamp || Date.now(),
        lastSeen: [...observations].reverse().find((o) => o.topics.includes(topic))?.timestamp || Date.now(),
      });
    }

    const toolFrequency = new Map<string, number>();
    for (const obs of observations) {
      for (const [tool, count] of Object.entries(obs.toolUsage)) {
        toolFrequency.set(tool, (toolFrequency.get(tool) || 0) + count);
      }
    }

    const dominantTools = [...toolFrequency.entries()]
      .filter(([, count]) => count >= 5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    for (const [tool, count] of dominantTools) {
      patterns.push({
        id: `pat_tool_${tool}`,
        description: `Heavy user of "${tool}" (${count} uses)`,
        frequency: count,
        confidence: Math.min(1, count / (observations.length * 3)),
        evidence: [`${tool} used ${count} times across ${observations.length} sessions`],
        firstDetected: observations[0].timestamp,
        lastSeen: observations[observations.length - 1].timestamp,
      });
    }

    const correctionRate = observations.filter((o) => o.correctionsCount > 0).length / observations.length;
    if (correctionRate > 0.2 && observations.length >= 5) {
      patterns.push({
        id: "pat_high_corrections",
        description: `High correction rate (${(correctionRate * 100).toFixed(0)}%) — you refine often`,
        frequency: Math.round(correctionRate * observations.length),
        confidence: correctionRate,
        evidence: [`${Math.round(correctionRate * observations.length)} sessions with corrections`],
        firstDetected: observations[0].timestamp,
        lastSeen: observations[observations.length - 1].timestamp,
      });
    }

    return patterns.sort((a, b) => b.confidence - a.confidence);
  }

  surfaceInsights(observations: ObservedSession[], beliefs: MentalModelEntry[]): FounderInsight[] {
    const insights: FounderInsight[] = [];

    if (observations.length < 10) return insights;

    const patterns = this.analyzePatterns(observations);
    const topicPatterns = patterns.filter((p) => p.id.startsWith("pat_topic_"));

    if (topicPatterns.length >= 3) {
      const topTopics = topicPatterns.slice(0, 3).map((p) => p.description);
      insights.push({
        pattern: "topic_concentration",
        insight: `Your work concentrates on ${topicPatterns.length} recurring topics: ${topTopics.join(", ")}`,
        confidence: 0.7,
        evidence: topTopics,
      });
    }

    const challengedBeliefs = beliefs.filter((b) => b.status === "challenged");
    if (challengedBeliefs.length >= 2) {
      insights.push({
        pattern: "belief_evolution",
        insight: `You've changed your mind on ${challengedBeliefs.length} beliefs. This suggests intellectual flexibility.`,
        confidence: 0.6,
        evidence: challengedBeliefs.map((b) => b.statement),
      });
    }

    const strongBeliefs = beliefs.filter((b) => b.mentionCount >= 5 && b.status === "active");
    if (strongBeliefs.length >= 2) {
      insights.push({
        pattern: "strong_convictions",
        insight: `You hold ${strongBeliefs.length} strong convictions (mentioned 5+ times). These shape your decision-making.`,
        confidence: 0.65,
        evidence: strongBeliefs.map((b) => `"${b.statement}" (${b.mentionCount}x)`),
      });
    }

    const timePatterns = this.analyzeTimePatterns(observations);
    if (timePatterns) {
      insights.push(timePatterns);
    }

    const toolPatterns = patterns.filter((p) => p.id.startsWith("pat_tool_"));
    if (toolPatterns.length >= 2) {
      insights.push({
        pattern: "tool_preferences",
        insight: `You rely heavily on: ${toolPatterns.map((p) => p.description).join("; ")}`,
        confidence: 0.5,
        evidence: toolPatterns.map((p) => p.description),
      });
    }

    return insights.sort((a, b) => b.confidence - a.confidence);
  }

  detectDecisionTendencies(observations: ObservedSession[]): string[] {
    const tendencies: string[] = [];

    if (observations.length < 5) return tendencies;

    const intentCounts = new Map<string, number>();
    for (const obs of observations) {
      intentCounts.set(obs.sessionIntent, (intentCounts.get(obs.sessionIntent) || 0) + 1);
    }

    const total = observations.length;
    for (const [intent, count] of intentCounts) {
      if (count / total > 0.5) {
        tendencies.push(`You predominantly work in "${intent}" mode (${count}/${total} sessions)`);
      }
    }

    const avgDuration = observations.reduce((s, o) => s + o.durationMinutes, 0) / total;
    if (avgDuration > 30) {
      tendencies.push(`Long sessions (avg ${Math.round(avgDuration)} min) — you work in deep blocks`);
    } else if (avgDuration < 10) {
      tendencies.push(`Short sessions (avg ${Math.round(avgDuration)} min) — you work in quick bursts`);
    }

    const avgCorrections = observations.reduce((s, o) => s + o.correctionsCount, 0) / total;
    if (avgCorrections > 0.5) {
      tendencies.push(`High correction rate — you refine through iteration`);
    }

    return tendencies;
  }

  detectBlindSpots(observations: ObservedSession[], goals: ExecGoal[]): string[] {
    const blindSpots: string[] = [];

    if (observations.length < 10 || goals.length === 0) return blindSpots;

    const activeGoals = goals.filter((g) => g.status === "active");
    for (const goal of activeGoals) {
      const goalWords = goal.description.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const matchingSessions = observations.filter((o) => {
        const topicText = o.topics.join(" ");
        return goalWords.some((w) => topicText.includes(w));
      });

      if (matchingSessions.length === 0) {
        blindSpots.push(`Goal "${goal.description}" has no matching sessions — may need attention`);
      }
    }

    const recentObs = observations.slice(-10);
    const recentTopics = new Set(recentObs.flatMap((o) => o.topics));
    const oldObs = observations.slice(0, Math.floor(observations.length / 2));
    const oldTopics = new Set(oldObs.flatMap((o) => o.topics));

    const abandonedTopics = [...oldTopics].filter((t) => !recentTopics.has(t));
    if (abandonedTopics.length >= 3) {
      blindSpots.push(`Topics you've moved away from: ${abandonedTopics.slice(0, 3).join(", ")}`);
    }

    return blindSpots;
  }

  private groupByDay(observations: ObservedSession[]): Map<string, ObservedSession[]> {
    const groups = new Map<string, ObservedSession[]>();
    for (const obs of observations) {
      const day = new Date(obs.timestamp).toISOString().slice(0, 10);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day)!.push(obs);
    }
    return groups;
  }

  private analyzeTimePatterns(observations: ObservedSession[]): FounderInsight | null {
    if (observations.length < 10) return null;

    const hourCounts = new Map<number, number>();
    for (const obs of observations) {
      const hour = new Date(obs.timestamp).getHours();
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    }

    let peakHour = 0;
    let peakCount = 0;
    for (const [hour, count] of hourCounts) {
      if (count > peakCount) {
        peakHour = hour;
        peakCount = count;
      }
    }

    if (peakCount >= observations.length * 0.3) {
      const timeLabel = peakHour < 12 ? "morning" : peakHour < 18 ? "afternoon" : "evening";
      return {
        pattern: "peak_time",
        insight: `You're most active in the ${timeLabel} (${peakCount}/${observations.length} sessions around ${peakHour}:00)`,
        confidence: Math.min(1, peakCount / observations.length),
        evidence: [`${peakCount} sessions at ${peakHour}:00`],
      };
    }

    return null;
  }
}
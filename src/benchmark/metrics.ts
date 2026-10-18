export function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function percentDelta(on: number, off: number): number {
  if (off === 0) return on > 0 ? 100 : 0;
  return Math.round(((on - off) / off) * 1000) / 10;
}

export interface DomainScorePair {
  domain: string;
  on: number;
  off: number;
}

export function computeDomainDeltas(pairs: DomainScorePair[]): Record<string, number> {
  const grouped = new Map<string, { on: number[]; off: number[] }>();
  for (const pair of pairs) {
    const entry = grouped.get(pair.domain) ?? { on: [], off: [] };
    entry.on.push(pair.on);
    entry.off.push(pair.off);
    grouped.set(pair.domain, entry);
  }

  const deltas: Record<string, number> = {};
  for (const [domain, scores] of grouped) {
    deltas[domain] = percentDelta(average(scores.on), average(scores.off));
  }
  return deltas;
}

export function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function assessDelta(delta: number): string {
  if (delta > 15) return "Strong improvement";
  if (delta > 5) return "Moderate improvement";
  if (delta > -5) return "Neutral";
  return "Regression";
}

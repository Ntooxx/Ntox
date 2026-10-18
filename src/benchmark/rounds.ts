import { ALL_ROUNDS, type BenchmarkRound } from "./dataset.js";

export function selectRounds(spec: string): BenchmarkRound[] {
  const normalized = spec.trim().toLowerCase();
  if (!normalized || normalized === "all") return [...ALL_ROUNDS];

  const picked: BenchmarkRound[] = [];
  const seen = new Set<number>();

  for (const token of normalized.split(",")) {
    const index = Number(token.trim());
    if (!Number.isInteger(index) || index < 1 || index > ALL_ROUNDS.length) continue;
    if (seen.has(index)) continue;
    seen.add(index);
    picked.push(ALL_ROUNDS[index - 1]);
  }

  return picked;
}

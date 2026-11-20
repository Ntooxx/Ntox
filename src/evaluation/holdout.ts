/**
 * Held-out task partitioning for honest transfer measurement.
 *
 * A task id is assigned to the holdout deterministically from a stable
 * fingerprint so the same physical task never leaks into training on one run
 * and holdout on another. This is what makes "transfer lift" meaningful.
 */
export interface TransferStatsLike {
  supported: number;
  rejected: number;
  avgLift: number;
}

function fnv1a(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function isHoldoutId(id: string, fingerprint: string, ratio: number): boolean {
  return fnv1a(`${fingerprint}::${id}`) % 1000 < ratio * 1000;
}

/** Deterministically split task ids into train/holdout for a given fingerprint. */
export function splitHoldout(
  ids: string[],
  fingerprint: string,
  ratio = 0.2,
): { train: string[]; holdout: string[] } {
  const unique = Array.from(new Set(ids)).sort();
  const train: string[] = [];
  const holdout: string[] = [];
  for (const id of unique) {
    if (isHoldoutId(id, fingerprint, ratio)) {
      holdout.push(id);
    } else {
      train.push(id);
    }
  }
  if (holdout.length === 0 && unique.length > 0) {
    // Ensure the holdout is non-empty so transfer is measurable.
    const moved = unique[fnv1a(fingerprint) % unique.length];
    const idx = train.indexOf(moved);
    if (idx >= 0) {
      train.splice(idx, 1);
      holdout.push(moved);
    }
  }
  return { train, holdout };
}

export function isHoldout(id: string, holdout: ReadonlySet<string>): boolean {
  return holdout.has(id);
}

/** Render a transfer summary line set for an ALIVE-style report. */
export function transferSummary(holdout: ReadonlySet<string>, stats: TransferStatsLike): string[] {
  const total = stats.supported + stats.rejected;
  const lines: string[] = [];
  lines.push(`Holdout tasks: ${holdout.size}`);
  lines.push(`Transfer supported: ${stats.supported}`);
  lines.push(`Transfer rejected: ${stats.rejected}`);
  lines.push(`Transfer avgLift: ${total > 0 ? stats.avgLift.toFixed(4) : "n/a"}`);
  return lines;
}
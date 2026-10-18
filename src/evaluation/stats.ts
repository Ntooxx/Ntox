export interface ConfidenceInterval {
  mean: number;
  lower: number;
  upper: number;
  confidence: number;
  significant: boolean;
}

export interface RegressionResult {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
}

export interface PowerInput {
  alpha?: number;
  power?: number;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

export function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let total = 0;
  for (const value of values) total += (value - m) ** 2;
  return total / (values.length - 1);
}

export function stddev(values: number[]): number {
  return Math.sqrt(variance(values));
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pairedDifferences(baseline: number[], treatment: number[]): number[] {
  const length = Math.min(baseline.length, treatment.length);
  const diffs: number[] = [];
  for (let i = 0; i < length; i++) diffs.push(treatment[i] - baseline[i]);
  return diffs;
}

export function bootstrapCI(
  samples: number[],
  options: { iterations?: number; confidence?: number; seed?: number } = {},
): ConfidenceInterval {
  const iterations = options.iterations ?? 10000;
  const confidence = options.confidence ?? 0.95;
  if (samples.length === 0) {
    return { mean: 0, lower: 0, upper: 0, confidence, significant: false };
  }
  const random = mulberry32(options.seed ?? 1337);
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let total = 0;
    for (let j = 0; j < samples.length; j++) {
      total += samples[Math.floor(random() * samples.length)];
    }
    means.push(total / samples.length);
  }
  means.sort((a, b) => a - b);
  const tail = (1 - confidence) / 2;
  const lower = percentile(means, tail);
  const upper = percentile(means, 1 - tail);
  return {
    mean: mean(samples),
    lower,
    upper,
    confidence,
    significant: lower > 0 || upper < 0,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, p * (sorted.length - 1)));
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function cohensD(samples: number[]): number {
  const sd = stddev(samples);
  if (sd === 0) return mean(samples) === 0 ? 0 : Infinity;
  return mean(samples) / sd;
}

export function linearSlope(points: { x: number; y: number }[]): RegressionResult {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: n === 1 ? points[0].y : 0, r2: 0, n };
  const meanX = mean(points.map((p) => p.x));
  const meanY = mean(points.map((p) => p.y));
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.x - meanX) * (point.y - meanY);
    denominator += (point.x - meanX) ** 2;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;
  let ssRes = 0;
  let ssTot = 0;
  for (const point of points) {
    const predicted = slope * point.x + intercept;
    ssRes += (point.y - predicted) ** 2;
    ssTot += (point.y - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  return { slope, intercept, r2, n };
}

export function inverseNormal(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= phigh) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

export function requiredPairedSampleSize(effectSize: number, input: PowerInput = {}): number {
  const alpha = input.alpha ?? 0.05;
  const power = input.power ?? 0.8;
  if (!Number.isFinite(effectSize) || effectSize === 0) return Infinity;
  const zAlpha = inverseNormal(1 - alpha / 2);
  const zPower = inverseNormal(power);
  const n = ((zAlpha + zPower) / Math.abs(effectSize)) ** 2;
  return Math.max(2, Math.ceil(n));
}

export function summarize(values: number[]): { mean: number; std: number; n: number } {
  return { mean: mean(values), std: stddev(values), n: values.length };
}

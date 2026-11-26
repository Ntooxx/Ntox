export function findSpeechBounds(
  samples: Int16Array,
  threshold = 400,
  window = 160,
): { start: number; end: number } | null {
  let start = -1;
  let end = -1;
  for (let index = 0; index + window <= samples.length; index += window) {
    let energy = 0;
    for (let offset = 0; offset < window; offset++) energy += Math.abs(samples[index + offset]!);
    const rms = energy / window;
    if (rms > threshold && start < 0) start = index;
    if (rms > threshold) end = index + window;
  }
  return start < 0 ? null : { start, end };
}

export function isSilent(samples: Int16Array, threshold = 400): boolean {
  return findSpeechBounds(samples, threshold) === null;
}

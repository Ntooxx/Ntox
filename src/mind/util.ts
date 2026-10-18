export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function dayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

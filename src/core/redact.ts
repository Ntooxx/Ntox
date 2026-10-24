const MASK = "[redacted]";
const MIN_REGISTERED_LENGTH = 8;

const registered = new Set<string>();

const SECRET_PATTERNS: RegExp[] = [
  /sk-or-v1-[A-Za-z0-9_-]{16,}/g,
  /sk-(?:ant-)?[A-Za-z0-9_-]{20,}/g,
  /gsk_[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /AIza[A-Za-z0-9_-]{30,}/g,
];

export function registerSecret(value: unknown): void {
  if (typeof value !== "string") return;
  if (value.length < MIN_REGISTERED_LENGTH) return;
  registered.add(value);
}

export function registerSecrets(values: Iterable<unknown>): void {
  for (const value of values) registerSecret(value);
}

export function clearRegisteredSecrets(): void {
  registered.clear();
}

export function isRegisteredSecret(value: string): boolean {
  return registered.has(value);
}

export function redact(input: string): string {
  let output = input;
  const secrets = [...registered].sort((a, b) => b.length - a.length);
  for (const secret of secrets) {
    if (output.includes(secret)) output = output.split(secret).join(MASK);
  }
  for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, MASK);
  return output;
}

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) result[key] = redactValue(item);
    return result;
  }
  return value;
}

export function redactError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return redact(text);
}

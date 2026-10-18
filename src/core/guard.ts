const INJECTION_PATTERNS = [
  /\[INST\]|<<SYS>>|<\/SYS>/i,
  /<\|system\|>/i,
  /<\|im_start\|>system/i,
  /\bignore (?:all )?previous (?:instructions?|prompts?|messages?)/i,
  /\byou are now (?:DAN|jailbroken|unfiltered)/i,
  /\bpretend (?:to be|you are) (?:an? )?(?:unfiltered|evil|malicious|unrestricted)/i,
  /\boverride (?:your )?(?:system |safety )?(?:prompt|instructions?|rules?)/i,
  /\bbypass (?:your )?(?:content |safety )?(?:filter|restrictions?|guidelines?)/i,
  /\bdo not follow (?:your )?(?:guidelines|rules|instructions?|ethics)/i,
  /\bsimulate (?:an? )?(?:unrestricted|unfiltered|unethical)/i,
  /\bfor educational purposes only\b.*\b(?:hack|exploit|malware|weapon)/i,
  /\(system_message:.*\)/i,
  /\brespond as if you (?:have|had) no (?:restrictions?|limitations?|safety|rules)\b/i,
  /\byou are a (?:developer|operator) mode\b/i,
  /\bno (?:need|requirement) (?:for|to follow) (?:safety|ethics|guidelines)\b/i,
];

const SECRET_PATTERNS = [
  /sk-(?:or-)?[a-zA-Z0-9]{20,}/g,
  /[0-9]{8,10}:[a-zA-Z0-9_-]{30,40}/g,
  /Bearer\s+[a-zA-Z0-9_-]{20,}/g,
  /api[_-]?key[=:]\s*['"]?[a-zA-Z0-9_-]{20,}['"]?/gi,
  /token[=:]\s*['"]?[a-zA-Z0-9_.-]{20,}['"]?/gi,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bghp_[a-zA-Z0-9]{36}\b/g,
  /\bgithub_pat_[a-zA-Z0-9_]{22,}\b/g,
  /\bglpat-[a-zA-Z0-9\-_]{20,}\b/g,
  /\bpostgres(?:ql)?:\/\/[^\s]+:[^\s]+@[^\s]+/gi,
  /\bmongodb(?:\+srv)?:\/\/[^\s]+:[^\s]+@[^\s]+/gi,
];

export interface GuardResult {
  clean: boolean;
  blocked: boolean;
  reason?: string;
  sanitizedInput?: string;
  sanitizedOutput?: string;
}

export function detectPromptInjection(input: string): GuardResult {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      return {
        clean: false,
        blocked: true,
        reason: `Prompt injection pattern detected`,
      };
    }
  }
  return { clean: true, blocked: false };
}

export function sanitizeOutput(output: string): string {
  let sanitized = output;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }
  return sanitized;
}

export function sanitizeInput(input: string): string {
  return input
    .replace(/<\|[^|]+\|>/g, "")
    .replace(/\[INST\].*?\[\/INST\]/gi, "")
    .replace(/\(system[^)]*\)/gi, "")
    .trim();
}

const PRIVATE_KEY_BEGIN = "-----BEGIN";
const PRIVATE_KEY_END = /-----END [A-Z0-9 ]*PRIVATE KEY-----/;

const SECRET_START_PATTERNS: RegExp[] = [
  /sk-/,
  /-----BEGIN/,
  /Bearer\s/i,
  /ghp_/,
  /github_pat_/,
  /glpat-/,
  /\bAKIA[0-9A-Z]/,
  /[0-9]{8,10}:/,
  /api[_-]?key[=:]/i,
  /(^|[^a-z])token[=:]/i,
  /postgres(?:ql)?:\/\//i,
  /mongodb(?:\+srv)?:\/\//i,
];

export class StreamingSanitizer {
  private buf = "";
  private emitted = 0;
  private readonly hold: number;

  constructor(hold: number = 64) {
    this.hold = hold;
  }

  private firstSecretStart(from: number): number {
    let earliest = -1;
    for (const pattern of SECRET_START_PATTERNS) {
      const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
      const re = new RegExp(pattern.source, flags);
      re.lastIndex = from;
      const match = re.exec(this.buf);
      if (match && match.index >= from) {
        if (earliest === -1 || match.index < earliest) earliest = match.index;
      }
    }
    return earliest;
  }

  push(token: string): string {
    if (!token) return "";
    this.buf += token;
    const safe = sanitizeOutput(this.buf);

    const beginIdx = safe.indexOf(PRIVATE_KEY_BEGIN);
    if (beginIdx >= 0 && !PRIVATE_KEY_END.test(safe.slice(beginIdx))) {
      const maxEmit = beginIdx;
      if (maxEmit <= this.emitted) return "";
      const out = safe.slice(this.emitted, maxEmit);
      this.emitted += out.length;
      return out;
    }

    let limit = safe.length - this.hold;
    const secretStart = this.firstSecretStart(this.emitted);
    if (secretStart >= 0) limit = Math.min(limit, secretStart);

    if (safe !== this.buf) {
      let diverge = 0;
      const minLen = Math.min(safe.length, this.buf.length);
      while (diverge < minLen && safe[diverge] === this.buf[diverge]) diverge++;
      limit = Math.min(limit, diverge);
    }

    if (limit <= this.emitted) return "";
    const out = safe.slice(this.emitted, limit);
    this.emitted += out.length;

    if (this.buf.length > 8192) {
      this.buf = safe;
      this.emitted = Math.min(this.emitted, this.buf.length);
    }
    return out;
  }

  flush(): string {
    let safe = sanitizeOutput(this.buf);
    const beginIdx = safe.search(/-----BEGIN/);
    if (beginIdx >= 0 && !PRIVATE_KEY_END.test(safe.slice(beginIdx))) {
      safe = `${safe.slice(0, beginIdx)}[REDACTED]`;
    }
    const out = safe.slice(Math.min(this.emitted, safe.length));
    this.buf = "";
    this.emitted = 0;
    return out;
  }

  reset(): void {
    this.buf = "";
    this.emitted = 0;
  }
}

export function createStreamingSanitizer(hold?: number): StreamingSanitizer {
  return new StreamingSanitizer(hold);
}

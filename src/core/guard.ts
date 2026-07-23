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

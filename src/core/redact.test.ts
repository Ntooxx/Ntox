import { describe, it, expect, afterEach } from "vitest";
import {
  clearRegisteredSecrets,
  isRegisteredSecret,
  redact,
  redactError,
  redactValue,
  registerSecret,
} from "./redact.js";

afterEach(() => clearRegisteredSecrets());

describe("registerSecret", () => {
  it("ignores values that are too short to be a secret", () => {
    registerSecret("abc");
    expect(isRegisteredSecret("abc")).toBe(false);
    expect(redact("value abc")).toBe("value abc");
  });

  it("registers exactly known long values", () => {
    registerSecret("custom-secret-value-123456");
    expect(isRegisteredSecret("custom-secret-value-123456")).toBe(true);
  });
});

describe("redact", () => {
  it("redacts registered screen values anywhere in a string", () => {
    registerSecret("sk-or-v1-abcdefghijklmnop");
    const output = redact("call failed with key sk-or-v1-abcdefghijklmnop at line 2");
    expect(output).not.toContain("sk-or-v1-abcdefghijklmnop");
    expect(output).toContain("[redacted]");
    expect(output).toContain("at line 2");
  });

  it("redacts key-shaped strings even when not registered", () => {
    expect(redact("token=sk-or-v1-0123456789abcdefghij")).not.toContain("0123456789abcdefghij");
    expect(redact("gsk_0123456789abcdefghijklmnopqrst")).toContain("[redacted]");
    expect(redact("8598712471:AAEkH44tlJKe59SPaK0rI3CaGTWjJa8nb_Q")).toContain("[redacted]");
    expect(redact("xo" + "xb-123456789012-abcdefghijklmno")).toContain("[redacted]");
  });

  it("leaves ordinary text alone", () => {
    expect(redact("the model returned 42 tokens")).toBe("the model returned 42 tokens");
  });

  it("redacts the longest registered value first", () => {
    registerSecret("sk-or-v1-aaaa");
    registerSecret("sk-or-v1-aaaaaaaaaaaa");
    expect(redact("x sk-or-v1-aaaaaaaaaaaa y")).toBe("x [redacted] y");
  });
});

describe("redactValue", () => {
  it("walks nested structures", () => {
    registerSecret("sk-or-v1-nestedsecret");
    const output = redactValue({ error: "bad key sk-or-v1-nestedsecret", list: ["sk-or-v1-nestedsecret", 5] }) as {
      error: string;
      list: unknown[];
    };
    expect(output.error).toBe("bad key [redacted]");
    expect(output.list[0]).toBe("[redacted]");
    expect(output.list[1]).toBe(5);
  });
});

describe("redactError", () => {
  it("redacts error messages", () => {
    registerSecret("sk-or-v1-errorsecret");
    expect(redactError(new Error("auth failed: sk-or-v1-errorsecret"))).toBe("auth failed: [redacted]");
    expect(redactError("plain string")).toBe("plain string");
  });
});

import { describe, it, expect } from "vitest";
import {
  NtoxError,
  ApiError,
  StreamError,
  NetworkError,
  TimeoutError,
  EmptyResponseError,
  ConfigError,
  isRetryableError,
  isTransientStreamError,
  describeError,
} from "./errors.js";

describe("NtoxError", () => {
  it("creates base error with code and retryable", () => {
    const e = new NtoxError("msg", "CODE", true, 500);
    expect(e.message).toBe("msg");
    expect(e.code).toBe("CODE");
    expect(e.retryable).toBe(true);
    expect(e.status).toBe(500);
    expect(NtoxError.isNtoxError(e)).toBe(true);
    expect(NtoxError.isNtoxError(new Error())).toBe(false);
  });
});

describe("ApiError", () => {
  it("creates with auto-retryable for 429/502/503", () => {
    expect(new ApiError("x", 429, "openai").retryable).toBe(true);
    expect(new ApiError("x", 502, "openai").retryable).toBe(true);
    expect(new ApiError("x", 503, "openai").retryable).toBe(true);
  });

  it("creates non-retryable for 401/404", () => {
    expect(new ApiError("x", 401, "openai").retryable).toBe(false);
    expect(new ApiError("x", 404, "openai").retryable).toBe(false);
  });

  it("stores httpStatus and provider", () => {
    const e = new ApiError("bad", 400, "groq");
    expect(e.httpStatus).toBe(400);
    expect(e.provider).toBe("groq");
  });
});

describe("StreamError", () => {
  it("is always retryable", () => {
    expect(new StreamError("x").retryable).toBe(true);
  });
});

describe("NetworkError", () => {
  it("is always retryable", () => {
    expect(new NetworkError("x").retryable).toBe(true);
  });
});

describe("TimeoutError", () => {
  it("is always retryable", () => {
    expect(new TimeoutError("x").retryable).toBe(true);
  });
});

describe("EmptyResponseError", () => {
  it("is not retryable", () => {
    expect(new EmptyResponseError("x").retryable).toBe(false);
  });
});

describe("ConfigError", () => {
  it("is not retryable", () => {
    expect(new ConfigError("x").retryable).toBe(false);
  });
});

describe("isRetryableError", () => {
  it("returns true for retryable errors", () => {
    expect(isRetryableError(new NetworkError("x"))).toBe(true);
    expect(isRetryableError(new TimeoutError("x"))).toBe(true);
    expect(isRetryableError(new ApiError("x", 429, "x"))).toBe(true);
  });

  it("returns false for non-retryable", () => {
    expect(isRetryableError(new ConfigError("x"))).toBe(false);
    expect(isRetryableError(new Error("x"))).toBe(false);
    expect(isRetryableError("string")).toBe(false);
  });
});

describe("isTransientStreamError", () => {
  it("is true for retryable NTOX errors", () => {
    expect(isTransientStreamError(new StreamError("stream reset"))).toBe(true);
    expect(isTransientStreamError(new NetworkError("x"))).toBe(true);
    expect(isTransientStreamError(new TimeoutError("x"))).toBe(true);
    expect(isTransientStreamError(new ApiError("rate limited", 429, "openrouter"))).toBe(true);
    expect(isTransientStreamError(new ApiError("bad gateway", 502, "openrouter"))).toBe(true);
  });

  it("is false for non-retryable provider errors", () => {
    expect(isTransientStreamError(new ApiError("Check your API key", 401, "openrouter"))).toBe(false);
    expect(isTransientStreamError(new ApiError("bad request", 400, "openrouter"))).toBe(false);
    expect(isTransientStreamError(new ConfigError("no model"))).toBe(false);
    expect(isTransientStreamError(new EmptyResponseError("empty"))).toBe(false);
  });

  it("classifies raw transport failures from undici as transient", () => {
    expect(isTransientStreamError(new TypeError("terminated"))).toBe(true);
    expect(isTransientStreamError(new TypeError("fetch failed"))).toBe(true);
    expect(isTransientStreamError(new Error("read ECONNRESET"))).toBe(true);
    expect(isTransientStreamError(new Error("other side closed"))).toBe(true);
    expect(isTransientStreamError(new Error("Premature close"))).toBe(true);
  });

  it("never retries a cancellation", () => {
    expect(isTransientStreamError(new Error("cancelled"))).toBe(false);
    expect(isTransientStreamError("cancelled")).toBe(false);
  });

  it("does not retry unrelated errors", () => {
    expect(isTransientStreamError(new Error("simulated stream failure"))).toBe(false);
    expect(isTransientStreamError(new Error("ENOENT: no such file"))).toBe(false);
  });
});

describe("describeError", () => {
  it("describes 401 as auth error", () => {
    const d = describeError(new ApiError("unauthorized", 401, "openai"));
    expect(d.isAuth).toBe(true);
    expect(d.hint).toContain("API key");
  });

  it("describes 402 as credits error", () => {
    const d = describeError(new ApiError("no money", 402, "openai"));
    expect(d.isCredits).toBe(true);
  });

  it("describes 404 as not found", () => {
    const d = describeError(new ApiError("gone", 404, "openai"));
    expect(d.isNotFound).toBe(true);
  });

  it("describes 429 as rate limited", () => {
    const d = describeError(new ApiError("slow down", 429, "openai"));
    expect(d.isRateLimited).toBe(true);
  });

  it("describes NetworkError", () => {
    const d = describeError(new NetworkError("fetch failed"));
    expect(d.isNetwork).toBe(true);
  });

  it("describes TimeoutError", () => {
    const d = describeError(new TimeoutError("timed out"));
    expect(d.isTimeout).toBe(true);
  });

  it("handles plain Error", () => {
    const d = describeError(new Error("something"));
    expect(d.message).toBe("something");
    expect(d.hint).toBeNull();
  });

  it("handles non-Error", () => {
    const d = describeError("just a string");
    expect(d.message).toBe("just a string");
    expect(d.hint).toBeNull();
  });
});

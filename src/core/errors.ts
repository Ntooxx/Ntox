export class NtoxError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly status?: number;

  constructor(message: string, code: string, retryable: boolean = false, status?: number) {
    super(message);
    this.name = code;
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }

  static isNtoxError(e: unknown): e is NtoxError {
    return e instanceof NtoxError;
  }
}

export class ApiError extends NtoxError {
  public readonly httpStatus: number;
  public readonly provider: string;

  constructor(
    message: string,
    httpStatus: number,
    provider: string,
    retryable?: boolean
  ) {
    super(
      message,
      "API_ERROR",
      retryable ?? (httpStatus === 429 || httpStatus === 502 || httpStatus === 503),
      httpStatus
    );
    this.httpStatus = httpStatus;
    this.provider = provider;
  }
}

export class StreamError extends NtoxError {
  public readonly streamCode?: string | number;

  constructor(message: string, streamCode?: string | number) {
    super(message, "STREAM_ERROR", true);
    this.streamCode = streamCode;
  }
}

export class NetworkError extends NtoxError {
  constructor(message: string) {
    super(message, "NETWORK_ERROR", true);
  }
}

export class TimeoutError extends NtoxError {
  constructor(message: string) {
    super(message, "TIMEOUT_ERROR", true);
  }
}

export class EmptyResponseError extends NtoxError {
  constructor(message: string) {
    super(message, "EMPTY_RESPONSE", false);
  }
}

export class ConfigError extends NtoxError {
  constructor(message: string) {
    super(message, "CONFIG_ERROR", false);
  }
}

export function isRetryableError(e: unknown): boolean {
  return e instanceof NtoxError && e.retryable;
}

export function describeError(e: unknown): {
  message: string;
  hint: string | null;
  isAuth: boolean;
  isNotFound: boolean;
  isRateLimited: boolean;
  isCredits: boolean;
  isNetwork: boolean;
  isTimeout: boolean;
} {
  if (e instanceof ApiError) {
    return {
      message: e.message,
      hint:
        e.httpStatus === 401 ? "Check your API key (/config) and provider settings (/provider)" :
        e.httpStatus === 402 ? "Insufficient credits or quota exceeded" :
        e.httpStatus === 404 ? "Model may not be available on this provider. Try /model to list available models, or check /provider" :
        e.httpStatus === 429 ? "Rate limited. Wait a moment and try again" :
        e.httpStatus === 400 ? "Bad request. Model may not support these parameters" :
        e.httpStatus === 502 || e.httpStatus === 503 ? "Provider temporarily unavailable. Try again in a moment" :
        null,
      isAuth: e.httpStatus === 401 || e.httpStatus === 403,
      isNotFound: e.httpStatus === 404,
      isRateLimited: e.httpStatus === 429,
      isCredits: e.httpStatus === 402,
      isNetwork: false,
      isTimeout: false,
    };
  }

  if (e instanceof NetworkError) {
    return {
      message: e.message,
      hint: "Could not reach the API. Check your network or the provider status",
      isAuth: false,
      isNotFound: false,
      isRateLimited: false,
      isCredits: false,
      isNetwork: true,
      isTimeout: false,
    };
  }

  if (e instanceof TimeoutError) {
    return {
      message: e.message,
      hint: "Could not reach the API. Check your network or the provider status",
      isAuth: false,
      isNotFound: false,
      isRateLimited: false,
      isCredits: false,
      isNetwork: false,
      isTimeout: true,
    };
  }

  if (e instanceof EmptyResponseError || e instanceof StreamError) {
    return {
      message: e.message,
      hint: null,
      isAuth: false,
      isNotFound: false,
      isRateLimited: false,
      isCredits: false,
      isNetwork: false,
      isTimeout: false,
    };
  }

  const msg = e instanceof Error ? e.message : String(e);
  return {
    message: msg,
    hint: null,
    isAuth: false,
    isNotFound: false,
    isRateLimited: false,
    isCredits: false,
    isNetwork: false,
    isTimeout: false,
  };
}

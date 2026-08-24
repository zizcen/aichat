import type { ResponsesSnapshot } from "./types";

export type ApiErrorShape = {
  message?: string;
  type?: string;
  code?: string;
  param?: string | null;
};

export type GrokApiErrorInit = {
  status: number;
  message: string;
  code?: string;
  type?: string;
  param?: string | null;
  retryAfterMs?: number;
  cause?: unknown;
  partial?: ResponsesSnapshot;
};

/**
 * Error raised by the public gateway.  No raw request, headers, or response
 * body is retained, so an API key cannot accidentally leak through logging or
 * crash-report serialization.
 */
export class GrokApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly type?: string;
  readonly param?: string | null;
  readonly retryAfterMs?: number;
  readonly partial?: ResponsesSnapshot;

  constructor(init: GrokApiErrorInit);
  constructor(status: number, message: string, code?: string, type?: string);
  constructor(
    initOrStatus: GrokApiErrorInit | number,
    message?: string,
    code?: string,
    type?: string,
  ) {
    const init: GrokApiErrorInit = typeof initOrStatus === "number"
      ? { status: initOrStatus, message: message ?? `HTTP ${initOrStatus}`, code, type }
      : initOrStatus;
    const safeMessage = redactSecrets(init.message || `HTTP ${init.status}`);
    // Do not attach the original exception as `cause`: fetch implementations
    // and platform wrappers occasionally include request headers in their
    // error objects.  Keeping it would make an otherwise safe error loggable
    // with a leaked Authorization value.
    super(safeMessage);
    this.name = "GrokApiError";
    this.status = init.status;
    this.code = init.code ? redactSecrets(init.code) : undefined;
    this.type = init.type ? redactSecrets(init.type) : undefined;
    this.param = init.param === null || init.param === undefined ? init.param : redactSecrets(init.param);
    this.retryAfterMs = init.retryAfterMs;
    this.partial = init.partial;
  }

  get isNetworkError(): boolean {
    return this.status === 0 || this.code === "network_error";
  }

  get isTimeout(): boolean {
    return this.status === 408 || this.code === "timeout";
  }

  get isRateLimited(): boolean {
    return this.status === 429 || this.code === "rate_limit_error";
  }

  get retryable(): boolean {
    return this.code !== "missing_api_key" && this.code !== "invalid_api_key" && isRetryableStatus(this.status);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      status: this.status,
      message: redactSecrets(this.message),
      ...(this.code ? { code: redactSecrets(this.code) } : {}),
      ...(this.type ? { type: redactSecrets(this.type) } : {}),
      ...(this.param !== undefined ? { param: this.param === null ? null : redactSecrets(this.param) } : {}),
      ...(this.retryAfterMs !== undefined ? { retryAfterMs: this.retryAfterMs } : {}),
    };
  }
}

/** Alias for codebases that use the shorter API error name. */
export { GrokApiError as ApiError };

/** Error emitted while consuming a Responses SSE stream. */
export class ResponsesStreamError extends GrokApiError {
  readonly partialSnapshot: ResponsesSnapshot;

  constructor(init: GrokApiErrorInit & { partial: ResponsesSnapshot }) {
    super(init);
    this.name = "ResponsesStreamError";
    this.partialSnapshot = init.partial;
  }
}

/** Read OpenAI-style, gateway-style, and plain error payloads. */
export function readApiError(payload: unknown): ApiErrorShape {
  if (!isRecord(payload)) return {};
  const candidate = isRecord(payload.error) ? payload.error : payload;
  return {
    message: typeof candidate.message === "string" ? redactSecrets(candidate.message) : undefined,
    type: typeof candidate.type === "string" ? redactSecrets(candidate.type) : undefined,
    code: typeof candidate.code === "string" ? redactSecrets(candidate.code) : undefined,
    param: candidate.param === null || typeof candidate.param === "string"
      ? candidate.param
      : undefined,
  };
}

export function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
}

export function isAbortError(error: unknown): boolean {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "AbortError";
  }
  return isRecord(error) && error.name === "AbortError";
}

export function retryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return undefined;
}

/**
 * Convert a failed HTTP response into a safe, structured error.  Callers pass
 * already-consumed body text or a parsed payload; this function never stores
 * that body in the resulting error.
 */
export function apiErrorFromResponse(
  response: Pick<Response, "status" | "statusText" | "headers">,
  payload?: unknown,
  bodyText?: string,
): GrokApiError {
  const parsed = readApiError(payload);
  const fallback = redactSecrets(bodyText?.trim() || response.statusText || `HTTP ${response.status}`);
  return new GrokApiError({
    status: response.status,
    message: parsed.message || fallback,
    code: parsed.code,
    type: parsed.type,
    param: parsed.param,
    retryAfterMs: retryAfterMs(response.headers.get("retry-after")),
  });
}

export function redactSecrets(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\bg2a_[A-Za-z0-9._~-]+\b/g, "[REDACTED_API_KEY]")
    .replace(/([?&](?:api[_-]?key|key|token)=)[^&\s]+/gi, "$1[REDACTED]");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

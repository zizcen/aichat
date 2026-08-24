/** URL construction and media URL validation for the public API. */

export type NormalizeBaseUrlOptions = {
  /** Release builds leave this false; debug builds may opt into LAN HTTP. */
  allowHttp?: boolean;
  /** Permit an accidentally supplied trailing `/v1` and canonicalize it away. */
  stripV1Suffix?: boolean;
};

export class ApiUrlError extends Error {
  readonly code = "invalid_base_url";

  constructor(message: string) {
    super(message);
    this.name = "ApiUrlError";
  }
}

const ADMIN_PATH_PATTERN = /(?:^|\/)api\/admin(?:\/|$)/i;

/**
 * Normalize a user supplied server URL.
 *
 * The returned value never ends in `/`, never contains credentials/query/hash,
 * and does not include the public `/v1` prefix.  A path prefix is preserved so
 * reverse-proxied installations such as `https://example.test/grok` work.
 */
export function normalizeBaseUrl(
  value: string | URL,
  options: NormalizeBaseUrlOptions = {},
): string {
  const input = String(value).trim();
  if (!input) throw new ApiUrlError("Base URL is required");

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ApiUrlError("Base URL must be an absolute http(s) URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ApiUrlError("Base URL must use https");
  }
  if (url.protocol === "http:" && !options.allowHttp) {
    throw new ApiUrlError("Base URL must use https (HTTP is only allowed in development)");
  }
  if (!url.hostname || url.username || url.password) {
    throw new ApiUrlError("Base URL must contain a host and no credentials");
  }
  if (url.search || url.hash) {
    throw new ApiUrlError("Base URL must not contain a query string or fragment");
  }
  if (ADMIN_PATH_PATTERN.test(url.pathname)) {
    throw new ApiUrlError("Admin API URLs are not supported");
  }

  let pathname = url.pathname.replace(/\/+$/, "");
  if (options.stripV1Suffix !== false && /\/v1$/i.test(pathname)) {
    pathname = pathname.slice(0, -3).replace(/\/+$/, "");
  }

  // URL#origin omits the default port, which gives stable profile/scope keys.
  const origin = url.origin;
  return `${origin}${pathname}`;
}

/** Build an absolute URL from a canonical base and an endpoint path. */
export function buildApiUrl(
  baseUrl: string | URL,
  endpoint: string,
  options: NormalizeBaseUrlOptions = {},
): string {
  const base = normalizeBaseUrl(baseUrl, options);
  const path = endpoint.trim();
  if (!path) throw new ApiUrlError("API endpoint is required");
  if (/^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(path) || /(?:^|\/)\.\.(?:\/|$)/.test(path)) {
    throw new ApiUrlError("API endpoint must be a relative path");
  }
  if (ADMIN_PATH_PATTERN.test(path)) throw new ApiUrlError("Admin API URLs are not supported");

  // Endpoints accepted by this helper may be root health routes or explicit
  // `/v1/*` routes.  Keep a reverse-proxy path prefix when one was configured;
  // callers still cannot escape it with `..` because endpoint strings are
  // restricted to API paths by the client.
  const parsedBase = new URL(base);
  const basePath = parsedBase.pathname.replace(/\/+$/, "");
  const resolvedPath = path.startsWith("/")
    ? `${basePath}${path}` || "/"
    : `${basePath}/${path}`;
  const endpointUrl = new URL(resolvedPath, parsedBase.origin);
  return endpointUrl.toString();
}

/** Build a public `/v1/*` endpoint without allowing a duplicate prefix. */
export function buildPublicApiUrl(
  baseUrl: string | URL,
  endpoint: string,
  options: NormalizeBaseUrlOptions = {},
): string {
  const path = endpoint.trim();
  if (!path) throw new ApiUrlError("API endpoint is required");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const alreadyPrefixed = normalized === "/v1" || normalized.startsWith("/v1/") || normalized.startsWith("/v1?");
  return buildApiUrl(baseUrl, alreadyPrefixed ? normalized : `/v1${normalized}`, options);
}

export function buildHealthUrl(
  baseUrl: string | URL,
  route: "healthz" | "readyz",
  options: NormalizeBaseUrlOptions = {},
): string {
  return buildApiUrl(baseUrl, `/${route}`, options);
}

export function isAbsoluteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return Boolean(parsed.protocol && parsed.host);
  } catch {
    return false;
  }
}

/**
 * Resolve a media URL returned by grok2api.
 *
 * Relative media paths are anchored to the configured server.  External
 * HTTPS URLs and data/blob URLs are preserved.  Other external protocols and
 * non-media relative paths are rejected to keep remote media rendering scoped.
 */
export function resolveMediaUrl(
  baseUrl: string | URL,
  value: string,
  options: NormalizeBaseUrlOptions = {},
): string {
  const raw = value.trim();
  if (!raw) throw new ApiUrlError("Media URL is empty");
  if (/^(?:data|blob):/i.test(raw)) return raw;
  if (raw.startsWith("//") || /(?:^|\/)\.\.(?:\/|$)/.test(raw)) {
    throw new ApiUrlError("Media URL must not escape the configured gateway");
  }

  const base = normalizeBaseUrl(baseUrl, options);
  let resolved: URL;
  try {
    resolved = new URL(raw, `${base}/`);
  } catch {
    throw new ApiUrlError("Media URL is invalid");
  }

  if (resolved.protocol === "https:") {
    if (isAllowedGatewayMediaPath(resolved.pathname, base)) return resolved.toString();
    // An explicitly external HTTPS URL is a supported public-media input.
    const baseOrigin = new URL(base).origin;
    if (resolved.origin !== baseOrigin) return resolved.toString();
    throw new ApiUrlError("Relative media URL must use the gateway media path");
  }

  // HTTP is only safe when it is the configured development server itself.
  if (resolved.protocol === "http:") {
    const baseOrigin = new URL(base).origin;
    if (resolved.origin === baseOrigin && isAllowedGatewayMediaPath(resolved.pathname, base)) {
      return resolved.toString();
    }
  }
  throw new ApiUrlError("Media URL must be HTTPS or a gateway media URL");
}

/** Alias retained for callers using URL as an acronym. */
export const resolveMediaURL = resolveMediaUrl;

export function imageDataUrl(base64: string, contentType = "image/png"): string {
  const encoded = base64.trim();
  if (!encoded) throw new ApiUrlError("Image base64 payload is empty");
  if (/^data:/i.test(encoded)) return encoded;
  const mime = contentType.trim() || "image/png";
  return `data:${mime};base64,${encoded}`;
}

export function audioDataUrl(base64: string, contentType = "audio/mpeg"): string {
  const encoded = base64.trim();
  if (!encoded) throw new ApiUrlError("Audio base64 payload is empty");
  if (/^data:/i.test(encoded)) return encoded;
  const mime = contentType.trim() || "audio/mpeg";
  return `data:${mime};base64,${encoded}`;
}

function isAllowedGatewayMediaPath(pathname: string, base: string): boolean {
  const basePath = new URL(base).pathname.replace(/\/+$/, "");
  const normalized = pathname.replace(/\/+$/, "");
  // Current servers expose `/v1/media/*` at the origin.  A reverse proxy may
  // add a base path, in which case accept that same prefix as well.
  return (
    /^\/v1\/media\/(?:images|videos)\/[^/]+/i.test(normalized) ||
    new RegExp(`^${escapeRegExp(basePath)}\\/v1\\/media\\/(?:images|videos)\\/[^/]+`, "i").test(normalized)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

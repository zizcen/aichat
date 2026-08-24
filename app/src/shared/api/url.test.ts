import { describe, expect, it } from "vitest";
import {
  ApiUrlError,
  buildHealthUrl,
  buildPublicApiUrl,
  imageDataUrl,
  normalizeBaseUrl,
  resolveMediaUrl,
} from "./url";

describe("public API URL helpers", () => {
  it("canonicalizes trailing slashes and an accidental v1 suffix", () => {
    expect(normalizeBaseUrl("https://example.test/v1///")).toBe("https://example.test");
    expect(buildHealthUrl("https://example.test/", "healthz")).toBe("https://example.test/healthz");
    expect(buildPublicApiUrl("https://example.test", "/models")).toBe("https://example.test/v1/models");
    expect(buildPublicApiUrl("https://example.test/grok", "/models")).toBe("https://example.test/grok/v1/models");
  });

  it("rejects credentials, admin paths, query strings, and release HTTP", () => {
    for (const value of [
      "https://user:pass@example.test",
      "https://example.test/api/admin",
      "https://example.test/?debug=1",
      "http://example.test",
    ]) {
      expect(() => normalizeBaseUrl(value)).toThrow(ApiUrlError);
    }
    expect(normalizeBaseUrl("http://127.0.0.1:8080", { allowHttp: true })).toBe("http://127.0.0.1:8080");
  });

  it("resolves gateway media and external HTTPS URLs without making relative URLs cross-origin", () => {
    expect(resolveMediaUrl("https://example.test", "/v1/media/images/a1")).toBe(
      "https://example.test/v1/media/images/a1",
    );
    expect(resolveMediaUrl("https://example.test", "https://cdn.example/a.png")).toBe(
      "https://cdn.example/a.png",
    );
    expect(resolveMediaUrl("https://example.test", "data:image/png;base64,AA")).toBe(
      "data:image/png;base64,AA",
    );
    expect(() => resolveMediaUrl("https://example.test", "javascript:alert(1)")).toThrow(ApiUrlError);
    expect(imageDataUrl("AA==")).toBe("data:image/png;base64,AA==");
  });
});

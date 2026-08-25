import { describe, expect, it } from "vitest";

import {
  compareVersions,
  hasNewerVersion,
  parseReleasePayload,
} from "./update-service";

describe("app update metadata", () => {
  it("compares semantic release versions", () => {
    expect(compareVersions("v0.1.1", "0.1.0")).toBe(1);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("0.0.9", "0.1.0")).toBe(-1);
  });

  it("selects the creative workbench APK and digest", () => {
    const info = parseReleasePayload({
      tag_name: "v0.1.1",
      name: "创作工作台 v0.1.1",
      html_url: "https://github.com/zizcen/aichat/releases/tag/v0.1.1",
      body: "修复更新流程",
      published_at: "2026-08-26T00:00:00Z",
      assets: [
        {
          name: "README.txt",
          browser_download_url: "https://github.com/zizcen/aichat/releases/download/v0.1.1/README.txt",
          size: 10,
        },
        {
          name: "creative-workbench-v0.1.1.apk",
          browser_download_url: "https://github.com/zizcen/aichat/releases/download/v0.1.1/creative-workbench-v0.1.1.apk",
          size: 2048,
          digest: "sha256:abc123",
        },
      ],
    });
    expect(info?.asset?.name).toBe("creative-workbench-v0.1.1.apk");
    expect(info?.asset?.digest).toBe("sha256:abc123");
    expect(info && hasNewerVersion(info)).toBe(true);
  });

  it("rejects incomplete release payloads", () => {
    expect(parseReleasePayload({ tag_name: "v0.1.1" })).toBeNull();
  });
});

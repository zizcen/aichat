import { Capacitor, registerPlugin } from "@capacitor/core";

import { platformFetch } from "@/shared/api/native-http";

export const CURRENT_APP_VERSION =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.1.0";
export const RELEASES_URL = "https://github.com/zizcen/aichat/releases";
const LATEST_RELEASE_API =
  "https://api.github.com/repos/zizcen/aichat/releases/latest";

type AppUpdaterPlugin = {
  download(options: {
    url: string;
    fileName: string;
    sha256?: string;
  }): Promise<{ uri: string; sha256: string; size: number; fileName: string }>;
  install(options: {
    uri: string;
  }): Promise<{ status: "started" | "permission_required" }>;
};

const AppUpdater = registerPlugin<AppUpdaterPlugin>("AppUpdater");

export type AppUpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  tagName: string;
  releaseName: string;
  releaseUrl: string;
  releaseNotes: string;
  publishedAt?: string;
  asset?: {
    name: string;
    downloadUrl: string;
    size: number;
    digest?: string;
  };
};

export type DownloadedUpdate = {
  uri: string;
  sha256: string;
  size: number;
  fileName: string;
};

type ReleaseAsset = {
  name: string;
  browser_download_url: string;
  size: number;
  digest?: string | null;
};

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function parseReleasePayload(payload: unknown): AppUpdateInfo | null {
  if (!isRecord(payload)) return null;
  const tagName = stringValue(payload.tag_name);
  const latestVersion = stripVersionPrefix(tagName);
  const releaseUrl = stringValue(payload.html_url);
  if (!tagName || !latestVersion || !releaseUrl) return null;
  const assets = Array.isArray(payload.assets)
    ? payload.assets.filter(isReleaseAsset)
    : [];
  const apk =
    assets.find((asset) => /^creative-workbench-v.+\.apk$/i.test(asset.name)) ??
    assets.find((asset) => asset.name.toLowerCase().endsWith(".apk"));
  return {
    currentVersion: CURRENT_APP_VERSION,
    latestVersion,
    tagName,
    releaseName: stringValue(payload.name) || tagName,
    releaseUrl,
    releaseNotes: stringValue(payload.body),
    publishedAt: stringValue(payload.published_at) || undefined,
    asset: apk
      ? {
          name: apk.name,
          downloadUrl: apk.browser_download_url,
          size: Number.isFinite(apk.size) ? apk.size : 0,
          digest: apk.digest || undefined,
        }
      : undefined,
  };
}

export async function fetchLatestRelease(signal?: AbortSignal): Promise<AppUpdateInfo> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await platformFetch(LATEST_RELEASE_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`更新检查失败（${response.status}）`);
    const info = parseReleasePayload(await response.json());
    if (!info) throw new Error("GitHub 返回的 Release 信息无效");
    return info;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export function hasNewerVersion(info: AppUpdateInfo): boolean {
  return compareVersions(info.latestVersion, CURRENT_APP_VERSION) > 0;
}

export function isNativeUpdaterAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

export async function downloadUpdate(info: AppUpdateInfo): Promise<DownloadedUpdate> {
  if (!Capacitor.isNativePlatform())
    throw new Error("浏览器端请打开 Release 页面下载更新。");
  if (!info.asset) throw new Error("该 Release 没有可下载的 APK");
  return AppUpdater.download({
    url: info.asset.downloadUrl,
    fileName: info.asset.name,
    sha256: info.asset.digest,
  });
}

export async function installDownloadedUpdate(
  update: DownloadedUpdate,
): Promise<"started" | "permission_required"> {
  if (!Capacitor.isNativePlatform()) return "started";
  return (await AppUpdater.install({ uri: update.uri })).status;
}

export function openReleasePage(info: AppUpdateInfo): void {
  window.open(info.releaseUrl, "_blank", "noopener,noreferrer");
}

function parseVersion(value: string): [number, number, number] | null {
  const match = value.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function stripVersionPrefix(value: string): string {
  return value.trim().replace(/^v/i, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReleaseAsset(value: unknown): value is ReleaseAsset {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === "string" &&
    typeof value.browser_download_url === "string" &&
    typeof value.size === "number"
  );
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

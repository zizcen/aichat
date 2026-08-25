import { useCallback, useEffect, useRef, useState } from "react";

import {
  CURRENT_APP_VERSION,
  type AppUpdateInfo,
  type DownloadedUpdate,
  downloadUpdate,
  fetchLatestRelease,
  hasNewerVersion,
  installDownloadedUpdate,
  isNativeUpdaterAvailable,
  openReleasePage,
} from "./update-service";

const CACHE_KEY = "creative-workbench:update-check:v1";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UpdateInstallState =
  | "idle"
  | "downloading"
  | "permission_required"
  | "installing"
  | "opened"
  | "error";

export type AppUpdateController = {
  currentVersion: string;
  info: AppUpdateInfo | null;
  available: boolean;
  checking: boolean;
  installState: UpdateInstallState;
  error: string | null;
  lastCheckedAt: number | null;
  checkNow: () => Promise<void>;
  dismiss: () => void;
  install: () => Promise<void>;
  openRelease: () => void;
};

export function useAppUpdate(): AppUpdateController {
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [installState, setInstallState] = useState<UpdateInstallState>("idle");
  const [dismissedTag, setDismissedTag] = useState(() => readDismissedTag());
  const downloadedRef = useRef<DownloadedUpdate | null>(null);
  const checkInFlight = useRef<Promise<void> | null>(null);

  const check = useCallback(async (force = false) => {
    if (checkInFlight.current) return checkInFlight.current;
    const cached = readCache();
    if (!force && cached && Date.now() - cached.checkedAt < CHECK_INTERVAL_MS) {
      setInfo(cached.info);
      setLastCheckedAt(cached.checkedAt);
      return;
    }
    const request = (async () => {
      setChecking(true);
      setError(null);
      try {
        const latest = await fetchLatestRelease();
        const checkedAt = Date.now();
        writeCache({ info: latest, checkedAt });
        setInfo(latest);
        setLastCheckedAt(checkedAt);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "更新检查失败");
      } finally {
        setChecking(false);
        checkInFlight.current = null;
      }
    })();
    checkInFlight.current = request;
    return request;
  }, []);

  useEffect(() => {
    void check();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [check]);

  const dismiss = useCallback(() => {
    if (!info) return;
    setDismissedTag(info.tagName);
    try {
      localStorage.setItem(`${CACHE_KEY}:dismissed`, info.tagName);
    } catch {
      // Private browsing may disable local storage; dismissal still lasts this session.
    }
  }, [info]);

  const install = useCallback(async () => {
    if (!info) return;
    setError(null);
    try {
      if (!isNativeUpdaterAvailable()) {
        openReleasePage(info);
        setInstallState("opened");
        return;
      }
      let downloaded = downloadedRef.current;
      if (!downloaded) {
        setInstallState("downloading");
        downloaded = await downloadUpdate(info);
        downloadedRef.current = downloaded;
      }
      const status = await installDownloadedUpdate(downloaded);
      setInstallState(status === "started" ? "installing" : status);
    } catch (caught) {
      downloadedRef.current = null;
      setInstallState("error");
      setError(caught instanceof Error ? caught.message : "更新安装失败");
    }
  }, [info]);

  const openRelease = useCallback(() => {
    if (info) openReleasePage(info);
  }, [info]);

  const available = Boolean(info && hasNewerVersion(info));
  return {
    currentVersion: CURRENT_APP_VERSION,
    info,
    available: available && dismissedTag !== info?.tagName,
    checking,
    installState,
    error,
    lastCheckedAt,
    checkNow: useCallback(() => check(true), [check]),
    dismiss,
    install,
    openRelease,
  };
}

function readDismissedTag(): string | null {
  try {
    return localStorage.getItem(`${CACHE_KEY}:dismissed`);
  } catch {
    return null;
  }
}

function readCache(): { info: AppUpdateInfo; checkedAt: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { info?: AppUpdateInfo; checkedAt?: number };
    if (!value.info || typeof value.checkedAt !== "number") return null;
    return { info: value.info, checkedAt: value.checkedAt };
  } catch {
    return null;
  }
}

function writeCache(value: { info: AppUpdateInfo; checkedAt: number }): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    // The next app resume will simply perform another lightweight check.
  }
}

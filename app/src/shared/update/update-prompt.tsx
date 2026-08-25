import { Check, Download, ExternalLink, LoaderCircle, X } from "lucide-react";

import type { AppUpdateController } from "./use-app-update";

export function UpdatePrompt({ update }: { update: AppUpdateController }) {
  if (!update.available || !update.info) return null;
  const info = update.info;
  const busy = update.installState === "downloading" || update.installState === "installing";
  const message = update.installState === "permission_required"
    ? "请允许本应用安装未知来源应用，然后返回这里再次点击更新。"
    : update.installState === "opened"
      ? "已打开 Release 页面，请下载最新 APK。"
      : update.error;
  return (
    <section className="update-prompt" role="dialog" aria-label="发现新版本">
      <div className="update-prompt-icon"><Download size={17} /></div>
      <div className="update-prompt-content">
        <div className="update-prompt-title">
          发现新版本 <span>{info.latestVersion}</span>
        </div>
        <div className="update-prompt-copy">
          当前版本 {update.currentVersion} · {info.releaseName}
        </div>
        {info.releaseNotes ? (
          <p className="update-prompt-notes">{trimNotes(info.releaseNotes)}</p>
        ) : null}
        {message ? <div className="update-prompt-message">{message}</div> : null}
        <div className="update-prompt-actions">
          <button className="button ghost small" type="button" onClick={update.dismiss} disabled={busy}>
            <X size={13} />
            稍后
          </button>
          <button className="button small" type="button" onClick={update.openRelease} disabled={busy}>
            <ExternalLink size={13} />
            Release
          </button>
          <button className="button primary small" type="button" onClick={() => void update.install()} disabled={busy}>
            {busy ? <LoaderCircle className="spinner" size={13} /> : update.installState === "permission_required" ? <Check size={13} /> : <Download size={13} />}
            {busy ? "准备更新…" : update.installState === "permission_required" ? "重新安装" : "立即更新"}
          </button>
        </div>
      </div>
    </section>
  );
}

function trimNotes(notes: string): string {
  const compact = notes.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}…` : compact;
}

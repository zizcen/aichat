import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export async function shareMedia(url: string, title: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Share.share({ title, url, dialogTitle: title });
    return;
  }
  if (typeof navigator.share === "function") {
    await navigator.share({ title, url });
    return;
  }
  await navigator.clipboard?.writeText(url);
}
export async function saveMedia(url: string, filename: string): Promise<string | undefined> {
  if (!Capacitor.isNativePlatform()) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.click();
    return undefined;
  }
  const base64 = await readAsBase64(url);
  const result = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Documents, recursive: true });
  await Share.share({ title: filename, url: result.uri, dialogTitle: "分享生成结果" });
  return result.uri;
}

async function readAsBase64(url: string): Promise<string> {
  const dataMatch = /^data:[^,]+,(.*)$/s.exec(url);
  if (dataMatch) return dataMatch[1].replace(/\s/g, "");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`媒体下载失败（${response.status}）`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

import { Capacitor, registerPlugin } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

import { platformFetch } from "@/shared/api/native-http";

type MediaStorePlugin = {
  save(options: {
    filename: string;
    mimeType: string;
    data: string;
  }): Promise<{ uri: string }>;
};

const MediaStore = registerPlugin<MediaStorePlugin>("MediaStore");

export async function shareMedia(
  url: string,
  title: string,
  filename = "creative-workbench-media.bin",
): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    if (typeof navigator.share === "function")
      await navigator.share({ title, url });
    else await navigator.clipboard?.writeText(url);
    return;
  }
  const media = await readAsBase64(url);
  const path = timestampedFilename(filename);
  const result = await Filesystem.writeFile({
    path,
    data: media.base64,
    directory: Directory.Cache,
    recursive: true,
  });
  await Share.share({ title, url: result.uri, dialogTitle: title });
}

export async function saveMedia(
  url: string,
  filename: string,
): Promise<string | undefined> {
  const path = timestampedFilename(filename);
  if (!Capacitor.isNativePlatform()) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = path;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.click();
    return undefined;
  }
  const media = await readAsBase64(url);
  return (
    await MediaStore.save({
      filename: path,
      mimeType: media.mimeType,
      data: media.base64,
    })
  ).uri;
}

async function readAsBase64(
  url: string,
): Promise<{ base64: string; mimeType: string }> {
  const dataMatch = /^data:([^;,]+)(?:;base64)?,(.*)$/s.exec(url);
  if (dataMatch)
    return {
      base64: dataMatch[2].replace(/\s/g, ""),
      mimeType: dataMatch[1] || "application/octet-stream",
    };
  const response = url.startsWith("blob:")
    ? await globalThis.fetch(url)
    : await platformFetch(url);
  if (!response.ok) throw new Error(`媒体下载失败（${response.status}）`);
  return {
    base64: encodeBase64(new Uint8Array(await response.arrayBuffer())),
    mimeType:
      response.headers.get("content-type")?.split(";", 1)[0] ||
      mimeTypeFromFilename(url),
  };
}

function timestampedFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : "";
  return `${stem}-${new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14)}${extension}`;
}

function mimeTypeFromFilename(filename: string): string {
  const normalized = filename.toLowerCase();
  if (/\.png(?:$|[?#])/.test(normalized)) return "image/png";
  if (/\.jpe?g(?:$|[?#])/.test(normalized)) return "image/jpeg";
  if (/\.webp(?:$|[?#])/.test(normalized)) return "image/webp";
  if (/\.mp4(?:$|[?#])/.test(normalized)) return "video/mp4";
  if (/\.wav(?:$|[?#])/.test(normalized)) return "audio/wav";
  if (/\.ogg(?:$|[?#])/.test(normalized)) return "audio/ogg";
  if (/\.mp3(?:$|[?#])/.test(normalized)) return "audio/mpeg";
  return "application/octet-stream";
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize)
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  return btoa(binary);
}

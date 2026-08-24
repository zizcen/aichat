export type MediaInputDTO = {
  fileId: string;
  kind: "image" | "video";
  mimeType: string;
  sizeBytes: number;
  expiresAt: string;
};

/** The standalone client deliberately has no admin staging endpoint. */
export async function uploadMediaInput(file: File): Promise<MediaInputDTO> {
  void file;
  throw new Error("当前 APK 仅支持可公开访问的图片/视频 URL。");
}

export async function importVideoInputFromURL(url: string): Promise<MediaInputDTO> {
  const value = url.trim();
  if (!/^https?:\/\//i.test(value)) throw new Error("请输入可公开访问的媒体 URL。");
  return { fileId: value, kind: "video", mimeType: "video/*", sizeBytes: 0, expiresAt: new Date(Date.now() + 300_000).toISOString() };
}

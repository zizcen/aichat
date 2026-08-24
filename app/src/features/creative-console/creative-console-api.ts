import type { ResponsesRequest } from "@/shared/api/types";
import { getCreativeConsoleRuntime } from "./creative-console-runtime";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ReasoningEffort = "auto" | "none" | "low" | "medium" | "high" | "xhigh";
export type ChatToolActivity = {
  id: string;
  type: string;
  name: string;
  status: "in_progress" | "completed" | "failed";
  detail: string;
};
export type ChatStreamSnapshot = { text: string; reasoning: string; tools: ChatToolActivity[] };
export type ChatResponseResult = ChatStreamSnapshot;
export type ImageResult = { url: string; revisedPrompt?: string };
export type VideoStatus = {
  status: "pending" | "done" | "failed";
  model?: string;
  progress: number;
  video?: { url: string; duration?: number; respectModeration?: boolean };
  error?: { code?: string; message: string };
};
export type VoiceInfo = { voiceId: string; name: string; language?: string };
export type TTSResult = { url: string; contentType: string; duration?: number };
export type STTResult = {
  text: string;
  language?: string;
  duration?: number;
  words?: Array<{ text: string; start: number; end: number; speaker?: number }>;
};

const IMAGE_TIMEOUT_MS = 180_000;
const VIDEO_TIMEOUT_MS = 60_000;

export async function createChatResponse(input: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  promptCacheKey?: string;
  reasoningEffort: ReasoningEffort;
  webSearch: boolean;
  xSearch: boolean;
  onUpdate?: (snapshot: ChatStreamSnapshot) => void;
  signal?: AbortSignal;
}): Promise<ChatResponseResult> {
  const runtime = getCreativeConsoleRuntime();
  if (runtime.previewMode) {
    const result = { text: "这是创作控制台的预览回复。连接提供商后即可发送真实请求。", reasoning: "", tools: [] };
    input.onUpdate?.(result);
    return result;
  }
  const body: ResponsesRequest = {
    model: input.model,
    input: input.messages.map(({ role, content }) => ({ role, content })),
    stream: true,
    store: false,
  };
  if (input.promptCacheKey) body.prompt_cache_key = input.promptCacheKey;
  if (input.reasoningEffort === "auto") body.reasoning = { summary: "auto" };
  else if (input.reasoningEffort === "none") body.reasoning = { effort: "none" };
  else body.reasoning = { effort: input.reasoningEffort, summary: "auto" };
  const tools: Array<{ type: string }> = [];
  if (input.webSearch) tools.push({ type: "web_search" });
  if (input.xSearch) tools.push({ type: "x_search" });
  if (tools.length) body.tools = tools;
  const result = await runtime.client.streamResponses(
    body,
    {
      apiKey: input.apiKey,
      signal: input.signal,
      onUpdate: (snapshot) => input.onUpdate?.({ text: snapshot.text, reasoning: snapshot.reasoning, tools: snapshot.tools }),
    },
  );
  return { text: result.text, reasoning: result.reasoning, tools: result.tools };
}

export async function generateImage(input: {
  apiKey: string;
  model: string;
  prompt: string;
  count: number;
  aspectRatio: string;
  resolution: string;
  quality?: "low" | "medium";
  signal?: AbortSignal;
}): Promise<ImageResult[]> {
  const runtime = getCreativeConsoleRuntime();
  if (runtime.previewMode) return Array.from({ length: input.count }, (_, index) => ({ url: previewImage(index), revisedPrompt: input.prompt }));
  const images = await runtime.client.generateImage(
    {
      model: input.model,
      prompt: input.prompt,
      n: input.count,
      aspect_ratio: input.aspectRatio,
      resolution: input.resolution,
      ...(input.quality ? { quality: input.quality } : {}),
      response_format: "url",
      stream: false,
    },
    { apiKey: input.apiKey, signal: input.signal, timeoutMs: IMAGE_TIMEOUT_MS },
  );
  if (images.length === 0) throw new Error("The image response did not contain any images");
  return images.map((image) => ({ url: image.url, revisedPrompt: image.revisedPrompt }));
}

export async function editImage(input: {
  apiKey: string;
  model: string;
  prompt: string;
  imageURL: string;
  count: number;
  aspectRatio: string;
  resolution: string;
  quality?: "low" | "medium";
  signal?: AbortSignal;
}): Promise<ImageResult[]> {
  const runtime = getCreativeConsoleRuntime();
  if (runtime.previewMode) return Array.from({ length: input.count }, (_, index) => ({ url: previewImage(index + 20), revisedPrompt: input.prompt }));
  const images = await runtime.client.editImage(
    {
      model: input.model,
      prompt: input.prompt,
      image: { url: input.imageURL },
      n: input.count,
      aspect_ratio: input.aspectRatio,
      resolution: input.resolution,
      ...(input.quality ? { quality: input.quality } : {}),
      response_format: "url",
      stream: false,
    },
    { apiKey: input.apiKey, signal: input.signal, timeoutMs: IMAGE_TIMEOUT_MS },
  );
  if (images.length === 0) throw new Error("The image edit response did not contain any images");
  return images.map((image) => ({ url: image.url, revisedPrompt: image.revisedPrompt }));
}

export async function createVideo(input: {
  apiKey: string;
  model: string;
  prompt: string;
  imageURL?: string;
  imageFileID?: string;
  referenceImages?: Array<{ url?: string; fileId?: string }>;
  referenceVoiceIds?: string[];
  duration: number;
  aspectRatio: string;
  resolution: string;
  signal?: AbortSignal;
}): Promise<string> {
  const runtime = getCreativeConsoleRuntime();
  if (runtime.previewMode) return "preview-video-job";
  const result = await runtime.client.createVideo(
    {
      model: input.model,
      prompt: input.prompt,
      duration: input.duration,
      aspect_ratio: input.aspectRatio,
      resolution: input.resolution,
      ...(input.imageFileID || input.imageURL ? { image: input.imageFileID ? { file_id: input.imageFileID } : { url: input.imageURL } } : {}),
      ...(input.referenceImages?.length ? { reference_images: input.referenceImages.map((item) => item.fileId ? { file_id: item.fileId } : { url: item.url }) } : {}),
      ...(input.referenceVoiceIds?.length ? { reference_audios: input.referenceVoiceIds.map((voice_id) => ({ voice_id })) } : {}),
    },
    { apiKey: input.apiKey, signal: input.signal, timeoutMs: VIDEO_TIMEOUT_MS },
  );
  return result.request_id;
}

export async function editVideo(input: { apiKey: string; model: string; prompt: string; videoURL?: string; videoFileID?: string; signal?: AbortSignal }): Promise<string> {
  const runtime = getCreativeConsoleRuntime();
  if (runtime.previewMode) return "preview-video-job";
  const result = await runtime.client.editVideo(
    { model: input.model, prompt: input.prompt, video: input.videoFileID ? { file_id: input.videoFileID } : { url: input.videoURL } },
    { apiKey: input.apiKey, signal: input.signal, timeoutMs: VIDEO_TIMEOUT_MS },
  );
  return result.request_id;
}

export async function extendVideo(input: { apiKey: string; model: string; prompt: string; videoURL?: string; videoFileID?: string; duration?: number; signal?: AbortSignal }): Promise<string> {
  const runtime = getCreativeConsoleRuntime();
  if (runtime.previewMode) return "preview-video-job";
  const result = await runtime.client.extendVideo(
    { model: input.model, prompt: input.prompt, duration: input.duration, video: input.videoFileID ? { file_id: input.videoFileID } : { url: input.videoURL } },
    { apiKey: input.apiKey, signal: input.signal, timeoutMs: VIDEO_TIMEOUT_MS },
  );
  return result.request_id;
}

export async function getVideo(input: { apiKey: string; requestId: string; signal?: AbortSignal }): Promise<VideoStatus> {
  const runtime = getCreativeConsoleRuntime();
  if (runtime.previewMode) return { status: "done", progress: 100, model: "preview", video: { url: previewImage(9), duration: 6 } };
  const result = await runtime.client.getVideoStatus(input.requestId, { apiKey: input.apiKey, signal: input.signal, timeoutMs: VIDEO_TIMEOUT_MS });
  return {
    status: result.status,
    progress: result.progress,
    model: result.model,
    video: result.video,
    error: result.error,
  };
}

export async function listVoices(input: { apiKey: string; model?: string; signal?: AbortSignal }): Promise<VoiceInfo[]> {
  const runtime = getCreativeConsoleRuntime();
  if (runtime.previewMode) return [{ voiceId: "alloy", name: "Alloy", language: "en" }, { voiceId: "aria", name: "Aria", language: "zh" }];
  return runtime.client.listVoices({ model: input.model, apiKey: input.apiKey, signal: input.signal });
}

export async function synthesizeSpeech(input: { apiKey: string; model: string; text: string; voiceId: string; language: string; speed?: number; signal?: AbortSignal }): Promise<TTSResult> {
  const runtime = getCreativeConsoleRuntime();
  if (runtime.previewMode) return { url: previewAudio(), contentType: "audio/wav" };
  const result = await runtime.client.synthesizeSpeech(
    { model: input.model, text: input.text, voice_id: input.voiceId, language: input.language, speed: input.speed },
    { apiKey: input.apiKey, signal: input.signal, timeoutMs: IMAGE_TIMEOUT_MS },
  );
  return { url: result.url ?? result.dataUrl ?? (result.blob ? URL.createObjectURL(result.blob) : ""), contentType: result.contentType, duration: result.duration };
}

export async function transcribeSpeech(input: { apiKey: string; model: string; file: File; language?: string; signal?: AbortSignal }): Promise<STTResult> {
  const runtime = getCreativeConsoleRuntime();
  if (runtime.previewMode) return { text: "这是语音识别预览结果。", language: input.language ?? "zh" };
  const result = await runtime.client.transcribeSpeech(
    { model: input.model, file: input.file, language: input.language, format: true },
    { apiKey: input.apiKey, signal: input.signal, timeoutMs: IMAGE_TIMEOUT_MS },
  );
  return { text: result.text, language: result.language, duration: result.duration, words: result.words?.map((word) => ({ text: word.text, start: word.start, end: word.end, speaker: typeof word.speaker === "number" ? word.speaker : undefined })) };
}

function previewImage(index: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#161b20"/><circle cx="220" cy="280" r="160" fill="#9ee8c4" fill-opacity=".65"/><circle cx="760" cy="720" r="240" fill="#8297d9" fill-opacity=".55"/><path d="M120 820c180-240 320-180 470-390 120-168 220-188 314-90v480H120z" fill="#0d1117"/><text x="512" y="540" text-anchor="middle" fill="#f4f7f5" font-family="sans-serif" font-size="42">创作工作台 Preview ${index + 1}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function previewAudio(): string {
  // A short silent WAV keeps the audio control valid in preview mode.
  return "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAESsAAABAAgAZGF0YQAAAAA=";
}

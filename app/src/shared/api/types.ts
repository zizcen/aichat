/**
 * Public grok2api protocol types.
 *
 * These types intentionally retain unknown fields.  The public API is
 * versioned independently from the client and newer servers may add fields
 * that an older APK should pass through rather than discard.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type ApiRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Optional one-shot key for profile switches; never serialized or logged. */
  apiKey?: string;
};

export type HealthResponse = {
  ok?: boolean;
  status?: string;
  [key: string]: unknown;
};

export type ReadyResponse = HealthResponse;

export type ModelCapability = "chat" | "image" | "video" | "tts" | "stt";

export type Model = {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  capability?: string | string[] | Record<string, unknown>;
  capabilities?: string[] | Record<string, unknown>;
  supports?: string[] | Record<string, unknown>;
  [key: string]: unknown;
};

export type ModelsResponse = {
  object?: string;
  data: Model[];
  [key: string]: unknown;
};

export type ModelInfo = Model;

export type ResponseRole = "system" | "developer" | "user" | "assistant" | "tool";

export type ResponseContentPart = {
  type?: string;
  text?: string;
  [key: string]: unknown;
};

export type ResponseInputItem = {
  role?: ResponseRole | string;
  content?: string | ResponseContentPart[] | JsonValue;
  type?: string;
  [key: string]: unknown;
};

export type ReasoningEffort = "auto" | "none" | "low" | "medium" | "high" | "xhigh";

export type ResponsesReasoning = {
  effort?: ReasoningEffort;
  summary?: "auto" | "concise" | "detailed" | string;
  [key: string]: unknown;
};

export type ResponsesRequest = {
  model: string;
  input: ResponseInputItem[] | string | Record<string, unknown>;
  stream?: boolean;
  store?: boolean;
  prompt_cache_key?: string;
  previous_response_id?: string;
  reasoning?: ResponsesReasoning;
  tools?: unknown[];
  [key: string]: unknown;
};

export type ChatMessage = {
  role: ResponseRole | string;
  content: string | ResponseContentPart[] | JsonValue;
  [key: string]: unknown;
};

export type ChatToolActivity = {
  id: string;
  type: string;
  name: string;
  status: "in_progress" | "completed" | "failed";
  detail: string;
};

export type ResponsesSnapshot = {
  text: string;
  reasoning: string;
  tools: ChatToolActivity[];
  responseId?: string;
  status?: string;
  done?: boolean;
  error?: {
    code?: string;
    message: string;
  };
};

/** Backwards-compatible name used by the original creative console. */
export type ChatStreamSnapshot = ResponsesSnapshot;

export type ResponsesResult = ResponsesSnapshot;
export type ChatResponseResult = ResponsesResult;

export type ResponsesEvent = {
  type?: string;
  [key: string]: unknown;
};

export type ImageResponseFormat = "url" | "b64_json";

export type ImageGenerationRequest = {
  model: string;
  prompt: string;
  n?: number;
  aspect_ratio?: string;
  resolution?: string;
  quality?: "low" | "medium" | string;
  response_format?: ImageResponseFormat;
  stream?: boolean;
  [key: string]: unknown;
};

export type ImageEditRequest = ImageGenerationRequest & {
  image?: { url?: string; file_id?: string };
  images?: Array<{ url?: string; file_id?: string }>;
};

export type ImageData = {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
  content_type?: string;
  mime_type?: string;
  [key: string]: unknown;
};

export type ImagesResponse = {
  created?: number;
  data: ImageData[];
  [key: string]: unknown;
};

export type ImageAsset = {
  /** A displayable URL; base64 responses are represented as a data URL. */
  url: string;
  b64Json?: string;
  revisedPrompt?: string;
  source: "url" | "base64";
  contentType?: string;
  raw?: ImageData;
};

export type ImageResult = ImageAsset;

export type VideoReferenceImage = { url?: string; file_id?: string };
export type VideoReferenceAudio = { voice_id?: string; url?: string; file_id?: string };

export type VideoGenerationRequest = {
  model: string;
  prompt: string;
  duration?: number;
  aspect_ratio?: string;
  resolution?: string;
  image?: { url?: string; file_id?: string };
  reference_images?: VideoReferenceImage[];
  reference_audios?: VideoReferenceAudio[];
  [key: string]: unknown;
};

export type VideoEditRequest = {
  model: string;
  prompt: string;
  video: { url?: string; file_id?: string };
  [key: string]: unknown;
};

export type VideoExtensionRequest = VideoEditRequest & {
  duration?: number;
};

export type VideoCreateResponse = {
  request_id: string;
  requestId: string;
  [key: string]: unknown;
};

export type VideoState = "pending" | "done" | "failed";

export type VideoStatusResponse = {
  status: VideoState;
  progress: number;
  model?: string;
  video?: {
    url: string;
    duration?: number;
    respectModeration?: boolean;
    [key: string]: unknown;
  };
  error?: {
    code?: string;
    message: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

/** Alias used by feature state code. */
export type VideoStatus = VideoStatusResponse;
export type VideoJobStatus = VideoStatusResponse;

export type VoiceInfo = {
  voiceId: string;
  name: string;
  language?: string;
  [key: string]: unknown;
};

export type TtsOutputFormat = {
  codec?: string;
  sample_rate?: number;
  bit_rate?: number;
  [key: string]: unknown;
};

export type TtsRequest = {
  model?: string;
  text: string;
  voice_id?: string;
  language: string;
  speed?: number;
  output_format?: TtsOutputFormat;
  with_timestamps?: boolean;
  [key: string]: unknown;
};

export type TtsJsonResponse = {
  audio: string;
  content_type?: string;
  duration?: number;
  [key: string]: unknown;
};

export type TtsResult = {
  kind: "base64" | "binary";
  contentType: string;
  duration?: number;
  /** Base64 payload, present for JSON responses. */
  base64?: string;
  /** Data URL derived from `base64`, convenient for an audio element. */
  dataUrl?: string;
  /** Raw bytes, present for binary responses. */
  bytes?: ArrayBuffer;
  /** Alias for consumers that prefer the Web API naming. */
  arrayBuffer?: ArrayBuffer;
  /** A URL when one is available (data URL for JSON base64 responses). */
  url?: string;
  /** Browser Blob backing `url` for binary responses, when available. */
  blob?: Blob;
};

export type TTSResult = TtsResult;
export type TTSRequest = TtsRequest;

export type SttRequest = {
  model: string;
  file: Blob;
  filename?: string;
  language?: string;
  format?: boolean;
  diarize?: boolean;
  keyterm?: string | string[];
  [key: string]: unknown;
};

export type SttWord = {
  text: string;
  start: number;
  end: number;
  speaker?: number | string;
  [key: string]: unknown;
};

export type SttResult = {
  text: string;
  language?: string;
  duration?: number;
  words?: SttWord[];
  [key: string]: unknown;
};

export type STTResult = SttResult;
export type STTRequest = SttRequest;

export type MediaContent = {
  bytes: ArrayBuffer;
  contentType: string;
  contentLength?: number;
};

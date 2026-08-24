import {
  apiErrorFromResponse,
  GrokApiError,
  isAbortError,
} from "./errors";
import {
  audioDataUrl,
  buildHealthUrl,
  buildPublicApiUrl,
  imageDataUrl,
  normalizeBaseUrl,
  resolveMediaUrl,
  type NormalizeBaseUrlOptions,
} from "./url";
import {
  consumeResponsesSse,
  parseResponsesJson,
} from "./responses-sse";
import type {
  ApiRequestOptions,
  FetchLike,
  HealthResponse,
  ImageAsset,
  ImageData,
  ImageEditRequest,
  ImageGenerationRequest,
  MediaContent,
  Model,
  ModelsResponse,
  ResponsesRequest,
  ResponsesResult,
  ResponsesSnapshot,
  SttRequest,
  SttResult,
  SttWord,
  TtsJsonResponse,
  TtsRequest,
  TtsResult,
  VideoCreateResponse,
  VideoEditRequest,
  VideoExtensionRequest,
  VideoGenerationRequest,
  VideoStatusResponse,
  VoiceInfo,
} from "./types";

export type Grok2ApiClientOptions = {
  baseUrl: string | URL;
  apiKey?: string;
  /** `key` is accepted as a compatibility alias for integrations. */
  key?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  allowHttp?: boolean;
};

export type ResponsesCallOptions = ApiRequestOptions & {
  onUpdate?: (snapshot: ResponsesSnapshot) => void;
};

export type LegacyImageRequestFields = {
  count?: number;
  aspectRatio?: string;
  responseFormat?: "url" | "b64_json";
};

export type LegacyVideoRequestFields = {
  imageURL?: string;
  imageFileID?: string;
  referenceImages?: Array<{ url?: string; fileId?: string }>;
  referenceVoiceIds?: string[];
  aspectRatio?: string;
  videoURL?: string;
  videoFileID?: string;
};

export type LegacyTtsRequestFields = {
  voiceId?: string;
};

type RequestOptions = ApiRequestOptions & {
  auth?: boolean;
  accept?: string;
  contentType?: string;
};

type RequestContext = {
  signal: AbortSignal;
  didTimeout: () => boolean;
  cleanup: () => void;
};

/**
 * Public grok2api client.  Every method builds an absolute URL from the
 * configured base and adds Bearer authentication in memory only.
 */
export class Grok2ApiClient {
  readonly baseUrl: string;
  readonly allowHttp: boolean;
  private apiKey?: string;
  private readonly fetcher: FetchLike;
  private readonly defaultTimeoutMs?: number;

  constructor(options: Grok2ApiClientOptions);
  constructor(baseUrl: string | URL, apiKey?: string);
  constructor(
    optionsOrBaseUrl: Grok2ApiClientOptions | string | URL,
    legacyApiKey?: string,
  ) {
    const options: Grok2ApiClientOptions = typeof optionsOrBaseUrl === "string" || optionsOrBaseUrl instanceof URL
      ? { baseUrl: optionsOrBaseUrl, apiKey: legacyApiKey }
      : optionsOrBaseUrl;
    this.allowHttp = options.allowHttp === true;
    this.baseUrl = normalizeBaseUrl(options.baseUrl, { allowHttp: this.allowHttp });
    this.apiKey = normalizeApiKey(options.apiKey ?? options.key);
    this.fetcher = options.fetch ?? defaultFetch;
    this.defaultTimeoutMs = options.timeoutMs;
  }

  /** Replace the in-memory key; secure storage remains the caller's concern. */
  setApiKey(apiKey?: string): void {
    this.apiKey = normalizeApiKey(apiKey);
  }

  clearApiKey(): void {
    this.apiKey = undefined;
  }

  get hasApiKey(): boolean {
    return Boolean(this.apiKey);
  }

  health(options: ApiRequestOptions = {}): Promise<HealthResponse> {
    return this.runRequest(
      buildHealthUrl(this.baseUrl, "healthz", this.urlOptions),
      { method: "GET" },
      { ...options, auth: false, accept: "application/json, text/plain" },
      (response) => this.readHealth(response),
    );
  }

  ready(options: ApiRequestOptions = {}): Promise<HealthResponse> {
    return this.runRequest(
      buildHealthUrl(this.baseUrl, "readyz", this.urlOptions),
      { method: "GET" },
      { ...options, auth: false, accept: "application/json, text/plain" },
      (response) => this.readHealth(response),
    );
  }

  models(options: ApiRequestOptions = {}): Promise<ModelsResponse> {
    return this.runRequest(
      buildPublicApiUrl(this.baseUrl, "/models", this.urlOptions),
      { method: "GET" },
      { ...options, auth: true, accept: "application/json" },
      async (response) => parseModels(await this.readJsonResponse(response)),
    );
  }

  /** Alias matching the REST resource name. */
  getModels(options: ApiRequestOptions = {}): Promise<ModelsResponse> {
    return this.models(options);
  }

  listModels(options: ApiRequestOptions = {}): Promise<Model[]> {
    return this.models(options).then((result) => result.data);
  }

  healthCheck(options: ApiRequestOptions = {}): Promise<HealthResponse> {
    return this.health(options);
  }

  readinessCheck(options: ApiRequestOptions = {}): Promise<HealthResponse> {
    return this.ready(options);
  }

  /**
   * Create a Responses request.  Streaming is the default; callers can set
   * `stream:false` to consume a regular JSON response.
   */
  responses(request: ResponsesRequest, options: ResponsesCallOptions = {}): Promise<ResponsesResult> {
    const body: ResponsesRequest = {
      ...request,
      stream: request.stream !== false,
      store: request.store ?? false,
    };
    if (body.stream === false) {
      return this.runRequest(
        buildPublicApiUrl(this.baseUrl, "/responses", this.urlOptions),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        { ...options, auth: true, accept: "application/json" },
        async (response) => parseResponsesJson(await this.readJsonResponse(response)),
      );
    }
    return this.streamResponses(body, options.onUpdate, options);
  }

  /** Alias used by feature state code. */
  createResponse(request: ResponsesRequest, options: ResponsesCallOptions = {}): Promise<ResponsesResult> {
    return this.responses(request, options);
  }

  streamResponses(
    request: ResponsesRequest,
    onUpdate?: ((snapshot: ResponsesSnapshot) => void) | ResponsesCallOptions,
    options?: ApiRequestOptions,
  ): Promise<ResponsesResult> {
    const update = typeof onUpdate === "function" ? onUpdate : onUpdate?.onUpdate;
    const requestOptions = typeof onUpdate === "function" ? (options ?? {}) : (onUpdate ?? {});
    const body: ResponsesRequest = {
      ...request,
      stream: true,
      store: request.store ?? false,
    };
    return this.runRequest(
      buildPublicApiUrl(this.baseUrl, "/responses", this.urlOptions),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { ...requestOptions, auth: true, accept: "text/event-stream" },
      async (response) => this.readResponsesResponse(response, update),
    );
  }

  getResponse(responseId: string, options: ApiRequestOptions = {}): Promise<Record<string, unknown>> {
    const encoded = encodePathSegment(responseId);
    return this.runRequest(
      buildPublicApiUrl(this.baseUrl, `/responses/${encoded}`, this.urlOptions),
      { method: "GET" },
      { ...options, auth: true, accept: "application/json" },
      async (response) => asRecord(await this.readJsonResponse(response), "The response payload was invalid"),
    );
  }

  async deleteResponse(responseId: string, options: ApiRequestOptions = {}): Promise<void> {
    await this.runRequest(
      buildPublicApiUrl(this.baseUrl, `/responses/${encodePathSegment(responseId)}`, this.urlOptions),
      { method: "DELETE" },
      { ...options, auth: true, accept: "application/json" },
      async (response) => {
        if (response.status === 204) return undefined;
        await this.readJsonResponse(response);
        return undefined;
      },
    );
  }

  generateImage(
    request: ImageGenerationRequest & LegacyImageRequestFields,
    options: ApiRequestOptions = {},
  ): Promise<ImageAsset[]> {
    return this.imageRequest("/images/generations", request, options);
  }

  editImage(
    request: ImageEditRequest & LegacyImageRequestFields,
    options: ApiRequestOptions = {},
  ): Promise<ImageAsset[]> {
    return this.imageRequest("/images/edits", request, options);
  }

  /** Alias for callers that name the operation `images`. */
  images(request: ImageGenerationRequest & LegacyImageRequestFields, options: ApiRequestOptions = {}): Promise<ImageAsset[]> {
    return this.generateImage(request, options);
  }

  createVideo(
    request: VideoGenerationRequest & LegacyVideoRequestFields,
    options: ApiRequestOptions = {},
  ): Promise<VideoCreateResponse> {
    return this.videoCreateRequest("/videos/generations", request, options);
  }

  createVideoJob(
    request: VideoGenerationRequest & LegacyVideoRequestFields,
    options: ApiRequestOptions = {},
  ): Promise<string> {
    return this.createVideo(request, options).then((result) => result.request_id);
  }

  editVideo(request: VideoEditRequest & LegacyVideoRequestFields, options: ApiRequestOptions = {}): Promise<VideoCreateResponse> {
    return this.videoCreateRequest("/videos/edits", request, options);
  }

  extendVideo(request: VideoExtensionRequest & LegacyVideoRequestFields, options: ApiRequestOptions = {}): Promise<VideoCreateResponse> {
    return this.videoCreateRequest("/videos/extensions", request, options);
  }

  getVideoStatus(requestId: string, options: ApiRequestOptions = {}): Promise<VideoStatusResponse> {
    return this.runRequest(
      buildPublicApiUrl(this.baseUrl, `/videos/${encodePathSegment(requestId)}`, this.urlOptions),
      { method: "GET" },
      { ...options, auth: true, accept: "application/json" },
      async (response) => parseVideoStatus(await this.readJsonResponse(response), this.baseUrl, this.urlOptions),
    );
  }

  /** Alias used by polling stores. */
  videoStatus(requestId: string, options: ApiRequestOptions = {}): Promise<VideoStatusResponse> {
    return this.getVideoStatus(requestId, options);
  }

  getVideo(requestId: string, options: ApiRequestOptions = {}): Promise<VideoStatusResponse> {
    return this.getVideoStatus(requestId, options);
  }

  async getVideoContent(requestId: string, options: ApiRequestOptions = {}): Promise<MediaContent> {
    return this.runRequest(
      buildPublicApiUrl(this.baseUrl, `/videos/${encodePathSegment(requestId)}/content`, this.urlOptions),
      { method: "GET" },
      { ...options, auth: true, accept: "video/*, application/octet-stream" },
      async (response) => {
        if (!response.ok) throw await this.errorForResponse(response);
        const bytes = await response.arrayBuffer();
        return {
          bytes,
          contentType: response.headers.get("content-type") || "video/mp4",
          contentLength: parseContentLength(response.headers.get("content-length")),
        };
      },
    );
  }

  /** Download alias; intentionally keeps Authorization on the request. */
  downloadVideoContent(requestId: string, options: ApiRequestOptions = {}): Promise<MediaContent> {
    return this.getVideoContent(requestId, options);
  }

  listVoices(options?: ApiRequestOptions & { model?: string }): Promise<VoiceInfo[]>;
  listVoices(model?: string, options?: ApiRequestOptions): Promise<VoiceInfo[]>;
  listVoices(
    modelOrOptions: string | (ApiRequestOptions & { model?: string }) = {},
    legacyOptions: ApiRequestOptions = {},
  ): Promise<VoiceInfo[]> {
    const model = typeof modelOrOptions === "string" ? modelOrOptions : modelOrOptions.model;
    const options = typeof modelOrOptions === "string" ? legacyOptions : modelOrOptions;
    const query = model ? `?model=${encodeURIComponent(model)}` : "";
    return this.runRequest(
      buildPublicApiUrl(this.baseUrl, `/tts/voices${query}`, this.urlOptions),
      { method: "GET" },
      { ...options, auth: true, accept: "application/json" },
      async (response) => parseVoices(await this.readJsonResponse(response)),
    );
  }

  synthesizeSpeech(request: TtsRequest & LegacyTtsRequestFields, options: ApiRequestOptions = {}): Promise<TtsResult> {
    const body: TtsRequest = {
      model: "grok-voice-latest",
      ...request,
      ...(request.voice_id === undefined && request.voiceId !== undefined ? { voice_id: request.voiceId } : {}),
    };
    delete (body as Record<string, unknown>).voiceId;
    return this.runRequest(
      buildPublicApiUrl(this.baseUrl, "/tts", this.urlOptions),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { ...options, auth: true, accept: "application/json, audio/*" },
      (response) => this.readTtsResponse(response),
    );
  }

  tts(request: TtsRequest & LegacyTtsRequestFields, options: ApiRequestOptions = {}): Promise<TtsResult> {
    return this.synthesizeSpeech(request, options);
  }

  transcribeSpeech(request: SttRequest, options: ApiRequestOptions = {}): Promise<SttResult> {
    const form = new FormData();
    form.append("model", request.model);
    if (request.language) form.append("language", request.language);
    form.append("format", String(request.format ?? true));
    if (request.diarize !== undefined) form.append("diarize", String(request.diarize));
    if (request.keyterm !== undefined) {
      const terms = Array.isArray(request.keyterm) ? request.keyterm : [request.keyterm];
      for (const term of terms) form.append("keyterm", term);
    }
    for (const [key, value] of Object.entries(request)) {
      if (["model", "file", "filename", "language", "format", "diarize", "keyterm"].includes(key)) continue;
      appendFormValue(form, key, value);
    }
    const filename = request.filename || fileName(request.file);
    form.append("file", request.file, filename);
    return this.runRequest(
      buildPublicApiUrl(this.baseUrl, "/stt", this.urlOptions),
      { method: "POST", body: form },
      { ...options, auth: true, accept: "application/json" },
      async (response) => parseStt(await this.readJsonResponse(response)),
    );
  }

  stt(request: SttRequest, options: ApiRequestOptions = {}): Promise<SttResult> {
    return this.transcribeSpeech(request, options);
  }

  private get urlOptions(): NormalizeBaseUrlOptions {
    return { allowHttp: this.allowHttp };
  }

  private async imageRequest(
    endpoint: string,
    request: (ImageGenerationRequest | ImageEditRequest) & LegacyImageRequestFields,
    options: ApiRequestOptions,
  ): Promise<ImageAsset[]> {
    return this.runRequest(
      buildPublicApiUrl(this.baseUrl, endpoint, this.urlOptions),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizeImageRequest(request)),
      },
      { ...options, auth: true, accept: "application/json" },
      async (response) => parseImages(await this.readJsonResponse(response), this.baseUrl, this.urlOptions),
    );
  }

  private async videoCreateRequest(
    endpoint: string,
    request: (VideoGenerationRequest | VideoEditRequest | VideoExtensionRequest) & LegacyVideoRequestFields,
    options: ApiRequestOptions,
  ): Promise<VideoCreateResponse> {
    return this.runRequest(
      buildPublicApiUrl(this.baseUrl, endpoint, this.urlOptions),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizeVideoRequest(request)),
      },
      { ...options, auth: true, accept: "application/json" },
      async (response) => parseVideoCreate(await this.readJsonResponse(response)),
    );
  }

  private async readResponsesResponse(
    response: Response,
    onUpdate?: (snapshot: ResponsesSnapshot) => void,
  ): Promise<ResponsesResult> {
    if (!response.ok) throw await this.errorForResponse(response);
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/event-stream")) {
      if (!response.body) throw new GrokApiError(200, "The Responses API stream was empty", "invalid_response");
      return consumeResponsesSse(response.body, { onUpdate });
    }

    const text = await response.text();
    if (!text.trim()) throw new GrokApiError(200, "The Responses API returned an empty response", "invalid_response");
    if (/^(?:event:|data:)/m.test(text.trimStart())) {
      return consumeResponsesSse(text, { onUpdate });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new GrokApiError(200, "The Responses API returned invalid JSON", "invalid_response");
    }
    return parseResponsesJson(payload);
  }

  private async readHealth(response: Response): Promise<HealthResponse> {
    if (!response.ok) throw await this.errorForResponse(response);
    const text = await response.text();
    if (!text.trim()) return { ok: true };
    try {
      const payload: unknown = JSON.parse(text);
      if (isRecord(payload)) return { ...payload, ok: payload.ok === undefined ? true : Boolean(payload.ok) };
    } catch {
      // Health endpoints in older deployments return plain text.
    }
    return { ok: true, status: text.trim() };
  }

  private async readJsonResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    let payload: unknown;
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        if (!response.ok) throw apiErrorFromResponse(response, undefined, text);
        throw new GrokApiError(response.status, "The API returned invalid JSON", "invalid_response");
      }
    }
    if (!response.ok) throw apiErrorFromResponse(response, payload, text);
    return payload;
  }

  private async readTtsResponse(response: Response): Promise<TtsResult> {
    if (!response.ok) throw await this.errorForResponse(response);
    const contentType = response.headers.get("content-type") || "";
    if (contentType.toLowerCase().includes("json")) {
      return parseTtsJson(await this.readJsonResponse(response));
    }
    // A few older deployments omit the JSON content type.  Peek through a
    // clone so a genuine binary response remains untouched.
    if (!contentType && typeof response.clone === "function") {
      const candidate = await response.clone().text();
      if (candidate.trim().startsWith("{")) {
        try {
          const payload: unknown = JSON.parse(candidate);
          if (isRecord(payload) && typeof payload.audio === "string") return parseTtsJson(payload);
        } catch {
          // Fall through to binary handling.
        }
      }
    }
    const bytes = await response.arrayBuffer();
    const mime = contentType || "audio/mpeg";
    let blob: Blob | undefined;
    let url: string | undefined;
    if (typeof Blob !== "undefined") {
      blob = new Blob([bytes], { type: mime });
      if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        url = URL.createObjectURL(blob);
      }
    }
    return { kind: "binary", contentType: mime, bytes, arrayBuffer: bytes, blob, url };
  }

  private async errorForResponse(response: Response): Promise<GrokApiError> {
    const text = await response.text();
    let payload: unknown;
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = undefined;
      }
    }
    return apiErrorFromResponse(response, payload, text);
  }

  private async runRequest<T>(
    url: string,
    init: RequestInit,
    options: RequestOptions,
    parser: (response: Response) => Promise<T> | T,
  ): Promise<T> {
    const requestApiKey = normalizeApiKey(options.apiKey) ?? this.apiKey;
    if (options.auth !== false && !requestApiKey) {
      throw new GrokApiError(0, "An API key is required for this endpoint", "missing_api_key", "authentication_error");
    }
    const context = createRequestContext(options.signal, options.timeoutMs ?? this.defaultTimeoutMs);
    const headers = new Headers(init.headers);
    headers.set("Accept", options.accept || headers.get("Accept") || "application/json");
    if (options.contentType) headers.set("Content-Type", options.contentType);
    if (options.auth !== false && requestApiKey) headers.set("Authorization", `Bearer ${requestApiKey}`);
    try {
      const response = await this.fetcher(url, { ...init, headers, signal: context.signal });
      return await parser(response);
    } catch (error) {
      if (error instanceof GrokApiError) throw error;
      if (context.didTimeout()) {
        throw new GrokApiError({ status: 408, message: "The request timed out", code: "timeout", cause: error });
      }
      if (isAbortError(error)) throw error;
      throw new GrokApiError({ status: 0, message: "Network request failed", code: "network_error", cause: error });
    } finally {
      context.cleanup();
    }
  }
}

export function createGrok2ApiClient(options: Grok2ApiClientOptions): Grok2ApiClient {
  return new Grok2ApiClient(options);
}

function defaultFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof globalThis.fetch !== "function") {
    return Promise.reject(new Error("fetch is not available in this runtime"));
  }
  return globalThis.fetch(input, init);
}

function normalizeApiKey(value: string | undefined): string | undefined {
  const key = value?.trim().replace(/^Bearer\s+/i, "");
  return key || undefined;
}

function createRequestContext(signal: AbortSignal | undefined, timeoutMs: number | undefined): RequestContext {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  if (timeoutMs !== undefined && timeoutMs > 0 && Number.isFinite(timeoutMs)) {
    timer = setTimeout(() => {
      timedOut = true;
      const reason = typeof DOMException === "function"
        ? new DOMException("The request timed out", "TimeoutError")
        : Object.assign(new Error("The request timed out"), { name: "TimeoutError" });
      controller.abort(reason);
    }, timeoutMs);
  }
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

function parseModels(payload: unknown): ModelsResponse {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new GrokApiError(200, "The models response was invalid", "invalid_response");
  }
  const data: Model[] = [];
  const ids = new Set<string>();
  for (const item of payload.data) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) {
      throw new GrokApiError(200, "The models response was invalid", "invalid_response");
    }
    if (ids.has(item.id.trim())) {
      throw new GrokApiError(200, "The models response contained duplicate model IDs", "invalid_response");
    }
    ids.add(item.id.trim());
    data.push(item as Model);
  }
  return { ...payload, data };
}

function normalizeImageRequest(
  request: (ImageGenerationRequest | ImageEditRequest) & LegacyImageRequestFields,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...request };
  if (body.n === undefined && request.count !== undefined) body.n = request.count;
  if (body.aspect_ratio === undefined && request.aspectRatio !== undefined) body.aspect_ratio = request.aspectRatio;
  if (body.response_format === undefined && request.responseFormat !== undefined) body.response_format = request.responseFormat;
  delete body.count;
  delete body.aspectRatio;
  delete body.responseFormat;
  return body;
}

function normalizeVideoRequest(
  request: (VideoGenerationRequest | VideoEditRequest | VideoExtensionRequest) & LegacyVideoRequestFields,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...request };
  if (body.aspect_ratio === undefined && request.aspectRatio !== undefined) body.aspect_ratio = request.aspectRatio;
  if (body.image === undefined && (request.imageURL || request.imageFileID)) {
    body.image = request.imageFileID ? { file_id: request.imageFileID } : { url: request.imageURL };
  }
  if (body.reference_images === undefined && request.referenceImages) {
    body.reference_images = request.referenceImages.map((item) => item.fileId ? { file_id: item.fileId } : { url: item.url });
  }
  if (body.reference_audios === undefined && request.referenceVoiceIds) {
    body.reference_audios = request.referenceVoiceIds.map((voiceId) => ({ voice_id: voiceId }));
  }
  if (body.video === undefined && (request.videoURL || request.videoFileID)) {
    body.video = request.videoFileID ? { file_id: request.videoFileID } : { url: request.videoURL };
  }
  delete body.aspectRatio;
  delete body.imageURL;
  delete body.imageFileID;
  delete body.referenceImages;
  delete body.referenceVoiceIds;
  delete body.videoURL;
  delete body.videoFileID;
  return body;
}

function parseImages(payload: unknown, baseUrl: string, urlOptions: NormalizeBaseUrlOptions): ImageAsset[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new GrokApiError(200, "The image response was invalid", "invalid_response");
  }
  const images: ImageAsset[] = [];
  for (const item of payload.data) {
    if (!isRecord(item)) continue;
    const raw = item as ImageData;
    const rawUrl = typeof raw.url === "string" ? raw.url.trim() : "";
    const b64 = typeof raw.b64_json === "string" ? raw.b64_json.trim() : "";
    if (rawUrl) {
      let url: string;
      try {
        url = resolveMediaUrl(baseUrl, rawUrl, urlOptions);
      } catch {
        // Do not surface same-origin non-media paths or unsafe protocols as
        // displayable assets.  The caller receives `invalid_response` when all
        // returned items are malformed.
        continue;
      }
      images.push({
        url,
        revisedPrompt: typeof raw.revised_prompt === "string" ? raw.revised_prompt : undefined,
        source: "url",
        contentType: typeof raw.content_type === "string" ? raw.content_type : undefined,
        raw,
      });
      continue;
    }
    if (b64) {
      const contentType = typeof raw.content_type === "string" && raw.content_type.trim()
        ? raw.content_type
        : typeof raw.mime_type === "string" && raw.mime_type.trim() ? raw.mime_type : "image/png";
      images.push({
        url: imageDataUrl(b64, contentType),
        b64Json: b64,
        revisedPrompt: typeof raw.revised_prompt === "string" ? raw.revised_prompt : undefined,
        source: "base64",
        contentType,
        raw,
      });
    }
  }
  if (images.length === 0) throw new GrokApiError(200, "The image response did not contain any images", "invalid_response");
  return images;
}

function parseVideoCreate(payload: unknown): VideoCreateResponse {
  if (!isRecord(payload) || typeof payload.request_id !== "string" || !payload.request_id.trim()) {
    throw new GrokApiError(200, "The video response did not contain a request ID", "invalid_response");
  }
  return { ...payload, request_id: payload.request_id.trim(), requestId: payload.request_id.trim() };
}

function parseVideoStatus(payload: unknown, baseUrl: string, urlOptions: NormalizeBaseUrlOptions): VideoStatusResponse {
  if (!isRecord(payload) || (payload.status !== "pending" && payload.status !== "done" && payload.status !== "failed")) {
    throw new GrokApiError(200, "The video status response was invalid", "invalid_response");
  }
  const status = payload.status;
  const progress = typeof payload.progress === "number" && Number.isFinite(payload.progress)
    ? Math.max(0, Math.min(100, payload.progress))
    : status === "done" ? 100 : 0;
  const result: VideoStatusResponse = { ...payload, status, progress };
  if (status === "done" && (!isRecord(payload.video) || typeof payload.video.url !== "string" || !payload.video.url.trim())) {
    throw new GrokApiError(200, "The completed video response did not contain a video URL", "invalid_response");
  }
  if (status === "failed" && (!isRecord(payload.error) || typeof payload.error.message !== "string" || !payload.error.message.trim())) {
    throw new GrokApiError(200, "The failed video response did not contain an error", "invalid_response");
  }
  if (isRecord(payload.video) && typeof payload.video.url === "string") {
    let url = payload.video.url;
    try {
      url = resolveMediaUrl(baseUrl, url, urlOptions);
    } catch {
      // Keep the server value for a caller that wants to display diagnostics.
    }
    result.video = {
      ...payload.video,
      url,
      duration: typeof payload.video.duration === "number" ? payload.video.duration : undefined,
      respectModeration: typeof payload.video.respect_moderation === "boolean"
        ? payload.video.respect_moderation
        : undefined,
    };
  }
  if (isRecord(payload.error) && typeof payload.error.message === "string") {
    result.error = {
      ...payload.error,
      message: payload.error.message,
      code: typeof payload.error.code === "string" ? payload.error.code : undefined,
    };
  }
  return result;
}

function parseVoices(payload: unknown): VoiceInfo[] {
  if (!isRecord(payload) || !Array.isArray(payload.voices)) {
    throw new GrokApiError(200, "The voice list response was invalid", "invalid_response");
  }
  const voices: VoiceInfo[] = [];
  for (const item of payload.voices) {
    if (!isRecord(item) || typeof item.voice_id !== "string" || !item.voice_id.trim()) {
      throw new GrokApiError(200, "The voice list response was invalid", "invalid_response");
    }
    voices.push({
      ...item,
      voiceId: item.voice_id.trim(),
      name: typeof item.name === "string" && item.name.trim() ? item.name : item.voice_id.trim(),
      language: typeof item.language === "string" ? item.language : undefined,
    });
  }
  return voices;
}

function parseTtsJson(payload: unknown): TtsResult {
  if (!isRecord(payload) || typeof payload.audio !== "string" || !payload.audio.trim()) {
    throw new GrokApiError(200, "The TTS response was invalid", "invalid_response");
  }
  const result = payload as TtsJsonResponse;
  const contentType = typeof result.content_type === "string" && result.content_type.trim()
    ? result.content_type
    : "audio/mpeg";
  const base64 = result.audio.replace(/^data:[^,]+,/, "").trim();
  const dataUrl = audioDataUrl(base64, contentType);
  return {
    kind: "base64",
    contentType,
    base64,
    dataUrl,
    url: dataUrl,
    duration: typeof result.duration === "number" ? result.duration : undefined,
  };
}

function parseStt(payload: unknown): SttResult {
  if (!isRecord(payload) || typeof payload.text !== "string") {
    throw new GrokApiError(200, "The STT response was invalid", "invalid_response");
  }
  const words: SttWord[] | undefined = Array.isArray(payload.words)
    ? payload.words.flatMap((item) => {
        if (!isRecord(item) || typeof item.text !== "string") return [];
        return [{
          ...item,
          text: item.text,
          start: typeof item.start === "number" ? item.start : 0,
          end: typeof item.end === "number" ? item.end : 0,
          speaker: typeof item.speaker === "number" || typeof item.speaker === "string" ? item.speaker : undefined,
        }];
      })
    : undefined;
  return {
    ...payload,
    text: payload.text,
    language: typeof payload.language === "string" ? payload.language : undefined,
    duration: typeof payload.duration === "number" ? payload.duration : undefined,
    ...(words ? { words } : {}),
  };
}

function appendFormValue(form: FormData, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    form.append(key, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) appendFormValue(form, key, item);
    return;
  }
  if (typeof value === "object") {
    form.append(key, JSON.stringify(value));
    return;
  }
  form.append(key, String(value));
}

function fileName(file: Blob): string {
  if (typeof File !== "undefined" && file instanceof File && file.name) return file.name;
  return "audio";
}

function encodePathSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new GrokApiError(0, "A resource ID is required", "invalid_request_error");
  return encodeURIComponent(trimmed);
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new GrokApiError(200, message, "invalid_response");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

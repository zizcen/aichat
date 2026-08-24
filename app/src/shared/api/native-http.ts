import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from "@capacitor/core";

type NativeHeaders = Record<string, string>;
type NativeFormEntry =
  | { type: "string"; key: string; value: string }
  | {
      type: "base64File";
      key: string;
      value: string;
      fileName: string;
      contentType: string;
    };

type NativeRequest = {
  requestId: string;
  url: string;
  method: string;
  headers: NativeHeaders;
  body?: string;
  bodyType?: "text" | "formData";
  formData?: NativeFormEntry[];
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
};

type NativeResponse = { status: number; headers: NativeHeaders; data?: string };
type StreamEvent = { requestId: string; data?: string; message?: string };

type NativeHttpPlugin = {
  request(options: NativeRequest): Promise<NativeResponse>;
  stream(options: NativeRequest): Promise<NativeResponse>;
  cancel(options: { requestId: string }): Promise<void>;
  addListener(
    eventName: "streamChunk" | "streamEnd" | "streamError",
    listener: (event: StreamEvent) => void,
  ): Promise<PluginListenerHandle>;
};

const NativeHttp = registerPlugin<NativeHttpPlugin>("NativeHttp");

export function platformFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!Capacitor.isNativePlatform()) return globalThis.fetch(input, init);
  return nativeFetch(input, init);
}

async function nativeFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const request = await serializeRequest(input, init);
  const accept = request.headers.accept?.toLowerCase() ?? "";
  const streaming = accept.includes("text/event-stream");
  return streaming
    ? nativeStream(request, init.signal)
    : nativeRequest(request, init.signal);
}

async function nativeRequest(
  request: NativeRequest,
  signal?: AbortSignal | null,
): Promise<Response> {
  throwIfAborted(signal);
  const onAbort = () => {
    void NativeHttp.cancel({ requestId: request.requestId });
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    let result: NativeResponse;
    try {
      result = await NativeHttp.request(request);
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      throw error;
    }
    throwIfAborted(signal);
    const bytes = result.data ? decodeBase64(result.data) : undefined;
    return new Response(bytes ? Uint8Array.from(bytes).buffer : null, {
      status: result.status,
      headers: result.headers,
    });
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

async function nativeStream(
  request: NativeRequest,
  signal?: AbortSignal | null,
): Promise<Response> {
  throwIfAborted(signal);
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    cancel() {
      void NativeHttp.cancel({ requestId: request.requestId });
    },
  });
  const handles: PluginListenerHandle[] = [];
  const cleanup = () => {
    if (closed) return;
    closed = true;
    for (const handle of handles) void handle.remove();
    signal?.removeEventListener("abort", onAbort);
  };
  const onAbort = () => {
    void NativeHttp.cancel({ requestId: request.requestId });
    controller?.error(abortError(signal));
    cleanup();
  };
  handles.push(
    await NativeHttp.addListener("streamChunk", (event) => {
      if (!closed && event.requestId === request.requestId && event.data)
        controller?.enqueue(decodeBase64(event.data));
    }),
    await NativeHttp.addListener("streamEnd", (event) => {
      if (!closed && event.requestId === request.requestId) {
        controller?.close();
        cleanup();
      }
    }),
    await NativeHttp.addListener("streamError", (event) => {
      if (!closed && event.requestId === request.requestId) {
        controller?.error(
          new TypeError(event.message || "Native stream failed"),
        );
        cleanup();
      }
    }),
  );
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) {
    onAbort();
    throw abortError(signal);
  }
  try {
    const result = await NativeHttp.stream(request);
    throwIfAborted(signal);
    if (result.status < 200 || result.status >= 300) {
      controller?.enqueue(
        result.data ? decodeBase64(result.data) : new Uint8Array(),
      );
      controller?.close();
      cleanup();
    }
    return new Response(body, {
      status: result.status,
      headers: result.headers,
    });
  } catch (error) {
    controller?.error(error);
    cleanup();
    if (signal?.aborted) throw abortError(signal);
    throw error;
  }
}

async function serializeRequest(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<NativeRequest> {
  const source =
    typeof input === "string" || input instanceof URL ? undefined : input;
  const url =
    typeof input === "string" || input instanceof URL
      ? input.toString()
      : input.url;
  const headers = new Headers(source?.headers);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const nativeHeaders: NativeHeaders = {};
  headers.forEach((value, key) => {
    nativeHeaders[key.toLowerCase()] = value;
  });
  const request: NativeRequest = {
    requestId: crypto.randomUUID(),
    url,
    method: (init.method ?? source?.method ?? "GET").toUpperCase(),
    headers: nativeHeaders,
  };
  const body = init.body;
  if (body instanceof FormData) {
    request.bodyType = "formData";
    request.formData = [];
    for (const [key, value] of body.entries()) {
      if (typeof value === "string")
        request.formData.push({ type: "string", key, value });
      else
        request.formData.push({
          type: "base64File",
          key,
          value: encodeBase64(new Uint8Array(await value.arrayBuffer())),
          fileName: value.name || "file",
          contentType: value.type || "application/octet-stream",
        });
    }
  } else if (typeof body === "string") {
    request.bodyType = "text";
    request.body = body;
  } else if (body instanceof Blob) {
    request.bodyType = "text";
    request.body = encodeBase64(new Uint8Array(await body.arrayBuffer()));
    request.headers["x-grok2api-body-encoding"] = "base64";
  } else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    const bytes =
      body instanceof ArrayBuffer
        ? new Uint8Array(body)
        : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    request.bodyType = "text";
    request.body = encodeBase64(bytes);
    request.headers["x-grok2api-body-encoding"] = "base64";
  }
  return request;
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw abortError(signal);
}

function abortError(signal?: AbortSignal | null): DOMException {
  return signal?.reason instanceof DOMException
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize)
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

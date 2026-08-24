import { GrokApiError, ResponsesStreamError, readApiError } from "./errors";
import type {
  ChatToolActivity,
  ResponsesResult,
  ResponsesSnapshot,
} from "./types";

export type SseEvent = {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
};

export type SseSource =
  | string
  | ReadableStream<Uint8Array>
  | AsyncIterable<Uint8Array | string>;

export type ResponsesStreamOptions = {
  onUpdate?: (snapshot: ResponsesSnapshot) => void;
  signal?: AbortSignal;
};

/**
 * Parse Server-Sent Events while preserving UTF-8 characters split across
 * network chunks.  Multiple `data:` lines are joined with a newline as
 * required by the SSE specification; comments and unknown fields are ignored.
 */
export async function* parseSseEvents(source: SseSource): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";
  let eventId: string | undefined;
  let retry: number | undefined;
  let dataLines: string[] = [];

  const dispatch = (): SseEvent | undefined => {
    if (dataLines.length === 0) {
      eventName = "";
      eventId = undefined;
      retry = undefined;
      return undefined;
    }
    const event: SseEvent = {
      ...(eventName ? { event: eventName } : {}),
      data: dataLines.join("\n"),
      ...(eventId !== undefined ? { id: eventId } : {}),
      ...(retry !== undefined ? { retry } : {}),
    };
    eventName = "";
    eventId = undefined;
    retry = undefined;
    dataLines = [];
    return event;
  };

  const processLine = (line: string): SseEvent | undefined => {
    if (line === "") return dispatch();
    if (line.startsWith(":")) return undefined;

    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "event":
        eventName = value;
        break;
      case "data":
        dataLines.push(value);
        break;
      case "id":
        if (!value.includes("\u0000")) eventId = value;
        break;
      case "retry": {
        const parsed = Number(value);
        if (/^\d+$/.test(value) && Number.isFinite(parsed)) retry = parsed;
        break;
      }
      default:
        break;
    }
    return undefined;
  };

  const flushBuffer = function* (final: boolean): Generator<SseEvent> {
    // Normalize all line ending forms.  Keep a trailing CR at chunk boundaries
    // in the main buffer by only splitting complete lines here.
    while (true) {
      const match = /\r\n|\n|\r/.exec(buffer);
      if (!match || (!final && match.index === buffer.length - 1 && match[0] === "\r")) break;
      const line = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const event = processLine(line);
      if (event) yield event;
    }
    if (final && buffer.length > 0) {
      const event = processLine(buffer);
      buffer = "";
      if (event) yield event;
    }
  };

  const append = function* (chunk: Uint8Array | string, stream: boolean): Generator<SseEvent> {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream });
    yield* flushBuffer(false);
  };

  if (typeof source === "string") {
    yield* append(source, false);
  } else if (isReadableStream(source)) {
    const reader = source.getReader();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        yield* append(result.value, true);
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    for await (const chunk of source) yield* append(chunk, true);
  }

  buffer += decoder.decode();
  yield* flushBuffer(true);
  const trailing = dispatch();
  if (trailing) yield trailing;
}

/** Common acronym spelling used by some feature modules. */
export const parseSSE = parseSseEvents;

/** Consume a Responses event stream and aggregate displayable output. */
export async function consumeResponsesSse(
  source: SseSource,
  options: ResponsesStreamOptions = {},
): Promise<ResponsesResult> {
  const state = createState();
  const emit = () => options.onUpdate?.(snapshotOf(state));

  for await (const event of parseSseEvents(source)) {
    if (options.signal?.aborted) {
      const reason = options.signal.reason;
      throw isAbortLike(reason) ? reason : abortError();
    }
    const raw = event.data.trim();
    if (!raw || raw === "[DONE]") {
      if (raw === "[DONE]") state.done = true;
      continue;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      // Forward-compatible servers may send non-JSON heartbeats under an
      // unknown event name.  Ignore those while still rejecting malformed
      // payloads for events this adapter understands.
      if (event.event && !isKnownEvent(event.event)) continue;
      throw streamError(state, "The Responses stream contained invalid JSON", "invalid_sse");
    }
    if (!isRecord(payload)) continue;
    const type = typeof payload.type === "string" ? payload.type : event.event ?? "";
    applyEvent(state, type, payload, emit);
  }

  state.done = state.done || state.status === "completed";
  const result = snapshotOf(state);
  if (!result.text.trim() && !result.reasoning.trim() && result.tools.length === 0) {
    throw streamError(state, "The Responses API did not return any displayable output", "invalid_response");
  }
  return result;
}

export const consumeResponsesSSE = consumeResponsesSse;
export const parseResponsesStream = consumeResponsesSse;

/** Parse a non-streaming Responses JSON response (and common chat fallback). */
export function parseResponsesJson(payload: unknown): ResponsesResult {
  const state = createState();
  if (!isRecord(payload)) {
    throw new GrokApiError(200, "The Responses API returned invalid JSON", "invalid_response");
  }
  applyEnvelope(state, payload);

  // A few compatible deployments return Chat Completions-shaped JSON even
  // when `/responses` was requested.  Reading it costs nothing and keeps the
  // protocol adapter useful across v3.x installations.
  if (!state.text && Array.isArray(payload.choices)) {
    const first = isRecord(payload.choices[0]) ? payload.choices[0] : undefined;
    const message = first && isRecord(first.message) ? first.message : undefined;
    if (message) state.text = readContentText(message.content);
  }
  state.done = true;
  state.status = typeof payload.status === "string" ? payload.status : "completed";
  const result = snapshotOf(state);
  if (state.status === "incomplete") {
    throw new ResponsesStreamError({
      status: 200,
      message: readIncompleteReason(payload) || "The response ended before completion",
      code: "incomplete_response",
      partial: result,
    });
  }
  if (state.status === "failed" || isRecord(payload.error)) {
    const error = readApiError(payload);
    throw new ResponsesStreamError({
      status: 200,
      message: error.message || "The Responses API response failed",
      code: error.code || "response_failed",
      partial: { ...result, error: { code: error.code, message: error.message || "The Responses API response failed" } },
    });
  }
  if (!result.text.trim() && !result.reasoning.trim() && result.tools.length === 0) {
    throw new GrokApiError(200, "The Responses API did not return any displayable output", "invalid_response");
  }
  return result;
}

type MutableState = {
  text: string;
  reasoning: string;
  tools: Map<string, ChatToolActivity>;
  responseId?: string;
  status?: string;
  done: boolean;
  error?: { code?: string; message: string };
};

function createState(): MutableState {
  return { text: "", reasoning: "", tools: new Map(), done: false };
}

function snapshotOf(state: MutableState): ResponsesSnapshot {
  return {
    text: state.text,
    reasoning: state.reasoning,
    tools: Array.from(state.tools.values()),
    ...(state.responseId ? { responseId: state.responseId } : {}),
    ...(state.status ? { status: state.status } : {}),
    done: state.done,
    ...(state.error ? { error: state.error } : {}),
  };
}

function applyEvent(
  state: MutableState,
  type: string,
  payload: Record<string, unknown>,
  emit: () => void,
): void {
  switch (type) {
    case "response.output_text.delta":
      if (typeof payload.delta === "string") {
        state.text += payload.delta;
        emit();
      }
      return;
    case "response.output_text.done":
      if (typeof payload.text === "string") state.text = payload.text;
      else if (typeof payload.output_text === "string") state.text = payload.output_text;
      emit();
      return;
    case "response.reasoning_summary_text.delta":
    case "response.reasoning_text.delta":
      if (typeof payload.delta === "string") {
        state.reasoning += payload.delta;
        emit();
      }
      return;
    case "response.reasoning_summary_text.done":
    case "response.reasoning_text.done":
      if (typeof payload.text === "string") state.reasoning = payload.text;
      else if (typeof payload.output_text === "string") state.reasoning = payload.output_text;
      emit();
      return;
    case "response.output_item.added":
    case "response.output_item.done": {
      const item = isRecord(payload.item) ? payload.item : undefined;
      if (!item) return;
      applyOutputItem(state, item, type.endsWith(".done") ? "completed" : "in_progress");
      emit();
      return;
    }
    case "response.function_call_arguments.delta":
    case "response.custom_tool_call_input.delta":
      updateToolDetail(state, payload, typeof payload.delta === "string" ? payload.delta : "", true);
      emit();
      return;
    case "response.function_call_arguments.done":
    case "response.custom_tool_call_input.done": {
      const detail = typeof payload.arguments === "string"
        ? payload.arguments
        : typeof payload.input === "string" ? payload.input : "";
      updateToolDetail(state, payload, detail, false);
      emit();
      return;
    }
    case "response.created":
    case "response.in_progress":
      applyEnvelope(state, isRecord(payload.response) ? payload.response : payload);
      state.status = type === "response.created" ? "created" : "in_progress";
      emit();
      return;
    case "response.completed":
      applyEnvelope(state, isRecord(payload.response) ? payload.response : payload);
      state.status = "completed";
      state.done = true;
      emit();
      return;
    case "response.incomplete": {
      applyEnvelope(state, isRecord(payload.response) ? payload.response : payload);
      state.status = "incomplete";
      state.done = true;
      const reason = readIncompleteReason(isRecord(payload.response) ? payload.response : payload);
      throw streamError(state, reason || "The response ended before completion", "incomplete_response");
    }
    case "response.failed":
    case "error": {
      const source = isRecord(payload.response) ? payload.response : payload;
      applyEnvelope(state, source);
      const error = readApiError(source);
      state.status = "failed";
      state.done = true;
      state.error = { code: error.code, message: error.message || "The Responses API stream failed" };
      throw streamError(state, state.error.message, state.error.code || "response_failed");
    }
    default:
      // Unknown event types are deliberately ignored for forward compatibility.
      return;
  }
}

function applyEnvelope(state: MutableState, payload: Record<string, unknown>): void {
  if (typeof payload.id === "string" && payload.id.trim()) state.responseId = payload.id;
  if (typeof payload.status === "string") state.status = payload.status;

  const outputText = readResponseText(payload);
  if (outputText) state.text = outputText;
  const reasoning = readResponseReasoning(payload);
  if (reasoning) state.reasoning = reasoning;
  for (const item of readResponseTools(payload)) state.tools.set(item.id, item);
}

function applyOutputItem(
  state: MutableState,
  item: Record<string, unknown>,
  fallbackStatus: ChatToolActivity["status"],
): void {
  if (item.type === "message") {
    const text = readContentText(item.content);
    if (text) state.text = text;
    return;
  }
  if (item.type === "reasoning") {
    const reasoning = readContentText(item.summary) || readContentText(item.content);
    if (reasoning) state.reasoning = reasoning;
    return;
  }
  const tool = readToolItem(item, fallbackStatus);
  if (tool) state.tools.set(tool.id, tool);
}

function updateToolDetail(
  state: MutableState,
  payload: Record<string, unknown>,
  detail: string,
  append: boolean,
): void {
  const id = firstString(payload.item_id, payload.call_id, payload.id);
  if (!id) return;
  const current = state.tools.get(id) ?? {
    id,
    type: "function_call",
    name: "tool",
    status: "in_progress" as const,
    detail: "",
  };
  state.tools.set(id, { ...current, detail: append ? current.detail + detail : detail || current.detail });
}

function readResponseText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  if (!Array.isArray(payload.output)) return "";
  return payload.output
    .flatMap((item) => {
      if (!isRecord(item) || item.type !== "message") return [];
      return [readContentText(item.content)];
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function readResponseReasoning(payload: Record<string, unknown>): string {
  if (!Array.isArray(payload.output)) return "";
  return payload.output
    .flatMap((item) => {
      if (!isRecord(item) || item.type !== "reasoning") return [];
      return [readContentText(item.summary) || readContentText(item.content)];
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function readResponseTools(payload: Record<string, unknown>): ChatToolActivity[] {
  if (!Array.isArray(payload.output)) return [];
  return payload.output.flatMap((item) => {
    if (!isRecord(item) || item.type === "message" || item.type === "reasoning") return [];
    const tool = readToolItem(item, "completed");
    return tool ? [tool] : [];
  });
}

function readToolItem(
  item: Record<string, unknown>,
  fallbackStatus: ChatToolActivity["status"],
): ChatToolActivity | undefined {
  const type = firstString(item.type);
  if (!type) return undefined;
  const id = firstString(item.id, item.call_id) || `${type}-${firstString(item.name) || "tool"}`;
  const name = firstString(item.name) || toolNameFromType(type);
  const action = isRecord(item.action) ? item.action : undefined;
  const detail = firstString(item.arguments, item.input, action?.query, item.query);
  return { id, type, name, status: readToolStatus(item.status, fallbackStatus), detail };
}

function readToolStatus(value: unknown, fallback: ChatToolActivity["status"]): ChatToolActivity["status"] {
  if (value === "completed") return "completed";
  if (value === "failed" || value === "incomplete") return "failed";
  if (value === "in_progress" || value === "searching") return "in_progress";
  return fallback;
}

function toolNameFromType(type: string): string {
  if (type === "web_search_call" || type === "web_search") return "web_search";
  if (type === "x_search_call" || type === "x_search") return "x_search";
  return type.replace(/_call$/, "");
}

function readIncompleteReason(payload: Record<string, unknown>): string {
  if (!isRecord(payload.incomplete_details)) return "";
  const reason = firstString(payload.incomplete_details.reason);
  return reason ? `The response was incomplete: ${reason}` : "";
}

function readContentText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (!isRecord(item)) return "";
      return typeof item.text === "string"
        ? item.text
        : typeof item.content === "string" ? item.content : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function streamError(state: MutableState, message: string, code: string): ResponsesStreamError {
  return new ResponsesStreamError({
    status: 200,
    message,
    code,
    partial: snapshotOf(state),
  });
}

function isKnownEvent(type: string): boolean {
  return (
    type === "response.output_text.delta" ||
    type === "response.output_text.done" ||
    type === "response.reasoning_summary_text.delta" ||
    type === "response.reasoning_summary_text.done" ||
    type === "response.reasoning_text.delta" ||
    type === "response.reasoning_text.done" ||
    type === "response.output_item.added" ||
    type === "response.output_item.done" ||
    type === "response.function_call_arguments.delta" ||
    type === "response.function_call_arguments.done" ||
    type === "response.custom_tool_call_input.delta" ||
    type === "response.custom_tool_call_input.done" ||
    type === "response.created" ||
    type === "response.in_progress" ||
    type === "response.completed" ||
    type === "response.incomplete" ||
    type === "response.failed" ||
    type === "error"
  );
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { getReader?: unknown }).getReader === "function"
  );
}

function abortError(): Error {
  if (typeof DOMException === "function") return new DOMException("The operation was aborted", "AbortError");
  return Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
}

function isAbortLike(value: unknown): value is Error {
  return typeof value === "object" && value !== null && (value as { name?: unknown }).name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

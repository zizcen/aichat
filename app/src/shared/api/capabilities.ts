import type { Model, ModelCapability } from "./types";

export type CapabilitySource = "server" | "builtin" | "unknown" | "override";

export type ModelCapabilityInfo = {
  modelId: string;
  capabilities: ModelCapability[];
  source: CapabilitySource;
};

export type CapabilityOverrides = Record<string, ModelCapability[] | ModelCapability>;

/**
 * Read optional capability metadata added by newer grok2api deployments.
 * Older v3.1.x responses only contain id/object/created/owned_by, so the
 * function intentionally returns an empty list for unknown metadata instead
 * of claiming a capability that was never advertised.
 */
export function readServerCapabilities(model: Model): ModelCapability[] {
  const values: unknown[] = [
    model.capability,
    model.capabilities,
    model.supports,
    model.endpoints,
    model.supported_endpoints,
    model.supportedEndpoints,
    model.supported_actions,
    model.supportedActions,
  ];
  const result = new Set<ModelCapability>();
  for (const value of values) collectCapabilities(value, result);
  return orderCapabilities(Array.from(result));
}

/** Infer an endpoint family when an OpenAI-compatible catalog omits metadata. */
export function inferBuiltinCapabilities(modelId: string): ModelCapability[] {
  const id = modelId.trim().toLowerCase();
  if (!id) return [];
  const result = new Set<ModelCapability>();

  if (/(?:image|imagine|flux|dall|sdxl)/.test(id) && !/(?:video|voice|audio)/.test(id)) result.add("image");
  if (/(?:video|veo|sora|kling)/.test(id)) result.add("video");
  if (/(?:tts|text[-_ ]?to[-_ ]?speech|voice)/.test(id)) result.add("tts");
  if (/(?:stt|speech[-_ ]?to[-_ ]?text|transcri|whisper)/.test(id)) result.add("stt");

  // Most OpenAI-compatible /v1/models responses expose only an ID. Once
  // endpoint-specific families have been classified, keep ordinary text
  // models in chat and exclude the known non-chat-only families.
  const nonChatOnly = /(?:^|[/:._-])(?:embed(?:ding)?s?|rerank(?:er)?|moderation|classifier|safety|guard|realtime)(?:$|[/:._0-9-])/;
  if (result.size === 0 && !nonChatOnly.test(id)) {
    result.add("chat");
  }
  return orderCapabilities(Array.from(result));
}

/** Resolve server metadata, built-in names, and user overrides in that order. */
export function getModelCapabilities(
  model: Model | string,
  overrides: CapabilityOverrides = {},
): ModelCapabilityInfo {
  const modelId = typeof model === "string" ? model.trim() : model.id.trim();
  const override = overrides[modelId];
  if (override !== undefined) {
    const capabilities = normalizeCapabilityList(override);
    return { modelId, capabilities, source: "override" };
  }

  if (typeof model !== "string") {
    const server = readServerCapabilities(model);
    if (server.length > 0) return { modelId, capabilities: server, source: "server" };
  }

  const builtin = inferBuiltinCapabilities(modelId);
  return {
    modelId,
    capabilities: builtin,
    source: builtin.length > 0 ? "builtin" : "unknown",
  };
}

export function mapModelCapabilities(
  models: Model[],
  overrides: CapabilityOverrides = {},
): ModelCapabilityInfo[] {
  return models.map((model) => getModelCapabilities(model, overrides));
}

/** Alias for callers that prefer a singular `capabilitiesForModel` name. */
export const capabilitiesForModel = getModelCapabilities;

function collectCapabilities(value: unknown, result: Set<ModelCapability>): void {
  if (typeof value === "string") {
    const normalized = normalizeCapability(value);
    if (normalized) result.add(normalized);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectCapabilities(item, result);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, enabled] of Object.entries(value)) {
    if (enabled === true) {
      const normalized = normalizeCapability(key);
      if (normalized) result.add(normalized);
    } else if (typeof enabled === "string" || Array.isArray(enabled)) {
      collectCapabilities(enabled, result);
    }
  }
}

function normalizeCapabilityList(value: ModelCapability[] | ModelCapability): ModelCapability[] {
  const set = new Set<ModelCapability>();
  collectCapabilities(value, set);
  return orderCapabilities(Array.from(set));
}

function normalizeCapability(value: string): ModelCapability | undefined {
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  if (/(?:image|vision|image_generation|image_edit)/.test(normalized)) return "image";
  if (/(?:video|video_generation|video_edit)/.test(normalized)) return "video";
  if (/(?:tts|speech_synthesis|text_to_speech|voice|audio_generation|audio[/_]speech)/.test(normalized)) return "tts";
  if (/(?:stt|transcription|speech_to_text|audio_transcription)/.test(normalized)) return "stt";
  if (/(?:chat|completion|responses?|text(?:_generation)?|language_model)/.test(normalized)) return "chat";
  return undefined;
}

function orderCapabilities(values: ModelCapability[]): ModelCapability[] {
  const order: ModelCapability[] = ["chat", "image", "video", "tts", "stt"];
  return order.filter((capability) => values.includes(capability));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

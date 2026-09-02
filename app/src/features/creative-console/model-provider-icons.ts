import type { ModelRouteDTO } from "@/entities/model/types";

/** The small, stable surface needed by the provider picker. */
export type ProviderModel = Pick<ModelRouteDTO, "publicId"> & Partial<Pick<ModelRouteDTO, "upstreamModel">>;

export type ModelProviderId = "openai" | "grok" | "gemini" | "other";

export type ModelProviderGroup = {
  id: ModelProviderId;
  label: string;
  models: ProviderModel[];
};

type ProviderDefinition = {
  id: ModelProviderId;
  label: string;
  pattern: RegExp;
};

/**
 * Match both plain model IDs (gpt-4o) and gateway-qualified IDs
 * (openai/gpt-4o).  The fallback deliberately stays visible for custom
 * providers instead of silently hiding models we cannot classify.
 */
export const MODEL_PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
  { id: "openai", label: "OpenAI", pattern: /(?:^|[/:_-])(openai|chatgpt|codex|gpt(?:$|[0-9-])|o[1-9](?:$|[-_0-9]))/i },
  { id: "grok", label: "Grok", pattern: /(?:^|[/:_-])(grok|xai)(?:$|[/:._-])/i },
  { id: "gemini", label: "Gemini", pattern: /(?:^|[/:_-])(gemini|gemma|google|nano-banana)(?:$|[/:._-])/i },
  { id: "other", label: "其他厂商", pattern: /.*/i },
];

function modelSearchText(model: ProviderModel | string): string {
  if (typeof model === "string") return model.trim();
  return `${model.publicId} ${model.upstreamModel ?? ""}`.trim();
}

/** Return the vendor represented by a model ID. */
export function detectModelProvider(model: ProviderModel | string): ModelProviderId {
  const name = modelSearchText(model);
  return MODEL_PROVIDER_DEFINITIONS.find((definition) => definition.id !== "other" && definition.pattern.test(name))?.id ?? "other";
}

/** Remove capability duplicates while preserving the catalog order. */
export function uniqueProviderModels(models: readonly ProviderModel[]): ProviderModel[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    const id = model.publicId.trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Group only vendors that have at least one model in the current panel. */
export function getVisibleModelProviders(models: readonly ProviderModel[]): ModelProviderGroup[] {
  const groups = new Map<ModelProviderId, ProviderModel[]>();
  for (const model of uniqueProviderModels(models)) {
    const provider = detectModelProvider(model);
    const current = groups.get(provider);
    if (current) current.push(model);
    else groups.set(provider, [model]);
  }
  return MODEL_PROVIDER_DEFINITIONS
    .filter((definition) => groups.has(definition.id))
    .map((definition) => ({ id: definition.id, label: definition.label, models: groups.get(definition.id)! }));
}

export function getModelsForProvider(models: readonly ProviderModel[], provider: ModelProviderId): ProviderModel[] {
  return uniqueProviderModels(models).filter((model) => detectModelProvider(model) === provider);
}

/**
 * Pick the current model when it already belongs to the clicked vendor;
 * otherwise choose that vendor's first available model.
 */
export function selectModelForProvider(
  models: readonly ProviderModel[],
  provider: ModelProviderId,
  currentModel?: string,
): string {
  const candidates = getModelsForProvider(models, provider);
  if (currentModel && candidates.some((model) => model.publicId === currentModel)) return currentModel;
  return candidates[0]?.publicId ?? "";
}


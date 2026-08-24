import type { Model } from "@/shared/api/types";
import { getModelCapabilities } from "@/shared/api/capabilities";
import type { Grok2ApiClient } from "@/shared/api/client";
import type { ModelRouteDTO } from "@/entities/model/types";

/** Runtime supplied by the APK shell. The upstream console components stay
 * visual-only; all requests are routed through the hardened public client. */
export type CreativeConsoleRuntime = {
  client: Grok2ApiClient;
  apiKey: string;
  scope: string;
  previewMode?: boolean;
};

let activeRuntime: CreativeConsoleRuntime | null = null;

export function setCreativeConsoleRuntime(runtime: CreativeConsoleRuntime | null): void {
  activeRuntime = runtime;
}

export function getCreativeConsoleRuntime(): CreativeConsoleRuntime {
  if (!activeRuntime) throw new Error("创作控制台尚未连接提供商。");
  return activeRuntime;
}

export function modelsToRoutes(models: Model[]): ModelRouteDTO[] {
  return models.flatMap((model) => {
    const id = typeof model.id === "string" ? model.id.trim() : "";
    if (!id) return [];
    const capabilities = getModelCapabilities(model).capabilities;
    const routeCapabilities = new Set<ModelRouteDTO["capability"]>(
      capabilities.map((capability) => capability === "chat" ? "responses" : capability),
    );
    // Public model catalogs often advertise only `image` even though the
    // same Grok Imagine route accepts `/images/edits`. Preserve an explicit
    // image_edit capability when present and cover the known Imagine family.
    const knownImagine = /grok[-_/]?imagine[-_/]?image/i.test(id);
    const explicitImageEdit = hasRawCapability(model, "image_edit");
    const explicitImage = hasRawCapability(model, "image");
    if (explicitImageEdit || knownImagine) routeCapabilities.add("image_edit");
    if (explicitImageEdit && !explicitImage && !knownImagine) routeCapabilities.delete("image");
    return Array.from(routeCapabilities).map((capability) => ({
      id: `${id}:${capability}`,
      publicId: id,
      provider: "grok_console",
      upstreamModel: id,
      capability,
      origin: "discovered",
      enabled: true,
      accountIds: [],
      bindingMode: false,
      supportedAccounts: 1,
      syncedAccounts: 1,
      totalAccounts: 1,
      capabilityKnown: true,
      available: true,
      lastSyncedAt: undefined,
    }));
  });
}

function hasRawCapability(model: Model, wanted: string): boolean {
  const values: unknown[] = [model.capability, model.capabilities, model.supports];
  return values.some((value) => containsCapability(value, wanted));
}

function containsCapability(value: unknown, wanted: string): boolean {
  const normalizedWanted = wanted.replaceAll("-", "_").toLowerCase();
  if (typeof value === "string") return value.replaceAll("-", "_").toLowerCase() === normalizedWanted;
  if (Array.isArray(value)) return value.some((item) => containsCapability(item, wanted));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, enabled]) => enabled === true && key.replaceAll("-", "_").toLowerCase() === normalizedWanted);
}

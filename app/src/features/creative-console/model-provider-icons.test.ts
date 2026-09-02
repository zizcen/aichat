import { describe, expect, it } from "vitest";

import { detectModelProvider, getModelsForProvider, getVisibleModelProviders, selectModelForProvider } from "./model-provider-icons";

const model = (publicId: string, upstreamModel = publicId) => ({ publicId, upstreamModel });

describe("model provider grouping", () => {
  it("recognizes gateway-qualified OpenAI, Grok, and Gemini IDs", () => {
    expect(detectModelProvider("openai/gpt-4o-mini")).toBe("openai");
    expect(detectModelProvider(model("xai/grok-4.6"))).toBe("grok");
    expect(detectModelProvider(model("google/gemini-2.5-pro"))).toBe("gemini");
  });

  it("keeps custom models under a visible fallback vendor", () => {
    expect(detectModelProvider("my-company/vision-1")).toBe("other");
    expect(getVisibleModelProviders([model("my-company/vision-1")]).map((group) => group.id)).toEqual(["other"]);
  });

  it("deduplicates capability routes and hides vendors without models", () => {
    const groups = getVisibleModelProviders([
      model("grok-4.6"),
      model("grok-4.6"),
      model("gemini-2.5-flash"),
    ]);
    expect(groups.map((group) => group.id)).toEqual(["grok", "gemini"]);
    expect(groups.find((group) => group.id === "grok")?.models).toHaveLength(1);
  });

  it("selects the current model within a provider and otherwise its first model", () => {
    const models = [model("gpt-4o"), model("gpt-4o-mini"), model("grok-4.6")];
    expect(selectModelForProvider(models, "openai", "gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(selectModelForProvider(models, "openai", "grok-4.6")).toBe("gpt-4o");
    expect(getModelsForProvider(models, "grok").map((item) => item.publicId)).toEqual(["grok-4.6"]);
  });
});


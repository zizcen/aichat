import { describe, expect, it } from "vitest";
import { getModelCapabilities, inferBuiltinCapabilities, readServerCapabilities } from "./capabilities";

describe("model capability mapping", () => {
  it("prefers explicit server metadata and keeps unknown IDs probeable", () => {
    expect(readServerCapabilities({ id: "custom", capabilities: { responses: true, image_generation: true } })).toEqual(["chat", "image"]);
    expect(getModelCapabilities({ id: "custom" })).toMatchObject({ capabilities: [], source: "unknown" });
    expect(inferBuiltinCapabilities("grok-imagine-video")).toEqual(["video"]);
  });

  it("allows user overrides", () => {
    expect(getModelCapabilities("custom", { custom: "stt" })).toMatchObject({
      capabilities: ["stt"],
      source: "override",
    });
  });
});

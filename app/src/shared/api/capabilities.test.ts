import { describe, expect, it } from "vitest";
import { getModelCapabilities, inferBuiltinCapabilities, readServerCapabilities } from "./capabilities";

describe("model capability mapping", () => {
  it("prefers explicit server metadata and endpoint declarations", () => {
    expect(readServerCapabilities({ id: "custom", capabilities: { responses: true, image_generation: true } })).toEqual(["chat", "image"]);
    expect(readServerCapabilities({ id: "custom", supported_endpoints: ["/v1/responses"] })).toEqual(["chat"]);
    expect(readServerCapabilities({ id: "custom", endpoints: ["/v1/audio/speech"] })).toEqual(["tts"]);
    expect(getModelCapabilities({ id: "custom" })).toMatchObject({ capabilities: ["chat"], source: "builtin" });
    expect(inferBuiltinCapabilities("grok-imagine-video")).toEqual(["video"]);
  });

  it("keeps unlabelled GPT text models in chat without mixing endpoint-specific models", () => {
    for (const id of ["gpt-5.2", "gpt-4.1", "o3", "o4-mini", "codex-mini-latest", "gemini-2.5-pro", "custom-text-model"]) {
      expect(inferBuiltinCapabilities(id), id).toEqual(["chat"]);
    }
    expect(inferBuiltinCapabilities("gpt-4o-audio-preview")).toEqual(["chat"]);
    expect(inferBuiltinCapabilities("gpt-image-1")).toEqual(["image"]);
    expect(inferBuiltinCapabilities("sora-2")).toEqual(["video"]);
    expect(inferBuiltinCapabilities("gpt-4o-mini-tts")).toEqual(["tts"]);
    expect(inferBuiltinCapabilities("whisper-1")).toEqual(["stt"]);
    expect(inferBuiltinCapabilities("text-embedding-3-large")).toEqual([]);
    expect(inferBuiltinCapabilities("omni-moderation-latest")).toEqual([]);
    expect(inferBuiltinCapabilities("bge-reranker-v2")).toEqual([]);
  });

  it("allows user overrides", () => {
    expect(getModelCapabilities("custom", { custom: "stt" })).toMatchObject({
      capabilities: ["stt"],
      source: "override",
    });
  });
});

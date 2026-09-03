import { describe, expect, it } from "vitest";

import { modelsToRoutes } from "./creative-console-runtime";

describe("creative console model routes", () => {
  it("keeps a separate image-edit route for Imagine models", () => {
    const routes = modelsToRoutes([
      { id: "grok-imagine-image-2.0", capability: "image" },
      { id: "custom-image-edit", capability: "image_edit" },
    ]);

    expect(routes.filter((route) => route.publicId === "grok-imagine-image-2.0").map((route) => route.capability)).toEqual(["image", "image_edit"]);
    expect(routes.some((route) => route.publicId === "custom-image-edit" && route.capability === "image_edit")).toBe(true);
  });

  it("keeps unlabelled GPT text catalogs available to chat", () => {
    const routes = modelsToRoutes([
      { id: "gpt-5.2" },
      { id: "gpt-5.2-chat-latest" },
      { id: "o3" },
      { id: "o4-mini" },
      { id: "codex-mini-latest" },
      { id: "text-embedding-3-large" },
      { id: "omni-moderation-latest" },
    ]);

    expect(routes.filter((route) => route.capability === "responses").map((route) => route.publicId)).toEqual([
      "gpt-5.2",
      "gpt-5.2-chat-latest",
      "o3",
      "o4-mini",
      "codex-mini-latest",
    ]);
    expect(routes.some((route) => route.publicId === "text-embedding-3-large")).toBe(false);
    expect(routes.some((route) => route.publicId === "omni-moderation-latest")).toBe(false);
  });
});

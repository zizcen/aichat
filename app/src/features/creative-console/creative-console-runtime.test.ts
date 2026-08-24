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
});

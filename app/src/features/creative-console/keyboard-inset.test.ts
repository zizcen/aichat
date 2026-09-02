import { describe, expect, it } from "vitest";

import { calculateKeyboardInset } from "./keyboard-inset";

describe("keyboard composer inset", () => {
  it("moves an overlaying composer above the visual viewport", () => {
    expect(calculateKeyboardInset(832, 520, 0)).toBe(312);
  });

  it("keeps the same offset after CSS has translated the composer", () => {
    expect(calculateKeyboardInset(520, 520, 312)).toBe(312);
  });

  it("does not add an offset when adjustResize already shortened the layout", () => {
    expect(calculateKeyboardInset(488, 500, 0)).toBe(0);
  });

  it("ignores tiny navigation-bar differences", () => {
    expect(calculateKeyboardInset(510, 500, 0)).toBe(0);
  });
});

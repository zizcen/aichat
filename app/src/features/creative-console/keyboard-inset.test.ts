import { describe, expect, it } from "vitest";

import { advanceKeyboardInset, calculateKeyboardInset } from "./keyboard-inset";

describe("keyboard composer inset", () => {
  it("moves an overlaying composer above the visual viewport", () => {
    expect(calculateKeyboardInset(832, 520)).toBe(312);
  });

  it("advances toward a new boundary instead of jumping", () => {
    const first = advanceKeyboardInset(0, 312);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(312);
    let current = first;
    for (let index = 0; index < 24; index += 1) current = advanceKeyboardInset(current, 312);
    expect(current).toBeCloseTo(312, 0);
  });

  it("does not add an offset when adjustResize already shortened the layout", () => {
    expect(calculateKeyboardInset(488, 500)).toBe(0);
  });

  it("ignores tiny navigation-bar differences", () => {
    expect(calculateKeyboardInset(510, 500, 24)).toBe(0);
  });
});

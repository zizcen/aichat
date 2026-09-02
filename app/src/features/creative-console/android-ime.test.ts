import { describe, expect, it } from "vitest";

import { isNearScrollEnd, nativeImeScrollDelta } from "./android-ime";

describe("Android IME list synchronization", () => {
  it("scrolls only by the newly exposed keyboard height", () => {
    expect(nativeImeScrollDelta(0, 312)).toBe(312);
    expect(nativeImeScrollDelta(312, 344)).toBe(32);
    expect(nativeImeScrollDelta(344, 0)).toBe(0);
  });

  it("does not produce a delta for invalid or decreasing insets", () => {
    expect(nativeImeScrollDelta(Number.NaN, 120)).toBe(120);
    expect(nativeImeScrollDelta(200, 120)).toBe(0);
    expect(nativeImeScrollDelta(-1, -4)).toBe(0);
  });

  it("recognizes a viewport that is already close to the end", () => {
    expect(isNearScrollEnd({ scrollHeight: 1200, scrollTop: 900, clientHeight: 250 })).toBe(true);
    expect(isNearScrollEnd({ scrollHeight: 1200, scrollTop: 700, clientHeight: 250 })).toBe(false);
  });
});

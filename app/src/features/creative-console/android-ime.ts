import { Capacitor } from "@capacitor/core";
import { useEffect } from "react";

export const nativeImeEventName = "creative-workbench-ime";

export type NativeImeDetail = {
  bottom?: number;
  visible?: boolean;
  animated?: boolean;
};

/**
 * Mirrors RikkaHub's LazyList delta scroll: only the newly exposed keyboard
 * height is added to the current scroll position, never the full inset again.
 */
export function nativeImeScrollDelta(previousInset: number, nextInset: number): number {
  const previous = Number.isFinite(previousInset) ? Math.max(0, previousInset) : 0;
  const next = Number.isFinite(nextInset) ? Math.max(0, nextInset) : 0;
  return next > previous ? next - previous : 0;
}

export function isNearScrollEnd(viewport: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">, threshold = 96): boolean {
  const remaining = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  return remaining <= Math.max(0, threshold);
}

function visibleMessageViewport(): HTMLElement | null {
  for (const candidate of document.querySelectorAll<HTMLElement>('[data-slot="message-scroller-viewport"]')) {
    const rect = candidate.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return candidate;
  }
  return null;
}

/**
 * Android-only bridge for the native WindowInsetsAnimation callback. The
 * browser fallback remains in creative-console-page for desktop preview, but
 * Android relies on the system's measured IME boundary instead of a second
 * visualViewport height animation.
 */
export function useAndroidImeAutoScroller(): void {
  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;

    let previousInset = 0;
    let followEnd = false;

    const onIme = (event: Event) => {
      const detail = (event as CustomEvent<NativeImeDetail>).detail;
      const nextInset = typeof detail?.bottom === "number" && Number.isFinite(detail.bottom)
        ? Math.max(0, detail.bottom)
        : 0;
      const delta = nativeImeScrollDelta(previousInset, nextInset);
      const viewport = visibleMessageViewport();

      if (nextInset > previousInset && previousInset === 0) {
        followEnd = viewport ? isNearScrollEnd(viewport) : false;
      }
      if (delta > 0 && followEnd && viewport) {
        viewport.scrollTop += delta;
      }
      if (nextInset === 0) followEnd = false;
      previousInset = nextInset;
    };

    window.addEventListener(nativeImeEventName, onIme);
    return () => window.removeEventListener(nativeImeEventName, onIme);
  }, []);
}

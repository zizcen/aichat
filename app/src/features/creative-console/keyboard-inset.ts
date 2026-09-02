/** Return the portion of the layout baseline hidden below the visual viewport. */
export function calculateKeyboardInset(
  layoutBottom: number,
  visibleBottom: number,
  threshold = 24,
): number {
  const overlap = Math.max(0, Math.round(layoutBottom - visibleBottom));
  return overlap >= threshold ? overlap : 0;
}

/** Advance one animation frame without jumping to a new IME boundary. */
export function advanceKeyboardInset(
  current: number,
  target: number,
  factor = 0.32,
): number {
  if (Math.abs(target - current) < 0.5) return target;
  const clampedFactor = Math.min(1, Math.max(0, factor));
  return current + (target - current) * clampedFactor;
}

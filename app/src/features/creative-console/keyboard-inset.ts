/** Return the portion of a composer hidden below the current visual viewport. */
export function calculateKeyboardInset(
  formBottom: number,
  visibleBottom: number,
  appliedInset: number,
  threshold = 24,
): number {
  const layoutBottom = formBottom + appliedInset;
  const overlap = Math.max(0, Math.round(layoutBottom - visibleBottom));
  return overlap >= threshold ? overlap : 0;
}

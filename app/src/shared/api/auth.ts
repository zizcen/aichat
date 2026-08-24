export function normalizeApiKey(value: string | undefined): string | undefined {
  const key = value
    ?.trim()
    .replace(/^Bearer\s+/i, "")
    .trim();
  return key || undefined;
}

export async function profileScope(baseUrl: string, apiKey: string): Promise<string> {
  const data = new TextEncoder().encode(`${baseUrl}\n${apiKey}`);
  if (!globalThis.crypto?.subtle) throw new Error("This device does not provide Web Crypto");
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

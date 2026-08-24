import { Capacitor, registerPlugin } from "@capacitor/core";

type SecureStorePlugin = {
  get(options: { key: string }): Promise<{ value?: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
};

// The native implementation is provided by the Android shell when installed. In a
// browser build we deliberately keep the encryption key in sessionStorage, so a
// reload requires the user to reconnect instead of persisting a plaintext API key.
const NativeSecureStore = registerPlugin<SecureStorePlugin>("SecureStore");
const fallbackKeyName = "grok2api:session-encryption-key";

function canUseNativeStore(): boolean {
  return Capacitor.isNativePlatform();
}

async function getSessionKey(): Promise<CryptoKey> {
  if (!globalThis.crypto?.subtle) throw new Error("This device does not provide Web Crypto");
  const encoded = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(fallbackKeyName);
  if (encoded) return crypto.subtle.importKey("raw", decodeBase64(encoded) as unknown as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  if (typeof sessionStorage !== "undefined") {
    const raw = await crypto.subtle.exportKey("raw", key);
    sessionStorage.setItem(fallbackKeyName, encodeBase64(new Uint8Array(raw)));
  }
  return key;
}

export async function secureGet(key: string): Promise<string | null> {
  if (canUseNativeStore()) return (await NativeSecureStore.get({ key })).value ?? null;
  const encrypted = typeof localStorage === "undefined" ? null : localStorage.getItem(`grok2api:secret:${key}`);
  if (!encrypted) return null;
  try {
    const [ivText, dataText] = encrypted.split(".");
    if (!ivText || !dataText) return null;
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64(ivText) as unknown as BufferSource }, await getSessionKey(), decodeBase64(dataText) as unknown as BufferSource);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export async function secureSet(key: string, value: string): Promise<void> {
  if (canUseNativeStore()) {
    await NativeSecureStore.set({ key, value });
    return;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await getSessionKey(), new TextEncoder().encode(value));
  localStorage.setItem(`grok2api:secret:${key}`, `${encodeBase64(iv)}.${encodeBase64(new Uint8Array(encrypted))}`);
}

export async function secureRemove(key: string): Promise<void> {
  if (canUseNativeStore()) {
    await NativeSecureStore.remove({ key });
    return;
  }
  localStorage.removeItem(`grok2api:secret:${key}`);
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

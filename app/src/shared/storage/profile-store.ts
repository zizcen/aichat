import { normalizeBaseUrl } from "@/shared/api/url";
import { normalizeApiKey } from "@/shared/api/auth";
import {
  secureRemove,
  secureGet,
  secureSet,
} from "@/shared/security/secure-store";
import { profileScope } from "@/shared/security/scope";

export type ConnectionProfile = {
  id: string;
  baseUrl: string;
  apiKeyRef: string;
  scope: string;
  displayName?: string;
  createdAt: number;
  lastUsedAt: number;
};

const profilesKey = "grok2api:profiles:v1";
const activeProfileKey = "grok2api:active-profile:v1";

export type StoredProfiles = {
  profiles: ConnectionProfile[];
  activeId: string | null;
};

export function readProfiles(): StoredProfiles {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(profilesKey) ?? "null",
    );
    const persistedProfiles = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.profiles)
        ? parsed.profiles
        : [];
    const profiles = persistedProfiles.filter(isProfile);
    const objectActiveId =
      isRecord(parsed) && typeof parsed.activeId === "string"
        ? parsed.activeId
        : null;
    const activeId = localStorage.getItem(activeProfileKey) ?? objectActiveId;
    return {
      profiles,
      activeId: profiles.some((profile) => profile.id === activeId)
        ? activeId
        : (profiles[0]?.id ?? null),
    };
  } catch {
    return { profiles: [], activeId: null };
  }
}

export async function saveProfile(input: {
  baseUrl: string;
  apiKey: string;
  displayName?: string;
  allowHttp?: boolean;
}): Promise<ConnectionProfile> {
  const baseUrl = normalizeBaseUrl(input.baseUrl, {
    allowHttp: input.allowHttp,
  });
  const apiKey = normalizeApiKey(input.apiKey);
  if (!apiKey) throw new Error("API Key is required");
  const scope = await profileScope(baseUrl, apiKey);
  const now = Date.now();
  const profile: ConnectionProfile = {
    id: crypto.randomUUID(),
    baseUrl,
    apiKeyRef: `profile:${scope}`,
    scope,
    displayName: input.displayName?.trim() || new URL(baseUrl).host,
    createdAt: now,
    lastUsedAt: now,
  };
  await secureSet(profile.apiKeyRef, apiKey);
  const current = readProfiles();
  const replaced = current.profiles.find((item) => item.baseUrl === baseUrl);
  if (replaced && replaced.apiKeyRef !== profile.apiKeyRef)
    await secureRemove(replaced.apiKeyRef);
  localStorage.setItem(
    profilesKey,
    JSON.stringify({
      profiles: [
        profile,
        ...current.profiles.filter((item) => item.baseUrl !== baseUrl),
      ],
      activeId: profile.id,
    }),
  );
  localStorage.setItem(activeProfileKey, profile.id);
  return profile;
}

export async function readApiKey(
  profile: ConnectionProfile,
): Promise<string | null> {
  return secureGet(profile.apiKeyRef);
}

export async function activateProfile(
  profile: ConnectionProfile,
): Promise<void> {
  const current = readProfiles();
  const profiles = current.profiles.map((item) =>
    item.id === profile.id ? { ...item, lastUsedAt: Date.now() } : item,
  );
  localStorage.setItem(
    profilesKey,
    JSON.stringify({ profiles, activeId: profile.id }),
  );
  localStorage.setItem(activeProfileKey, profile.id);
}

export async function removeProfile(
  profile: ConnectionProfile,
  removeHistory: boolean,
): Promise<void> {
  await secureRemove(profile.apiKeyRef);
  const current = readProfiles();
  const profiles = current.profiles.filter((item) => item.id !== profile.id);
  const activeId =
    current.activeId === profile.id
      ? (profiles[0]?.id ?? null)
      : current.activeId;
  localStorage.setItem(profilesKey, JSON.stringify({ profiles, activeId }));
  if (activeId) localStorage.setItem(activeProfileKey, activeId);
  else localStorage.removeItem(activeProfileKey);
  if (removeHistory) clearProfileData(profile.scope);
}

export function clearProfileData(scope: string): void {
  for (const key of Object.keys(localStorage)) {
    if (key.includes(`:${scope}:`) || key.endsWith(`:${scope}`))
      localStorage.removeItem(key);
  }
}

function isProfile(value: unknown): value is ConnectionProfile {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.baseUrl === "string" &&
    typeof item.apiKeyRef === "string" &&
    typeof item.scope === "string" &&
    typeof item.createdAt === "number" &&
    typeof item.lastUsedAt === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

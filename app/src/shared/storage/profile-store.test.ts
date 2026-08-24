import { beforeEach, describe, expect, it, vi } from "vitest";

const secrets = new Map<string, string>();

vi.mock("@/shared/security/secure-store", () => ({
  secureGet: vi.fn(async (key: string) => secrets.get(key) ?? null),
  secureSet: vi.fn(async (key: string, value: string) => { secrets.set(key, value); }),
  secureRemove: vi.fn(async (key: string) => { secrets.delete(key); }),
}));

vi.mock("@/shared/security/scope", () => ({
  profileScope: vi.fn(async (baseUrl: string, apiKey: string) => `${new URL(baseUrl).hostname}-${apiKey.slice(-4)}`),
}));

import { activateProfile, readApiKey, readProfiles, removeProfile, saveProfile } from "./profile-store";

describe("profile persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    secrets.clear();
  });

  it("round-trips the object written by saveProfile", async () => {
    const profile = await saveProfile({ baseUrl: "https://gateway.example/v1/", apiKey: "  Bearer g2a_secret  ", displayName: "Gateway" });
    const stored = readProfiles();

    expect(stored.activeId).toBe(profile.id);
    expect(stored.profiles).toEqual([profile]);
    expect(stored.profiles[0]?.baseUrl).toBe("https://gateway.example");
    expect(await readApiKey(profile)).toBe("g2a_secret");
    expect(JSON.stringify(stored)).not.toContain("g2a_secret");
  });

  it("persists activation and removes the selected profile", async () => {
    const first = await saveProfile({ baseUrl: "https://one.example", apiKey: "key_one" });
    const second = await saveProfile({ baseUrl: "https://two.example", apiKey: "key_two" });

    await activateProfile(first);
    expect(readProfiles().activeId).toBe(first.id);

    await removeProfile(first, false);
    expect(readProfiles()).toMatchObject({ activeId: second.id, profiles: [second] });
    expect(await readApiKey(first)).toBeNull();
  });

  it("migrates the legacy top-level array format", () => {
    const profile = {
      id: "legacy",
      baseUrl: "https://legacy.example",
      apiKeyRef: "profile:legacy",
      scope: "legacy-scope",
      createdAt: 1,
      lastUsedAt: 1,
    };
    localStorage.setItem("grok2api:profiles:v1", JSON.stringify([profile]));
    expect(readProfiles()).toEqual({ profiles: [profile], activeId: "legacy" });
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { loadChatSessions, saveChatSessions, type ChatSession } from "./chat-store";

function session(index: number): ChatSession {
  return {
    id: `session-${index}`,
    title: `Session ${index}`,
    createdAt: index,
    updatedAt: index,
    model: "grok-4.5",
    promptCacheKey: `local-${index}`,
    reasoningEffort: "auto",
    webSearch: false,
    xSearch: false,
    messages: [],
  };
}

describe("chat persistence", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the newest 50 sessions and reports truncation", () => {
    const result = saveChatSessions("scope-a", Array.from({ length: 52 }, (_, index) => session(index)));
    expect(result.saved).toBe(true);
    expect(result.removed).toBe(2);
    const loaded = loadChatSessions("scope-a");
    expect(loaded.sessions).toHaveLength(50);
    expect(loaded.sessions[0]?.id).toBe("session-51");
  });

  it("does not mix scopes", () => {
    saveChatSessions("scope-a", [session(1)]);
    saveChatSessions("scope-b", [session(2)]);
    expect(loadChatSessions("scope-a").sessions[0]?.id).toBe("session-1");
    expect(loadChatSessions("scope-b").sessions[0]?.id).toBe("session-2");
  });
});

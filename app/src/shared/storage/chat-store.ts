import type { ChatMessage, ReasoningEffort } from "@/shared/api/types";

export type StoredChatMessage = ChatMessage & { id: string; reasoning?: string; tools?: Array<{ id: string; type: string; name: string; status: string; detail: string }> };
export type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  promptCacheKey: string;
  reasoningEffort: ReasoningEffort;
  webSearch: boolean;
  xSearch: boolean;
  messages: StoredChatMessage[];
};

const prefix = "grok2api:chat:";
export const CHAT_MAX_SESSIONS = 50;
export const CHAT_MAX_BYTES = 4 * 1024 * 1024;

export type ChatLoadResult = { sessions: ChatSession[]; truncated: boolean; corrupt: boolean };

export function loadChatSessions(scope: string): ChatLoadResult {
  const key = `${prefix}${scope}`;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { sessions: [], truncated: false, corrupt: false };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { sessions: [], truncated: false, corrupt: true };
    const valid = parsed.filter(isSession).sort((a, b) => b.updatedAt - a.updatedAt);
    return { sessions: valid.slice(0, CHAT_MAX_SESSIONS), truncated: valid.length > CHAT_MAX_SESSIONS, corrupt: valid.length !== parsed.length };
  } catch {
    return { sessions: [], truncated: false, corrupt: true };
  }
}

export function saveChatSessions(scope: string, sessions: ChatSession[]): { saved: boolean; removed: number; bytes: number } {
  const normalized = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, CHAT_MAX_SESSIONS);
  let removed = sessions.length - normalized.length;
  let candidate = normalized;
  let raw = JSON.stringify(candidate);
  while (raw.length > CHAT_MAX_BYTES && candidate.length > 1) {
    candidate = candidate.slice(0, -1);
    removed += 1;
    raw = JSON.stringify(candidate);
  }
  if (raw.length > CHAT_MAX_BYTES) return { saved: false, removed, bytes: raw.length };
  localStorage.setItem(`${prefix}${scope}`, raw);
  return { saved: true, removed, bytes: raw.length };
}

export function clearChatSessions(scope: string): void {
  localStorage.removeItem(`${prefix}${scope}`);
}

function isSession(value: unknown): value is ChatSession {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.title === "string" && typeof item.createdAt === "number" && typeof item.updatedAt === "number" && typeof item.model === "string" && Array.isArray(item.messages);
}

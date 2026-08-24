import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  Activity,
  AudioLines,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FileAudio,
  History as HistoryIcon,
  ImageIcon,
  KeyRound,
  Layers3,
  LoaderCircle,
  MessageSquareText,
  Mic2,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Video,
  X,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from "react";

import { Grok2ApiClient } from "@/shared/api/client";
import { normalizeApiKey } from "@/shared/api/auth";
import { getModelCapabilities } from "@/shared/api/capabilities";
import { GrokApiError, isAbortError } from "@/shared/api/errors";
import type {
  ImageAsset,
  Model,
  ReasoningEffort,
  ResponsesSnapshot,
  SttResult,
  VideoStatusResponse,
  VoiceInfo,
} from "@/shared/api/types";
import { normalizeBaseUrl } from "@/shared/api/url";
import { saveMedia, shareMedia } from "@/shared/platform/media";
import {
  activateProfile,
  readApiKey,
  readProfiles,
  removeProfile,
  saveProfile,
  type ConnectionProfile,
} from "@/shared/storage/profile-store";
import {
  CHAT_MAX_BYTES,
  loadChatSessions,
  saveChatSessions,
  type ChatSession,
  type StoredChatMessage,
} from "@/shared/storage/chat-store";

type Workspace = "chat" | "image" | "video" | "voice" | "history" | "settings";

type ToastState = {
  message: string;
  tone: "normal" | "error" | "success";
} | null;
type ToastTone = NonNullable<ToastState>["tone"];

type VideoJob = {
  id: string;
  requestId: string;
  model: string;
  prompt: string;
  createdAt: number;
  status: VideoStatusResponse["status"];
  progress: number;
  requestedDuration?: number;
  aspectRatio?: string;
  resolution?: string;
  imageUrl?: string;
  videoUrl?: string;
  duration?: number;
  contentType?: string;
  protectedContent?: boolean;
  error?: string;
};
type VideoJobInput = Pick<
  VideoJob,
  | "model"
  | "prompt"
  | "requestedDuration"
  | "aspectRatio"
  | "resolution"
  | "imageUrl"
>;

const workspaceMeta: Record<Workspace, { label: string; description: string }> =
  {
    chat: {
      label: "对话",
      description: "流式 Responses 对话，保留思考与工具活动。",
    },
    image: {
      label: "图片",
      description: "用公共图片接口生成可保存、可分享的画面。",
    },
    video: {
      label: "视频",
      description: "提交异步任务并在后台友好地跟踪进度。",
    },
    voice: {
      label: "语音",
      description: "文字转语音与文件转写均直接连接你的网关。",
    },
    history: { label: "历史", description: "按连接隔离的本地会话和生成任务。" },
    settings: {
      label: "设置",
      description: "管理连接、数据删除和客户端行为。",
    },
  };

const navItems: Array<{ id: Workspace; icon: typeof MessageSquareText }> = [
  { id: "chat", icon: MessageSquareText },
  { id: "image", icon: ImageIcon },
  { id: "video", icon: Video },
  { id: "voice", icon: AudioLines },
  { id: "history", icon: HistoryIcon },
  { id: "settings", icon: Settings2 },
];

const markdownRenderer = new marked.Renderer();
markdownRenderer.html = () => "";
const markdownTags = [
  "p",
  "br",
  "strong",
  "em",
  "del",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "hr",
];

export function App() {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>(
    () => readProfiles().profiles,
  );
  const [activeProfileId, setActiveProfileId] = useState<string | null>(
    () => readProfiles().activeId,
  );
  const activeProfile =
    profiles.find((profile) => profile.id === activeProfileId) ?? null;
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [client, setClient] = useState<Grok2ApiClient | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [workspace, setWorkspace] = useState<Workspace>("chat");
  const [booting, setBooting] = useState(Boolean(activeProfile));
  const [connecting, setConnecting] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionsReady, setSessionsReady] = useState(false);
  const [sessionScope, setSessionScope] = useState<string | null>(null);
  const sessionsRef = useRef(sessions);

  const showToast = useCallback(
    (message: string, tone: ToastTone = "normal") => {
      setToast({ message, tone });
      window.setTimeout(
        () =>
          setToast((current) =>
            current?.message === message ? null : current,
          ),
        5000,
      );
    },
    [],
  );

  const loadProfile = useCallback(
    async (profile: ConnectionProfile, announce = false) => {
      setBooting(true);
      try {
        const key = await readApiKey(profile);
        if (!key) {
          setApiKey(null);
          setClient(null);
          setModels([]);
          if (announce) showToast("此连接的密钥需要重新输入。", "error");
          return;
        }
        const nextClient = new Grok2ApiClient({
          baseUrl: profile.baseUrl,
          apiKey: key,
          allowHttp: __DEV_BUILD__,
        });
        const modelResponse = await nextClient.models({ timeoutMs: 15_000 });
        setApiKey(key);
        setClient(nextClient);
        setModels(dedupeModels(modelResponse.data));
        await activateProfile(profile);
        setProfiles(readProfiles().profiles);
        setActiveProfileId(profile.id);
        if (announce) showToast("连接已切换，数据空间已隔离。", "success");
      } catch (error) {
        setApiKey(null);
        setClient(null);
        setModels([]);
        if (announce) showToast(formatError(error), "error");
      } finally {
        setBooting(false);
      }
    },
    [showToast],
  );

  useEffect(() => {
    let cancelled = false;
    if (!activeProfile) {
      setBooting(false);
      return;
    }
    setApiKey(null);
    setClient(null);
    setModels([]);
    void (async () => {
      try {
        const key = await readApiKey(activeProfile);
        if (cancelled) return;
        if (!key) {
          setApiKey(null);
          setClient(null);
          setModels([]);
          showToast("安全存储中的 Key 已失效，请重新输入。", "error");
          return;
        }
        const nextClient = new Grok2ApiClient({
          baseUrl: activeProfile.baseUrl,
          apiKey: key,
          allowHttp: __DEV_BUILD__,
        });
        const modelResponse = await nextClient.models({ timeoutMs: 15_000 });
        if (cancelled) return;
        setApiKey(key);
        setClient(nextClient);
        setModels(dedupeModels(modelResponse.data));
      } catch (error) {
        if (!cancelled)
          showToast(`无法恢复连接：${formatError(error)}`, "error");
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProfile, showToast]);

  useEffect(() => {
    if (!activeProfile) {
      setSessions([]);
      setActiveSessionId(null);
      setSessionsReady(false);
      setSessionScope(null);
      return;
    }
    setSessionsReady(false);
    setSessionScope(null);
    const loaded = loadChatSessions(activeProfile.scope);
    setSessions(loaded.sessions);
    sessionsRef.current = loaded.sessions;
    setActiveSessionId(loaded.sessions[0]?.id ?? null);
    setSessionsReady(true);
    setSessionScope(activeProfile.scope);
    if (loaded.corrupt)
      showToast("部分历史数据无法读取，已跳过损坏记录。", "error");
    if (loaded.truncated) showToast("历史会话已按 50 条上限整理。", "normal");
  }, [activeProfile, showToast]);

  useEffect(() => {
    sessionsRef.current = sessions;
    if (
      !activeProfile ||
      !sessionsReady ||
      sessionScope !== activeProfile.scope
    )
      return;
    const timer = window.setTimeout(() => {
      const result = saveChatSessions(activeProfile.scope, sessions);
      if (!result.saved) {
        showToast(
          `历史无法写入本地存储（上限约 ${Math.round(CHAT_MAX_BYTES / 1024 / 1024)} MiB），请删除部分内容。`,
          "error",
        );
      } else if (result.removed > 0) {
        showToast(
          `已达到本地容量上限，移除 ${result.removed} 个最旧会话。`,
          "error",
        );
        setSessions(result.sessions);
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [activeProfile, sessionScope, sessions, sessionsReady, showToast]);

  useEffect(() => {
    const flush = () => {
      if (activeProfile && sessionScope === activeProfile.scope)
        saveChatSessions(activeProfile.scope, sessionsRef.current);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", flush);
    return () => {
      flush();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", flush);
    };
  }, [activeProfile, sessionScope]);

  const connect = useCallback(
    async (input: {
      baseUrl: string;
      apiKey: string;
      displayName?: string;
    }) => {
      setConnecting(true);
      try {
        const normalized = normalizeBaseUrl(input.baseUrl, {
          allowHttp: __DEV_BUILD__,
        });
        const normalizedKey = normalizeApiKey(input.apiKey);
        if (!normalizedKey) throw new Error("请填写客户端 API Key。");
        const nextClient = new Grok2ApiClient({
          baseUrl: normalized,
          apiKey: normalizedKey,
          allowHttp: __DEV_BUILD__,
        });
        await nextClient.health({ timeoutMs: 15_000 });
        await nextClient.ready({ timeoutMs: 15_000 });
        const modelResponse = await nextClient.models({ timeoutMs: 15_000 });
        const profile = await saveProfile({
          ...input,
          baseUrl: normalized,
          allowHttp: __DEV_BUILD__,
        });
        setProfiles(readProfiles().profiles);
        setActiveProfileId(profile.id);
        setApiKey(normalizedKey);
        setClient(nextClient);
        setModels(dedupeModels(modelResponse.data));
        setWorkspace("chat");
        showToast(
          modelResponse.data.length
            ? `连接成功，发现 ${modelResponse.data.length} 个模型。`
            : "连接成功，但当前 Key 没有可用模型。",
          modelResponse.data.length ? "success" : "normal",
        );
      } catch (error) {
        throw new Error(formatError(error));
      } finally {
        setConnecting(false);
      }
    },
    [showToast],
  );

  const refreshModels = useCallback(async () => {
    if (!client) return;
    try {
      const response = await client.models({ timeoutMs: 15_000 });
      setModels(dedupeModels(response.data));
      showToast(`模型目录已刷新（${response.data.length} 个）。`, "success");
    } catch (error) {
      showToast(formatError(error), "error");
    }
  }, [client, showToast]);

  const disconnect = useCallback(() => {
    client?.clearApiKey();
    setClient(null);
    setApiKey(null);
    setModels([]);
    setWorkspace("settings");
  }, [client]);

  const switchProfile = useCallback(
    async (profile: ConnectionProfile) => {
      await loadProfile(profile, true);
    },
    [loadProfile],
  );

  const deleteCurrentProfile = useCallback(
    async (removeHistory: boolean) => {
      if (!activeProfile) return;
      await removeProfile(activeProfile, removeHistory);
      setProfiles(readProfiles().profiles);
      setActiveProfileId(readProfiles().activeId);
      setClient(null);
      setApiKey(null);
      setModels([]);
      showToast(
        removeHistory
          ? "连接和本地数据已删除。"
          : "连接已删除，本地历史已保留。",
        "success",
      );
    },
    [activeProfile, showToast],
  );

  const toastView = toast ? (
    <div
      className={`toast ${toast.tone === "error" ? "error-text" : toast.tone === "success" ? "success-text" : ""}`}
      role="status"
    >
      {toast.message}
    </div>
  ) : null;
  if (booting)
    return (
      <>
        <LoadingScreen />
        {toastView}
      </>
    );
  if (!client || !activeProfile || !apiKey) {
    return (
      <>
        <ConnectionScreen
          profiles={profiles}
          connecting={connecting}
          onConnect={connect}
          onSelectProfile={switchProfile}
        />
        {toastView}
      </>
    );
  }

  const page = workspaceMeta[workspace];
  return (
    <div className="app-frame">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={16} />
          </div>
          <div className="brand-copy">
            <div className="brand-name">Grok2API 创作工作台</div>
            <div className="brand-meta">公共 API · 本地优先</div>
          </div>
        </div>
        <div className="top-actions">
          <div className="connection-chip" title={activeProfile.baseUrl}>
            <span className="connection-dot" />
            <span>
              {activeProfile.displayName ?? new URL(activeProfile.baseUrl).host}
            </span>
          </div>
          <button
            className="icon-button"
            type="button"
            title="刷新模型"
            onClick={() => void refreshModels()}
          >
            <RefreshCw size={15} />
          </button>
          <button
            className="icon-button"
            type="button"
            title="断开连接"
            onClick={disconnect}
          >
            <X size={15} />
          </button>
        </div>
      </header>
      <div className="app-body">
        <aside className="sidebar">
          <div className="nav-label">工作区</div>
          <nav className="nav-list" aria-label="主导航">
            {navItems.map(({ id, icon: Icon }) => (
              <button
                key={id}
                className={`nav-item${workspace === id ? " active" : ""}`}
                type="button"
                onClick={() => setWorkspace(id)}
              >
                <Icon size={17} />
                <span>{workspaceMeta[id].label}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-footer">
            连接与历史均保存在本机。API Key 不会上传到第三方服务。
          </div>
        </aside>
        <main className="workspace">
          <div className="workspace-inner">
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  {workspace === "settings"
                    ? "Preferences"
                    : "Creative Console"}
                </div>
                <h1 className="page-title">{page.label}</h1>
                <p className="page-description">{page.description}</p>
              </div>
              <div className="heading-actions">
                {workspace === "chat" ? (
                  <button
                    className="button primary"
                    type="button"
                    onClick={() => setActiveSessionId(null)}
                  >
                    <Plus size={15} />
                    新建会话
                  </button>
                ) : null}
              </div>
            </div>
            {workspace === "chat" ? (
              <ChatWorkspace
                key={activeProfile.scope}
                client={client}
                models={models}
                scope={activeProfile.scope}
                sessions={sessions}
                setSessions={setSessions}
                activeSessionId={activeSessionId}
                setActiveSessionId={setActiveSessionId}
                showToast={showToast}
              />
            ) : null}
            {workspace === "image" ? (
              <ImageWorkspace
                key={activeProfile.scope}
                client={client}
                models={models}
                showToast={showToast}
              />
            ) : null}
            {workspace === "video" ? (
              <VideoWorkspace
                key={activeProfile.scope}
                client={client}
                models={models}
                scope={activeProfile.scope}
                showToast={showToast}
              />
            ) : null}
            {workspace === "voice" ? (
              <VoiceWorkspace
                key={activeProfile.scope}
                client={client}
                models={models}
                showToast={showToast}
              />
            ) : null}
            {workspace === "history" ? (
              <HistoryWorkspace
                sessions={sessions}
                setSessions={setSessions}
                setActiveSessionId={setActiveSessionId}
                setWorkspace={setWorkspace}
              />
            ) : null}
            {workspace === "settings" ? (
              <SettingsWorkspace
                profiles={profiles}
                activeProfile={activeProfile}
                onSwitch={switchProfile}
                onDelete={deleteCurrentProfile}
                onAdd={disconnect}
                models={models}
              />
            ) : null}
          </div>
        </main>
      </div>
      {toastView}
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="connection-page">
      <div className="status-line">
        <LoaderCircle className="spinner" size={17} />
        正在恢复本地连接…
      </div>
    </div>
  );
}

function ConnectionScreen(props: {
  profiles: ConnectionProfile[];
  connecting: boolean;
  onConnect: (input: {
    baseUrl: string;
    apiKey: string;
    displayName?: string;
  }) => Promise<void>;
  onSelectProfile: (profile: ConnectionProfile) => Promise<void>;
}) {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [showKey, setShowKey] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!baseUrl.trim() || !apiKey.trim()) {
      setError("请填写 Base URL 和客户端 API Key。");
      return;
    }
    try {
      await props.onConnect({ baseUrl, apiKey, displayName });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "连接失败，请检查地址和 Key。",
      );
    }
  };
  return (
    <div className="connection-page">
      <div className="connection-layout">
        <section className="connection-intro">
          <div className="intro-mark">
            <Layers3 size={21} />
          </div>
          <div className="eyebrow">Private creative workspace</div>
          <h1 className="intro-title">把你的 Grok2API，变成随身创作台。</h1>
          <p className="intro-copy">
            填写已经部署的服务地址和客户端
            Key。所有推理请求直达你的网关，会话和生成结果默认留在本机。
          </p>
          <div className="intro-points">
            <div className="intro-point">
              <ShieldCheck size={15} />
              Key 通过本地安全存储引用，不进入会话标题或诊断信息。
            </div>
            <div className="intro-point">
              <Zap size={15} />
              支持 Responses 流式聊天、图片、异步视频和语音接口。
            </div>
            <div className="intro-point">
              <CircleHelp size={15} />
              只使用公共 `/v1` API，不依赖管理后台登录。
            </div>
          </div>
        </section>
        <section className="connection-form">
          <div className="panel-title">连接你的网关</div>
          <p className="panel-subtitle">
            首次连接会依次检查存活、就绪状态和模型权限。
          </p>
          <form
            className="form-stack"
            onSubmit={(event) => void submit(event)}
            style={{ marginTop: 22 }}
          >
            <label className="field">
              <span className="field-label">BASE URL</span>
              <input
                className="input"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://grok.example.com"
                autoComplete="url"
                inputMode="url"
              />
              <span className="field-hint">
                生产环境必须使用 HTTPS；末尾 `/` 和误填的 `/v1` 会自动规范化。
              </span>
            </label>
            <label className="field">
              <span className="field-label">CLIENT API KEY</span>
              <div style={{ position: "relative" }}>
                <input
                  className="input"
                  style={{ paddingRight: 70 }}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="g2a_…"
                  type={showKey ? "text" : "password"}
                  autoComplete="off"
                />
                <button
                  className="tiny-button"
                  style={{ position: "absolute", right: 7, top: 9 }}
                  type="button"
                  onClick={() => setShowKey((value) => !value)}
                >
                  {showKey ? "隐藏" : "显示"}
                </button>
              </div>
              <span className="field-hint">
                仅发送到上面填写的网关，不会复制到剪贴板。
              </span>
            </label>
            <label className="field">
              <span className="field-label">连接名称（可选）</span>
              <input
                className="input"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="我的 VPS"
                maxLength={40}
              />
            </label>
            {error ? (
              <div className="status-line error">
                <X size={14} />
                {error}
              </div>
            ) : null}
            <div className="form-actions">
              <button
                className="button primary"
                disabled={props.connecting}
                type="submit"
              >
                {props.connecting ? (
                  <LoaderCircle className="spinner" size={15} />
                ) : (
                  <ChevronRight size={15} />
                )}
                {props.connecting ? "连接中…" : "测试并连接"}
              </button>
            </div>
          </form>
          {props.profiles.length > 0 ? (
            <div className="connection-note">
              <div style={{ marginBottom: 9, color: "var(--muted)" }}>
                已有连接
              </div>
              {props.profiles.slice(0, 3).map((profile) => (
                <button
                  key={profile.id}
                  className="profile-row"
                  style={{ width: "100%", textAlign: "left", marginBottom: 7 }}
                  type="button"
                  onClick={() => void props.onSelectProfile(profile)}
                >
                  <span className="profile-info">
                    <span className="profile-name">
                      {profile.displayName ?? "未命名连接"}
                    </span>
                    <span className="profile-url">{profile.baseUrl}</span>
                  </span>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
          ) : null}
          <div className="connection-note">
            支持 Android 8.0（API 26）及以上。当前版本不调用
            `/api/admin/v1/*`，本地媒体上传暂不启用。
          </div>
        </section>
      </div>
    </div>
  );
}

function ChatWorkspace(props: {
  client: Grok2ApiClient;
  models: Model[];
  scope: string;
  sessions: ChatSession[];
  setSessions: Dispatch<SetStateAction<ChatSession[]>>;
  activeSessionId: string | null;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  showToast: (message: string, tone?: ToastTone) => void;
}) {
  const setSessions = props.setSessions;
  const chatModels = useMemo(
    () => modelsForCapability(props.models, "chat"),
    [props.models],
  );
  const [model, setModel] = useState(chatModels[0]?.id ?? "");
  const [reasoning, setReasoning] = useState<ReasoningEffort>("auto");
  const [webSearch, setWebSearch] = useState(false);
  const [xSearch, setXSearch] = useState(false);
  const [composer, setComposer] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const activeAssistantRef = useRef<{
    sessionId: string;
    messageId: string;
  } | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const session =
    props.sessions.find((item) => item.id === props.activeSessionId) ?? null;
  const lastMessageContent =
    session?.messages[session.messages.length - 1]?.content;
  const selectedSessionId = session?.id;
  const selectedSessionModel = session?.model;
  const selectedSessionReasoning = session?.reasoningEffort;
  const selectedSessionWebSearch = session?.webSearch;
  const selectedSessionXSearch = session?.xSearch;
  const selectedSessionTitle = session?.title;

  useEffect(() => {
    if (!model && chatModels[0]) setModel(chatModels[0].id);
  }, [chatModels, model]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages.length, lastMessageContent]);
  useEffect(() => {
    if (!selectedSessionId || !selectedSessionReasoning) return;
    setModel(selectedSessionModel || chatModels[0]?.id || "");
    setReasoning(selectedSessionReasoning);
    setWebSearch(Boolean(selectedSessionWebSearch));
    setXSearch(Boolean(selectedSessionXSearch));
    setRenaming(false);
    setRenameValue(selectedSessionTitle ?? "");
  }, [
    chatModels,
    selectedSessionId,
    selectedSessionModel,
    selectedSessionReasoning,
    selectedSessionWebSearch,
    selectedSessionXSearch,
    selectedSessionTitle,
  ]);
  useEffect(
    () => () => {
      requestSeqRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      const activeAssistant = activeAssistantRef.current;
      if (activeAssistant) {
        setSessions((current) =>
          current.map((item) =>
            item.id === activeAssistant.sessionId
              ? {
                  ...item,
                  messages: item.messages.filter(
                    (message) =>
                      message.id !== activeAssistant.messageId ||
                      Boolean(String(message.content).trim()),
                  ),
                }
              : item,
          ),
        );
      }
      activeAssistantRef.current = null;
    },
    [setSessions],
  );

  const makeSession = useCallback((): ChatSession => {
    const id = crypto.randomUUID();
    const next: ChatSession = {
      id,
      title: "新会话",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: model || "",
      promptCacheKey: `local-${props.scope}-${id}`,
      reasoningEffort: reasoning,
      webSearch,
      xSearch,
      messages: [],
    };
    props.setSessions((current) => [next, ...current]);
    props.setActiveSessionId(id);
    return next;
  }, [model, props, reasoning, webSearch, xSearch]);

  const updateSession = useCallback(
    (id: string, updater: (session: ChatSession) => ChatSession) => {
      props.setSessions((current) =>
        current.map((item) => (item.id === id ? updater(item) : item)),
      );
    },
    [props],
  );

  const cancelCurrent = () => {
    requestSeqRef.current += 1;
    const controller = abortRef.current;
    abortRef.current = null;
    controller?.abort();
    const activeAssistant = activeAssistantRef.current;
    activeAssistantRef.current = null;
    if (activeAssistant) {
      updateSession(activeAssistant.sessionId, (item) => ({
        ...item,
        messages: item.messages.filter(
          (message) =>
            message.id !== activeAssistant.messageId ||
            String(message.content).trim(),
        ),
      }));
    }
    setStreaming(false);
  };

  const runGeneration = async (
    active: ChatSession,
    history: StoredChatMessage[],
    titleText: string,
  ) => {
    if (abortRef.current || !history.length) return;
    const assistantId = crypto.randomUUID();
    const assistantMessage: StoredChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
    };
    const requestModel = model || active.model;
    const controller = new AbortController();
    const requestSeq = ++requestSeqRef.current;
    abortRef.current = controller;
    activeAssistantRef.current = {
      sessionId: active.id,
      messageId: assistantId,
    };
    updateSession(active.id, (item) => ({
      ...item,
      title: item.messages.length ? item.title : titleText.slice(0, 32),
      model: requestModel,
      reasoningEffort: reasoning,
      webSearch,
      xSearch,
      updatedAt: Date.now(),
      messages: [...history, assistantMessage],
    }));
    setStreaming(true);
    let lastSnapshot: ResponsesSnapshot = {
      text: "",
      reasoning: "",
      tools: [],
    };
    const isCurrent = () =>
      requestSeqRef.current === requestSeq && abortRef.current === controller;
    try {
      const tools = [
        ...(webSearch ? [{ type: "web_search" }] : []),
        ...(xSearch ? [{ type: "x_search" }] : []),
      ];
      const result = await props.client.streamResponses(
        {
          model: requestModel,
          input: history.map(({ role, content }) => ({ role, content })),
          stream: true,
          store: false,
          prompt_cache_key: active.promptCacheKey,
          reasoning:
            reasoning === "auto"
              ? { summary: "auto" }
              : reasoning === "none"
                ? { effort: "none" }
                : { effort: reasoning, summary: "auto" },
          ...(tools.length ? { tools } : {}),
        },
        (snapshot) => {
          if (!isCurrent()) return;
          lastSnapshot = snapshot;
          updateSession(active.id, (item) => ({
            ...item,
            updatedAt: Date.now(),
            messages: item.messages.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    content: snapshot.text,
                    reasoning: snapshot.reasoning || undefined,
                    tools: snapshot.tools,
                  }
                : message,
            ),
          }));
        },
        { signal: controller.signal, timeoutMs: 5 * 60 * 1000 },
      );
      if (!isCurrent()) return;
      lastSnapshot = result;
      updateSession(active.id, (item) => ({
        ...item,
        updatedAt: Date.now(),
        messages: item.messages.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: result.text || lastSnapshot.text,
                reasoning: result.reasoning || undefined,
                tools: result.tools,
              }
            : message,
        ),
      }));
    } catch (error) {
      if (isCurrent() && !isAbortError(error)) {
        const partial =
          error instanceof GrokApiError
            ? (error.partial ?? lastSnapshot)
            : lastSnapshot;
        updateSession(active.id, (item) => ({
          ...item,
          updatedAt: Date.now(),
          messages: item.messages.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: partial.text || "（未收到可显示内容）",
                  reasoning: partial.reasoning || undefined,
                  tools: partial.tools,
                }
              : message,
          ),
        }));
        props.showToast(formatError(error), "error");
      }
    } finally {
      if (isCurrent()) {
        abortRef.current = null;
        activeAssistantRef.current = null;
        setStreaming(false);
      }
    }
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = composer.trim();
    if (!text || abortRef.current) return;
    const active = session ?? makeSession();
    const userMessage: StoredChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    setComposer("");
    await runGeneration(active, [...active.messages, userMessage], text);
  };

  const stop = () => cancelCurrent();
  const clearSession = () => {
    if (!session) return;
    cancelCurrent();
    updateSession(session.id, (item) => ({
      ...item,
      messages: [],
      title: "新会话",
      updatedAt: Date.now(),
    }));
  };
  const deleteSession = () => {
    if (!session) return;
    cancelCurrent();
    props.setSessions((current) =>
      current.filter((item) => item.id !== session.id),
    );
    props.setActiveSessionId(
      props.sessions.find((item) => item.id !== session.id)?.id ?? null,
    );
  };
  const retry = (assistantId: string) => {
    if (!session || abortRef.current) return;
    const assistantIndex = session.messages.findIndex(
      (message) => message.id === assistantId,
    );
    let userIndex = assistantIndex - 1;
    while (userIndex >= 0 && session.messages[userIndex]?.role !== "user")
      userIndex -= 1;
    const userMessage = session.messages[userIndex];
    if (userIndex >= 0 && userMessage)
      void runGeneration(
        session,
        session.messages.slice(0, userIndex + 1),
        String(userMessage.content),
      );
  };
  const editMessage = (messageId: string, content: string) => {
    if (!session || abortRef.current || !content.trim()) return;
    const messageIndex = session.messages.findIndex(
      (message) => message.id === messageId,
    );
    const message = session.messages[messageIndex];
    if (!message) return;
    if (message.role === "user") {
      const edited = { ...message, content: content.trim() };
      const history = [...session.messages.slice(0, messageIndex), edited];
      void runGeneration(session, history, content.trim());
      return;
    }
    updateSession(session.id, (item) => ({
      ...item,
      updatedAt: Date.now(),
      messages: item.messages.map((candidate) =>
        candidate.id === messageId
          ? { ...candidate, content: content.trim() }
          : candidate,
      ),
    }));
  };
  const renameSession = (event: FormEvent) => {
    event.preventDefault();
    if (!session || !renameValue.trim()) return;
    updateSession(session.id, (item) => ({
      ...item,
      title: renameValue.trim().slice(0, 80),
      updatedAt: Date.now(),
    }));
    setRenaming(false);
  };

  return (
    <div className="console-grid">
      <section className="panel chat-panel">
        <div className="chat-toolbar">
          <div className="toolbar-group">
            <span className="toolbar-label">模型</span>
            <select
              className="toolbar-select"
              value={chatModels.some((item) => item.id === model) ? model : ""}
              onChange={(event) => setModel(event.target.value)}
            >
              <option value="">手动输入模型 ID</option>
              {chatModels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id}
                </option>
              ))}
            </select>
            {!chatModels.some((item) => item.id === model) ? (
              <input
                className="input"
                style={{ height: 32, maxWidth: 210, fontSize: 11 }}
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="例如 grok-4.5"
              />
            ) : null}
          </div>
          <div className="toolbar-group">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={webSearch}
                onChange={(event) => setWebSearch(event.target.checked)}
              />
              Web Search
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={xSearch}
                onChange={(event) => setXSearch(event.target.checked)}
              />
              X Search
            </label>
          </div>
        </div>
        <div className="chat-messages">
          {!session?.messages.length ? (
            <div className="empty-state">
              <div>
                <div className="empty-icon">
                  <MessageSquareText size={19} />
                </div>
                <div
                  style={{
                    color: "var(--text)",
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  开始一段新对话
                </div>
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  Enter 发送，Shift + Enter 换行。连接切换后历史完全隔离。
                </div>
              </div>
            </div>
          ) : (
            session.messages.map((message) => (
              <ChatMessageView
                key={message.id}
                message={message}
                onRetry={
                  message.role === "assistant"
                    ? () => retry(message.id)
                    : undefined
                }
                onEdit={(content) => editMessage(message.id, content)}
                editingDisabled={streaming}
              />
            ))
          )}
          <div ref={endRef} />
        </div>
        <div className="composer">
          <form onSubmit={(event) => void send(event)}>
            <div className="composer-box">
              <textarea
                className="composer-textarea"
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder="写下你想探索的内容…"
                disabled={streaming}
              />
              {streaming ? (
                <button
                  className="send-button"
                  style={{ background: "#27313e", color: "var(--danger)" }}
                  type="button"
                  title="停止生成"
                  onClick={stop}
                >
                  <Pause size={16} />
                </button>
              ) : (
                <button
                  className="send-button"
                  type="submit"
                  title="发送"
                  disabled={!composer.trim() || !model}
                >
                  <Send size={16} />
                </button>
              )}
            </div>
          </form>
          <div className="composer-options">
            <label className="toolbar-label">推理</label>
            <select
              className="toolbar-select"
              style={{ height: 27, minWidth: 100 }}
              value={reasoning}
              onChange={(event) =>
                setReasoning(event.target.value as ReasoningEffort)
              }
            >
              {["auto", "none", "low", "medium", "high", "xhigh"].map(
                (item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ),
              )}
            </select>
            <span className="faint" style={{ fontSize: 10 }}>
              {streaming ? "正在流式生成…" : "store: false"}
            </span>
            <button
              className="tiny-button"
              type="button"
              onClick={clearSession}
              disabled={!session?.messages.length}
            >
              <Trash2 size={12} />
              清空
            </button>
            <button
              className="tiny-button"
              type="button"
              onClick={deleteSession}
              disabled={!session}
            >
              <X size={12} />
              删除会话
            </button>
          </div>
        </div>
      </section>
      <aside className="panel history-panel">
        <div className="history-header">
          <span className="panel-title">会话</span>
          <span style={{ display: "flex", gap: 4 }}>
            <button
              className="icon-button"
              style={{ width: 29, height: 29 }}
              type="button"
              title="重命名"
              disabled={!session}
              onClick={() => {
                setRenameValue(session?.title ?? "");
                setRenaming(true);
              }}
            >
              <Pencil size={13} />
            </button>
            <button
              className="icon-button"
              style={{ width: 29, height: 29 }}
              type="button"
              title="新建"
              onClick={() => props.setActiveSessionId(null)}
            >
              <Plus size={14} />
            </button>
          </span>
        </div>
        {renaming ? (
          <form
            onSubmit={renameSession}
            style={{
              display: "flex",
              gap: 5,
              padding: "8px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <input
              className="input"
              style={{ height: 32 }}
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              maxLength={80}
              autoFocus
            />
            <button
              className="icon-button"
              style={{ width: 32, height: 32 }}
              type="submit"
              title="保存"
            >
              <Check size={13} />
            </button>
            <button
              className="icon-button"
              style={{ width: 32, height: 32 }}
              type="button"
              title="取消"
              onClick={() => setRenaming(false)}
            >
              <X size={13} />
            </button>
          </form>
        ) : null}
        <div className="history-list">
          {props.sessions.length ? (
            props.sessions.map((item) => (
              <button
                key={item.id}
                className={`history-item${item.id === props.activeSessionId ? " active" : ""}`}
                type="button"
                onClick={() => props.setActiveSessionId(item.id)}
              >
                <span className="history-title">{item.title || "新会话"}</span>
                <span className="history-date">
                  {formatDate(item.updatedAt)} · {item.messages.length} 条
                </span>
              </button>
            ))
          ) : (
            <div className="history-empty">还没有本地会话。</div>
          )}
        </div>
      </aside>
    </div>
  );
}

function ChatMessageView(props: {
  message: StoredChatMessage;
  onRetry?: () => void;
  onEdit: (content: string) => void;
  editingDisabled: boolean;
}) {
  const isUser = props.message.role === "user";
  const content =
    typeof props.message.content === "string"
      ? props.message.content
      : JSON.stringify(props.message.content);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  useEffect(() => {
    if (!editing) setDraft(content);
  }, [content, editing]);
  return (
    <div className={`message-row ${isUser ? "user" : "assistant"}`}>
      <div className="message-avatar">
        {isUser ? "你" : <Sparkles size={13} />}
      </div>
      <div className="message-content">
        <div className="message-meta">{isUser ? "USER" : "GROK"}</div>
        {props.message.reasoning ? (
          <details className="reasoning">
            <summary>思考过程</summary>
            <div style={{ marginTop: 6 }}>{props.message.reasoning}</div>
          </details>
        ) : null}
        {editing ? (
          <div className="field">
            <textarea
              className="textarea"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              autoFocus
            />
            <div className="form-footer">
              <button
                className="button small"
                type="button"
                onClick={() => {
                  props.onEdit(draft);
                  setEditing(false);
                }}
                disabled={!draft.trim()}
              >
                <Check size={12} />
                保存
              </button>
              <button
                className="button small ghost"
                type="button"
                onClick={() => {
                  setDraft(content);
                  setEditing(false);
                }}
              >
                <X size={12} />
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="message-bubble">
            {isUser ? content : <SafeMarkdown value={content || "▋"} />}
          </div>
        )}
        {props.message.tools?.length ? (
          <div className="tool-activity">
            <Activity
              size={12}
              style={{ verticalAlign: "-2px", marginRight: 5 }}
            />
            {props.message.tools
              .map((tool) => `${tool.name || tool.type} · ${tool.status}`)
              .join("、")}
          </div>
        ) : null}
        <div className="message-actions">
          {!isUser ? (
            <button
              className="tiny-button"
              type="button"
              onClick={props.onRetry}
            >
              <RefreshCw size={11} />
              重试
            </button>
          ) : null}
          <button
            className="tiny-button"
            type="button"
            disabled={props.editingDisabled}
            onClick={() => setEditing(true)}
          >
            <Pencil size={11} />
            编辑
          </button>
          <button
            className="tiny-button"
            type="button"
            onClick={() => void navigator.clipboard?.writeText(content)}
          >
            <Copy size={11} />
            复制
          </button>
        </div>
      </div>
    </div>
  );
}

function SafeMarkdown({ value }: { value: string }) {
  const rendered = marked.parse(value, {
    async: false,
    renderer: markdownRenderer,
  }) as string;
  const sanitized = DOMPurify.sanitize(rendered, {
    ALLOWED_TAGS: markdownTags,
    ALLOWED_ATTR: ["href", "src", "alt", "title", "class"],
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto):|data:image\/(?:png|jpeg|gif|webp);base64,)/i,
  });
  const documentFragment = new DOMParser().parseFromString(
    sanitized,
    "text/html",
  );
  for (const link of documentFragment.body.querySelectorAll("a")) {
    const href = link.getAttribute("href") ?? "";
    if (!/^(?:https?:|mailto:)/i.test(href)) {
      link.replaceWith(...link.childNodes);
      continue;
    }
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  for (const image of documentFragment.body.querySelectorAll("img")) {
    const source = image.getAttribute("src") ?? "";
    if (!/^(?:https:|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(source))
      image.remove();
  }
  for (const pre of documentFragment.body.querySelectorAll("pre")) {
    const button = documentFragment.createElement("button");
    button.type = "button";
    button.className = "code-copy-button";
    button.dataset.copyCode = "true";
    button.textContent = "复制";
    pre.prepend(button);
  }
  const copyCode = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("[data-copy-code]")
        : null;
    const code = target?.parentElement?.querySelector("code")?.textContent;
    if (target && code) void navigator.clipboard?.writeText(code);
  };
  return (
    <div
      className="markdown"
      onClick={copyCode}
      dangerouslySetInnerHTML={{ __html: documentFragment.body.innerHTML }}
    />
  );
}

function ImageWorkspace(props: {
  client: Grok2ApiClient;
  models: Model[];
  showToast: (message: string, tone?: ToastTone) => void;
}) {
  const imageModels = useMemo(
    () => modelsForCapability(props.models, "image"),
    [props.models],
  );
  const [model, setModel] = useState(imageModels[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState("1");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [resolution, setResolution] = useState("1k");
  const [quality, setQuality] = useState("medium");
  const [results, setResults] = useState<ImageAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!model && imageModels[0]) setModel(imageModels[0].id);
  }, [imageModels, model]);
  useEffect(() => () => abortRef.current?.abort(), []);
  const qualitySupported = /grok-imagine-image-2\.0$/i.test(model);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!prompt.trim() || !model || busy) return;
    setBusy(true);
    setResults([]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const assets = await props.client.generateImage(
        {
          model,
          prompt: prompt.trim(),
          n: Number(count),
          aspect_ratio: aspectRatio,
          resolution,
          response_format: "url",
          stream: false,
          ...(qualitySupported ? { quality } : {}),
        },
        { signal: controller.signal, timeoutMs: 2 * 60 * 1000 },
      );
      setResults(assets);
      props.showToast(`已生成 ${assets.length} 张图片。`, "success");
    } catch (error) {
      if (!isAbortError(error)) props.showToast(formatError(error), "error");
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };
  return (
    <div className="media-layout">
      <section className="panel media-form">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">图片生成</h2>
            <p className="panel-subtitle">支持 URL 与 b64_json 响应。</p>
          </div>
          <ImageIcon size={17} className="muted" />
        </div>
        <form
          className="panel-body form-stack"
          onSubmit={(event) => void submit(event)}
        >
          <label className="field">
            <span className="field-label">模型</span>
            <select
              className="select"
              value={imageModels.some((item) => item.id === model) ? model : ""}
              onChange={(event) => setModel(event.target.value)}
            >
              <option value="">手动输入模型 ID</option>
              {imageModels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id}
                </option>
              ))}
            </select>
            {!imageModels.some((item) => item.id === model) ? (
              <input
                className="input"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="grok-imagine-image"
              />
            ) : null}
          </label>
          <label className="field">
            <span className="field-label">提示词</span>
            <textarea
              className="textarea"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="描述你想生成的画面…"
              maxLength={4000}
            />
          </label>
          <div className="field-grid two">
            <label className="field">
              <span className="field-label">数量</span>
              <select
                className="select"
                value={count}
                onChange={(event) => setCount(event.target.value)}
              >
                {[1, 2, 3, 4].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">比例</span>
              <select
                className="select"
                value={aspectRatio}
                onChange={(event) => setAspectRatio(event.target.value)}
              >
                {["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"].map(
                  (value) => (
                    <option key={value}>{value}</option>
                  ),
                )}
              </select>
            </label>
            <label className="field">
              <span className="field-label">分辨率</span>
              <select
                className="select"
                value={resolution}
                onChange={(event) => setResolution(event.target.value)}
              >
                <option>1k</option>
                <option>2k</option>
              </select>
            </label>
            {qualitySupported ? (
              <label className="field">
                <span className="field-label">质量</span>
                <select
                  className="select"
                  value={quality}
                  onChange={(event) => setQuality(event.target.value)}
                >
                  <option>low</option>
                  <option>medium</option>
                </select>
              </label>
            ) : null}
          </div>
          <div className="form-footer">
            {busy ? (
              <button
                className="button ghost"
                type="button"
                onClick={() => abortRef.current?.abort()}
              >
                <Pause size={14} />
                停止
              </button>
            ) : null}
            <button
              className="button primary"
              type="submit"
              disabled={busy || !model || !prompt.trim()}
            >
              {busy ? (
                <LoaderCircle className="spinner" size={15} />
              ) : (
                <Sparkles size={15} />
              )}
              {busy ? "生成中…" : "生成图片"}
            </button>
          </div>
        </form>
      </section>
      <section>
        <div
          className="panel-header"
          style={{ padding: "0 0 12px", borderBottom: 0 }}
        >
          <div>
            <h2 className="panel-title">结果</h2>
            <p className="panel-subtitle">
              生成结果只在本机索引，远程 URL 按服务端语义处理。
            </p>
          </div>
        </div>
        {results.length ? (
          <div className="result-grid">
            {results.map((asset, index) => (
              <MediaResult
                key={`${asset.url}-${index}`}
                url={asset.url}
                label={
                  asset.source === "base64" ? "Base64 图片" : "网关媒体 URL"
                }
                showToast={props.showToast}
              />
            ))}
          </div>
        ) : (
          <div
            className="panel"
            style={{ minHeight: 290, display: "grid", placeItems: "center" }}
          >
            <div className="empty-state" style={{ minHeight: 240 }}>
              <div>
                <div className="empty-icon">
                  <ImageIcon size={19} />
                </div>
                <div style={{ fontSize: 13 }}>生成结果会显示在这里</div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function VideoWorkspace(props: {
  client: Grok2ApiClient;
  models: Model[];
  scope: string;
  showToast: (message: string, tone?: ToastTone) => void;
}) {
  const videoModels = useMemo(
    () => modelsForCapability(props.models, "video"),
    [props.models],
  );
  const [model, setModel] = useState(videoModels[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState("6");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("720p");
  const [imageUrl, setImageUrl] = useState("");
  const [jobs, setJobs] = useState<VideoJob[]>(() =>
    loadVideoJobs(props.scope),
  );
  const [busy, setBusy] = useState(false);
  const jobsRef = useRef(jobs);
  const submitAbortRef = useRef<AbortController | null>(null);
  const objectUrlsRef = useRef(new Set<string>());
  useEffect(() => {
    if (!model && videoModels[0]) setModel(videoModels[0].id);
  }, [model, videoModels]);
  useEffect(() => {
    jobsRef.current = jobs;
    const persisted = jobs.map((job) =>
      job.videoUrl?.startsWith("blob:") ? { ...job, videoUrl: undefined } : job,
    );
    localStorage.setItem(
      `grok2api:video-jobs:${props.scope}`,
      JSON.stringify(persisted),
    );
  }, [jobs, props.scope]);
  useEffect(
    () => () => {
      submitAbortRef.current?.abort();
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
      objectUrlsRef.current.clear();
    },
    [],
  );
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let activeController: AbortController | undefined;
    const nextPollAt = new Map<string, number>();
    const retryCounts = new Map<string, number>();
    const updateJob = (
      jobId: string,
      update: Partial<VideoJob>,
      pendingOnly = false,
    ) => {
      setJobs((current) =>
        current.map((item) =>
          item.id === jobId && (!pendingOnly || item.status === "pending")
            ? { ...item, ...update }
            : item,
        ),
      );
    };
    const schedule = (delayMs: number) => {
      if (!cancelled) timer = window.setTimeout(() => void tick(), delayMs);
    };
    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === "hidden") {
        schedule(1000);
        return;
      }
      const now = Date.now();
      const candidates = jobsRef.current.filter(
        (item) =>
          item.status === "pending" ||
          (item.status === "done" && item.protectedContent && !item.videoUrl),
      );
      for (const job of candidates) {
        if (cancelled || now < (nextPollAt.get(job.id) ?? 0)) continue;
        if (job.status === "pending" && now - job.createdAt > 30 * 60 * 1000) {
          updateJob(
            job.id,
            {
              status: "failed",
              error: "任务查询已超过 30 分钟，请重新提交。",
            },
            true,
          );
          continue;
        }
        try {
          activeController = new AbortController();
          if (job.status === "done" && job.protectedContent) {
            const content = await props.client.getVideoContent(job.requestId, {
              signal: activeController.signal,
              timeoutMs: 2 * 60 * 1000,
            });
            if (cancelled) return;
            const videoUrl = URL.createObjectURL(
              new Blob([content.bytes], { type: content.contentType }),
            );
            objectUrlsRef.current.add(videoUrl);
            updateJob(job.id, {
              videoUrl,
              contentType: content.contentType,
              error: undefined,
            });
            retryCounts.delete(job.id);
            nextPollAt.delete(job.id);
            continue;
          }
          const status = await props.client.getVideoStatus(job.requestId, {
            signal: activeController.signal,
            timeoutMs: 15_000,
          });
          if (cancelled) return;
          retryCounts.delete(job.id);
          nextPollAt.set(job.id, Date.now() + 3000);
          updateJob(
            job.id,
            {
              status: status.status,
              progress: status.progress,
              videoUrl: status.video?.url,
              duration: status.video?.duration,
              protectedContent: status.status === "done" && !status.video?.url,
              error: status.error?.message,
            },
            true,
          );
          if (status.status !== "pending") nextPollAt.delete(job.id);
        } catch (error) {
          if (cancelled || isAbortError(error)) return;
          const terminal =
            error instanceof GrokApiError &&
            error.status >= 400 &&
            error.status < 500 &&
            !error.retryable;
          if (terminal) {
            updateJob(job.id, {
              status: "failed",
              error: formatError(error),
            });
            nextPollAt.delete(job.id);
            continue;
          }
          const attempts = (retryCounts.get(job.id) ?? 0) + 1;
          retryCounts.set(job.id, attempts);
          const backoff =
            error instanceof GrokApiError && error.retryAfterMs
              ? error.retryAfterMs
              : Math.min(3000 * 2 ** (attempts - 1), 30_000);
          nextPollAt.set(job.id, Date.now() + backoff);
        } finally {
          activeController = undefined;
        }
      }
      schedule(1000);
    };
    schedule(0);
    return () => {
      cancelled = true;
      activeController?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [props.client]);
  const createJob = async (input: VideoJobInput) => {
    if (!input.prompt.trim() || !input.model || busy) return;
    if (input.imageUrl?.trim() && input.resolution === "1080p") {
      props.showToast("带参考图时不能使用 1080p。", "error");
      return;
    }
    setBusy(true);
    const controller = new AbortController();
    submitAbortRef.current = controller;
    try {
      const response = await props.client.createVideo(
        {
          model: input.model,
          prompt: input.prompt.trim(),
          duration: input.requestedDuration,
          aspect_ratio: input.aspectRatio,
          resolution: input.resolution,
          ...(input.imageUrl?.trim()
            ? { image: { url: input.imageUrl.trim() } }
            : {}),
        },
        { signal: controller.signal, timeoutMs: 60_000 },
      );
      const job: VideoJob = {
        id: crypto.randomUUID(),
        requestId: response.request_id,
        ...input,
        prompt: input.prompt.trim(),
        createdAt: Date.now(),
        status: "pending",
        progress: 0,
      };
      setJobs((current) => [job, ...current].slice(0, 20));
      props.showToast("视频任务已提交，后台每 3 秒更新。", "success");
    } catch (error) {
      if (!isAbortError(error)) props.showToast(formatError(error), "error");
    } finally {
      if (submitAbortRef.current === controller) submitAbortRef.current = null;
      setBusy(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await createJob({
      model,
      prompt,
      requestedDuration: Number(duration),
      aspectRatio,
      resolution,
      imageUrl: imageUrl.trim() || undefined,
    });
  };
  const retryJob = async (job: VideoJob) => {
    await createJob({
      model: job.model,
      prompt: job.prompt,
      requestedDuration: job.requestedDuration ?? 6,
      aspectRatio: job.aspectRatio ?? "16:9",
      resolution: job.resolution ?? "720p",
      imageUrl: job.imageUrl,
    });
  };
  const saveVideo = async (job: VideoJob) => {
    if (!job.videoUrl) return;
    try {
      await saveMedia(job.videoUrl, "grok2api-video.mp4");
      props.showToast("视频已保存到系统媒体库。", "success");
    } catch (error) {
      props.showToast(formatError(error), "error");
    }
  };
  const shareVideo = async (job: VideoJob) => {
    if (!job.videoUrl) return;
    try {
      await shareMedia(job.videoUrl, "Grok2API 视频", "grok2api-video.mp4");
    } catch (error) {
      props.showToast(formatError(error), "error");
    }
  };
  return (
    <div className="media-layout">
      <section className="panel media-form">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">视频生成</h2>
            <p className="panel-subtitle">
              任务先写入本地，再轮询 pending → done/failed。
            </p>
          </div>
          <Video size={17} className="muted" />
        </div>
        <form
          className="panel-body form-stack"
          onSubmit={(event) => void submit(event)}
        >
          <label className="field">
            <span className="field-label">模型</span>
            <select
              className="select"
              value={videoModels.some((item) => item.id === model) ? model : ""}
              onChange={(event) => setModel(event.target.value)}
            >
              <option value="">手动输入模型 ID</option>
              {videoModels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id}
                </option>
              ))}
            </select>
            {!videoModels.some((item) => item.id === model) ? (
              <input
                className="input"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="grok-imagine-video"
              />
            ) : null}
          </label>
          <label className="field">
            <span className="field-label">提示词</span>
            <textarea
              className="textarea"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="描述镜头运动、主体和氛围…"
              maxLength={4000}
            />
          </label>
          <div className="field-grid two">
            <label className="field">
              <span className="field-label">时长</span>
              <select
                className="select"
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              >
                {[6, 10, 15].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">比例</span>
              <select
                className="select"
                value={aspectRatio}
                onChange={(event) => setAspectRatio(event.target.value)}
              >
                {["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"].map(
                  (value) => (
                    <option key={value}>{value}</option>
                  ),
                )}
              </select>
            </label>
            <label className="field">
              <span className="field-label">分辨率</span>
              <select
                className="select"
                value={resolution}
                onChange={(event) => setResolution(event.target.value)}
              >
                {["480p", "720p", "1080p"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span className="field-label">公网首帧 URL（可选）</span>
            <input
              className="input"
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
              placeholder="https://…/first-frame.png"
              inputMode="url"
            />
            <span className="field-hint">
              MVP 不调用管理端 staging 上传，只接受公网 URL。
            </span>
          </label>
          <div className="form-footer">
            {busy ? (
              <button
                className="button ghost"
                type="button"
                onClick={() => submitAbortRef.current?.abort()}
              >
                <Pause size={14} />
                停止
              </button>
            ) : null}
            <button
              className="button primary"
              type="submit"
              disabled={busy || !model || !prompt.trim()}
            >
              {busy ? (
                <LoaderCircle className="spinner" size={15} />
              ) : (
                <Video size={15} />
              )}
              {busy ? "提交中…" : "提交视频任务"}
            </button>
          </div>
        </form>
      </section>
      <section>
        <div
          className="panel-header"
          style={{ padding: "0 0 12px", borderBottom: 0 }}
        >
          <div>
            <h2 className="panel-title">任务</h2>
            <p className="panel-subtitle">切换页面后任务仍会从本地索引恢复。</p>
          </div>
        </div>
        {jobs.length ? (
          <div className="job-list">
            {jobs.map((job) => (
              <VideoJobRow
                key={job.id}
                job={job}
                busy={busy}
                onRetry={() => void retryJob(job)}
                onSave={() => void saveVideo(job)}
                onShare={() => void shareVideo(job)}
              />
            ))}
          </div>
        ) : (
          <div
            className="panel"
            style={{ minHeight: 290, display: "grid", placeItems: "center" }}
          >
            <div className="empty-state" style={{ minHeight: 240 }}>
              <div>
                <div className="empty-icon">
                  <Clock3 size={19} />
                </div>
                <div style={{ fontSize: 13 }}>还没有视频任务</div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function VideoJobRow(props: {
  job: VideoJob;
  busy: boolean;
  onRetry: () => void;
  onSave: () => void;
  onShare: () => void;
}) {
  return (
    <div className="job-row">
      {props.job.videoUrl ? (
        <video
          className="result-media result-video"
          controls
          preload="metadata"
          src={props.job.videoUrl}
        />
      ) : null}
      <div className="job-top">
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {props.job.prompt}
        </span>
        <span
          className={
            props.job.status === "failed"
              ? "error-text"
              : props.job.status === "done"
                ? "success-text"
                : "muted"
          }
        >
          {props.job.status === "pending"
            ? "处理中"
            : props.job.status === "done"
              ? "完成"
              : "失败"}
        </span>
      </div>
      <div className="progress">
        <span style={{ width: `${props.job.progress}%` }} />
      </div>
      <div className="job-meta">
        <span>
          {props.job.progress}% · {formatDate(props.job.createdAt)}
        </span>
        <span>{props.job.requestId.slice(0, 12)}…</span>
      </div>
      {props.job.error ? (
        <div className="error-text" style={{ marginTop: 8, fontSize: 11 }}>
          {props.job.error}
        </div>
      ) : null}
      <div className="form-footer" style={{ marginTop: 8 }}>
        {props.job.status === "failed" ? (
          <button
            className="button small"
            type="button"
            disabled={props.busy}
            onClick={props.onRetry}
          >
            <RefreshCw size={12} />
            重试
          </button>
        ) : null}
        {props.job.status === "done" && props.job.videoUrl ? (
          <>
            <button
              className="button small"
              type="button"
              onClick={props.onSave}
            >
              <Download size={12} />
              保存
            </button>
            <button
              className="button small"
              type="button"
              onClick={props.onShare}
            >
              <ExternalLink size={12} />
              分享
            </button>
          </>
        ) : null}
        {props.job.status === "done" &&
        props.job.protectedContent &&
        !props.job.videoUrl ? (
          <span className="muted" style={{ fontSize: 11 }}>
            <LoaderCircle className="spinner" size={12} />
            正在加载受保护视频…
          </span>
        ) : null}
      </div>
    </div>
  );
}

function VoiceWorkspace(props: {
  client: Grok2ApiClient;
  models: Model[];
  showToast: (message: string, tone?: ToastTone) => void;
}) {
  const voiceModels = useMemo(
    () => modelsForCapability(props.models, "tts"),
    [props.models],
  );
  const sttModels = useMemo(
    () => modelsForCapability(props.models, "stt"),
    [props.models],
  );
  const [tab, setTab] = useState<"tts" | "stt">("tts");
  const [ttsModel, setTtsModel] = useState(
    voiceModels[0]?.id ?? "grok-voice-latest",
  );
  const [sttModel, setSttModel] = useState(sttModels[0]?.id ?? "grok-stt");
  const [text, setText] = useState("");
  const [language, setLanguage] = useState("zh");
  const [speed, setSpeed] = useState(1);
  const [voiceId, setVoiceId] = useState("eve");
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioContentType, setAudioContentType] = useState("audio/mpeg");
  const [transcript, setTranscript] = useState<SttResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<File | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const audioUrlRef = useRef("");
  const replaceAudioUrl = (value: string) => {
    if (audioUrlRef.current.startsWith("blob:"))
      URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = value;
    setAudioUrl(value);
  };
  useEffect(() => {
    if (!voiceId && voices[0]) setVoiceId(voices[0].voiceId);
  }, [voiceId, voices]);
  useEffect(() => {
    if (tab !== "tts") return;
    let cancelled = false;
    const controller = new AbortController();
    void props.client
      .listVoices({
        model: ttsModel,
        signal: controller.signal,
        timeoutMs: 15_000,
      })
      .then((items) => {
        if (!cancelled) {
          setVoices(items);
          if (items[0]) setVoiceId((current) => current || items[0].voiceId);
        }
      })
      .catch(() => {
        if (!cancelled) setVoices([]);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [props.client, tab, ttsModel]);
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (audioUrlRef.current.startsWith("blob:"))
        URL.revokeObjectURL(audioUrlRef.current);
    },
    [],
  );
  const synthesize = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    replaceAudioUrl("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await props.client.synthesizeSpeech(
        {
          model: ttsModel,
          text: text.trim(),
          voice_id: voiceId || "eve",
          language,
          speed,
        },
        { signal: controller.signal, timeoutMs: 2 * 60 * 1000 },
      );
      let url = result.url ?? result.dataUrl ?? "";
      if (!url && result.bytes)
        url = URL.createObjectURL(
          new Blob([result.bytes], {
            type: result.contentType || "audio/mpeg",
          }),
        );
      setAudioContentType(result.contentType || "audio/mpeg");
      replaceAudioUrl(url);
      props.showToast("语音生成完成。", "success");
    } catch (error) {
      if (!isAbortError(error)) props.showToast(formatError(error), "error");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  };
  const transcribe = async (event: FormEvent) => {
    event.preventDefault();
    const file = fileRef.current;
    if (!file || busy) return;
    if (
      !file.type.startsWith("audio/") &&
      !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)
    ) {
      props.showToast("请选择音频文件。", "error");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      props.showToast("音频文件不能超过 10 MiB。", "error");
      return;
    }
    setBusy(true);
    setTranscript(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setTranscript(
        await props.client.transcribeSpeech(
          { model: sttModel, file, filename: file.name, format: true },
          { signal: controller.signal, timeoutMs: 5 * 60 * 1000 },
        ),
      );
      props.showToast("转写完成。", "success");
    } catch (error) {
      if (!isAbortError(error)) props.showToast(formatError(error), "error");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  };
  const saveAudio = async () => {
    if (!audioUrl) return;
    const extension = audioContentType.includes("wav")
      ? "wav"
      : audioContentType.includes("ogg")
        ? "ogg"
        : "mp3";
    try {
      await saveMedia(audioUrl, `grok2api-tts.${extension}`);
      props.showToast("音频已保存到系统媒体库。", "success");
    } catch (error) {
      props.showToast(formatError(error), "error");
    }
  };
  const shareAudio = async () => {
    if (!audioUrl) return;
    try {
      await shareMedia(audioUrl, "Grok2API TTS", "grok2api-tts.mp3");
    } catch (error) {
      props.showToast(formatError(error), "error");
    }
  };
  return (
    <div className="settings-grid">
      <div className="voice-tabs">
        <button
          className={`voice-tab${tab === "tts" ? " active" : ""}`}
          type="button"
          disabled={busy}
          onClick={() => setTab("tts")}
        >
          <AudioLines
            size={14}
            style={{ verticalAlign: "-3px", marginRight: 6 }}
          />
          文字转语音
        </button>
        <button
          className={`voice-tab${tab === "stt" ? " active" : ""}`}
          type="button"
          disabled={busy}
          onClick={() => setTab("stt")}
        >
          <FileAudio
            size={14}
            style={{ verticalAlign: "-3px", marginRight: 6 }}
          />
          文件转写
        </button>
      </div>
      {tab === "tts" ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">TTS</h2>
              <p className="panel-subtitle">
                兼容原始 audio/* 和 JSON + Base64 返回。
              </p>
            </div>
            <Mic2 size={17} className="muted" />
          </div>
          <form
            className="panel-body form-stack"
            onSubmit={(event) => void synthesize(event)}
          >
            <label className="field">
              <span className="field-label">模型</span>
              <select
                className="select"
                value={ttsModel}
                onChange={(event) => setTtsModel(event.target.value)}
              >
                <option value="grok-voice-latest">grok-voice-latest</option>
                {voiceModels
                  .filter((item) => item.id !== "grok-voice-latest")
                  .map((item) => (
                    <option key={item.id}>{item.id}</option>
                  ))}
              </select>
            </label>
            <div className="field-grid two">
              <label className="field">
                <span className="field-label">声音</span>
                <select
                  className="select"
                  value={voiceId}
                  onChange={(event) => setVoiceId(event.target.value)}
                >
                  {voices.length ? (
                    voices.map((voice) => (
                      <option key={voice.voiceId} value={voice.voiceId}>
                        {voice.name} · {voice.voiceId}
                      </option>
                    ))
                  ) : (
                    <option value="eve">eve（默认）</option>
                  )}
                </select>
              </label>
              <label className="field">
                <span className="field-label">语言</span>
                <select
                  className="select"
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                >
                  {["auto", "zh", "en", "ja", "ko", "fr", "de", "es"].map(
                    (item) => (
                      <option key={item}>{item}</option>
                    ),
                  )}
                </select>
              </label>
            </div>
            <label className="field">
              <span className="field-label">文本</span>
              <textarea
                className="textarea"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="输入要朗读的文字…"
                maxLength={8000}
              />
            </label>
            <label className="field">
              <span className="field-label">语速</span>
              <div className="range-row">
                <input
                  type="range"
                  min="0.7"
                  max="1.5"
                  step="0.1"
                  value={speed}
                  onChange={(event) => setSpeed(Number(event.target.value))}
                />
                <span className="range-value">{speed.toFixed(1)}×</span>
              </div>
            </label>
            <div className="form-footer">
              {busy ? (
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                >
                  <Pause size={14} />
                  停止
                </button>
              ) : null}
              <button
                className="button primary"
                type="submit"
                disabled={busy || !text.trim()}
              >
                {busy ? (
                  <LoaderCircle className="spinner" size={15} />
                ) : (
                  <Play size={15} />
                )}
                {busy ? "生成中…" : "生成语音"}
              </button>
            </div>
            {audioUrl ? (
              <div>
                <audio className="audio-player" controls src={audioUrl} />
                <div className="form-footer">
                  <button
                    className="button small"
                    type="button"
                    onClick={() => void saveAudio()}
                  >
                    <Download size={13} />
                    保存音频
                  </button>
                  <button
                    className="button small"
                    type="button"
                    onClick={() => void shareAudio()}
                  >
                    <ExternalLink size={13} />
                    分享
                  </button>
                </div>
                <div className="field-hint">
                  音频数据只在当前页面使用，不写入诊断日志。
                </div>
              </div>
            ) : null}
          </form>
        </section>
      ) : (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">STT</h2>
              <p className="panel-subtitle">
                使用系统文件选择器上传，MVP 不申请录音权限。
              </p>
            </div>
            <FileAudio size={17} className="muted" />
          </div>
          <form
            className="panel-body form-stack"
            onSubmit={(event) => void transcribe(event)}
          >
            <label className="field">
              <span className="field-label">模型</span>
              <select
                className="select"
                value={sttModel}
                onChange={(event) => setSttModel(event.target.value)}
              >
                <option value="grok-stt">grok-stt</option>
                {sttModels
                  .filter((item) => item.id !== "grok-stt")
                  .map((item) => (
                    <option key={item.id}>{item.id}</option>
                  ))}
              </select>
            </label>
            <label className="dropzone">
              <span className="dropzone-label">
                <Upload size={21} />
                <span>{fileName || "选择音频文件"}</span>
                <small>MP3、WAV、M4A、AAC、OGG、FLAC · 最大 10 MiB</small>
              </span>
              <input
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  fileRef.current = file;
                  setFileName(file?.name ?? "");
                }}
              />
            </label>
            <div className="form-footer">
              {busy ? (
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                >
                  <Pause size={14} />
                  停止
                </button>
              ) : null}
              <button
                className="button primary"
                type="submit"
                disabled={busy || !fileRef.current}
              >
                {busy ? (
                  <LoaderCircle className="spinner" size={15} />
                ) : (
                  <Upload size={15} />
                )}
                {busy ? "上传中…" : "开始转写"}
              </button>
            </div>
            {transcript ? (
              <div className="panel" style={{ background: "#0c1118" }}>
                <div className="panel-body">
                  <div className="status-line success">
                    <Check size={14} />
                    转写完成
                    {transcript.language ? ` · ${transcript.language}` : ""}
                    {typeof transcript.duration === "number"
                      ? ` · ${transcript.duration.toFixed(1)} 秒`
                      : ""}
                  </div>
                  <div className="transcript" style={{ marginTop: 12 }}>
                    {transcript.text}
                  </div>
                  {transcript.words?.length ? (
                    <details
                      style={{
                        marginTop: 12,
                        color: "var(--muted)",
                        fontSize: 11,
                      }}
                    >
                      <summary>词级时间戳（{transcript.words.length}）</summary>
                      <div style={{ marginTop: 8 }}>
                        {transcript.words.map((word, index) => (
                          <span
                            key={`${word.text}-${index}`}
                            style={{ marginRight: 7 }}
                          >
                            {word.text}{" "}
                            <small>
                              ({word.start.toFixed(1)}–{word.end.toFixed(1)})
                            </small>
                          </span>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              </div>
            ) : null}
          </form>
        </section>
      )}
    </div>
  );
}

function MediaResult(props: {
  url: string;
  label: string;
  showToast: (message: string, tone?: ToastTone) => void;
}) {
  const save = async () => {
    try {
      await saveMedia(props.url, "grok2api-image.png");
      props.showToast("图片已保存到系统媒体库。", "success");
    } catch (error) {
      props.showToast(formatError(error), "error");
    }
  };
  const share = async () => {
    try {
      await shareMedia(props.url, "Grok2API 创作结果", "grok2api-image.png");
    } catch (error) {
      props.showToast(formatError(error), "error");
    }
  };
  return (
    <div className="result-item">
      <a href={props.url} target="_blank" rel="noopener noreferrer">
        <img className="result-media" src={props.url} alt="生成结果" />
      </a>
      <div className="result-footer">
        <span className="result-caption">{props.label}</span>
        <span style={{ display: "flex", gap: 2 }}>
          <button
            className="tiny-button"
            type="button"
            title="保存"
            onClick={() => void save()}
          >
            <Download size={12} />
          </button>
          <button
            className="tiny-button"
            type="button"
            title="分享或复制链接"
            onClick={() => void share()}
          >
            <ExternalLink size={12} />
          </button>
        </span>
      </div>
    </div>
  );
}

function HistoryWorkspace(props: {
  sessions: ChatSession[];
  setSessions: Dispatch<SetStateAction<ChatSession[]>>;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  setWorkspace: Dispatch<SetStateAction<Workspace>>;
}) {
  return (
    <div className="history-page">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">本地会话</h2>
            <p className="panel-subtitle">当前连接空间下的最近 50 个会话。</p>
          </div>
          <span className="faint" style={{ fontSize: 11 }}>
            {props.sessions.length} / 50
          </span>
        </div>
        {props.sessions.length ? (
          <div style={{ overflowX: "auto" }}>
            <table className="session-table">
              <thead>
                <tr>
                  <th>标题</th>
                  <th>模型</th>
                  <th>消息</th>
                  <th>最近更新</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {props.sessions.map((session) => (
                  <tr key={session.id}>
                    <td>{session.title || "新会话"}</td>
                    <td className="muted">{session.model || "手动模型"}</td>
                    <td>{session.messages.length}</td>
                    <td className="muted">{formatDate(session.updatedAt)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="tiny-button"
                        type="button"
                        onClick={() => {
                          props.setActiveSessionId(session.id);
                          props.setWorkspace("chat");
                        }}
                      >
                        <ChevronRight size={12} />
                        打开
                      </button>
                      <button
                        className="tiny-button"
                        type="button"
                        onClick={() =>
                          props.setSessions((current) =>
                            current.filter((item) => item.id !== session.id),
                          )
                        }
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state" style={{ minHeight: 240 }}>
            暂无会话。
          </div>
        )}
      </section>
    </div>
  );
}

function SettingsWorkspace(props: {
  profiles: ConnectionProfile[];
  activeProfile: ConnectionProfile;
  onSwitch: (profile: ConnectionProfile) => Promise<void>;
  onDelete: (removeHistory: boolean) => Promise<void>;
  onAdd: () => void;
  models: Model[];
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removeHistory, setRemoveHistory] = useState(true);
  return (
    <div className="settings-grid">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">连接配置</h2>
            <p className="panel-subtitle">
              Key 只用于当前网关请求；切换 profile 会隔离模型、会话和任务。
            </p>
          </div>
          <KeyRound size={17} className="muted" />
        </div>
        <div className="panel-body">
          <div className="profile-list">
            {props.profiles.map((profile) => (
              <div
                className={`profile-row${profile.id === props.activeProfile.id ? "" : ""}`}
                key={profile.id}
              >
                <div className="profile-info">
                  <div className="profile-name">
                    {profile.displayName ?? "未命名连接"}{" "}
                    {profile.id === props.activeProfile.id ? (
                      <span
                        className="success-text"
                        style={{ fontSize: 10, marginLeft: 6 }}
                      >
                        当前
                      </span>
                    ) : null}
                  </div>
                  <div className="profile-url">{profile.baseUrl}</div>
                </div>
                <div className="profile-actions">
                  {profile.id !== props.activeProfile.id ? (
                    <button
                      className="button small"
                      type="button"
                      onClick={() => void props.onSwitch(profile)}
                    >
                      切换
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <div className="form-footer" style={{ marginTop: 14 }}>
            <button className="button" type="button" onClick={props.onAdd}>
              <Plus size={14} />
              添加连接
            </button>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">当前服务</h2>
            <p className="panel-subtitle">模型目录来自公共 GET /v1/models。</p>
          </div>
          <Activity size={17} className="muted" />
        </div>
        <div className="panel-body">
          <div className="status-line success">
            <span className="connection-dot" />
            已连接 · {props.models.length} 个模型
          </div>
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 13 }}
          >
            {props.models.slice(0, 24).map((model) => (
              <span
                key={model.id}
                style={{
                  padding: "5px 8px",
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  color: "var(--muted)",
                  fontSize: 10,
                }}
              >
                {model.id}
              </span>
            ))}
          </div>
          {props.models.length === 0 ? (
            <div className="field-hint" style={{ marginTop: 12 }}>
              当前 Key 没有模型白名单，仍可在各工作区手动输入模型 ID。
            </div>
          ) : null}
        </div>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">数据与安全</h2>
            <p className="panel-subtitle">
              清除连接时可同时删除该 profile 的会话和视频任务。
            </p>
          </div>
          <ShieldCheck size={17} className="muted" />
        </div>
        <div className="panel-body">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={removeHistory}
              onChange={(event) => setRemoveHistory(event.target.checked)}
            />
            删除连接时同时删除本地历史与媒体索引
          </label>
          {confirmDelete ? (
            <div
              style={{
                marginTop: 14,
                padding: 12,
                border: "1px solid rgba(255,141,141,.3)",
                borderRadius: 8,
                background: "rgba(255,141,141,.05)",
              }}
            >
              <div className="error-text" style={{ fontSize: 12 }}>
                确认删除「
                {props.activeProfile.displayName ?? props.activeProfile.baseUrl}
                」？此操作不可撤销。
              </div>
              <div className="form-footer">
                <button
                  className="button small"
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                >
                  取消
                </button>
                <button
                  className="button small danger"
                  type="button"
                  onClick={() => void props.onDelete(removeHistory)}
                >
                  确认删除
                </button>
              </div>
            </div>
          ) : (
            <div className="form-footer" style={{ marginTop: 14 }}>
              <button
                className="button danger"
                type="button"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={14} />
                删除当前连接
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function modelsForCapability(
  models: Model[],
  capability: "chat" | "image" | "video" | "tts" | "stt",
): Model[] {
  return models.filter((model) =>
    getModelCapabilities(model).capabilities.includes(capability),
  );
}

function dedupeModels(models: Model[]): Model[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    const id = model.id.trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function loadVideoJobs(scope: string): VideoJob[] {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(`grok2api:video-jobs:${scope}`) ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed
          .filter(isVideoJob)
          .map((job) =>
            job.videoUrl?.startsWith("blob:")
              ? { ...job, videoUrl: undefined, protectedContent: true }
              : job,
          )
      : [];
  } catch {
    return [];
  }
}

function isVideoJob(value: unknown): value is VideoJob {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.requestId === "string" &&
    typeof item.model === "string" &&
    typeof item.prompt === "string" &&
    typeof item.createdAt === "number" &&
    (item.status === "pending" ||
      item.status === "done" ||
      item.status === "failed") &&
    typeof item.progress === "number"
  );
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function formatError(error: unknown): string {
  if (error instanceof GrokApiError) {
    if (error.status === 401 || error.status === 403)
      return "Key 无效或没有该模型的权限，请检查客户端 API Key。";
    if (error.status === 404) return "当前 grok2api 版本不支持此能力（404）。";
    if (error.status === 429)
      return `请求过于频繁${error.retryAfterMs ? `，请 ${Math.ceil(error.retryAfterMs / 1000)} 秒后重试` : "，请稍后重试"}。`;
    if (error.status === 503)
      return "服务尚未就绪或上游暂时不可用，请稍后重试。";
    if (error.status === 408 || error.isNetworkError)
      return "网络或 TLS 连接超时，请检查地址后重试。";
    return error.message || `请求失败（${error.status}）。`;
  }
  return error instanceof Error ? error.message : "请求失败，请稍后重试。";
}

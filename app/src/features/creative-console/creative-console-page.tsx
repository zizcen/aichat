import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUp, AudioLines, BrainCircuit, Check, CheckCircle2, Clock3, ExternalLink, Globe, History, ImageIcon, ImagePlus, ImageUpscale, Images, Loader2, Menu, MessageSquareText, Mic, Pencil, RefreshCw, Sparkle, Square, SquarePen, Trash2, TriangleAlert, TvMinimal, Upload, Video, Wrench, X } from "lucide-react";
import { marked } from "marked";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport } from "@/components/ui/message-scroller";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ModelRouteDTO } from "@/entities/model/types";
import {
  createChatResponse,
  createVideo,
  editImage,
  editVideo,
  extendVideo,
  generateImage,
  getVideo,
  listVoices,
  synthesizeSpeech,
  transcribeSpeech,
  type ChatMessage,
  type ChatStreamSnapshot,
  type ChatToolActivity,
  type ImageResult,
  type ReasoningEffort,
  type STTResult,
  type TTSResult,
  type VideoStatus,
  type VoiceInfo,
} from "@/features/creative-console/creative-console-api";
import { PageHeader } from "@/shared/components/page-header";
import { cn } from "@/shared/lib/cn";
import type { Grok2ApiClient } from "@/shared/api/client";
import type { Model } from "@/shared/api/types";
import type { ConnectionProfile } from "@/shared/storage/profile-store";
import { uploadMediaInput } from "@/features/media/media-api";
import { modelsToRoutes, setCreativeConsoleRuntime } from "./creative-console-runtime";

type CreativeMode = "chat" | "image" | "video" | "voice";
type ConversationMessage = ChatMessage & {
  id: string;
  reasoning?: string;
  tools?: ChatToolActivity[];
};

type ChatRequest = {
  messages: ChatMessage[];
  promptCacheKey: string;
  reasoningEffort: ReasoningEffort;
  webSearch: boolean;
  xSearch: boolean;
  assistantMessageId: string;
  apiKey: string;
  model: string;
  requestSeq: number;
};

type PendingTruncateAction =
  | { kind: "delete"; messageId: string; trailingCount: number }
  | { kind: "regenerate"; messageId: string; trailingCount: number }
  | { kind: "edit-user"; messageId: string; content: string; trailingCount: number };

type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  promptCacheKey: string;
  reasoningEffort: ReasoningEffort;
  webSearch: boolean;
  xSearch: boolean;
  messages: ConversationMessage[];
};

const imageAspectRatios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;
const videoAspectRatios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;
const imageResolutions = ["1k", "2k"] as const;
const videoResolutions = ["480p", "720p", "1080p"] as const;
const videoDurations = ["6", "10", "15"] as const;
const videoExtendDurations = ["2", "4", "6", "8", "10"] as const;
type VideoAction = "generate" | "edit" | "extend";
const chatHistoryStoragePrefix = "grok2api:creative-console:chat-history:";
const chatHistoryMaxSessions = 50;
const chatHistoryMaxBytes = 4 * 1024 * 1024;
const composerClassName = "overflow-hidden rounded-2xl bg-secondary/45 ring-1 ring-transparent transition-colors focus-within:bg-secondary/60 focus-within:ring-ring";

export type CreativeConsolePageProps = {
  client: Grok2ApiClient;
  apiKey: string;
  models: Model[];
  scope: string;
  profiles: ConnectionProfile[];
  activeProfileId: string;
  providerName?: string;
  previewMode?: boolean;
  initialMode?: CreativeMode;
  onModeChange?: (mode: CreativeMode) => void;
  onSwitchProvider?: (profile: ConnectionProfile) => Promise<void>;
  onOpenMenu?: () => void;
};

export function CreativeConsolePage(props: CreativeConsolePageProps) {
  const { t } = useTranslation();
  useKeyboardInset();
  const [mode, setMode] = useState<CreativeMode>(props.initialMode ?? "chat");
  const [selectedModels, setSelectedModels] = useState<Record<CreativeMode, string>>({ chat: "", image: "", video: "", voice: "" });
  const [chatToolbarElement, setChatToolbarElement] = useState<HTMLDivElement | null>(null);
  const [switchingProvider, setSwitchingProvider] = useState(false);
  const modelRoutes = useMemo(() => modelsToRoutes(props.models), [props.models]);
  const modelGroups = useMemo(() => ({
    chat: uniqueModelsByPublicID(modelRoutes.filter((model) => model.capability === "chat" || model.capability === "responses")),
    // Keep both image and image_edit routes. ImagePanel selects the matching
    // capability for the current segmented mode instead of discarding the
    // second route while deduplicating public IDs.
    image: modelRoutes.filter((model) => model.capability === "image" || model.capability === "image_edit"),
    // Keep every route target for VideoPanel. It presents one row per public ID,
    // but edit/extend eligibility depends on whether any aggregated target is
    // Console/grok-imagine-video, not on the public name chosen by the operator.
    video: modelRoutes.filter((model) => model.capability === "video"),
    // Keep capability-specific routes for VoicePanel so TTS/STT can filter correctly.
    voice: modelRoutes.filter((model) => model.capability === "tts" || model.capability === "stt" || model.capability === "realtime"),
  }), [modelRoutes]);
  const voiceModelChoices = useMemo(() => uniqueModelsByPublicID(modelGroups.voice), [modelGroups.voice]);
  const effectiveModels = useMemo<Record<CreativeMode, string>>(() => ({
    chat: modelGroups.chat.some((model) => model.publicId === selectedModels.chat) ? selectedModels.chat : modelGroups.chat[0]?.publicId ?? "",
    image: modelGroups.image.some((model) => model.publicId === selectedModels.image) ? selectedModels.image : modelGroups.image[0]?.publicId ?? "",
    video: modelGroups.video.some((model) => model.publicId === selectedModels.video) ? selectedModels.video : modelGroups.video[0]?.publicId ?? "",
    voice: voiceModelChoices.some((model) => model.publicId === selectedModels.voice) ? selectedModels.voice : voiceModelChoices[0]?.publicId ?? "",
  }), [modelGroups, selectedModels, voiceModelChoices]);

  useEffect(() => {
    setCreativeConsoleRuntime({ client: props.client, apiKey: props.apiKey, scope: props.scope, previewMode: props.previewMode });
    return () => setCreativeConsoleRuntime(null);
  }, [props.apiKey, props.client, props.previewMode, props.scope]);

  useEffect(() => {
    if (props.initialMode && props.initialMode !== mode) setMode(props.initialMode);
  }, [mode, props.initialMode]);

  function panelProps(panelMode: CreativeMode): CreativePanelProps {
    return {
      apiKey: props.apiKey,
      model: effectiveModels[panelMode],
      modelOptions: modelGroups[panelMode],
      onModelChange: (model) => setSelectedModels((current) => ({ ...current, [panelMode]: model })),
    };
  }

  function changeMode(nextMode: CreativeMode): void {
    setMode(nextMode);
    props.onModeChange?.(nextMode);
  }

  async function changeProvider(id: string): Promise<void> {
    if (id === props.activeProfileId || switchingProvider) return;
    const profile = props.profiles.find((item) => item.id === id);
    if (!profile || !props.onSwitchProvider) return;
    setSwitchingProvider(true);
    try {
      await props.onSwitchProvider(profile);
    } finally {
      setSwitchingProvider(false);
    }
  }

  return (
    <div className="creative-console-page flex h-full min-h-0 flex-col gap-5 overflow-hidden">
      <div className="creative-page-heading flex items-start gap-2">
        {props.onOpenMenu ? (
          <Button type="button" variant="ghost" size="icon" className="mt-0.5 size-9 shrink-0 text-muted-foreground" onClick={props.onOpenMenu} aria-label="打开设置">
            <Menu />
          </Button>
        ) : null}
        <div className="min-w-0 flex-1">
          <PageHeader title={t("creativeConsole.title")} description={t("creativeConsole.description")} />
        </div>
      </div>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-9 shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={mode} onValueChange={(value) => changeMode(value as CreativeMode)}>
            <TabsList className="h-9 w-full rounded-full bg-secondary/50 p-1 lg:w-auto">
              <TabsTrigger className="flex-1 gap-1.5 rounded-full px-3 lg:min-w-20 [&_svg]:size-3.5" value="chat"><MessageSquareText />{t("creativeConsole.modes.chat")}</TabsTrigger>
              <TabsTrigger className="flex-1 gap-1.5 rounded-full px-3 lg:min-w-20 [&_svg]:size-3.5" value="image"><ImageIcon />{t("creativeConsole.modes.image")}</TabsTrigger>
              <TabsTrigger className="flex-1 gap-1.5 rounded-full px-3 lg:min-w-20 [&_svg]:size-3.5" value="video"><Video />{t("creativeConsole.modes.video")}</TabsTrigger>
              <TabsTrigger className="flex-1 gap-1.5 rounded-full px-3 lg:min-w-20 [&_svg]:size-3.5" value="voice"><AudioLines />{t("creativeConsole.modes.voice")}</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex min-w-0 items-center gap-2">
            <Select value={props.activeProfileId} onValueChange={(id) => void changeProvider(id)} disabled={switchingProvider || props.profiles.length < 2}>
              <SelectTrigger className="h-9 min-w-0 max-w-72 rounded-lg bg-secondary/55 px-3 text-xs lg:w-64" aria-label="提供商">
                <SelectValue placeholder={props.previewMode ? "预览模式" : (props.providerName ?? "选择提供商")} />
              </SelectTrigger>
              <SelectContent>
                {props.profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {providerOptionLabel(profile)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div ref={setChatToolbarElement} className={cn("items-center gap-1", mode === "chat" ? "flex" : "hidden")} />
          </div>
        </div>

        <div className="shrink-0 space-y-2 px-3">
          {modelRoutes.length === 0 ? <InlineError message={t("creativeConsole.noModels")} /> : null}
        </div>

        <div className="min-h-0 flex-1">
          <div className="h-full" hidden={mode !== "chat"}><ChatPanel key={props.scope} storageScope={props.scope} toolbarElement={chatToolbarElement} {...panelProps("chat")} /></div>
          <div className="h-full" hidden={mode !== "image"}><ImagePanel {...panelProps("image")} /></div>
          <div className="h-full" hidden={mode !== "video"}><VideoPanel {...panelProps("video")} /></div>
          <div className="h-full" hidden={mode !== "voice"}><VoicePanel {...panelProps("voice")} /></div>
        </div>
      </section>
    </div>
  );
}

type CreativePanelProps = {
  apiKey: string;
  model: string;
  modelOptions: ModelRouteDTO[];
  onModelChange: (model: string) => void;
};

function ChatPanel({ apiKey, model, modelOptions, onModelChange, storageScope, toolbarElement }: CreativePanelProps & { storageScope: string; toolbarElement: HTMLDivElement | null }) {
  const { t, i18n } = useTranslation();
  const [initialHistory] = useState(() => {
    const sessions = loadChatSessions(storageScope);
    return { sessions, active: sessions[0] ?? createBlankChatSession(model) };
  });
  const [sessions, setSessions] = useState<ChatSession[]>(initialHistory.sessions);
  const [sessionId, setSessionId] = useState(initialHistory.active.id);
  const [sessionCreatedAt, setSessionCreatedAt] = useState(initialHistory.active.createdAt);
  const [webSearch, setWebSearch] = useState(initialHistory.active.webSearch);
  const [xSearch, setXSearch] = useState(initialHistory.active.xSearch);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(initialHistory.active.reasoningEffort);
  const [promptCacheKey, setPromptCacheKey] = useState(initialHistory.active.promptCacheKey);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>(initialHistory.active.messages);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [pendingTruncate, setPendingTruncate] = useState<PendingTruncateAction | null>(null);
  const streamSnapshotRef = useRef<ChatStreamSnapshot>({ text: "", reasoning: "", tools: [] });
  const streamFrameRef = useRef<number | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  // requestSeq starts at 1 and increases; 0 means no active request owns the stream callbacks.
  const requestSeqRef = useRef(0);
  const activeRequestSeqRef = useRef(0);
  const restoredInitialModelRef = useRef(false);
  const selectedModelRoute = useMemo(() => modelOptions.find((option) => option.publicId === model), [model, modelOptions]);
  const fixedReasoningModel = isFixedReasoningConsoleModel(selectedModelRoute);
  const effectiveReasoningEffort: ReasoningEffort = fixedReasoningModel ? "auto" : reasoningEffort;
  const reasoningEffortOptions: ReasoningEffort[] = fixedReasoningModel ? ["auto"] : ["auto", "none", "low", "medium", "high", "xhigh"];

  useEffect(() => {
    if (restoredInitialModelRef.current || modelOptions.length === 0) return;
    restoredInitialModelRef.current = true;
    if (initialHistory.active.model && modelOptions.some((option) => option.publicId === initialHistory.active.model)) {
      onModelChange(initialHistory.active.model);
    }
  }, [initialHistory.active.model, modelOptions, onModelChange]);

  useEffect(() => {
    if (messages.length === 0) return;
    const timer = window.setTimeout(() => {
      const session: ChatSession = {
        id: sessionId,
        title: createChatSessionTitle(messages),
        createdAt: sessionCreatedAt,
        updatedAt: currentTimestamp(),
        model,
        promptCacheKey,
        reasoningEffort: effectiveReasoningEffort,
        webSearch,
        xSearch,
        messages,
      };
      setSessions((current) => {
        const next = upsertChatSession(current, session);
        return persistChatSessions(storageScope, next);
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [effectiveReasoningEffort, messages, model, promptCacheKey, sessionCreatedAt, sessionId, storageScope, webSearch, xSearch]);

  useEffect(() => () => {
    cancelActiveRequest();
  }, []);

  function isActiveRequest(requestSeq: number): boolean {
    return activeRequestSeqRef.current === requestSeq;
  }

  function cancelActiveRequest(): void {
    if (streamFrameRef.current !== null) {
      cancelAnimationFrame(streamFrameRef.current);
      streamFrameRef.current = null;
    }
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    // 0 = no active request owns stream callbacks.
    activeRequestSeqRef.current = 0;
    streamSnapshotRef.current = { text: "", reasoning: "", tools: [] };
  }

  function invalidatePromptCache(): string {
    const next = createCreativeCacheKey();
    setPromptCacheKey(next);
    return next;
  }

  function toRequestMessages(items: ConversationMessage[]): ChatMessage[] {
    return items
      .filter((message) => message.role === "user" || message.role === "assistant")
      .filter((message) => message.content.trim())
      .map(({ role, content }) => ({ role, content }));
  }

  function clearEditState(): void {
    setEditingMessageId(null);
    setEditDraft("");
  }

  function clearEditStateIfAtOrAfter(index: number): void {
    if (!editingMessageId) return;
    const editIndex = messages.findIndex((message) => message.id === editingMessageId);
    if (editIndex < 0 || editIndex >= index) clearEditState();
  }

  function renderStreamSnapshot(messageId: string, requestSeq: number): void {
    if (streamFrameRef.current !== null) return;
    streamFrameRef.current = requestAnimationFrame(() => {
      streamFrameRef.current = null;
      if (!isActiveRequest(requestSeq)) return;
      const snapshot = streamSnapshotRef.current;
      setMessages((current) => current.map((message) => message.id === messageId
        ? { ...message, content: snapshot.text, reasoning: snapshot.reasoning, tools: snapshot.tools }
        : message));
    });
  }

  const mutation = useMutation({
    mutationFn: (request: ChatRequest) => {
      streamSnapshotRef.current = { text: "", reasoning: "", tools: [] };
      const controller = new AbortController();
      requestControllerRef.current = controller;
      activeRequestSeqRef.current = request.requestSeq;
      return createChatResponse({
        apiKey: request.apiKey,
        model: request.model,
        messages: request.messages,
        promptCacheKey: request.promptCacheKey || undefined,
        reasoningEffort: request.reasoningEffort,
        webSearch: request.webSearch,
        xSearch: request.xSearch,
        signal: controller.signal,
        onUpdate: (snapshot) => {
          if (!isActiveRequest(request.requestSeq)) return;
          streamSnapshotRef.current = snapshot;
          renderStreamSnapshot(request.assistantMessageId, request.requestSeq);
        },
      });
    },
    onSuccess: (result, request) => {
      if (!isActiveRequest(request.requestSeq)) return;
      if (streamFrameRef.current !== null) cancelAnimationFrame(streamFrameRef.current);
      streamFrameRef.current = null;
      setMessages((current) => current.map((message) => message.id === request.assistantMessageId
        ? { ...message, content: result.text, reasoning: result.reasoning, tools: result.tools }
        : message));
      requestControllerRef.current = null;
      activeRequestSeqRef.current = 0;
    },
    onError: (error, request) => {
      if (!isActiveRequest(request.requestSeq)) return;
      if (streamFrameRef.current !== null) cancelAnimationFrame(streamFrameRef.current);
      streamFrameRef.current = null;
      const snapshot = streamSnapshotRef.current;
      const aborted = isAbortError(error);
      setMessages((current) => current.flatMap((message) => {
        if (message.id !== request.assistantMessageId) return [message];
        // Drop empty/aborted assistant placeholders; keep partial text from real failures.
        if (aborted || (!snapshot.text.trim() && !snapshot.reasoning.trim() && snapshot.tools.length === 0)) return [];
        return [{ ...message, content: snapshot.text, reasoning: snapshot.reasoning, tools: snapshot.tools }];
      }));
      requestControllerRef.current = null;
      activeRequestSeqRef.current = 0;
    },
  });

  function beginAssistantRequest(params: {
    history: ConversationMessage[];
    assistantMessage: ConversationMessage;
    cacheKey: string;
    cancelPrevious?: boolean;
  }): void {
    if (!apiKey || !model) return;
    if (params.cancelPrevious) cancelActiveRequest();
    const requestSeq = ++requestSeqRef.current;
    const requestMessages = toRequestMessages(params.history);
    mutation.reset();
    mutation.mutate({
      messages: requestMessages,
      promptCacheKey: params.cacheKey,
      reasoningEffort: effectiveReasoningEffort,
      webSearch,
      xSearch,
      assistantMessageId: params.assistantMessage.id,
      apiKey,
      model,
      requestSeq,
    });
  }

  function stopGenerating(): void {
    if (!mutation.isPending) return;
    const assistantMessageId = mutation.variables?.assistantMessageId;
    const snapshot = streamSnapshotRef.current;
    cancelActiveRequest();
    if (assistantMessageId) {
      setMessages((current) => current.flatMap((message) => {
        if (message.id !== assistantMessageId) return [message];
        const updated = hasChatStreamContent(snapshot)
          ? { ...message, content: snapshot.text, reasoning: snapshot.reasoning, tools: snapshot.tools }
          : message;
        if (!updated.content.trim() && !updated.reasoning?.trim() && !(updated.tools?.length)) return [];
        return [updated];
      }));
    }
    mutation.reset();
  }

  function submit(event?: FormEvent): void {
    event?.preventDefault();
    const userText = prompt.trim();
    if (!apiKey || !model || !userText || mutation.isPending) return;
    const userMessage: ConversationMessage = { id: createCreativeMessageId(), role: "user", content: userText };
    const assistantMessage: ConversationMessage = { id: createCreativeMessageId(), role: "assistant", content: "", reasoning: "", tools: [] };
    const history = [...messages, userMessage];
    setMessages([...history, assistantMessage]);
    setPrompt("");
    clearEditState();
    beginAssistantRequest({ history, assistantMessage, cacheKey: promptCacheKey });
  }

  function applyRegenerateAssistant(messageId: string): void {
    if (!apiKey || !model) return;
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0 || messages[index]?.role !== "assistant") return;
    const history = messages.slice(0, index);
    if (!history.some((message) => message.role === "user" && message.content.trim())) return;
    // Allow interrupt-regenerate: cancel the in-flight stream first, then start a new one.
    const cacheKey = invalidatePromptCache();
    const assistantMessage: ConversationMessage = { id: messageId, role: "assistant", content: "", reasoning: "", tools: [] };
    setMessages([...history, assistantMessage]);
    clearEditState();
    beginAssistantRequest({ history, assistantMessage, cacheKey, cancelPrevious: true });
  }

  function regenerateAssistant(messageId: string): void {
    if (!apiKey || !model) return;
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0 || messages[index]?.role !== "assistant") return;
    const trailingCount = messages.length - index - 1;
    if (trailingCount > 0) {
      setPendingTruncate({ kind: "regenerate", messageId, trailingCount });
      return;
    }
    applyRegenerateAssistant(messageId);
  }

  function startEditMessage(messageId: string): void {
    if (mutation.isPending) return;
    const target = messages.find((message) => message.id === messageId);
    if (!target) return;
    setEditingMessageId(messageId);
    setEditDraft(target.content);
  }

  function cancelEditMessage(): void {
    clearEditState();
  }

  function applyUserEditAndRegenerate(messageId: string, nextContent: string): void {
    if (!apiKey || !model) return;
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const target = messages[index];
    if (!target || target.role !== "user") return;
    const cacheKey = invalidatePromptCache();
    const historyPrefix = messages.slice(0, index);
    const userMessage: ConversationMessage = { ...target, content: nextContent };
    const assistantMessage: ConversationMessage = { id: createCreativeMessageId(), role: "assistant", content: "", reasoning: "", tools: [] };
    const history = [...historyPrefix, userMessage];
    setMessages([...history, assistantMessage]);
    clearEditState();
    beginAssistantRequest({ history, assistantMessage, cacheKey, cancelPrevious: true });
  }

  function applyDeleteMessage(messageId: string): void {
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    cancelActiveRequest();
    invalidatePromptCache();
    // Drop the selected message and every turn after it so the transcript stays a single continuous branch.
    const nextMessages = messages.slice(0, index);
    setMessages(nextMessages);
    if (nextMessages.length === 0) {
      setSessions((current) => {
        const next = current.filter((session) => session.id !== sessionId);
        return persistChatSessions(storageScope, next);
      });
    }
    clearEditStateIfAtOrAfter(index);
    mutation.reset();
  }

  function saveEditMessage(messageId: string): void {
    if (mutation.isPending) return;
    const nextContent = editDraft.trim();
    if (!nextContent) return;
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const target = messages[index];
    if (!target) return;

    if (target.role === "assistant") {
      // Local-only edit for assistant replies; keep subsequent turns intact.
      // Clear reasoning/tools so they cannot contradict the edited body.
      if (index < messages.length - 1) invalidatePromptCache();
      setMessages((current) => current.map((message) => message.id === messageId
        ? { ...message, content: nextContent, reasoning: undefined, tools: undefined }
        : message));
      clearEditState();
      return;
    }

    // Editing a user message truncates the branch and re-requests a new reply.
    if (!apiKey || !model) return;
    const trailingCount = messages.length - index - 1;
    if (trailingCount > 0) {
      setPendingTruncate({ kind: "edit-user", messageId, content: nextContent, trailingCount });
      return;
    }
    applyUserEditAndRegenerate(messageId, nextContent);
  }

  function deleteMessage(messageId: string): void {
    if (mutation.isPending) return;
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const trailingCount = messages.length - index - 1;
    if (trailingCount > 0) {
      setPendingTruncate({ kind: "delete", messageId, trailingCount });
      return;
    }
    applyDeleteMessage(messageId);
  }

  function confirmPendingTruncate(): void {
    if (!pendingTruncate) return;
    const action = pendingTruncate;
    setPendingTruncate(null);
    if (action.kind === "delete") {
      applyDeleteMessage(action.messageId);
      return;
    }
    if (action.kind === "regenerate") {
      applyRegenerateAssistant(action.messageId);
      return;
    }
    applyUserEditAndRegenerate(action.messageId, action.content);
  }

  function clearConversation(): void {
    cancelActiveRequest();
    setSessions((current) => {
      const next = current.filter((session) => session.id !== sessionId);
      return persistChatSessions(storageScope, next);
    });
    const blank = createBlankChatSession(model);
    setSessionId(blank.id);
    setSessionCreatedAt(blank.createdAt);
    setMessages([]);
    setPromptCacheKey(blank.promptCacheKey);
    setPrompt("");
    clearEditState();
    setPendingTruncate(null);
    mutation.reset();
  }

  function startNewConversation(): void {
    if (mutation.isPending) return;
    setSessions((current) => {
      const next = messages.length > 0 ? upsertChatSession(current, {
        id: sessionId,
        title: createChatSessionTitle(messages),
        createdAt: sessionCreatedAt,
        updatedAt: currentTimestamp(),
        model,
        promptCacheKey,
        reasoningEffort: effectiveReasoningEffort,
        webSearch,
        xSearch,
        messages,
      }) : current;
      return persistChatSessions(storageScope, next);
    });
    const blank = createBlankChatSession(model);
    setSessionId(blank.id);
    setSessionCreatedAt(blank.createdAt);
    setMessages([]);
    setPromptCacheKey(blank.promptCacheKey);
    setReasoningEffort(blank.reasoningEffort);
    setWebSearch(blank.webSearch);
    setXSearch(blank.xSearch);
    setPrompt("");
    clearEditState();
    setPendingTruncate(null);
    mutation.reset();
  }

  function switchConversation(targetId: string): void {
    if (mutation.isPending || targetId === sessionId) return;
    let availableSessions = sessions;
    if (messages.length > 0) {
      availableSessions = upsertChatSession(sessions, {
        id: sessionId,
        title: createChatSessionTitle(messages),
        createdAt: sessionCreatedAt,
        updatedAt: currentTimestamp(),
        model,
        promptCacheKey,
        reasoningEffort: effectiveReasoningEffort,
        webSearch,
        xSearch,
        messages,
      });
    }
    const target = availableSessions.find((session) => session.id === targetId);
    if (!target) return;
    availableSessions = persistChatSessions(storageScope, availableSessions);
    setSessions(availableSessions);
    setSessionId(target.id);
    setSessionCreatedAt(target.createdAt);
    setMessages(target.messages);
    setPromptCacheKey(target.promptCacheKey || createCreativeCacheKey());
    setReasoningEffort(target.reasoningEffort);
    setWebSearch(target.webSearch);
    setXSearch(target.xSearch);
    setPrompt("");
    clearEditState();
    setPendingTruncate(null);
    mutation.reset();
    if (target.model && modelOptions.some((option) => option.publicId === target.model)) onModelChange(target.model);
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, messageId: string): void {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditMessage();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      saveEditMessage(messageId);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {toolbarElement ? createPortal(<>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="rounded-full" aria-label={t("creativeConsole.newConversation")} onClick={startNewConversation} disabled={mutation.isPending}>
              <SquarePen />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("creativeConsole.newConversation")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="rounded-full" aria-label={t("creativeConsole.clearCurrent")} onClick={clearConversation} disabled={messages.length === 0 || mutation.isPending}>
              <Trash2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("creativeConsole.clearCurrent")}</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="rounded-full" aria-label={t("creativeConsole.history")} disabled={mutation.isPending}>
              <History />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>{t("creativeConsole.history")}</DropdownMenuLabel>
            {sessions.length === 0 ? (
              <div className="px-2 py-5 text-center text-xs text-muted-foreground">{t("creativeConsole.noHistory")}</div>
            ) : sessions.map((session) => (
              <DropdownMenuItem key={session.id} className="min-h-12 gap-2" onSelect={() => switchConversation(session.id)}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs">{session.title}</div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{session.model || t("creativeConsole.model")} · {formatChatSessionTime(session.updatedAt, i18n.language)}</div>
                </div>
                {session.id === sessionId ? <Check className="text-muted-foreground" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </>, toolbarElement) : null}
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport aria-label={t("creativeConsole.messageList")}>
            <MessageScrollerContent className={cn("w-full px-3 py-6 sm:px-6", messages.length === 0 && !mutation.isPending && "justify-center")}>
              {messages.length === 0 && !mutation.isPending ? <WelcomeState title={t("creativeConsole.welcome")} /> : null}
              {messages.map((message) => (
                <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={message.role === "user"}>
                  <ChatMessageItem
                    message={message}
                    loading={mutation.isPending && mutation.variables?.assistantMessageId === message.id}
                    busy={mutation.isPending}
                    editing={editingMessageId === message.id}
                    editDraft={editingMessageId === message.id ? editDraft : ""}
                    onEditDraftChange={setEditDraft}
                    onStartEdit={() => startEditMessage(message.id)}
                    onCancelEdit={cancelEditMessage}
                    onSaveEdit={() => saveEditMessage(message.id)}
                    onEditKeyDown={(event) => handleEditKeyDown(event, message.id)}
                    onRegenerate={() => regenerateAssistant(message.id)}
                    onStop={stopGenerating}
                    onDelete={() => deleteMessage(message.id)}
                  />
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton aria-label={t("creativeConsole.scrollToLatest")} />
        </MessageScroller>
      </MessageScrollerProvider>

      <form className="w-full shrink-0 px-3 pb-2 sm:px-6 sm:pb-3" onSubmit={submit}>
        <div className={composerClassName}>
          <Textarea id="chat-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handlePromptKeyDown} placeholder={t("creativeConsole.chatPlaceholder")} className="min-h-24 resize-none border-0 bg-transparent px-4 py-3 text-sm focus-visible:ring-0" />
          <div className="flex items-center justify-between gap-3 px-3 pb-3">
            <div className="creative-horizontal-controls flex min-w-0 items-center gap-0.5 overflow-x-auto">
              <CompactModelSelect value={model} models={modelOptions} onChange={onModelChange} />
              <CompactIconSelect
                value={webSearch ? "on" : "off"}
                options={[{ value: "off", label: t("creativeConsole.webSearchOff") }, { value: "on", label: t("creativeConsole.webSearchOn") }]}
                onChange={(value) => setWebSearch(value === "on")}
                ariaLabel={t("creativeConsole.webSearch")}
                icon={<Globe />}
                active={webSearch}
              />
              <CompactIconSelect
                value={xSearch ? "on" : "off"}
                options={[{ value: "off", label: t("creativeConsole.xSearchOff") }, { value: "on", label: t("creativeConsole.xSearchOn") }]}
                onChange={(value) => setXSearch(value === "on")}
                ariaLabel={t("creativeConsole.xSearch")}
                icon={<XSocialIcon />}
                active={xSearch}
              />
              <CompactIconSelect
                value={effectiveReasoningEffort}
                options={reasoningEffortOptions.map((effort) => ({ value: effort, label: t(`creativeConsole.reasoning.${effort}`) }))}
                onChange={(value) => setReasoningEffort(value as ReasoningEffort)}
                ariaLabel={t("creativeConsole.reasoningEffort")}
                icon={<Sparkle />}
                active={effectiveReasoningEffort !== "auto" && effectiveReasoningEffort !== "none"}
                disabled={fixedReasoningModel}
              />
            </div>
            {mutation.isPending ? (
              <Button type="button" size="icon" variant="secondary" aria-label={t("creativeConsole.stopGenerating")} onClick={stopGenerating}>
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button type="submit" size="icon" aria-label={t("creativeConsole.send")} disabled={!apiKey || !model || !prompt.trim()}>
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
        {mutation.isError ? <div className="mt-1 px-2 text-[11px] text-destructive">{mutation.error.message}</div> : null}
      </form>

      <AlertDialog open={pendingTruncate !== null} onOpenChange={(open) => { if (!open) setPendingTruncate(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingTruncate?.kind === "edit-user"
                ? t("creativeConsole.editUserTruncateTitle")
                : pendingTruncate?.kind === "regenerate"
                  ? t("creativeConsole.regenerateTruncateTitle")
                : t("creativeConsole.deleteMessageConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingTruncate
                ? t(
                  pendingTruncate.kind === "edit-user"
                    ? "creativeConsole.editUserTruncateDescription"
                    : pendingTruncate.kind === "regenerate"
                      ? "creativeConsole.regenerateTruncateDescription"
                    : "creativeConsole.deleteMessageConfirmDescription",
                  { count: pendingTruncate.trailingCount },
                )
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={pendingTruncate?.kind === "delete" ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
              onClick={(event) => {
                event.preventDefault();
                confirmPendingTruncate();
              }}
            >
              {pendingTruncate?.kind === "edit-user"
                ? t("creativeConsole.saveAndRegenerate")
                : pendingTruncate?.kind === "regenerate"
                  ? t("creativeConsole.regenerate")
                : t("creativeConsole.deleteMessage")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ImagePanel({ apiKey, model, modelOptions, onModelChange }: CreativePanelProps) {
  const { t } = useTranslation();
  const [action, setAction] = useState<"generate" | "edit">("generate");
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState("1");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [resolution, setResolution] = useState("1k");
  const [quality, setQuality] = useState<"low" | "medium">("medium");
  const [images, setImages] = useState<ImageResult[]>([]);
  const [sourceImage, setSourceImage] = useState<{ url: string; name: string } | null>(null);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const generationModels = useMemo(() => uniqueModelsByPublicID(modelOptions.filter((item) => item.capability === "image")), [modelOptions]);
  const editModels = useMemo(() => uniqueModelsByPublicID(modelOptions.filter((item) => item.capability === "image_edit")), [modelOptions]);
  const activeModels = action === "edit" ? editModels : generationModels;
  const activeModel = activeModels.some((item) => item.publicId === model) ? model : activeModels[0]?.publicId ?? "";
  const supportsQuality = activeModel.toLowerCase().includes("grok-imagine-image-2.0");

  useEffect(() => {
    if (activeModel !== model) onModelChange(activeModel);
  }, [activeModel, model, onModelChange]);

  const mutation = useMutation({
    mutationFn: async (request: { action: "generate" | "edit"; model: string; prompt: string; imageURL?: string; count: number; aspectRatio: string; resolution: string; quality?: "low" | "medium" }) => {
      if (request.action === "edit") {
        if (!request.imageURL) throw new Error(t("creativeConsole.errors.noEditImage"));
        return editImage({ apiKey, model: request.model, prompt: request.prompt, imageURL: request.imageURL, count: request.count, aspectRatio: request.aspectRatio, resolution: request.resolution, quality: request.quality });
      }
      return generateImage({ apiKey, model: request.model, prompt: request.prompt, count: request.count, aspectRatio: request.aspectRatio, resolution: request.resolution, quality: request.quality });
    },
    onSuccess: setImages,
  });

  function changeAction(nextAction: "generate" | "edit"): void {
    setAction(nextAction);
    setImages([]);
    setUploadError("");
    mutation.reset();
  }

  function chooseSourceImage(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadError(t("creativeConsole.errors.invalidImage"));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError(t("creativeConsole.errors.imageTooLarge"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setSourceImage({ url: reader.result, name: file.name });
      setUploadError("");
      setAction("edit");
      setImages([]);
      mutation.reset();
    };
    reader.onerror = () => setUploadError(t("creativeConsole.errors.invalidImage"));
    reader.readAsDataURL(file);
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!apiKey || !activeModel || !prompt.trim() || mutation.isPending) return;
    if (action === "edit" && !sourceImage) return;
    mutation.reset();
    mutation.mutate({ action, model: activeModel, prompt: prompt.trim(), imageURL: sourceImage?.url, count: Number(count), aspectRatio, resolution, quality: supportsQuality ? quality : undefined });
  }

  const canSubmit = Boolean(apiKey && activeModel && prompt.trim() && !mutation.isPending && (action === "generate" || sourceImage));
  const welcomeTitle = action === "edit" ? t("creativeConsole.welcomeImageEdit") : t("creativeConsole.welcomeImage");
  const placeholder = action === "edit" ? t("creativeConsole.imageEditPlaceholder") : t("creativeConsole.imagePlaceholder");

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto py-6">
        <div className="flex min-h-full w-full flex-col justify-center px-3 sm:px-6">
          {images.length === 0 && !mutation.isPending ? <WelcomeState title={welcomeTitle} /> : null}
          {mutation.isPending ? <LoadingResult text={action === "edit" ? t("creativeConsole.editingImage") : t("creativeConsole.generatingImage")} /> : null}
          {images.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-live="polite">
              {images.map((image, index) => (
                <figure key={`${image.url}-${index}`} className="group min-w-0 overflow-hidden">
                  <img src={image.url} alt={t("creativeConsole.generatedImageAlt", { index: index + 1 })} className="aspect-square w-full rounded-xl bg-muted object-contain" loading="lazy" />
                  <figcaption className="flex min-w-0 items-center justify-between gap-2 py-1.5">
                    <span className="truncate text-xs text-muted-foreground">{t("creativeConsole.imageNumber", { index: index + 1 })}</span>
                    <Button variant="ghost" size="icon" asChild><a href={image.url} target="_blank" rel="noreferrer" aria-label={t("creativeConsole.open")}><ExternalLink /></a></Button>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <form className="w-full shrink-0 px-3 pb-2 sm:px-6 sm:pb-3" onSubmit={submit}>
        <div className={cn(composerClassName, action === "edit" && "bg-[#080808] focus-within:bg-[#0d0d0d]")}>
          <ComposerActionButtons
            value={action}
            actions={[
              ["generate", t("creativeConsole.imageActions.generate")],
              ["edit", t("creativeConsole.imageActions.edit")],
            ]}
            onChange={(value) => changeAction(value as "generate" | "edit")}
          />
          <Textarea id="image-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={placeholder} className="min-h-24 resize-none border-0 bg-transparent px-4 py-3 text-sm focus-visible:ring-0" />
          <div className="flex items-center justify-between gap-3 px-3 pb-3">
            <div className="creative-horizontal-controls flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              <CompactModelSelect value={activeModel} models={activeModels} onChange={onModelChange} />
              {action === "edit" ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className={cn("h-8 gap-1.5 px-2 font-normal", sourceImage && "bg-secondary/70 text-foreground")} aria-label={t("creativeConsole.sourceImage")}>
                      <ImagePlus />{sourceImage ? t("creativeConsole.sourceImageAdded") : t("creativeConsole.sourceImageShort")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 p-3">
                    <div className="mb-2 text-xs font-medium">{t("creativeConsole.sourceImage")}</div>
                    {sourceImage ? (
                      <div className="mb-2 flex items-center gap-2 rounded-lg bg-secondary/45 p-2 text-xs text-muted-foreground">
                        <img src={sourceImage.url} alt={sourceImage.name} className="size-12 rounded object-cover" />
                        <span className="min-w-0 flex-1 truncate">{sourceImage.name}</span>
                        <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => setSourceImage(null)} aria-label={t("creativeConsole.clearSourceImage")}><X /></Button>
                      </div>
                    ) : null}
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={chooseSourceImage} />
                    <Button type="button" variant="secondary" size="sm" className="w-full" onClick={() => fileInputRef.current?.click()}>
                      <Upload />{t("creativeConsole.uploadImage")}
                    </Button>
                    {uploadError ? <p className="mt-1 text-[11px] text-destructive">{uploadError}</p> : null}
                  </PopoverContent>
                </Popover>
              ) : null}
              <CompactSelect value={count} options={["1", "2", "3", "4"]} onChange={setCount} ariaLabel={t("creativeConsole.count")} suffix="×" icon={<Images />} />
              <CompactSelect value={aspectRatio} options={imageAspectRatios} onChange={setAspectRatio} ariaLabel={t("creativeConsole.aspectRatio")} icon={<TvMinimal />} />
              <CompactSelect value={resolution} options={imageResolutions} onChange={setResolution} ariaLabel={t("creativeConsole.resolution")} icon={<ImageUpscale />} />
              {supportsQuality ? <CompactSelect value={quality} options={["low", "medium"]} onChange={(value) => setQuality(value as "low" | "medium")} ariaLabel={t("creativeConsole.quality")} /> : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button type="submit" size="icon" aria-label={action === "edit" ? t("creativeConsole.editImage") : t("creativeConsole.generateImage")} disabled={!canSubmit}>{mutation.isPending ? <Loader2 className="animate-spin" /> : <ArrowUp />}</Button>
            </div>
          </div>
        </div>
        {uploadError ? <div className="mt-1 px-2 text-[11px] text-destructive">{uploadError}</div> : null}
        {mutation.isError ? <div className="mt-1 px-2 text-[11px] text-destructive">{mutation.error.message}</div> : null}
      </form>
    </div>
  );
}

function VideoPanel({ apiKey, model, modelOptions, onModelChange }: CreativePanelProps) {
  const { t } = useTranslation();
  const [action, setAction] = useState<VideoAction>("generate");
  const [prompt, setPrompt] = useState("");
  const [imageURL, setImageURL] = useState("");
  const [imageFileID, setImageFileID] = useState("");
  const [referenceURL, setReferenceURL] = useState("");
  const [referenceFileID, setReferenceFileID] = useState("");
  const [referenceVoiceId, setReferenceVoiceId] = useState("");
  const [sourceVideoURL, setSourceVideoURL] = useState("");
  const [sourceVideoFileID, setSourceVideoFileID] = useState("");
  const [duration, setDuration] = useState("6");
  const [extendDuration, setExtendDuration] = useState("6");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("720p");
  const [job, setJob] = useState<{ requestId: string; apiKey: string } | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const referenceFileInputRef = useRef<HTMLInputElement | null>(null);
  const videoFileInputRef = useRef<HTMLInputElement | null>(null);
  const imageSelectionVersionRef = useRef(0);
  const referenceSelectionVersionRef = useRef(0);
  const videoSelectionVersionRef = useRef(0);

  const generateModels = useMemo(() => uniqueModelsByPublicID(modelOptions.filter((item) => item.capability === "video")), [modelOptions]);
  const editModels = useMemo(() => {
    const eligiblePublicIDs = new Set(modelOptions
      .filter((item) => item.capability === "video" && item.provider === "grok_console" && item.upstreamModel === "grok-imagine-video")
      .map((item) => item.publicId));
    return generateModels.filter((item) => eligiblePublicIDs.has(item.publicId));
  }, [generateModels, modelOptions]);
  const activeModels = action === "generate" ? generateModels : editModels;
  const activeModel = activeModels.some((item) => item.publicId === model)
    ? model
    : activeModels[0]?.publicId ?? "";

  useEffect(() => {
    if (activeModel && activeModel !== model) onModelChange(activeModel);
  }, [activeModel, model, onModelChange]);

  const voicesQuery = useQuery({
    queryKey: ["creative-console", "video-voices", apiKey],
    queryFn: ({ signal }) => listVoices({ apiKey, model: "grok-voice-latest", signal }),
    enabled: Boolean(apiKey && action === "generate"),
    staleTime: 60_000,
  });
  const voices = useMemo(() => voicesQuery.data ?? [], [voicesQuery.data]);
  const hasFirstFrame = Boolean(imageURL.trim() || imageFileID);
  const hasReferenceImage = Boolean(referenceURL.trim() || referenceFileID);
  const hasReferenceAudio = Boolean(referenceVoiceId.trim());
  const isReferenceMode = hasReferenceImage || hasReferenceAudio;
  const generateResolutions = isReferenceMode ? videoResolutions.filter((item) => item !== "1080p") : videoResolutions;
  const selectedVideoResolution = isReferenceMode && resolution === "1080p" ? "720p" : resolution;

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!apiKey || !activeModel) throw new Error(t("creativeConsole.errors.noModels"));
      if (action === "generate") {
        const nextImageURL = imageURL.trim() || undefined;
        const nextImageFileID = imageFileID || undefined;
        let nextReferenceURL = referenceURL.trim() || undefined;
        let nextReferenceFileID = referenceFileID || undefined;
        let nextReferenceVoice = referenceVoiceId.trim() || undefined;
        if (nextImageFileID || nextImageURL) {
          nextReferenceURL = undefined;
          nextReferenceFileID = undefined;
          nextReferenceVoice = undefined;
        }
        return createVideo({
          apiKey,
          model: activeModel,
          prompt: prompt.trim(),
          imageURL: nextImageURL,
          imageFileID: nextImageFileID,
          referenceImages: nextReferenceFileID
            ? [{ fileId: nextReferenceFileID }]
            : nextReferenceURL
              ? [{ url: nextReferenceURL }]
              : undefined,
          referenceVoiceIds: nextReferenceVoice ? [nextReferenceVoice] : undefined,
          duration: Number(duration),
          aspectRatio,
          resolution: selectedVideoResolution,
        });
      }
      const videoURL = sourceVideoURL.trim() || undefined;
      const videoFileID = sourceVideoFileID || undefined;
      if (!videoURL && !videoFileID) throw new Error(t("creativeConsole.errors.noSourceVideo"));
      if (action === "edit") {
        return editVideo({ apiKey, model: activeModel, prompt: prompt.trim(), videoURL, videoFileID });
      }
      return extendVideo({
        apiKey,
        model: activeModel,
        prompt: prompt.trim(),
        videoURL,
        videoFileID,
        duration: Number(extendDuration),
      });
    },
    onSuccess: (requestId) => setJob({ requestId, apiKey }),
  });

  // 本地媒体进入有 TTL 的隐藏临时区；视频任务只持久化短 file_id，不写入图库或公开 URL。
  const uploadMutation = useMutation({
    mutationFn: async ({ file, kind, selectionVersion }: { file: File; kind: "image" | "reference"; selectionVersion: number }) => {
      if (file.type && !file.type.startsWith("image/")) throw new Error(t("creativeConsole.errors.invalidImage"));
      const input = await uploadMediaInput(file);
      if (input.kind !== "image") throw new Error(t("creativeConsole.errors.invalidImage"));
      return { ...input, kind, selectionVersion };
    },
    onSuccess: (input) => {
      if (input.kind === "image") {
        if (input.selectionVersion !== imageSelectionVersionRef.current) return;
        setImageFileID(input.fileId);
        setImageURL("");
        setReferenceURL("");
        setReferenceFileID("");
        setReferenceVoiceId("");
        return;
      }
      if (input.selectionVersion !== referenceSelectionVersionRef.current) return;
      setReferenceFileID(input.fileId);
      setReferenceURL("");
      setImageURL("");
      setImageFileID("");
    },
  });

  const videoUploadMutation = useMutation({
    mutationFn: async ({ file }: { file: File; selectionVersion: number }) => {
      if (file.type && !file.type.startsWith("video/")) throw new Error(t("creativeConsole.errors.invalidVideo"));
      const input = await uploadMediaInput(file);
      if (input.kind !== "video") throw new Error(t("creativeConsole.errors.invalidVideo"));
      return input;
    },
    onSuccess: (input, request) => {
      if (request.selectionVersion !== videoSelectionVersionRef.current) return;
      setSourceVideoFileID(input.fileId);
      setSourceVideoURL("");
    },
  });

  const statusQuery = useQuery({
    queryKey: ["creative-console", "video", job?.requestId],
    queryFn: ({ signal }) => getVideo({ apiKey: job!.apiKey, requestId: job!.requestId, signal }),
    enabled: Boolean(job),
    refetchInterval: (query) => query.state.data?.status === "pending" ? 3_000 : false,
    retry: 2,
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!apiKey || !activeModel || createMutation.isPending || uploadMutation.isPending || videoUploadMutation.isPending) return;
    if (action === "generate") {
      if ((!prompt.trim() && !hasFirstFrame && !isReferenceMode) || !validDuration(duration)) return;
      if (isReferenceMode && !prompt.trim()) return;
    } else {
      if (!prompt.trim() || (!sourceVideoURL.trim() && !sourceVideoFileID)) return;
      if (action === "extend") {
        const value = Number(extendDuration);
        if (!Number.isFinite(value) || value < 2 || value > 10) return;
      }
    }
    setJob(null);
    createMutation.reset();
    createMutation.mutate();
  }

  const placeholder = action === "generate"
    ? t("creativeConsole.videoPlaceholder")
    : action === "edit"
      ? t("creativeConsole.videoEditPlaceholder")
      : t("creativeConsole.videoExtendPlaceholder");
  const welcome = action === "generate"
    ? t("creativeConsole.welcomeVideo")
    : action === "edit"
      ? t("creativeConsole.welcomeVideoEdit")
      : t("creativeConsole.welcomeVideoExtend");
  const submitLabel = action === "generate"
    ? t("creativeConsole.generateVideo")
    : action === "edit"
      ? t("creativeConsole.editVideo")
      : t("creativeConsole.extendVideo");
  const canSubmit = Boolean(apiKey && activeModel && !createMutation.isPending && !uploadMutation.isPending && !videoUploadMutation.isPending
    && (action === "generate"
      ? ((prompt.trim() || hasFirstFrame || isReferenceMode) && (!isReferenceMode || prompt.trim()) && validDuration(duration) && !(hasFirstFrame && isReferenceMode))
      : prompt.trim() && (sourceVideoURL.trim() || sourceVideoFileID) && (action !== "extend" || (Number(extendDuration) >= 2 && Number(extendDuration) <= 10))));

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto py-6">
        <div className="flex min-h-full w-full flex-col justify-center px-3 sm:px-6">
          {!job && !createMutation.isPending ? <WelcomeState title={welcome} /> : null}
          {createMutation.isPending ? <LoadingResult text={t("creativeConsole.submittingVideo")} /> : null}
          {job ? (
            <VideoResult
              requestId={job.requestId}
              status={statusQuery.data}
              loading={statusQuery.isPending || statusQuery.isFetching}
              error={statusQuery.isError ? statusQuery.error.message : ""}
              onRetry={() => void statusQuery.refetch()}
            />
          ) : null}
        </div>
      </div>

      <form className="w-full shrink-0 px-3 pb-2 sm:px-6 sm:pb-3" onSubmit={submit}>
        <div className={cn(composerClassName, action === "edit" && "bg-[#242424] focus-within:bg-[#2a2a2a]")}>
          <ComposerActionButtons
            value={action}
            actions={[
              ["generate", t("creativeConsole.videoActions.generate")],
              ["edit", t("creativeConsole.videoActions.edit")],
              ["extend", t("creativeConsole.videoActions.extend")],
            ]}
            onChange={(value) => {
              setAction(value as VideoAction);
              setJob(null);
              createMutation.reset();
            }}
          />
          <Textarea id="video-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={placeholder} className="min-h-24 resize-none border-0 bg-transparent px-4 py-3 text-sm focus-visible:ring-0" />
          <div className="flex items-center justify-between gap-3 px-3 pb-3">
            <div className="creative-horizontal-controls flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              <CompactModelSelect value={activeModel} models={activeModels} onChange={onModelChange} />
              {action === "generate" ? (
                <>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className={cn("h-8 gap-1.5 px-2 font-normal", hasFirstFrame && "bg-secondary/70 text-foreground")} aria-label={t("creativeConsole.firstFrameImage")} disabled={isReferenceMode}>
                      <ImagePlus />{hasFirstFrame ? t("creativeConsole.firstFrameImageAdded") : t("creativeConsole.firstFrameImageShort")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 p-3">
                    <div className="mb-2 text-xs font-medium">{t("creativeConsole.firstFrameImage")}</div>
                    <div className="flex items-center gap-2">
                      <Input id="video-image" type="url" value={imageURL} onChange={(event) => { imageSelectionVersionRef.current += 1; referenceSelectionVersionRef.current += 1; setImageURL(event.target.value); setImageFileID(""); setReferenceURL(""); setReferenceFileID(""); setReferenceVoiceId(""); }} placeholder={imageFileID ? t("creativeConsole.firstFrameImageAdded") : "https://..."} aria-label={t("creativeConsole.firstFrameImage")} />
                      {hasFirstFrame ? <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label={t("creativeConsole.clearFirstFrameImage")} onClick={() => { imageSelectionVersionRef.current += 1; setImageURL(""); setImageFileID(""); }}><X /></Button> : null}
                    </div>
                    <input
                      ref={imageFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          const selectionVersion = imageSelectionVersionRef.current + 1;
                          imageSelectionVersionRef.current = selectionVersion;
                          referenceSelectionVersionRef.current += 1;
                          setImageURL("");
                          setImageFileID("");
                          setReferenceURL("");
                          setReferenceFileID("");
                          setReferenceVoiceId("");
                          uploadMutation.reset();
                          uploadMutation.mutate({ file, kind: "image", selectionVersion });
                        }
                        event.target.value = "";
                      }}
                    />
                    <Button type="button" variant="secondary" size="sm" className="mt-2 w-full" disabled={uploadMutation.isPending} onClick={() => imageFileInputRef.current?.click()}>
                      {uploadMutation.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
                      {t("creativeConsole.uploadImage")}
                    </Button>
                    {uploadMutation.isError ? <p className="mt-1 text-[11px] text-destructive">{uploadMutation.error.message}</p> : null}
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className={cn("h-8 gap-1.5 px-2 font-normal", hasReferenceImage && "bg-secondary/70 text-foreground")} aria-label={t("creativeConsole.referenceImage")} disabled={hasFirstFrame}>
                      <Images />{hasReferenceImage ? t("creativeConsole.referenceImageAdded") : t("creativeConsole.referenceImageShort")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 p-3">
                    <div className="mb-2 text-xs font-medium">{t("creativeConsole.referenceImage")}</div>
                    <div className="flex items-center gap-2">
                      <Input id="video-reference" type="url" value={referenceURL} onChange={(event) => { referenceSelectionVersionRef.current += 1; imageSelectionVersionRef.current += 1; setReferenceURL(event.target.value); setReferenceFileID(""); setImageURL(""); setImageFileID(""); }} placeholder={referenceFileID ? t("creativeConsole.referenceImageAdded") : "https://..."} aria-label={t("creativeConsole.referenceImage")} />
                      {hasReferenceImage ? <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label={t("creativeConsole.clearReferenceImage")} onClick={() => { referenceSelectionVersionRef.current += 1; setReferenceURL(""); setReferenceFileID(""); }}><X /></Button> : null}
                    </div>
                    <input
                      ref={referenceFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          const selectionVersion = referenceSelectionVersionRef.current + 1;
                          referenceSelectionVersionRef.current = selectionVersion;
                          imageSelectionVersionRef.current += 1;
                          setReferenceURL("");
                          setReferenceFileID("");
                          setImageURL("");
                          setImageFileID("");
                          uploadMutation.reset();
                          uploadMutation.mutate({ file, kind: "reference", selectionVersion });
                        }
                        event.target.value = "";
                      }}
                    />
                    <Button type="button" variant="secondary" size="sm" className="mt-2 w-full" disabled={uploadMutation.isPending} onClick={() => referenceFileInputRef.current?.click()}>
                      {uploadMutation.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
                      {t("creativeConsole.uploadImage")}
                    </Button>
                    {uploadMutation.isError ? <p className="mt-1 text-[11px] text-destructive">{uploadMutation.error.message}</p> : null}
                  </PopoverContent>
                </Popover>
                <Select value={referenceVoiceId || "__none__"} onValueChange={(value) => { setReferenceVoiceId(value === "__none__" ? "" : value); if (value !== "__none__") { imageSelectionVersionRef.current += 1; setImageURL(""); setImageFileID(""); } }} disabled={hasFirstFrame}>
                  <SelectTrigger className={cn("h-8 w-auto gap-1.5 border-0 bg-transparent px-2 shadow-none", hasReferenceAudio && "bg-secondary/70")} aria-label={t("creativeConsole.referenceVoice")}>
                    <AudioLines className="size-3.5" />
                    <SelectValue placeholder={t("creativeConsole.referenceVoiceShort")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("creativeConsole.referenceVoiceNone")}</SelectItem>
                    {(voices.length > 0 ? voices : [{ voiceId: "eve", name: "Eve" }, { voiceId: "ara", name: "Ara" }] as VoiceInfo[]).map((voice) => (
                      <SelectItem key={voice.voiceId} value={voice.voiceId}>{voice.name || voice.voiceId}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                </>
              ) : (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className={cn("h-8 gap-1.5 px-2 font-normal", (sourceVideoURL || sourceVideoFileID) && "bg-secondary/70 text-foreground")} aria-label={t("creativeConsole.sourceVideo")}>
                      <Video />{sourceVideoURL || sourceVideoFileID ? t("creativeConsole.sourceVideoAdded") : t("creativeConsole.sourceVideoShort")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 p-3">
                    <div className="mb-2 text-xs font-medium">{t("creativeConsole.sourceVideo")}</div>
                    <div className="flex items-center gap-2">
                      <Input id="video-source" type="url" value={sourceVideoURL} onChange={(event) => { videoSelectionVersionRef.current += 1; setSourceVideoURL(event.target.value); setSourceVideoFileID(""); }} placeholder={sourceVideoFileID ? t("creativeConsole.sourceVideoAdded") : "https://..."} aria-label={t("creativeConsole.sourceVideo")} />
                      {sourceVideoURL || sourceVideoFileID ? <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label={t("creativeConsole.clearSourceVideo")} onClick={() => { videoSelectionVersionRef.current += 1; setSourceVideoURL(""); setSourceVideoFileID(""); }}><X /></Button> : null}
                    </div>
                    <input
                      ref={videoFileInputRef}
                      type="file"
                      accept="video/mp4,video/webm,video/quicktime"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          const selectionVersion = videoSelectionVersionRef.current + 1;
                          videoSelectionVersionRef.current = selectionVersion;
                          setSourceVideoURL("");
                          setSourceVideoFileID("");
                          videoUploadMutation.reset();
                          videoUploadMutation.mutate({ file, selectionVersion });
                        }
                        event.target.value = "";
                      }}
                    />
                    <Button type="button" variant="secondary" size="sm" className="mt-2 w-full" disabled={videoUploadMutation.isPending} onClick={() => videoFileInputRef.current?.click()}>
                      {videoUploadMutation.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
                      {t("creativeConsole.uploadVideo")}
                    </Button>
                    {videoUploadMutation.isError ? <p className="mt-1 text-[11px] text-destructive">{videoUploadMutation.error.message}</p> : null}
                  </PopoverContent>
                </Popover>
              )}
              {action === "generate" ? (
                <>
                  <CompactSelect value={duration} options={videoDurations} onChange={setDuration} ariaLabel={t("creativeConsole.duration")} suffix="s" icon={<Clock3 />} />
                  <CompactSelect value={aspectRatio} options={videoAspectRatios} onChange={setAspectRatio} ariaLabel={t("creativeConsole.aspectRatio")} icon={<TvMinimal />} />
                  <CompactSelect value={selectedVideoResolution} options={generateResolutions} onChange={setResolution} ariaLabel={t("creativeConsole.resolution")} icon={<ImageUpscale />} />
                </>
              ) : null}
              {action === "extend" ? (
                <CompactSelect value={extendDuration} options={videoExtendDurations} onChange={setExtendDuration} ariaLabel={t("creativeConsole.extendDuration")} suffix="s" icon={<Clock3 />} />
              ) : null}
            </div>
            <Button type="submit" size="icon" aria-label={submitLabel} disabled={!canSubmit}>
              {createMutation.isPending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
            </Button>
          </div>
        </div>
        {createMutation.isError ? <div className="mt-1 px-2 text-[11px] text-destructive">{createMutation.error.message}</div> : null}
      </form>
    </div>
  );
}

function VideoResult({ requestId, status, loading, error, onRetry }: { requestId: string; status?: VideoStatus; loading: boolean; error: string; onRetry: () => void }) {
  const { t } = useTranslation();
  const progress = status?.progress ?? 0;
  return (
    <div className="w-full space-y-4" aria-live="polite">
      <div className="grid gap-3 sm:grid-cols-2">
        <MetaItem label={t("creativeConsole.requestId")} value={requestId} mono />
        <MetaItem label={t("creativeConsole.status")} value={status ? t(`creativeConsole.videoStatus.${status.status}`) : t("common.loading")} />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">{t("creativeConsole.progress")}</span><span className="tabular-nums">{progress}%</span></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} /></div>
      </div>
      {loading && status?.status !== "done" && status?.status !== "failed" ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner />{t("creativeConsole.pollingVideo")}</div> : null}
      {error ? <RetryableError message={error} onRetry={onRetry} /> : null}
      {status?.status === "failed" ? <InlineError message={status.error?.message || t("creativeConsole.errors.videoFailed")} /> : null}
      {status?.status === "done" && status.video ? (
        <div className="space-y-3">
          {requestId === "preview-video-job" ? (
            <img src={status.video.url} alt="视频预览" className="max-h-[60vh] w-full rounded-2xl bg-black object-cover shadow-sm" />
          ) : (
            <video src={status.video.url} controls preload="metadata" className="max-h-[60vh] w-full rounded-2xl bg-black shadow-sm" />
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{status.video.duration ? t("creativeConsole.videoDuration", { count: status.video.duration }) : ""}</span>
            <Button variant="secondary" size="sm" asChild><a href={status.video.url} target="_blank" rel="noreferrer"><ExternalLink />{t("creativeConsole.openVideo")}</a></Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}


function VoicePanel({ apiKey, model, modelOptions, onModelChange }: CreativePanelProps) {
  const { t } = useTranslation();
  const [subMode, setSubMode] = useState<"tts" | "stt">("tts");
  const [prompt, setPrompt] = useState("");
  const [language, setLanguage] = useState("zh");
  const [voiceId, setVoiceId] = useState("eve");
  const [speed, setSpeed] = useState("1.0");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [ttsResult, setTtsResult] = useState<TTSResult | null>(null);
  const [sttResult, setSttResult] = useState<STTResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filteredModels = useMemo(() => {
    const matched = modelOptions.filter((item) => (
      subMode === "tts"
        ? item.capability === "tts" || item.capability === "realtime"
        : item.capability === "stt"
    ));
    return uniqueModelsByPublicID(matched);
  }, [modelOptions, subMode]);
  const activeModel = filteredModels.some((item) => item.publicId === model)
    ? model
    : filteredModels[0]?.publicId ?? "";

  useEffect(() => {
    if (activeModel !== model) onModelChange(activeModel);
  }, [activeModel, model, onModelChange]);

  const voicesQuery = useQuery({
    queryKey: ["creative-console", "voices", apiKey, activeModel],
    queryFn: ({ signal }) => listVoices({ apiKey, model: activeModel || "grok-voice-latest", signal }),
    enabled: Boolean(apiKey) && subMode === "tts",
    staleTime: 60_000,
  });
  const voices = useMemo(() => voicesQuery.data ?? [], [voicesQuery.data]);
  const activeVoiceId = voices.some((voice) => voice.voiceId === voiceId)
    ? voiceId
    : voices[0]?.voiceId ?? voiceId;

  const ttsMutation = useMutation({
    mutationFn: () => synthesizeSpeech({ apiKey, model: activeModel || "grok-voice-latest", text: prompt.trim(), voiceId: activeVoiceId, language, speed: Number(speed) }),
    onSuccess: (result) => {
      setTtsResult(result);
      setSttResult(null);
    },
  });
  const sttMutation = useMutation({
    mutationFn: async () => {
      if (!audioFile) throw new Error(t("creativeConsole.errors.noAudio"));
      return transcribeSpeech({ apiKey, model: activeModel || "grok-stt", file: audioFile, language });
    },
    onSuccess: (result) => {
      setSttResult(result);
      setTtsResult(null);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!apiKey || !activeModel) return;
    if (subMode === "tts") {
      if (!prompt.trim() || ttsMutation.isPending) return;
      ttsMutation.reset();
      ttsMutation.mutate();
      return;
    }
    if (!audioFile || sttMutation.isPending) return;
    sttMutation.reset();
    sttMutation.mutate();
  }

  const busy = ttsMutation.isPending || sttMutation.isPending;
  const languageOptions = ["auto", "zh", "en", "ja", "ko", "fr", "de", "es"] as const;
  const speedOptions = ["0.7", "0.8", "0.9", "1.0", "1.1", "1.2", "1.3", "1.4", "1.5"] as const;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-4">
        {!ttsResult && !sttResult && !busy ? <WelcomeState title={t("creativeConsole.welcomeVoice")} /> : null}
        {busy ? <LoadingResult text={subMode === "tts" ? t("creativeConsole.synthesizing") : t("creativeConsole.transcribing")} /> : null}
        {ttsResult ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-2xl bg-secondary/40 p-4">
            <audio controls src={ttsResult.url} className="w-full" />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{ttsResult.contentType}{typeof ttsResult.duration === "number" ? ` · ${ttsResult.duration.toFixed(2)}s` : ""}</span>
              <Button variant="secondary" size="sm" asChild><a href={ttsResult.url} download="speech.mp3"><ExternalLink />{t("creativeConsole.open")}</a></Button>
            </div>
          </div>
        ) : null}
        {sttResult ? (
          <div className="mx-auto w-full max-w-3xl space-y-3 rounded-2xl bg-secondary/40 p-4">
            <p className="whitespace-pre-wrap text-sm leading-6">{sttResult.text}</p>
            <div className="text-xs text-muted-foreground">
              {[sttResult.language, typeof sttResult.duration === "number" ? `${sttResult.duration.toFixed(2)}s` : ""].filter(Boolean).join(" · ")}
            </div>
          </div>
        ) : null}
        {ttsMutation.isError ? <div className="px-2 text-[11px] text-destructive">{ttsMutation.error.message}</div> : null}
        {sttMutation.isError ? <div className="px-2 text-[11px] text-destructive">{sttMutation.error.message}</div> : null}
      </div>
      <form onSubmit={submit} className={composerClassName}>
        <div className="flex items-center gap-2 px-3 pt-3">
          <Button type="button" size="sm" variant={subMode === "tts" ? "secondary" : "ghost"} className="h-8 gap-1.5" onClick={() => setSubMode("tts")}><AudioLines />{t("creativeConsole.synthesize")}</Button>
          <Button type="button" size="sm" variant={subMode === "stt" ? "secondary" : "ghost"} className="h-8 gap-1.5" onClick={() => setSubMode("stt")}><Mic />{t("creativeConsole.transcribe")}</Button>
        </div>
        {subMode === "tts" ? (
          <Textarea id="voice-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t("creativeConsole.voicePlaceholder")} className="min-h-24 resize-none border-0 bg-transparent px-4 py-3 text-sm focus-visible:ring-0" />
        ) : (
          <div className="flex items-center gap-2 px-4 py-3">
            <input ref={fileInputRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac" className="hidden" onChange={(event) => setAudioFile(event.target.files?.[0] ?? null)} />
            <Button type="button" variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}><Upload />{audioFile ? audioFile.name : t("creativeConsole.uploadAudio")}</Button>
            {audioFile ? <Button type="button" variant="ghost" size="icon" aria-label={t("creativeConsole.clearAudio")} onClick={() => setAudioFile(null)}><X /></Button> : null}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 px-3 pb-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <CompactModelSelect value={activeModel} models={filteredModels} onChange={onModelChange} />
            <CompactSelect value={language} options={languageOptions} onChange={setLanguage} ariaLabel={t("creativeConsole.voiceLanguage")} />
            {subMode === "tts" ? (
              <CompactSelect value={speed} options={speedOptions} onChange={setSpeed} ariaLabel={t("creativeConsole.voiceSpeed")} suffix="x" icon={<Clock3 />} />
            ) : null}
            {subMode === "tts" ? (
              <Select value={activeVoiceId} onValueChange={setVoiceId} disabled={voices.length === 0 && voicesQuery.isPending}>
                <SelectTrigger className="h-8 w-auto max-w-40 gap-1 border-0 bg-transparent px-2 shadow-none hover:bg-secondary/70 focus:ring-0" aria-label={t("creativeConsole.voiceId")}>
                  <SelectValue placeholder={t("creativeConsole.voiceId")} />
                </SelectTrigger>
                <SelectContent>
                  {(voices.length > 0 ? voices : [{ voiceId: "eve", name: "eve" } as VoiceInfo]).map((voice) => (
                    <SelectItem key={voice.voiceId} value={voice.voiceId}>{voice.name || voice.voiceId}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
          <Button type="submit" size="icon" aria-label={subMode === "tts" ? t("creativeConsole.synthesize") : t("creativeConsole.transcribe")} disabled={!apiKey || !activeModel || busy || (subMode === "tts" ? !prompt.trim() : !audioFile)}>
            {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
      </form>
    </div>
  );
}

function WelcomeState({ title }: { title: string }) {
  return (
    <div className="flex min-h-[20rem] items-center justify-center px-6 text-center">
      <h2 className="max-w-2xl text-xl font-medium tracking-tight text-muted-foreground sm:text-2xl">{title}</h2>
    </div>
  );
}

function useKeyboardInset(): void {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const inset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
      root.style.setProperty("--keyboard-inset", inset >= 80 ? `${inset}px` : "0px");
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      root.style.removeProperty("--keyboard-inset");
    };
  }, []);
}

function ComposerActionButtons({ value, actions, onChange }: { value: string; actions: readonly (readonly [string, string])[]; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1 px-3 pt-3">
      {actions.map(([action, label]) => (
        <Button
          key={action}
          type="button"
          variant="ghost"
          size="sm"
          className={cn("h-7 rounded-full px-3 text-xs font-normal", value === action && "bg-secondary/70 text-foreground")}
          onClick={() => onChange(action)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

function CompactModelSelect({ value, models, onChange }: { value: string; models: ModelRouteDTO[]; onChange: (model: string) => void }) {
  const { t } = useTranslation();
  return (
    <Select value={value} onValueChange={onChange} disabled={models.length === 0}>
      <SelectTrigger className="h-8 w-auto max-w-[145px] shrink-0 gap-1 whitespace-nowrap border-0 bg-transparent px-2 shadow-none hover:bg-secondary/70 focus:bg-secondary/70 focus:ring-0 sm:max-w-[220px]" aria-label={t("creativeConsole.model")} title={value}>
        <span className="creative-model-label">{value ? compactModelName(value) : (models.length === 0 ? t("creativeConsole.noModels") : t("creativeConsole.selectModel"))}</span>
      </SelectTrigger>
      <SelectContent>{models.map((item) => <SelectItem key={item.id} value={item.publicId}>{item.publicId}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function compactModelName(value: string): string {
  const name = value.trim();
  const maxLength = 17;
  return name.length > maxLength ? `…${name.slice(-(maxLength - 1))}` : name;
}

function CompactSelect({ value, options, onChange, ariaLabel, suffix, icon }: { value: string; options: readonly string[]; onChange: (value: string) => void; ariaLabel: string; suffix?: string; icon?: ReactNode }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-auto shrink-0 gap-1.5 whitespace-nowrap border-0 bg-transparent px-2 shadow-none hover:bg-secondary/70 focus:bg-secondary/70 focus:ring-0 [&>svg]:size-3.5 [&>svg]:shrink-0" aria-label={ariaLabel}>
        {icon}<SelectValue />
      </SelectTrigger>
      <SelectContent>{options.map((option) => <SelectItem key={option} value={option}>{option}{suffix}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function CompactIconSelect({ value, options, onChange, ariaLabel, icon, active = false, disabled = false }: { value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; ariaLabel: string; icon: ReactNode; active?: boolean; disabled?: boolean }) {
  const selectedLabel = options.find((option) => option.value === value)?.label ?? ariaLabel;
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger className={cn("h-8 w-auto min-w-8 gap-1 bg-transparent px-2 shadow-none hover:bg-secondary/70 focus:bg-secondary/70 focus:ring-0", active && "bg-secondary/70 text-foreground")} aria-label={`${ariaLabel}: ${selectedLabel}`}>
            <span className="flex items-center [&_svg]:size-3.5">{icon}</span>
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>{ariaLabel} · {selectedLabel}</TooltipContent>
      </Tooltip>
      <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function XSocialIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function ChatMessageItem({
  message,
  loading = false,
  busy = false,
  editing = false,
  editDraft = "",
  onEditDraftChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditKeyDown,
  onRegenerate,
  onStop,
  onDelete,
}: {
  message: ConversationMessage;
  loading?: boolean;
  busy?: boolean;
  editing?: boolean;
  editDraft?: string;
  onEditDraftChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onRegenerate: () => void;
  onStop: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const isUser = message.role === "user";
  const canStop = loading && !editing;
  const canRegenerate = !isUser && !editing && (!busy || loading);
  const canEdit = !loading && !busy;
  const canDelete = !loading && !busy && !editing;
  return (
    <Message align={isUser ? "end" : "start"}>
      <MessageContent className={cn(!isUser && "w-full max-w-full")}>
        {!isUser && message.reasoning ? (
          <div className="w-full rounded-xl bg-secondary/45 px-3 py-2.5 text-xs text-muted-foreground">
            <div className="mb-1.5 flex items-center gap-1.5 font-medium text-foreground/75"><BrainCircuit className="size-3.5" />{t("creativeConsole.thinkingProcess")}</div>
            <div className="whitespace-pre-wrap break-words leading-5">{message.reasoning}</div>
          </div>
        ) : null}
        {!isUser && message.tools?.length ? (
          <div className="flex w-full flex-col gap-1.5">
            {message.tools.map((tool) => <ToolActivityItem key={tool.id} tool={tool} />)}
          </div>
        ) : null}
        {editing ? (
          <div className={cn("w-full space-y-2", isUser ? "max-w-full" : "")}>
            <Textarea
              value={editDraft}
              onChange={(event) => onEditDraftChange(event.target.value)}
              onKeyDown={onEditKeyDown}
              className="min-h-24 resize-y bg-background/70 text-sm"
              autoFocus
              aria-label={t("creativeConsole.editMessage")}
            />
            {!isUser ? (
              <p className="text-[11px] leading-4 text-muted-foreground">{t("creativeConsole.localEditNote")}</p>
            ) : null}
            <div className={cn("flex items-center gap-2", isUser && "justify-end")}>
              <Button type="button" variant="ghost" size="sm" onClick={onCancelEdit}>{t("creativeConsole.cancelEdit")}</Button>
              <Button type="button" size="sm" onClick={onSaveEdit} disabled={!editDraft.trim()}>
                {isUser ? t("creativeConsole.saveAndRegenerate") : t("creativeConsole.saveEdit")}
              </Button>
            </div>
          </div>
        ) : message.content || isUser ? (
          isUser ? (
            <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm leading-6">{message.content}</div>
          ) : <AssistantContent content={message.content} />
        ) : null}
        {loading ? <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground"><Spinner />{t("creativeConsole.streaming")}</div> : null}
        {!editing && (canStop || canRegenerate || canEdit || canDelete) ? (
          <MessageFooter className="gap-0.5 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/message:opacity-100 [@media(hover:hover)]:group-focus-within/message:opacity-100">
            {canStop ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="size-7 rounded-full" aria-label={t("creativeConsole.stopGenerating")} onClick={onStop}>
                    <Square className="size-3.5 fill-current" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("creativeConsole.stopGenerating")}</TooltipContent>
              </Tooltip>
            ) : null}
            {canRegenerate ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="size-7 rounded-full" aria-label={t("creativeConsole.regenerate")} onClick={onRegenerate}>
                    <RefreshCw className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("creativeConsole.regenerate")}</TooltipContent>
              </Tooltip>
            ) : null}
            {canEdit ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="size-7 rounded-full" aria-label={t("creativeConsole.editMessage")} onClick={onStartEdit}>
                    <Pencil className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("creativeConsole.editMessage")}</TooltipContent>
              </Tooltip>
            ) : null}
            {canDelete ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="size-7 rounded-full text-destructive hover:text-destructive" aria-label={t("creativeConsole.deleteMessage")} onClick={onDelete}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("creativeConsole.deleteMessage")}</TooltipContent>
              </Tooltip>
            ) : null}
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  );
}

function AssistantContent({ content }: { content: string }) {
  const renderedHTML = useMemo(() => renderAssistantMarkup(content), [content]);
  if (!renderedHTML) return <div className="w-full whitespace-pre-wrap break-words py-1 text-sm leading-6">{content}</div>;
  return (
    <div
      className="w-full break-words py-1 text-sm leading-6 [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_code]:py-0.5 [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:font-semibold [&_hr]:my-4 [&_hr]:border-border [&_img]:my-3 [&_img]:max-h-[32rem] [&_img]:max-w-full [&_img]:rounded-xl [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-secondary [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border-b [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_th]:border-b [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6"
      dangerouslySetInnerHTML={{ __html: renderedHTML }}
    />
  );
}

function ToolActivityItem({ tool }: { tool: ChatToolActivity }) {
  const { t } = useTranslation();
  const isWebSearch = tool.name === "web_search" || tool.type === "web_search_call";
  const isXSearch = tool.name === "x_search" || tool.type === "x_search_call";
  const label = isWebSearch
    ? t("creativeConsole.toolNames.webSearch")
    : isXSearch
      ? t("creativeConsole.toolNames.xSearch")
      : tool.name;
  const statusLabel = t(`creativeConsole.toolStatus.${tool.status}`);
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-xl bg-secondary/45 px-3 py-2.5 text-xs">
      <span className="mt-0.5 text-muted-foreground">
        {isWebSearch ? <Globe className="size-3.5" /> : isXSearch ? <XSocialIcon className="size-3.5" /> : <Wrench className="size-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{t("creativeConsole.toolCall")} · {label}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground">
            {tool.status === "in_progress" ? <Loader2 className="size-3 animate-spin" /> : tool.status === "failed" ? <TriangleAlert className="size-3 text-destructive" /> : <CheckCircle2 className="size-3" />}
            {statusLabel}
          </span>
        </div>
        {tool.detail ? <div className="mt-1 line-clamp-2 break-all leading-5 text-muted-foreground" title={tool.detail}>{tool.detail}</div> : null}
      </div>
    </div>
  );
}

function LoadingResult({ text }: { text: string }) {
  return <div className="flex min-h-[20rem] items-center justify-center gap-3 text-xs text-muted-foreground"><Spinner className="size-5" />{text}</div>;
}

function InlineError({ message }: { message: string }) {
  return <div role="alert" className="rounded-md bg-destructive/8 px-3 py-2 text-xs leading-5 text-destructive">{message}</div>;
}

function RetryableError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-md bg-destructive/8 px-3 py-2 text-xs leading-5 text-destructive sm:flex-row sm:items-center sm:justify-between">
      <span>{message}</span>
      <Button type="button" variant="ghost" size="sm" className="self-start text-destructive hover:text-destructive sm:self-auto" onClick={onRetry}>
        <RefreshCw />{t("common.retry")}
      </Button>
    </div>
  );
}

function MetaItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0 py-2"><div className="mb-1 text-[11px] text-muted-foreground">{label}</div><div className={cn("truncate text-xs", mono && "font-mono")} title={value}>{value}</div></div>;
}

function providerOptionLabel(profile: ConnectionProfile): string {
  const name = profile.displayName?.trim() || (() => {
    try {
      return new URL(profile.baseUrl).host;
    } catch {
      return profile.baseUrl;
    }
  })();
  const suffix = profile.scope ? ` · ${profile.scope.slice(0, 12)}` : "";
  return `${name}${suffix}`;
}

function validDuration(value: string): boolean {
  const duration = Number(value);
  return Number.isInteger(duration) && duration >= 1 && duration <= 15;
}

function uniqueModelsByPublicID(models: ModelRouteDTO[]): ModelRouteDTO[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.publicId)) return false;
    seen.add(model.publicId);
    return true;
  });
}

function isFixedReasoningConsoleModel(model: ModelRouteDTO | undefined): boolean {
  return model?.provider === "grok_console" && model.upstreamModel === "grok-4.20-0309-reasoning";
}

let fallbackMessageID = 0;

function createCreativeMessageId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  fallbackMessageID += 1;
  return `creative-${Date.now().toString(36)}-${fallbackMessageID.toString(36)}`;
}

function createCreativeCacheKey(): string {
  return `creative-console-${createCreativeMessageId()}`;
}

function currentTimestamp(): number {
  return Date.now();
}

function createBlankChatSession(model: string): ChatSession {
  const now = Date.now();
  return {
    id: createCreativeMessageId(),
    title: "",
    createdAt: now,
    updatedAt: now,
    model,
    promptCacheKey: createCreativeCacheKey(),
    reasoningEffort: "auto",
    webSearch: false,
    xSearch: false,
    messages: [],
  };
}

function createChatSessionTitle(messages: ConversationMessage[]): string {
  const title = messages.find((message) => message.role === "user")?.content.replace(/\s+/g, " ").trim() ?? "";
  return title.length > 48 ? `${title.slice(0, 48)}…` : title || "Conversation";
}

function upsertChatSession(sessions: ChatSession[], session: ChatSession): ChatSession[] {
  return [session, ...sessions.filter((item) => item.id !== session.id)]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, chatHistoryMaxSessions);
}

function chatHistoryStorageKey(scope: string): string {
  return `${chatHistoryStoragePrefix}${encodeURIComponent(scope)}`;
}

function loadChatSessions(scope: string): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(chatHistoryStorageKey(scope)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap(parseChatSession).sort((left, right) => right.updatedAt - left.updatedAt).slice(0, chatHistoryMaxSessions);
  } catch {
    return [];
  }
}

function persistChatSessions(scope: string, sessions: ChatSession[]): ChatSession[] {
  if (typeof window === "undefined") return sessions;
  const retained = sessions.slice(0, chatHistoryMaxSessions);
  while (retained.length > 0) {
    try {
      const serialized = JSON.stringify(retained);
      if (serialized.length * 2 > chatHistoryMaxBytes) {
        retained.pop();
        continue;
      }
      window.localStorage.setItem(chatHistoryStorageKey(scope), serialized);
      return retained;
    } catch {
      retained.pop();
    }
  }
  try {
    window.localStorage.removeItem(chatHistoryStorageKey(scope));
  } catch {
    // Storage may be unavailable; the in-memory conversation remains usable.
  }
  return retained;
}

function parseChatSession(value: unknown): ChatSession[] {
  if (!isLocalRecord(value) || typeof value.id !== "string" || !Array.isArray(value.messages)) return [];
  const messages = value.messages.flatMap(parseConversationMessage);
  if (messages.length === 0) return [];
  const now = Date.now();
  const createdAt = finiteTimestamp(value.createdAt) ?? now;
  const updatedAt = finiteTimestamp(value.updatedAt) ?? createdAt;
  return [{
    id: value.id,
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : createChatSessionTitle(messages),
    createdAt,
    updatedAt,
    model: typeof value.model === "string" ? value.model : "",
    promptCacheKey: typeof value.promptCacheKey === "string" && value.promptCacheKey ? value.promptCacheKey : createCreativeCacheKey(),
    reasoningEffort: isReasoningEffort(value.reasoningEffort) ? value.reasoningEffort : "auto",
    webSearch: value.webSearch === true,
    xSearch: value.xSearch === true,
    messages,
  }];
}

function parseConversationMessage(value: unknown): ConversationMessage[] {
  if (!isLocalRecord(value) || (value.role !== "user" && value.role !== "assistant") || typeof value.content !== "string") return [];
  return [{
    id: typeof value.id === "string" && value.id ? value.id : createCreativeMessageId(),
    role: value.role,
    content: value.content,
    reasoning: typeof value.reasoning === "string" ? value.reasoning : undefined,
    tools: Array.isArray(value.tools) ? value.tools.flatMap(parseChatToolActivity) : undefined,
  }];
}

function parseChatToolActivity(value: unknown): ChatToolActivity[] {
  if (!isLocalRecord(value) || typeof value.id !== "string" || typeof value.type !== "string" || typeof value.name !== "string") return [];
  const status = value.status === "completed" || value.status === "failed" || value.status === "in_progress" ? value.status : "completed";
  return [{ id: value.id, type: value.type, name: value.name, status, detail: typeof value.detail === "string" ? value.detail : "" }];
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === "auto" || value === "none" || value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

function finiteTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function isLocalRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === "AbortError";
}

function hasChatStreamContent(snapshot: ChatStreamSnapshot): boolean {
  return Boolean(snapshot.text.trim() || snapshot.reasoning.trim() || snapshot.tools.length);
}

function formatChatSessionTime(value: number, language: string): string {
  return new Intl.DateTimeFormat(language, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

const safeAssistantHTMLTags = new Set([
  "a", "b", "blockquote", "br", "code", "del", "details", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "i", "img", "kbd", "li", "mark", "ol", "p", "pre", "s", "span", "strong", "sub", "summary", "sup", "table",
  "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
]);
const discardedAssistantHTMLTags = new Set([
  "applet", "audio", "base", "button", "canvas", "embed", "form", "frame", "frameset", "iframe", "input", "link",
  "math", "meta", "object", "picture", "script", "select", "source", "style", "svg", "template", "textarea", "video",
]);

function renderAssistantMarkup(content: string): string {
  const rendered = marked.parse(content, { async: false, breaks: true, gfm: true });
  return sanitizeAssistantHTML(typeof rendered === "string" ? rendered : "");
}

function sanitizeAssistantHTML(content: string): string {
  if (typeof DOMParser === "undefined") return "";
  const source = content.trim();
  if (!/<\/?[a-z][^>]*>/i.test(source)) return "";
  const documentValue = new DOMParser().parseFromString(source, "text/html");
  const elements = Array.from(documentValue.body.querySelectorAll("*"));
  for (const element of elements) {
    if (!element.isConnected) continue;
    const tag = element.tagName.toLowerCase();
    if (discardedAssistantHTMLTags.has(tag)) {
      element.remove();
      continue;
    }
    if (!safeAssistantHTMLTags.has(tag)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }
    const href = tag === "a" ? safeAssistantLink(element.getAttribute("href")) : "";
    const title = tag === "a" ? element.getAttribute("title")?.slice(0, 512) ?? "" : "";
    const imageSource = tag === "img" ? safeAssistantImage(element.getAttribute("src")) : "";
    const imageAlt = tag === "img" ? element.getAttribute("alt")?.slice(0, 512) ?? "" : "";
    const colSpan = tag === "td" || tag === "th" ? boundedTableSpan(element.getAttribute("colspan")) : "";
    const rowSpan = tag === "td" || tag === "th" ? boundedTableSpan(element.getAttribute("rowspan")) : "";
    const open = tag === "details" && element.hasAttribute("open");
    for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
    if (href) {
      element.setAttribute("href", href);
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "nofollow noopener noreferrer");
    }
    if (title) element.setAttribute("title", title);
    if (imageSource) {
      element.setAttribute("src", imageSource);
      element.setAttribute("alt", imageAlt);
      element.setAttribute("loading", "lazy");
      element.setAttribute("decoding", "async");
      element.setAttribute("referrerpolicy", "no-referrer");
    } else if (tag === "img") {
      element.remove();
      continue;
    }
    if (colSpan) element.setAttribute("colspan", colSpan);
    if (rowSpan) element.setAttribute("rowspan", rowSpan);
    if (open) element.setAttribute("open", "");
  }
  return documentValue.body.innerHTML;
}

function safeAssistantLink(value: string | null): string {
  const link = value?.trim() ?? "";
  if (!link) return "";
  try {
    const parsed = new URL(link);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function safeAssistantImage(value: string | null): string {
  const source = value?.trim() ?? "";
  if (!source) return "";
  if (source.startsWith("/v1/media/images/")) return source;
  try {
    const parsed = new URL(source);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function boundedTableSpan(value: string | null): string {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? String(parsed) : "";
}

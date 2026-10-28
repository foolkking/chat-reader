"use client";

import { ArrowLeft, ArrowRight, BookmarkPlus, Check, CheckSquare2, Highlighter, Maximize2, MessageSquareText, Minimize2, Pin, PinOff, RotateCcw, Search, Square, Trash2, Underline, Strikethrough, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PointerEvent as ReactPointerEvent, SetStateAction } from "react";
import type { AnnotationRepository } from "../../lib/annotation-repository";
import type { AnnotationColor, AnnotationCreateInput, AnnotationRead, AnnotationType, MessageListItem, NavigateTarget, NavigationResult } from "../../lib/types";
import { MarkdownRenderer } from "../conversations/markdown-renderer";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { usePreferences } from "../../components/preferences-provider";
import { getRenderedBlocks, subscribeRenderedBlocks } from "../conversations/rendered-block-registry";
import { annotationNavigationTarget } from "../conversations/reader-locator-target";
import { resolveTextAnchorRange } from "../conversations/text-anchor";
import { NotebookView } from "./notebook-view";
import { SettingsFocusedDialog } from "../../components/settings-focused-dialog";
import { ensureNotebookConflict } from "../../lib/offline-conflicts";
import { OFFLINE_SYNC_CHANGED_EVENT } from "../../lib/annotation-sync";
import { useAnnotationWorkspaceReads, type AnnotationReadKind, type AnnotationReadStatus } from "./use-annotation-workspace-reads";
import { AnnotationCommentEditor, type CommentDraft } from "./annotation-comment-editor";
import { DirectExportDownload } from "../exporting/direct-export-download";
import { captureCommentDraftStorage, readAnnotationCommentDrafts, removeAnnotationCommentDraft, trackCommentDraftPersistence, writeAnnotationCommentDraft, type CommentDraftStorage } from "../../lib/annotation-comment-drafts";
import { invalidateReaderSearch } from "../../lib/reader-search-cache";

type SelectionDraft = {
  messageId: string;
  messageVersionId: string;
  startBlockIndex: number;
  startOffset: number;
  endBlockIndex: number;
  endOffset: number;
  quote: string;
  prefix: string;
  suffix: string;
  rect: DOMRect;
};

type PanelState = { x: number; y: number; width: number; height: number };
type DragType = "move" | "resize-left" | "resize-right" | "resize-bottom" | "resize-bottom-right";
type DeleteRecovery = { ids: string[]; removed: string[]; confirmed: number; needsCheck: boolean; status: "deleting" | "checking" | "failed" | "cleanup" };
type CreationRequest = { input: AnnotationCreateInput; selection?: SelectionDraft; status: "saving" | "checking" | "unknown" | "missing" };
type NoteAddition = { references: Array<{ id: string; type: "annotation_reference"; annotation_id: string }>; status: "saving" | "checking" | "unknown" | "review"; missing: number; unavailable: number; capacity: boolean };

const PANEL_STORAGE_KEY = "chat-reader:annotation-workspace-panel";
const PANEL_MIN_WIDTH = 320;
const PANEL_MIN_HEIGHT = 360;
const PANEL_MARGIN = 8;

const COLORS: Array<{ value: AnnotationColor; className: string; label: string }> = [
  { value: "yellow", className: "annotation-swatch annotation-swatch-yellow", label: "黄色高亮" },
  { value: "green", className: "annotation-swatch annotation-swatch-green", label: "绿色高亮" },
  { value: "blue", className: "annotation-swatch annotation-swatch-blue", label: "蓝色高亮" },
  { value: "pink", className: "annotation-swatch annotation-swatch-pink", label: "粉色高亮" },
];

const TEXT_TYPES: Array<{ value: Exclude<AnnotationType, "bookmark">; label: string; icon: typeof Highlighter }> = [
  { value: "highlight", label: "Highlight", icon: Highlighter },
  { value: "underline", label: "Underline", icon: Underline },
  { value: "strikethrough", label: "Strike", icon: Strikethrough },
  { value: "comment", label: "Comment", icon: MessageSquareText },
];

// Ephemeral content and delayed UI callbacks belong to the same read scope.
// Panel geometry and the reader's chosen filters deliberately remain separate.
function useScopedState<T>(scopeKey: number, initial: T) {
  const [state, setState] = useState({ scopeKey, value: initial });
  const currentScope = useRef(scopeKey); currentScope.current = scopeKey;
  const update = useCallback((action: SetStateAction<T>) => {
    if (currentScope.current !== scopeKey) return;
    setState(previous => ({ scopeKey, value: typeof action === "function"
      ? (action as (value: T) => T)(previous.scopeKey === scopeKey ? previous.value : initial) : action }));
  }, [initial, scopeKey]);
  return [state.scopeKey === scopeKey ? state.value : initial, update] as const;
}

export function AnnotationWorkspace({ conversationId, messages, activeMessageId, initialAnnotationId, searchReplayKey = 0, repository, open, onOpenChange, onNavigate }: {
  conversationId: string;
  messages: MessageListItem[];
  activeMessageId: string | null;
  initialAnnotationId?: string | null;
  searchReplayKey?: number;
  repository: AnnotationRepository;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onNavigate: (target: NavigateTarget) => NavigationResult | Promise<NavigationResult>;
}) {
  const queryClient = useQueryClient();
  const dialog = useInteractionDialog();
  const { resolvedLocale, annotationDefaultPosition, setAnnotationDefaultPosition } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const refreshExportDependencies = () => {
    if (repository.mode === "remote") {
      void queryClient.invalidateQueries({ queryKey: ["conversation", "remote", conversationId] });
      invalidateReaderSearch(queryClient, { mode: "remote", conversationId });
    }
  };
  const { annotations, notebook, conflicts: notebookConflicts, reads, reload, publishNotebook: setNotebook,
    notebookReady, canUseNotebook, isCurrent, scopeKey, currentAnnotations, updateAnnotations } = useAnnotationWorkspaceReads(conversationId, repository, open);
  const [, refreshComments] = useScopedState(scopeKey, 0);
  const commentDraftsRef = useMemo(() => ({ current: {} as Record<string, CommentDraft> }), [scopeKey]);
  const commentDrafts = commentDraftsRef.current;
  const commentDraftVersions = useMemo(() => new Map<string, number>(), [scopeKey]);
  const commentPersistQueue = useMemo(() => new Map<string, Promise<void>>(), [scopeKey]);
  const pendingCommentDrafts = useMemo(() => new Map<string, { annotation: AnnotationRead; value: CommentDraft | null; storage: CommentDraftStorage }>(), [scopeKey]);
  const commentDeleteIntents = useMemo(() => new Map<string, AnnotationRead>(), [scopeKey]);
  const [commentStorage, setCommentStorage] = useScopedState<"loading" | "ready" | "failed">(scopeKey, "loading");
  const [commentStorageAttempt, retryCommentStorage] = useScopedState(scopeKey, 0);
  const commentWrites = useMemo(() => new Set<string>(), [scopeKey]);
  const styleGate = useMemo(() => ({ busy: false, needsCheck: false }), [scopeKey]);
  const [styleFeedback, setStyleFeedback] = useScopedState<{ status: "saving" | "checking" | "failed"; confirmed: number; total: number } | null>(scopeKey, null);
  const deleteGate = useMemo(() => ({ busy: false, operation: null as DeleteRecovery | null }), [scopeKey]);
  const [deleteFeedback, setDeleteFeedback] = useScopedState<DeleteRecovery | null>(scopeKey, null);
  const creationGate = useMemo(() => ({ busy: false, request: null as CreationRequest | null }), [scopeKey]);
  const [creationFeedback, setCreationFeedback] = useScopedState<CreationRequest | null>(scopeKey, null);
  const additionGate = useMemo(() => ({ busy: false, request: null as NoteAddition | null }), [scopeKey]);
  const [additionFeedback, setAdditionFeedback] = useScopedState<NoteAddition | null>(scopeKey, null);
  const [notebookActionNotice, setNotebookActionNotice] = useState<{ scopeKey: number; action: "delete" | "add"; returnView: "all" | "current" } | null>(null);
  const [selection, setSelectionState] = useScopedState<SelectionDraft | null>(scopeKey, null);
  const selectionRef = useMemo(() => ({ current: null as SelectionDraft | null }), [scopeKey]);
  const setSelection = useCallback((value: SelectionDraft | null) => {
    if (!isCurrent()) return;
    selectionRef.current = value; setSelectionState(value);
  }, [isCurrent, selectionRef, setSelectionState]);
  const [selectionType, setSelectionType] = useState<Exclude<AnnotationType, "bookmark">>("highlight");
  const [view, setView] = useState<"current" | "all" | "notebook">(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("notebookDraft") ? "notebook" : "current");
  const [annotationQuery, setAnnotationQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<AnnotationType | "all">("all");
  const [colorFilter, setColorFilter] = useState<AnnotationColor | "all">("all");
  const [statusFilter, setStatusFilter] = useState<AnnotationRead["anchor_status"] | "all">("all");
  const [selectionMode, setSelectionMode] = useState(false);
  const emptySelection = useMemo(() => new Set<string>(), []);
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useScopedState<Set<string>>(scopeKey, emptySelection);
  const [batchType, setBatchType] = useState<Exclude<AnnotationType, "bookmark">>("highlight");
  const [batchColor, setBatchColor] = useState<AnnotationColor>("yellow");
  const [focusedAnnotationId, setFocusedAnnotationId] = useScopedState<string | null>(scopeKey, null);
  const idleNavigation = useMemo(() => ({ status: "idle" as const, target: null }), []);
  const [navigationFeedback, setNavigationFeedback] = useScopedState<{ status: "idle" | "loading" | "failed" | "stale"; target: NavigateTarget | null }>(scopeKey, idleNavigation);
  const [contextAnnotation, setContextAnnotation] = useScopedState<{ annotation: AnnotationRead; x: number; y: number; returnFocus: HTMLElement | null } | null>(scopeKey, null);
  const [panelPinned, setPanelPinned] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [notebookDraftAtRisk, setNotebookDraftAtRisk] = useScopedState(scopeKey, false);
  const [conflictKey, setConflictKey] = useScopedState<string | null>(scopeKey, null);
  const conflictOpener = useRef<HTMLElement | null>(null);
  const [reviewMode, setReviewMode] = useState<"continuous" | "single">("continuous");
  const [reviewIndex, setReviewIndex] = useState(0);
  const searchReviewActivation = useMemo(() => ({ aligned: false }), [initialAnnotationId, searchReplayKey, scopeKey]);
  const [desktop, setDesktop] = useState(false);
  const [panel, setPanel] = useState<PanelState>({ x: 0, y: 72, width: 400, height: 620 });
  const panelRef = useRef(panel);
  const dragRef = useRef<{ type: DragType; startX: number; startY: number; panel: PanelState } | null>(null);
  const focusedMessageId = activeMessageId;

  const hasCommentDrafts = Object.keys(commentDrafts).length > 0 || commentDeleteIntents.size > 0;
  useEffect(() => {
    if (!hasCommentDrafts) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [hasCommentDrafts]);

  const persistCommentDraft = useCallback((annotation: AnnotationRead, value: CommentDraft | null) => {
    const id = annotation.id;
    if (value) commentDeleteIntents.delete(id);
    else commentDeleteIntents.set(id, annotation);
    let storage: CommentDraftStorage;
    try { storage = captureCommentDraftStorage(); }
    catch { if (isCurrent()) setCommentStorage("failed"); return; }
    pendingCommentDrafts.set(id, { annotation, value, storage });
    if (commentPersistQueue.has(id)) return;
    const task: Promise<void> = Promise.resolve().then(async () => {
      while (pendingCommentDrafts.has(id)) {
        const pending = pendingCommentDrafts.get(id)!;
        pendingCommentDrafts.delete(id);
        const expectedVersion = commentDraftVersions.get(id) ?? 0;
        try {
          if (pending.value) {
            const version = await writeAnnotationCommentDraft(conversationId, id, expectedVersion, pending.value, repository.mode, pending.storage);
            commentDraftVersions.set(id, version);
          } else {
            await removeAnnotationCommentDraft(conversationId, id, expectedVersion, repository.mode, pending.storage);
            commentDraftVersions.delete(id);
          }
          if (!pendingCommentDrafts.has(id)) commentDeleteIntents.delete(id);
          if (isCurrent()) refreshComments(value => value + 1);
        } catch {
          if (isCurrent()) setCommentStorage("failed");
          // Keep a failed delete as an explicit intent. A later hydration
          // must not turn an unconfirmed discard into a recovered draft.
          const newer = pendingCommentDrafts.has(id);
          if (!pending.value && !newer) pendingCommentDrafts.set(id, pending);
          const latest = commentDraftsRef.current[id];
          if (latest && isCurrent()) {
            commentDraftsRef.current = { ...commentDraftsRef.current, [id]: { ...latest, status: "error" } };
            refreshComments(value => value + 1);
          }
          // Do not spin on a failed local transaction. The explicit storage
          // retry effect will start this retained operation again.
          if (!newer) break;
        }
      }
    }).finally(() => {
      if (commentPersistQueue.get(id) === task) commentPersistQueue.delete(id);
    });
    commentPersistQueue.set(id, task);
    trackCommentDraftPersistence(conversationId, repository.mode, storage, task);
  }, [commentDeleteIntents, commentDraftVersions, commentDraftsRef, commentPersistQueue, conversationId, isCurrent, pendingCommentDrafts, refreshComments, repository.mode, setCommentStorage]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await Promise.all(commentPersistQueue.values());
        if (cancelled || !isCurrent()) return;
        const currentItems = currentAnnotations() ?? [];
        // A failed null write remains queued in memory. Retry it before
        // reading the store, otherwise the stale record could be classified
        // as a new recoverable draft.
        for (const pending of [...pendingCommentDrafts.values()])
          persistCommentDraft(pending.annotation, pending.value);
        for (const [id, annotation] of [...commentDeleteIntents])
          if (!commentPersistQueue.has(id)) persistCommentDraft(annotation, null);
        await Promise.all(commentPersistQueue.values());
        if (cancelled || !isCurrent()) return;
        if (commentDeleteIntents.size) throw new Error("Comment draft deletion is not yet confirmed.");
        const stored = await readAnnotationCommentDrafts(conversationId, repository.mode);
        if (cancelled || !isCurrent()) return;
        for (const record of stored) {
          if (cancelled || !isCurrent()) return;
          commentDraftVersions.set(record.annotation_id, record.version);
          if (commentDeleteIntents.has(record.annotation_id)) continue;
          const current = currentItems.find((item) => item.id === record.annotation_id);
          if (current && current.comment_markdown === record.text) {
            await removeAnnotationCommentDraft(
              conversationId,
              record.annotation_id,
              record.version,
              repository.mode,
            );
            commentDraftVersions.delete(record.annotation_id);
            continue;
          }
          if (!commentDraftsRef.current[record.annotation_id])
            commentDraftsRef.current[record.annotation_id] = { base: record.base, text: record.text,
              // Recovery is always explicit; reopening must not replay an
              // uncertain server write through blur autosave.
              status: "error" };
        }
        if (cancelled || !isCurrent()) return;
        setCommentStorage(pendingCommentDrafts.size || commentDeleteIntents.size ? "failed" : "ready");
        for (const draft of Object.values(commentDraftsRef.current))
          persistCommentDraft(draft.base, draft);
      } catch {
        if (!cancelled && isCurrent()) setCommentStorage("failed");
      } finally {
        if (!cancelled && isCurrent()) refreshComments(value => value + 1);
      }
    })();
    return () => { cancelled = true; };
  }, [commentDeleteIntents, commentDraftVersions, commentDraftsRef, commentPersistQueue, commentStorageAttempt, conversationId, currentAnnotations, isCurrent, pendingCommentDrafts, persistCommentDraft, refreshComments, repository.mode, scopeKey, setCommentStorage]);

  function changeCommentDraft(annotation: AnnotationRead, value: string) {
    if (!isCurrent() || commentStorage === "loading") return;
    const existing = commentDraftsRef.current[annotation.id];
    const next = { ...commentDraftsRef.current, [annotation.id]: { base: existing?.base ?? annotation,
      text: value, status: commentWrites.has(annotation.id) ? "saving" as const : "dirty" as const } };
    if (!commentWrites.has(annotation.id) && value === annotation.comment_markdown) delete next[annotation.id];
    commentDraftsRef.current = next;
    persistCommentDraft(annotation, next[annotation.id] ?? null);
    // Typing rerenders only the editor. The workspace needs to update when a
    // draft appears/disappears or its operation state changes.
    if (existing?.status !== next[annotation.id]?.status) refreshComments(value => value + 1);
  }

  function setCommentResult(id: string, value: CommentDraft | null) {
    if (!isCurrent()) return;
    const next = { ...commentDraftsRef.current };
    const base = value?.base ?? next[id]?.base;
    if (value) next[id] = value; else delete next[id];
    commentDraftsRef.current = next; refreshComments(value => value + 1);
    const annotation = currentAnnotations()?.find(item => item.id === id) ?? base;
    if (annotation) persistCommentDraft(annotation, value);
  }

  async function saveComment(annotation: AnnotationRead, overwrite = false, automatic = false) {
    const draft = commentDraftsRef.current[annotation.id];
    if (!draft || !isCurrent() || commentStorage !== "ready" || commentWrites.has(annotation.id) || styleGate.busy || deleteGate.busy || deleteGate.operation) return;
    if (automatic && draft.status !== "dirty") return;
    let current = currentAnnotations()?.find(item => item.id === annotation.id);
    if (!current) { setCommentResult(annotation.id, { ...draft, status: "error" }); return; }
    if (current.comment_markdown !== draft.base.comment_markdown && current.comment_markdown !== draft.text) {
      if (!overwrite) { setCommentResult(annotation.id, { ...draft, status: "conflict" }); return; }
      const revision = current.revision;
      const confirmed = await dialog.confirm({ title: zh ? "用此草稿替换当前评论？" : "Replace the current comment with this draft?",
        description: zh ? "当前评论已有更新。确认后仅替换评论，保留批注其他内容。" : "The current comment has changed. This replaces only the comment and keeps the annotation's other fields.",
        confirmLabel: zh ? "应用此草稿" : "Apply this draft", danger: true });
      current = currentAnnotations()?.find(item => item.id === annotation.id);
      if (!confirmed || !isCurrent() || !current || current.revision !== revision || commentDraftsRef.current[annotation.id]?.text !== draft.text || commentWrites.has(annotation.id)) return;
    }
    if (current.comment_markdown === draft.text) { setCommentResult(annotation.id, null); return; }
    commentWrites.add(annotation.id); setCommentResult(annotation.id, { ...draft, status: "saving" });
    try {
      const saved = await repository.update(current, { comment_markdown: draft.text });
      if (!isCurrent()) return;
      refreshExportDependencies();
      updateAnnotations(items => items.map(item => item.id === saved.id ? saved : item));
      const latestDraft = commentDraftsRef.current[annotation.id];
      setCommentResult(annotation.id, latestDraft && latestDraft.text !== draft.text
        ? { ...latestDraft, base: saved, status: "dirty" } : null);
    } catch {
      const latestDraft = commentDraftsRef.current[annotation.id];
      if (latestDraft) setCommentResult(annotation.id, { ...latestDraft, status: "error" });
    } finally { commentWrites.delete(annotation.id); }
  }

  async function discardCommentDraft(annotation: AnnotationRead) {
    const draft = commentDraftsRef.current[annotation.id];
    if (!draft || commentWrites.has(annotation.id)) return;
    const confirmed = await dialog.confirm({ title: zh ? "放弃此评论草稿？" : "Discard this comment draft?",
      confirmLabel: zh ? "保留当前评论" : "Keep current comment", danger: true });
    if (confirmed && isCurrent() && commentDraftsRef.current[annotation.id] === draft && !commentWrites.has(annotation.id)) setCommentResult(annotation.id, null);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("annotations") !== "open") return;
    setExpanded(params.get("annotation_layout") === "expanded");
    const mode = params.get("annotation_mode");
    if (mode === "single" || mode === "continuous") setReviewMode(mode);
  }, []);

  useEffect(() => {
    if (!open) return;
    const url = new URL(window.location.href);
    const wasExpanded = url.searchParams.get("annotation_layout") === "expanded";
    if (expanded) {
      url.searchParams.set("annotations", "open");
      url.searchParams.set("annotation_layout", "expanded");
      url.searchParams.set("annotation_mode", reviewMode);
      if (!wasExpanded) window.history.pushState(window.history.state, "", url);
      else window.history.replaceState(window.history.state, "", url);
    } else {
      url.searchParams.delete("annotation_layout");
      url.searchParams.delete("annotation_mode");
      if (wasExpanded) window.history.replaceState(window.history.state, "", url);
    }
  }, [expanded, open, reviewMode]);

  useEffect(() => {
    const syncFromHistory = () => {
      const params = new URLSearchParams(window.location.search);
      setExpanded(params.get("annotation_layout") === "expanded");
      const mode = params.get("annotation_mode");
      if (mode === "single" || mode === "continuous") setReviewMode(mode);
    };
    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, []);

  useEffect(() => {
    if (!initialAnnotationId) return;
    setFocusedAnnotationId(initialAnnotationId);
    setView("all");
    setAnnotationQuery("");
    setTypeFilter("all");
    setColorFilter("all");
    setStatusFilter("all");
  }, [initialAnnotationId, searchReplayKey, setFocusedAnnotationId]);

  const closeWorkspace = async () => {
    if (notebookDraftAtRisk && !await dialog.confirm({ title: zh ? "草稿尚未写入本机，仍要关闭？" : "The draft is not saved on this device. Close anyway?", description: zh ? "返回笔记可重试保存；关闭可能丢失最近的输入。" : "Return to the notebook to retry saving. Closing may lose recent input.", confirmLabel: zh ? "仍然关闭" : "Close anyway", danger: true })) return;
    if (!isCurrent()) return;
    setExpanded(false); onOpenChange(false);
  };
  const openNotebookConflicts = async () => {
    if (!notebook || !canUseNotebook()) return;
    conflictOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConflictKey(await ensureNotebookConflict(notebook, notebookConflicts));
  };
  useEffect(() => {
    if (!open) return;
    const update = () => { void reload().catch(() => undefined); };
    window.addEventListener(OFFLINE_SYNC_CHANGED_EVENT, update);
    return () => window.removeEventListener(OFFLINE_SYNC_CHANGED_EVENT, update);
  }, [open, reload]);

  // Defer initial reads until the panel opens. Once loaded, annotations also
  // support Reader highlights while the panel is closed.
  useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => {
      setDesktop(media.matches);
      if (!media.matches) {
        setPanelPinned(false);
        return;
      }
      const stored = readStoredPanel();
      const current = stored ?? panelRef.current;
      const next = clampPanel({
        ...current,
        x: stored ? current.x : Math.max(16, window.innerWidth - current.width - 28),
      });
      panelRef.current = next;
      setPanel(next);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!open || !desktop || panelPinned) return;
    const frame = window.requestAnimationFrame(() => {
      const next = clampPanel(panelRef.current);
      panelRef.current = next;
      setPanel(next);
      writeStoredPanel(next);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [desktop, open, panelPinned]);

  useEffect(() => {
    setPanelPinned(desktop && annotationDefaultPosition === "docked");
  }, [desktop, annotationDefaultPosition]);

  useEffect(() => {
    const captureKeyboardSelection = () => {
      window.setTimeout(() => {
        if (!isCurrent()) return;
        const next = captureSelection(messages);
        setSelection(next);
      }, 0);
    };
    const capturePointerSelection = (event: MouseEvent) => {
      // Capture the hit block before click handlers can navigate or rerender
      // the virtualized reader. The mouseup target may otherwise be detached
      // by the time the deferred selection check runs.
      const hitElement = document.elementFromPoint(event.clientX, event.clientY);
      window.setTimeout(() => {
        if (!isCurrent()) return;
        const next = captureSelection(messages);
        setSelection(next);
        if (next) return;
        if (!desktop) return;
        const annotation = annotationAtPoint(event, annotations, hitElement);
        if (!annotation) return;
        setFocusedAnnotationId(annotation.id);
        setView("all");
        onOpenChange(true);
        setContextAnnotation({
          annotation,
          x: clamp(event.clientX + 12, 8, window.innerWidth - 300),
          y: clamp(event.clientY + 12, 8, window.innerHeight - 180),
          returnFocus: hitElement?.closest<HTMLElement>("[data-block-index]") ?? null,
        });
      }, 0);
    };
    let selectionTimer = 0;
    const captureNativeSelection = () => {
      window.clearTimeout(selectionTimer);
      selectionTimer = window.setTimeout(() => {
        if (!isCurrent()) return;
        const next = captureSelection(messages);
        if (next) setSelection(next);
      }, 120);
    };
    document.addEventListener("mouseup", capturePointerSelection);
    document.addEventListener("keyup", captureKeyboardSelection);
    document.addEventListener("selectionchange", captureNativeSelection);
    return () => {
      window.clearTimeout(selectionTimer);
      document.removeEventListener("mouseup", capturePointerSelection);
      document.removeEventListener("keyup", captureKeyboardSelection);
      document.removeEventListener("selectionchange", captureNativeSelection);
    };
  }, [annotations, desktop, isCurrent, messages, onOpenChange, setSelection, setContextAnnotation, setFocusedAnnotationId]);

  useEffect(() => {
    let frame = 0;
    const resizeObserver = new ResizeObserver(scheduleRefresh);
    function refresh() {
      frame = 0;
      resizeObserver.disconnect();
      clearCssHighlights();
      const renderedBlocks = getRenderedBlocks();
      applyCssHighlights(annotations, renderedBlocks);
      for (const block of renderedBlocks) resizeObserver.observe(block.element);
    }
    function scheduleRefresh() {
      if (frame) return;
      frame = window.requestAnimationFrame(refresh);
    }
    const unsubscribe = subscribeRenderedBlocks(scheduleRefresh);
    window.addEventListener("resize", scheduleRefresh);
    scheduleRefresh();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      unsubscribe();
      window.removeEventListener("resize", scheduleRefresh);
      clearCssHighlights();
    };
  }, [annotations, messages]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      let next: PanelState;
      if (drag.type === "move") {
        next = clampPanel({ ...drag.panel, x: drag.panel.x + dx, y: drag.panel.y + dy });
      } else if (drag.type === "resize-left") {
        const right = drag.panel.x + drag.panel.width;
        const x = clamp(drag.panel.x + dx, PANEL_MARGIN, right - PANEL_MIN_WIDTH);
        next = clampPanel({ ...drag.panel, x, width: right - x });
      } else if (drag.type === "resize-right") {
        next = clampPanel({ ...drag.panel, width: drag.panel.width + dx });
      } else if (drag.type === "resize-bottom") {
        next = clampPanel({ ...drag.panel, height: drag.panel.height + dy });
      } else {
        next = clampPanel({ ...drag.panel, width: drag.panel.width + dx, height: drag.panel.height + dy });
      }
      panelRef.current = next;
      setPanel(next);
    };
    const stop = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      writeStoredPanel(panelRef.current);
    };
    const resize = () => {
      const next = clampPanel(panelRef.current);
      panelRef.current = next;
      setPanel(next);
      writeStoredPanel(next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("resize", resize);
    window.addEventListener("chat-reader:reader-sidebar-layout-change", resize);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("resize", resize);
      window.removeEventListener("chat-reader:reader-sidebar-layout-change", resize);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  async function createTextAnnotation(annotationType: Exclude<AnnotationType, "bookmark">, color: AnnotationColor) {
    const selected = selectionRef.current;
    if (!selected || !isCurrent() || creationGate.busy) return;
    if (creationGate.request) { onOpenChange(true); return; }
    creationGate.busy = true;
    try {
      const comment = annotationType === "comment" ? await dialog.prompt({
          title: zh ? "添加评论" : "Add comment",
          description: selected.quote.slice(0, 280),
          label: zh ? "评论" : "Comment",
          placeholder: zh ? "输入 Markdown 评论" : "Write a Markdown comment",
          confirmLabel: zh ? "创建" : "Create",
        }) : "";
      if (!isCurrent() || (annotationType === "comment" && !comment)) return;
      const message = messages.find((item) => item.id === selected.messageId);
      const request: CreationRequest = { status: "saving", selection: selected, input: {
        id: crypto.randomUUID(), annotation_type: annotationType, color,
        message_id: selected.messageId, message_version_id: selected.messageVersionId,
        start_block_index: selected.startBlockIndex, start_offset: selected.startOffset,
        end_block_index: selected.endBlockIndex, end_offset: selected.endOffset,
        quote: selected.quote, prefix: selected.prefix, suffix: selected.suffix, comment_markdown: comment ?? "",
        metadata: message ? { message_role: message.role, message_order_key: message.order_key, message_role_number: message.ordinal ?? null } : {},
      } };
      creationGate.busy = false;
      await submitCreation(request);
    } finally { creationGate.busy = false; }
  }

  async function createBookmark(message: MessageListItem) {
    if (!isCurrent() || creationGate.busy) return;
    if (creationGate.request) { onOpenChange(true); return; }
    const request: CreationRequest = { status: "saving", input: {
      id: crypto.randomUUID(),
      annotation_type: "bookmark",
      message_id: message.id,
      message_version_id: message.current_version?.id ?? null,
      quote: null,
      color: null,
      metadata: { message_role: message.role, message_order_key: message.order_key, message_role_number: message.ordinal ?? null },
    } };
    await submitCreation(request);
  }

  function publishCreation(request: CreationRequest | null) {
    if (!isCurrent()) return;
    creationGate.request = request;
    setCreationFeedback(request);
  }

  function finishCreation(request: CreationRequest, created: AnnotationRead) {
    if (!isCurrent()) return;
    if (request.selection) {
      const current = selectionRef.current, original = request.selection;
      if (current && current.messageId === original.messageId && current.messageVersionId === original.messageVersionId
        && current.startBlockIndex === original.startBlockIndex && current.startOffset === original.startOffset
        && current.endBlockIndex === original.endBlockIndex && current.endOffset === original.endOffset && current.quote === original.quote) {
        window.getSelection()?.removeAllRanges(); setSelection(null);
      }
      setView("all"); setFocusedAnnotationId(created.id);
    }
    publishCreation(null);
  }

  async function submitCreation(request: CreationRequest) {
    if (!isCurrent() || creationGate.busy) return;
    creationGate.busy = true; publishCreation({ ...request, status: "saving" });
    onOpenChange(true);
    try {
      const created = await repository.create(conversationId, request.input);
      if (!isCurrent()) return;
      refreshExportDependencies();
      updateAnnotations(items => [...items.filter(item => item.id !== created.id), created]);
      finishCreation(request, created);
      await reload();
    } catch {
      if (isCurrent()) publishCreation({ ...request, status: "unknown" });
    } finally { creationGate.busy = false; }
  }

  async function checkCreation() {
    const request = creationGate.request;
    if (!request || !isCurrent() || creationGate.busy) return;
    creationGate.busy = true; publishCreation({ ...request, status: "checking" });
    try {
      await reload("annotations");
      if (!isCurrent()) return;
      if (!reads.annotations.isReady()) publishCreation({ ...request, status: "unknown" });
      else {
        const created = currentAnnotations()?.find(item => item.id === request.input.id);
        if (created) finishCreation(request, created);
        else publishCreation({ ...request, status: "missing" });
      }
    } finally { creationGate.busy = false; }
  }

  async function retryCreation() {
    const request = creationGate.request;
    if (request?.status === "missing") await submitCreation(request);
  }

  useEffect(() => {
    const handler = (event: Event) => {
      const messageId = (event as CustomEvent<{ messageId: string }>).detail?.messageId;
      const message = messages.find((item) => item.id === messageId);
      if (message && desktop) void createBookmark(message);
    };
    window.addEventListener("chat-reader:create-bookmark", handler);
    return () => window.removeEventListener("chat-reader:create-bookmark", handler);
  });

  const visibleAnnotations = useMemo(() => {
    const base = view === "current" ? annotations.filter((item) => item.message_id === focusedMessageId) : annotations;
    const normalized = annotationQuery.trim().toLocaleLowerCase();
    return base.filter((item) => {
      if (typeFilter !== "all" && item.annotation_type !== typeFilter) return false;
      if (colorFilter !== "all" && item.color !== colorFilter) return false;
      if (statusFilter !== "all" && item.anchor_status !== statusFilter) return false;
      if (!normalized) return true;
      return `${item.quote ?? ""}\n${item.comment_markdown}`.toLocaleLowerCase().includes(normalized);
    });
  }, [annotationQuery, annotations, colorFilter, focusedMessageId, statusFilter, typeFilter, view]);

  useEffect(() => {
    if (!open || !initialAnnotationId || searchReviewActivation.aligned || view !== "all"
      || annotationQuery || typeFilter !== "all" || colorFilter !== "all" || statusFilter !== "all") return;
    const index = visibleAnnotations.findIndex((item) => item.id === initialAnnotationId);
    if (index < 0) return;
    // Keep single/continuous mode and drafts, but reveal this activation's row
    // once data and reset filters are committed. Later manual review stays put.
    searchReviewActivation.aligned = true;
    setReviewIndex(index);
  }, [annotationQuery, colorFilter, initialAnnotationId, open, searchReviewActivation, statusFilter, typeFilter, view, visibleAnnotations]);

  const focusedAnnotationIndex = visibleAnnotations.findIndex((item) => item.id === focusedAnnotationId);
  const focusedAnnotationVisible = view !== "notebook" && focusedAnnotationIndex >= 0
    && (!expanded || reviewMode !== "single" || focusedAnnotationIndex === Math.min(reviewIndex, visibleAnnotations.length - 1));
  useEffect(() => {
    if (!open || !focusedAnnotationVisible || !focusedAnnotationId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`annotation-${focusedAnnotationId}`)?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedAnnotationId, focusedAnnotationVisible, open, searchReplayKey, view]);

  const selectedAnnotations = useMemo(() => annotations.filter(item => selectedAnnotationIds.has(item.id)), [annotations, selectedAnnotationIds]);
  const annotationExport = view !== "notebook" ? <div data-comment-actions className="shrink-0 border-b border-ui px-3 py-2">
    {repository.mode === "remote" ? <DirectExportDownload key={`${scopeKey}:${conversationId}`} href={`/api/conversations/${conversationId}/exports/annotations`} format="markdown" label={zh ? "导出全部批注" : "Export all annotations"} compact /> : null}
    <p className="mt-1 text-xs text-secondary">{repository.mode === "offline"
      ? (zh ? "单独导出批注需要在线访问服务器已保存内容。" : "Standalone export requires online access to saved server content.")
      : (zh ? "导出全部未删除的服务器已保存批注，不受筛选或勾选影响；不含未保存草稿。" : "Exports all non-deleted, saved server annotations, regardless of filters or selection. Unsaved drafts are excluded.")}</p>
  </div> : null;

  const visibleIds = new Set(visibleAnnotations.map(item => item.id));
  const hiddenSelectedCount = selectedAnnotations.filter(item => !visibleIds.has(item.id)).length;
  const styleCount = selectedAnnotations.filter(item => item.annotation_type !== "bookmark").length;
  const notebookIds = new Set(notebook?.blocks.flatMap(block => block.annotation_id ? [block.annotation_id] : []) ?? []);
  const noteAdditionCount = selectedAnnotations.filter(item => !notebookIds.has(item.id)).length;

  useEffect(() => {
    const available = new Set(annotations.map((item) => item.id));
    setSelectedAnnotationIds((current) => new Set(Array.from(current).filter((id) => available.has(id))));
  }, [annotations, setSelectedAnnotationIds]);

  function beginPanelDrag(type: DragType, event: ReactPointerEvent) {
    if (!desktop) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { type, startX: event.clientX, startY: event.clientY, panel: panelRef.current };
    const cursor = type === "move"
      ? "grabbing"
      : type === "resize-bottom"
        ? "row-resize"
        : type === "resize-bottom-right"
          ? "nwse-resize"
          : "col-resize";
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";
  }

  async function deleteAnnotations(annotationIds: Set<string>) {
    if (!isCurrent() || deleteGate.busy || deleteGate.operation || additionGate.busy || additionGate.request || styleGate.busy || styleGate.needsCheck || commentWrites.size) return;
    const targets = (currentAnnotations() ?? []).filter((item) => annotationIds.has(item.id));
    if (!targets.length) return;
    if (!requireNotebook("delete")) return;
    deleteGate.busy = true;
    try {
      const confirmed = await dialog.confirm({
        title: zh ? (targets.length === 1 ? "删除这条批注？" : `删除 ${targets.length} 条批注？`) : `Delete ${targets.length} annotation${targets.length === 1 ? "" : "s"}?`,
        description: (zh ? "正文高亮和精选笔记中的对应引用也会移除。离线修改会在恢复联网后同步。" : "Their highlights and notebook references will also be removed. Offline changes sync when connected.")
          + (targets.some(item => !visibleIds.has(item.id)) ? (zh ? ` 其中 ${targets.filter(item => !visibleIds.has(item.id)).length} 条不在当前筛选中。` : ` ${targets.filter(item => !visibleIds.has(item.id)).length} are hidden by the current filters.`) : ""),
        confirmLabel: zh ? "删除" : "Delete",
        danger: true,
      });
      if (!confirmed || !requireNotebook("delete")) return;
      // The confirmation owns its original IDs, but uses the latest available
      // records and notebook revision. It must never expand to a newer selection.
      const confirmedIds = new Set(targets.map(item => item.id));
      const currentTargets = (currentAnnotations() ?? []).filter(item => confirmedIds.has(item.id));
      if (!currentTargets.length) return;
      const operation: DeleteRecovery = { ids: currentTargets.map(item => item.id), removed: [], confirmed: 0, needsCheck: false, status: "deleting" };
      publishDeletion(operation);
      onOpenChange(true);
      setContextAnnotation(null);
      try {
        for (const annotation of currentTargets) {
          if (!isCurrent()) return;
          const current = currentAnnotations()?.find(item => item.id === annotation.id);
          if (!current) throw new Error("annotation-unavailable");
          await repository.delete(current);
          if (!isCurrent()) return;
          refreshExportDependencies();
          operation.removed.push(current.id);
          operation.confirmed++;
          updateAnnotations(items => items.filter(item => item.id !== current.id));
          // Deleting an annotation does not silently discard unsaved writing.
          // Its draft remains available below as an orphan recovery copy.
          setSelectedAnnotationIds(ids => new Set([...ids].filter(id => id !== current.id)));
          publishDeletion(operation);
        }
      } catch { operation.needsCheck = true; }
      if (!isCurrent()) return;
      setFocusedAnnotationId(null);
      if (operation.needsCheck) publishDeletion({ ...operation, status: "failed" });
      else await cleanDeletedReferences(operation);
    } finally { deleteGate.busy = false; }
  }

  function publishDeletion(operation: DeleteRecovery | null) {
    if (!isCurrent()) return;
    deleteGate.operation = operation;
    setDeleteFeedback(operation ? { ...operation, removed: [...operation.removed] } : null);
  }

  async function cleanDeletedReferences(operation: DeleteRecovery) {
    try {
      if (!isCurrent() || !canUseNotebook() || !reads.annotations.isReady()) throw new Error("notebook-unavailable");
      const current = reads.notebook.currentData();
      if (!current) throw new Error("notebook-unavailable");
      const removed = new Set(operation.removed);
      if (currentAnnotations()?.some(item => removed.has(item.id))) throw new Error("annotation-changed");
      const blocks = current.blocks.filter(block => !block.annotation_id || !removed.has(block.annotation_id));
      if (blocks.length !== current.blocks.length) setNotebook(await repository.saveNotebook(current, blocks));
      if (isCurrent()) publishDeletion(null);
    } catch {
      if (isCurrent()) publishDeletion({ ...operation, status: "failed", needsCheck: true });
    }
  }

  async function checkDeletion() {
    const operation = deleteGate.operation;
    if (!operation || !isCurrent() || deleteGate.busy) return;
    deleteGate.busy = true; publishDeletion({ ...operation, status: "checking" });
    try {
      await reload();
      if (!isCurrent()) return;
      if (!reads.annotations.isReady() || !canUseNotebook()) {
        publishDeletion({ ...operation, status: "failed", needsCheck: true }); return;
      }
      const present = new Set((currentAnnotations() ?? []).map(item => item.id));
      // Absence is current state, not a receipt for the earlier request. A check
      // never repeats a delete or saves the notebook.
      const removed = operation.ids.filter(id => !present.has(id));
      const removedIds = new Set(removed);
      refreshComments(value => value + 1);
      setSelectedAnnotationIds(ids => new Set([...ids].filter(id => !removedIds.has(id))));
      const references = reads.notebook.currentData()?.blocks.some(block => block.annotation_id && removedIds.has(block.annotation_id));
      publishDeletion(references ? { ...operation, removed, needsCheck: false, status: "cleanup" } : null);
    } finally { deleteGate.busy = false; }
  }

  async function retryDeletedReferences() {
    const operation = deleteGate.operation;
    if (!operation || operation.needsCheck || deleteGate.busy || !isCurrent()) return;
    deleteGate.busy = true; publishDeletion({ ...operation, status: "deleting" });
    try { await cleanDeletedReferences(operation); } finally { deleteGate.busy = false; }
  }

  async function updateAnnotationStyle(annotation: AnnotationRead, annotationType: Exclude<AnnotationType, "bookmark">, color: AnnotationColor) {
    if (!isCurrent() || !desktop || annotation.annotation_type === "bookmark") return;
    await changeStyles([annotation], annotationType, color);
    if (isCurrent() && !styleGate.needsCheck) setContextAnnotation(null);
  }

  async function applyBatchStyle() {
    await changeStyles(selectedAnnotations, batchType, batchColor);
  }

  async function changeStyles(items: AnnotationRead[], annotationType: Exclude<AnnotationType, "bookmark">, color: AnnotationColor) {
    if (!isCurrent() || styleGate.busy || styleGate.needsCheck || deleteGate.busy || deleteGate.operation || commentWrites.size) return;
    const ids = new Set(items.map(item => item.id));
    const targets = (currentAnnotations() ?? []).filter(item => ids.has(item.id) && item.annotation_type !== "bookmark"
      && (item.annotation_type !== annotationType || item.color !== color));
    if (!targets.length) return;
    let confirmed = 0;
    styleGate.busy = true; setStyleFeedback({ status: "saving", confirmed, total: targets.length });
    onOpenChange(true);
    setContextAnnotation(null);
    try {
      for (const original of targets) {
        if (!isCurrent()) return;
        const current = currentAnnotations()?.find(item => item.id === original.id);
        if (!current) throw new Error("annotation-unavailable");
        const saved = await repository.update(current, { annotation_type: annotationType, color });
        if (!isCurrent()) return;
        refreshExportDependencies();
        updateAnnotations(values => values.map(item => item.id === saved.id ? saved : item));
        confirmed++;
        setStyleFeedback({ status: "saving", confirmed, total: targets.length });
      }
      setStyleFeedback(null);
    } catch {
      if (!isCurrent()) return;
      styleGate.needsCheck = true;
      setStyleFeedback({ status: "failed", confirmed, total: targets.length });
    } finally { styleGate.busy = false; }
  }

  async function checkStyles() {
    if (!isCurrent() || styleGate.busy || !styleFeedback) return;
    const feedback = styleFeedback;
    styleGate.busy = true; setStyleFeedback({ ...feedback, status: "checking" });
    try {
      await reload("annotations");
      if (!isCurrent()) return;
      if (reads.annotations.isReady()) { styleGate.needsCheck = false; setStyleFeedback(null); }
      else setStyleFeedback({ ...feedback, status: "failed" });
    } finally { styleGate.busy = false; }
  }

  const styleStatus = styleFeedback ? <div className="flex flex-wrap items-center gap-2 border-b border-ui px-3 py-2 text-xs text-secondary" role="status">
    <p className="min-w-0 flex-1">{styleFeedback.status === "failed"
      ? (zh ? `样式已确认 ${styleFeedback.confirmed}/${styleFeedback.total} 项，其余结果未确认。读取当前批注后，再决定是否重试；符合所选样式的项目不会重复提交。` : `${styleFeedback.confirmed}/${styleFeedback.total} style changes confirmed; remaining outcomes are unknown. Check current annotations before retrying. Matching styles will not be submitted again.`)
      : styleFeedback.status === "checking" ? (zh ? "正在读取当前批注…" : "Checking current annotations…")
      : (zh ? `正在修改样式 ${styleFeedback.confirmed}/${styleFeedback.total}…` : `Updating styles ${styleFeedback.confirmed}/${styleFeedback.total}…`)}</p>
    {styleFeedback.status !== "saving" ? <button type="button" className="btn-secondary min-h-11 px-3" disabled={styleFeedback.status === "checking"} onClick={() => void checkStyles()}>{zh ? "读取当前批注" : "Check current annotations"}</button> : null}
  </div> : null;

  const deletionStatus = deleteFeedback ? <div className="flex flex-wrap items-center gap-2 border-b border-ui px-3 py-2 text-xs text-secondary" role="status">
    <p className="min-w-0 flex-1">{deleteFeedback.status === "checking" ? (zh ? "正在读取批注与笔记…" : "Checking annotations and notes…")
      : deleteFeedback.status === "deleting" ? (zh ? "正在删除批注并清理对应笔记引用…" : "Deleting annotations and cleaning their notebook references…")
      : deleteFeedback.status === "cleanup" ? (zh ? "已核对当前批注，对应笔记引用待清理。其余批注仍保留，删除需重新确认。" : "Current annotations checked; their notebook references still need cleanup. Remaining annotations are kept; deleting them requires another confirmation.")
      : (zh ? `删除已确认 ${deleteFeedback.confirmed}/${deleteFeedback.ids.length} 项，操作尚未完成。先读取当前批注与笔记核对，不会自动继续删除。` : `${deleteFeedback.confirmed}/${deleteFeedback.ids.length} deletions confirmed; the operation is incomplete. Check current annotations and notes; deletion will not resume automatically.`)}</p>
    {deleteFeedback.status === "failed" || deleteFeedback.status === "checking" ? <button type="button" className="btn-secondary min-h-11 px-3" disabled={deleteFeedback.status === "checking"} onClick={() => void checkDeletion()}>{zh ? "核对删除结果" : "Check deletion results"}</button> : null}
    {deleteFeedback.status === "cleanup" ? <button type="button" className="btn-secondary min-h-11 px-3" onClick={() => void retryDeletedReferences()}>{zh ? "清理对应笔记引用" : "Clean notebook references"}</button> : null}
  </div> : null;

  const creationLabel = creationFeedback?.input.annotation_type === "bookmark" ? (zh ? "书签" : "bookmark") : (zh ? "批注" : "annotation");
  const creationStatus = creationFeedback ? <div className="flex flex-wrap items-center gap-2 border-b border-ui px-3 py-2 text-xs text-secondary" role="status">
    <p className="min-w-0 flex-1">{creationFeedback.status === "saving" ? (zh ? `正在添加${creationLabel}…` : `Adding ${creationLabel}…`)
      : creationFeedback.status === "checking" ? (zh ? `正在核对${creationLabel}…` : `Checking ${creationLabel}…`)
      : creationFeedback.status === "missing" ? (zh ? `当前未找到此${creationLabel}。可以重试原请求，或结束本次操作。` : `This ${creationLabel} is currently absent. Retry the original request or finish without retrying.`)
      : (zh ? `${creationLabel}添加结果未确认。先核对当前结果，不会自动重复添加。` : `${creationLabel === "bookmark" ? "Bookmark" : "Annotation"} creation was not confirmed. Check its current state; it will not be added again automatically.`)}</p>
    {creationFeedback.status === "unknown" || creationFeedback.status === "checking" ? <button type="button" className="btn-secondary min-h-11 px-3" disabled={creationFeedback.status === "checking"} onClick={() => void checkCreation()}>{zh ? `核对${creationLabel}` : `Check ${creationLabel}`}</button> : null}
    {creationFeedback.status === "missing" ? <><button type="button" className="btn-secondary min-h-11 px-3" onClick={() => void retryCreation()}>{zh ? `重试添加此${creationLabel}` : `Retry this ${creationLabel}`}</button><button type="button" className="min-h-11 px-3 underline" onClick={() => { if (!creationGate.busy && creationGate.request?.status === "missing") publishCreation(null); }}>{zh ? "结束，不重试" : "Finish without retrying"}</button></> : null}
    {creationFeedback.selection ? <details className="w-full"><summary className="flex min-h-11 cursor-pointer items-center underline">{zh ? "保留的摘录与评论" : "Retained quote and comment"}</summary><div className="max-h-40 overflow-auto whitespace-pre-wrap break-words border-l border-ui pl-3"><p>{creationFeedback.input.quote}</p>{creationFeedback.input.comment_markdown ? <p className="mt-2 text-primary">{creationFeedback.input.comment_markdown}</p> : null}</div></details> : null}
  </div> : null;
  const additionStatus = additionFeedback ? <div className="flex flex-wrap items-center gap-2 border-b border-ui px-3 py-2 text-xs text-secondary" role="status">
    <p className="min-w-0 flex-1">{additionFeedback.status === "saving" ? (zh ? "正在加入笔记…" : "Adding to notes…")
      : additionFeedback.status === "checking" ? (zh ? "正在核对笔记与批注…" : "Checking notes and annotations…")
      : additionFeedback.status === "unknown" ? (zh ? "加入笔记尚未获确认，原选择已保留。先读取当前结果，再决定是否补齐。" : "Adding to notes was not confirmed. Original targets are retained. Check current notes before deciding whether to add missing references.")
      : additionFeedback.capacity ? (zh ? `需要再加入 ${additionFeedback.missing} 项，但会超过笔记 5000 项上限。结束本次操作、整理笔记后再试。` : `Adding ${additionFeedback.missing} items would exceed the notebook's 5,000-item limit. Finish this operation and make room before retrying.`)
      : (zh ? `原选择仍缺 ${additionFeedback.missing} 项引用，另有 ${additionFeedback.unavailable} 条批注当前不可用。仅补齐仍可用且缺少的引用。` : `${additionFeedback.missing} original references are missing; ${additionFeedback.unavailable} annotations are currently unavailable. Only available, missing references will be added.`)}</p>
    {additionFeedback.status !== "saving" ? <button type="button" className="btn-secondary min-h-11 px-3" disabled={additionFeedback.status === "checking"} onClick={() => void checkNoteAddition()}>{zh ? "核对笔记内容" : "Check current notes"}</button> : null}
    {additionFeedback.status === "review" ? <>
      {additionFeedback.missing > 0 && !additionFeedback.capacity ? <button type="button" className="btn-secondary min-h-11 px-3" onClick={() => void retryNoteAddition()}>{zh ? `补齐引用（${additionFeedback.missing}）` : `Add missing references (${additionFeedback.missing})`}</button> : null}
      <button type="button" className="min-h-11 px-3 underline" onClick={() => { if (!additionGate.busy && additionGate.request?.status === "review") publishNoteAddition(null); }}>{zh ? "结束加入笔记" : "Finish adding to notes"}</button>
    </> : null}
  </div> : null;
  const orphanedCommentDrafts = reads.annotations.status === "ready"
    ? Object.values(commentDraftsRef.current).filter((draft) => !annotations.some((item) => item.id === draft.base.id)) : [];
  const commentStorageFeedback = <div className="space-y-2">
    {commentStorage === "loading" ? <p role="status" className="text-xs text-secondary">{zh ? "正在恢复本机评论草稿…" : "Recovering local comment drafts…"}</p> : null}
    {commentStorage === "failed" ? <div role="alert" className="text-xs text-[var(--danger)]">
      <p>{zh ? "本机评论草稿读写失败，最近输入可能只在此页面内。请重试，离开或刷新前先复制重要内容。" : "Local comment draft storage failed. Recent input may exist only on this page. Retry, and copy important text before leaving or refreshing."}</p>
      <button type="button" className="min-h-11 underline" onClick={() => retryCommentStorage(value => value + 1)}>{zh ? "重试本机草稿" : "Retry local drafts"}</button>
    </div> : null}
    {orphanedCommentDrafts.map((draft) => <div key={draft.base.id} className="rounded-md border border-ui bg-subtle p-3 text-xs text-secondary">
      <span>{zh ? "原批注已不存在；草稿仍保留，可复制后用于其他批注。" : "The original annotation is gone. This draft is retained; copy it into another annotation if needed."}</span>
      <textarea readOnly aria-label={zh ? "已删除批注的评论草稿" : "Comment draft for a deleted annotation"} rows={4} value={draft.text} className="mt-2 block w-full rounded border border-ui bg-surface p-2 text-sm text-primary" />
      <button type="button" className="min-h-11 underline" onClick={() => void discardCommentDraft(draft.base)}>{zh ? "放弃此草稿" : "Discard this draft"}</button>
    </div>)}
  </div>;
  const writeFeedback = <>{commentStorageFeedback}{styleStatus}{deletionStatus}{creationStatus}{additionStatus}</>;

  async function addSelectedToNotebook() {
    await addToNotebook(selectedAnnotations.map(item => item.id));
  }

  async function addAnnotationToNotebook(annotation: AnnotationRead) {
    await addToNotebook([annotation.id]);
  }

  async function addToNotebook(ids: string[]) {
    if (!isCurrent() || additionGate.busy) return;
    if (additionGate.request) { onOpenChange(true); return; }
    if (!requireNotebook("add")) return;
    const originalIds = new Set(ids);
    const references = (currentAnnotations() ?? []).filter(item => originalIds.has(item.id))
      .map(item => ({ id: crypto.randomUUID(), type: "annotation_reference" as const, annotation_id: item.id }));
    if (!references.length) return;
    await submitNoteAddition({ references, status: "saving", missing: references.length, unavailable: 0, capacity: false });
  }

  function publishNoteAddition(request: NoteAddition | null) {
    if (!isCurrent()) return;
    additionGate.request = request; setAdditionFeedback(request);
  }

  function inspectNoteAddition(request: NoteAddition) {
    if (!isCurrent() || !canUseNotebook() || !reads.annotations.isReady()) return null;
    const current = reads.notebook.currentData();
    if (!current) return null;
    const available = new Set((currentAnnotations() ?? []).map(item => item.id));
    const existing = new Set(current.blocks.flatMap(block => block.annotation_id ? [block.annotation_id] : []));
    const missing = request.references.filter(item => available.has(item.annotation_id) && !existing.has(item.annotation_id));
    const unavailable = request.references.filter(item => !available.has(item.annotation_id)).length;
    return { current, missing, unavailable, capacity: current.blocks.length + missing.length > 5000 };
  }

  async function submitNoteAddition(request: NoteAddition) {
    if (!isCurrent() || additionGate.busy || deleteGate.busy || deleteGate.operation) return;
    additionGate.busy = true; publishNoteAddition({ ...request, status: "saving" });
    onOpenChange(true);
    setContextAnnotation(null);
    try {
      const checked = inspectNoteAddition(request);
      if (!checked) { publishNoteAddition({ ...request, status: "unknown" }); return; }
      const review: NoteAddition = { ...request, status: "review", missing: checked.missing.length, unavailable: checked.unavailable, capacity: checked.capacity };
      if (checked.capacity) { publishNoteAddition(review); return; }
      if (checked.missing.length) {
        const saved = await repository.saveNotebook(checked.current, [...checked.current.blocks, ...checked.missing]);
        if (!isCurrent()) return;
        setNotebook(saved);
      }
      publishNoteAddition(checked.unavailable ? { ...review, missing: 0 } : null);
      setView("notebook");
    } catch {
      if (isCurrent()) publishNoteAddition({ ...request, status: "unknown" });
    } finally { additionGate.busy = false; }
  }

  async function checkNoteAddition() {
    const request = additionGate.request;
    if (!request || !isCurrent() || additionGate.busy) return;
    additionGate.busy = true; publishNoteAddition({ ...request, status: "checking" });
    try {
      await reload();
      if (!isCurrent()) return;
      const checked = inspectNoteAddition(request);
      if (!checked) { publishNoteAddition({ ...request, status: "unknown" }); return; }
      if (!checked.missing.length && !checked.unavailable) { publishNoteAddition(null); setView("notebook"); }
      else publishNoteAddition({ ...request, status: "review", missing: checked.missing.length, unavailable: checked.unavailable, capacity: checked.capacity });
    } finally { additionGate.busy = false; }
  }

  async function retryNoteAddition() {
    const request = additionGate.request;
    if (request?.status === "review" && request.missing && !request.capacity) await submitNoteAddition(request);
  }

  function toggleSelected(annotationId: string) {
    setSelectedAnnotationIds((current) => {
      const next = new Set(current);
      if (next.has(annotationId)) next.delete(annotationId);
      else next.add(annotationId);
      return next;
    });
  }

  function requireNotebook(action: "delete" | "add") {
    if (!isCurrent()) return false;
    if (action === "add" && (deleteGate.busy || deleteGate.operation)) return false;
    if (canUseNotebook()) { setNotebookActionNotice(null); return true; }
    setNotebookActionNotice({ scopeKey, action, returnView: view === "current" ? "current" : "all" });
    setContextAnnotation(null);
    setView("notebook");
    onOpenChange(true);
    return false;
  }

  async function navigateFromAnnotation(target: NavigateTarget) {
    if (!isCurrent()) return;
    setNavigationFeedback({ status: "loading", target });
    const result = await onNavigate(target);
    if (!isCurrent()) return;
    if (result.ok) {
      setNavigationFeedback({ status: result.fallback ? "stale" : "idle", target });
      // Keep the desktop workspace available for continued review; mobile
      // sheets close after navigation so the target content is unobstructed.
      if (!desktop) onOpenChange(false);
      return;
    }
    if (result.reason !== "cancelled") setNavigationFeedback({ status: "failed", target });
  }

  const creationTypes = desktop ? TEXT_TYPES : TEXT_TYPES.filter((type) => type.value !== "strikethrough");
  const creationColors = desktop ? COLORS : COLORS.slice(0, 3);
  const effectiveSelectionType = !desktop && selectionType === "strikethrough" ? "highlight" : selectionType;

  function resetPanelPosition() {
    const next = defaultPanel();
    panelRef.current = next;
    setPanel(next);
    writeStoredPanel(next);
  }

  const readFeedback = (kind: AnnotationReadKind) => <AnnotationReadFeedback kind={kind}
    status={reads[kind].status} hasData={reads[kind].data !== null} unavailable={reads[kind].unavailable}
    zh={zh} onRetry={() => void reload(kind)} />;
  const notebookContent = <div className="space-y-3">
    {notebookActionNotice?.scopeKey === scopeKey ? <div className="flex flex-wrap items-center gap-2 border-b border-ui pb-3" role="status">
      <p className="min-w-0 flex-1 text-sm text-secondary">{notebookActionNotice.action === "delete"
        ? (zh ? "尚未删除批注。恢复笔记读取后，返回批注重试。" : "Annotations were not deleted. Restore notebook reads, then return to annotations to retry.")
        : (zh ? "尚未加入笔记。恢复笔记读取后，返回批注重试。" : "Nothing was added to notes. Restore notebook reads, then return to annotations to retry.")}</p>
      <button type="button" className="btn-secondary min-h-11 px-3 text-sm" onClick={() => { setView(notebookActionNotice.returnView); setNotebookActionNotice(null); }}>{zh ? "返回批注" : "Back to annotations"}</button>
    </div> : null}
    {readFeedback("notebook")}{readFeedback("conflicts")}{readFeedback("annotations")}
    {notebook ? <NotebookView key={scopeKey} notebook={notebook} conflicts={notebookConflicts} annotations={annotations}
      repository={repository} onSaved={setNotebook} onReload={reload} onResolve={openNotebookConflicts}
      onRiskChange={setNotebookDraftAtRisk} onNavigate={navigateFromAnnotation}
      saveBlocked={!notebookReady || Boolean(deleteFeedback) || Boolean(additionFeedback)} canSave={() => canUseNotebook() && !deleteGate.busy && !deleteGate.operation && !additionGate.busy && !additionGate.request} annotationsLoaded={reads.annotations.data !== null} /> : null}
  </div>;

  return <>
    {conflictKey ? <SettingsFocusedDialog category="offline" initialConflictKey={conflictKey} onClose={() => { setConflictKey(null); void reload(); }} restoreFocus={() => conflictOpener.current} /> : null}
    {selection ? <div className={`fixed z-[120] flex max-w-[min(92vw,34rem)] flex-wrap items-center gap-1 rounded-md border border-ui bg-raised p-1.5 shadow-xl ${desktop ? "" : "inset-x-2 bottom-[calc(.5rem+env(safe-area-inset-bottom))] justify-center"}`} style={desktop ? { left: clamp(selection.rect.left + selection.rect.width / 2 - 170, 8, window.innerWidth - 360), top: Math.max(8, selection.rect.top - 88) } : undefined} role="toolbar" aria-label="Create annotation">
      {creationTypes.map((type) => { const Icon = type.icon; const label = localizedAnnotationType(type.value, zh); return <button key={type.value} type="button" onClick={() => setSelectionType(type.value)} className={`inline-flex h-8 items-center gap-1 rounded px-2 text-xs ${effectiveSelectionType === type.value ? "bg-[var(--accent-soft)] text-accent" : "text-secondary hover:bg-subtle"}`} aria-label={label} title={label}><Icon className="h-3.5 w-3.5" />{label}</button>; })}
      <span className="mx-1 h-5 w-px bg-[var(--border)]" />
      {creationColors.map((color) => <button key={color.value} type="button" onClick={() => void createTextAnnotation(effectiveSelectionType, color.value)} className={`h-7 w-7 rounded ${color.className} ring-offset-2 hover:ring-2 hover:ring-[var(--focus)]`} aria-label={zh ? `创建${localizedAnnotationType(effectiveSelectionType, true)}，${localizedColor(color.value, true)}` : `Create ${localizedAnnotationType(effectiveSelectionType, false)} ${localizedColor(color.value, false)}`} title={localizedColor(color.value, zh)} />)}
    </div> : null}
    {contextAnnotation && desktop ? <AnnotationContextMenu
      key={contextAnnotation.annotation.id}
      item={contextAnnotation.annotation}
      x={contextAnnotation.x}
      y={contextAnnotation.y}
      returnFocus={contextAnnotation.returnFocus}
      onClose={() => setContextAnnotation(null)}
      onNavigate={() => { setContextAnnotation(null); void navigateFromAnnotation(annotationNavigationTarget(contextAnnotation.annotation)); }}
      onDelete={() => void deleteAnnotations(new Set([contextAnnotation.annotation.id]))}
      onStyle={(type, color) => void updateAnnotationStyle(contextAnnotation.annotation, type, color)}
      onAddToNotebook={() => void addAnnotationToNotebook(contextAnnotation.annotation)}
      onSelect={() => { setSelectionMode(true); setSelectedAnnotationIds((current) => new Set(current).add(contextAnnotation.annotation.id)); setContextAnnotation(null); }}
    /> : null}
    {open && !expanded ? <section className={`fixed z-[110] flex min-h-0 flex-col overflow-hidden border border-ui bg-raised shadow-2xl ${panelPinned && desktop ? "inset-y-0 left-0 w-[min(22rem,32vw)] rounded-none" : "inset-x-2 bottom-2 top-16 rounded-md md:inset-auto"}`} style={desktop && !panelPinned ? { left: panel.x, top: panel.y, width: panel.width, height: panel.height } : undefined} aria-label="批注" data-annotation-mode={panelPinned && desktop ? "docked" : "floating"}>
      <header className="flex h-12 shrink-0 touch-none items-center gap-2 border-b border-ui px-3" onPointerDown={(event) => { if (panelPinned || (event.target as HTMLElement).closest("button")) return; beginPanelDrag("move", event); }}><MessageSquareText className="h-4 w-4 text-accent" /><h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{zh ? "批注" : "Annotations"}</h2>{desktop && !panelPinned ? <button type="button" onClick={resetPanelPosition} className="flex h-8 w-8 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={zh ? "重置批注窗口位置" : "Reset annotation window position"} title={zh ? "重置位置" : "Reset position"}><RotateCcw className="h-4 w-4" /></button> : null}{desktop ? <button type="button" onClick={() => { const next = !panelPinned; setPanelPinned(next); void setAnnotationDefaultPosition(next ? "docked" : "floating"); }} className="flex h-8 w-8 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={panelPinned ? (zh ? "恢复为浮窗" : "Return to floating") : (zh ? "固定到左侧栏" : "Dock to the left")} title={panelPinned ? (zh ? "恢复为浮窗" : "Return to floating") : (zh ? "固定到左侧栏" : "Dock to the left")}>{panelPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}</button> : null}<button type="button" onClick={() => setExpanded(true)} className="flex h-8 w-8 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={zh ? "展开批注阅读" : "Expand annotation reading"} title={zh ? "展开阅读" : "Expand reading"}><Maximize2 className="h-4 w-4" /></button><button type="button" onClick={() => void closeWorkspace()} className="flex h-8 w-8 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={zh ? "关闭" : "Close"}><X className="h-4 w-4" /></button></header>
      {annotationExport}
      <div className="grid shrink-0 grid-cols-3 border-b border-ui bg-subtle p-1">{(["current", "all", "notebook"] as const).map((item) => <button key={item} type="button" onClick={() => setView(item)} className={`min-h-9 rounded px-2 text-xs font-medium ${view === item ? "bg-surface text-primary shadow-sm" : "text-secondary"}`}>{item === "current" ? (zh ? "当前消息" : "Current") : item === "all" ? (zh ? "全部批注" : "All") : (zh ? "精选笔记" : "Notes")}</button>)}</div>
      {navigationFeedback.status !== "idle" ? <div className={`flex shrink-0 items-center gap-2 border-b border-ui px-3 py-2 text-xs ${navigationFeedback.status === "failed" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : navigationFeedback.status === "stale" ? "bg-amber-50 text-amber-800" : "bg-subtle text-accent"}`} role="status"><span className="min-w-0 flex-1">{navigationFeedback.status === "loading" ? "正在按对话与章节位置加载批注原文…" : navigationFeedback.status === "stale" ? "原文已更改，已定位到最近的段落或消息。" : "无法定位批注原文，当前正文保持不变。"}</span>{navigationFeedback.status === "failed" && navigationFeedback.target ? <button type="button" onClick={() => void navigateFromAnnotation(navigationFeedback.target as NavigateTarget)} className="shrink-0 font-semibold underline">重试</button> : null}</div> : null}
      {view !== "notebook" ? <div className="mx-3 mt-3 grid shrink-0 grid-cols-2 gap-2"><label className="col-span-2 flex min-h-9 min-w-0 items-center gap-2 rounded-md border border-ui bg-page px-2"><Search className="h-4 w-4 text-secondary" /><input value={annotationQuery} onChange={(event) => setAnnotationQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder={zh ? "搜索批注" : "Search annotations"} /></label><select aria-label={zh ? "批注类型" : "Annotation type"} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as AnnotationType | "all")} className="min-h-9 min-w-0 rounded-md border border-ui bg-page px-2 text-xs"><option value="all">{zh ? "全部类型" : "All types"}</option>{TEXT_TYPES.map((type) => <option key={type.value} value={type.value}>{localizedAnnotationType(type.value, zh)}</option>)}<option value="bookmark">{localizedAnnotationType("bookmark", zh)}</option></select><select aria-label={zh ? "批注颜色" : "Annotation color"} value={colorFilter} onChange={(event) => setColorFilter(event.target.value as AnnotationColor | "all")} className="min-h-9 min-w-0 rounded-md border border-ui bg-page px-2 text-xs"><option value="all">{zh ? "全部颜色" : "All colors"}</option>{COLORS.map((color) => <option key={color.value} value={color.value}>{localizedColor(color.value, zh)}</option>)}</select><select aria-label={zh ? "锚点状态" : "Anchor status"} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AnnotationRead["anchor_status"] | "all")} className="min-h-9 min-w-0 rounded-md border border-ui bg-page px-2 text-xs"><option value="all">{zh ? "全部状态" : "All status"}</option><option value="valid">{zh ? "正常" : "Valid"}</option><option value="remapped">{zh ? "已重定位" : "Remapped"}</option><option value="needs_review">{zh ? "需要检查" : "Needs review"}</option><option value="orphaned">{zh ? "原文缺失" : "Orphaned"}</option></select>{desktop ? <button type="button" onClick={() => { setSelectionMode((current) => !current); setSelectedAnnotationIds(new Set()); }} className={`min-h-9 rounded-md border px-3 text-xs font-medium ${selectionMode ? "border-[var(--accent)] bg-[var(--accent-soft)] text-accent" : "border-ui text-secondary hover:bg-subtle"}`}>{selectionMode ? (zh ? "完成" : "Done") : (zh ? "管理" : "Manage")}</button> : null}</div> : null}
      {view !== "notebook" && selectionMode ? <div className="mx-3 mt-2 flex flex-wrap items-center gap-2 border-b border-ui pb-2 text-xs">
        <button type="button" onClick={() => setSelectedAnnotationIds(current => new Set([...current, ...visibleIds]))} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-secondary hover:bg-subtle"><CheckSquare2 className="h-4 w-4" />{zh ? "全选当前结果" : "Select visible"}</button>
        <button type="button" onClick={() => setSelectedAnnotationIds(current => { const next = new Set(current); for (const id of visibleIds) { if (next.has(id)) next.delete(id); else next.add(id); } return next; })} className="inline-flex min-h-11 items-center rounded-md px-2 text-secondary hover:bg-subtle">{zh ? "反选当前结果" : "Invert visible"}</button>
        <button type="button" onClick={() => setSelectedAnnotationIds(new Set())} className="inline-flex min-h-11 items-center rounded-md px-2 text-secondary hover:bg-subtle">{zh ? "清除" : "Clear"}</button>
        <span className="min-w-0 flex-1 text-secondary">{zh ? `已选 ${selectedAnnotations.length} 项` : `${selectedAnnotations.length} selected`}{hiddenSelectedCount ? (zh ? `，其中 ${hiddenSelectedCount} 项不在当前筛选中` : `; ${hiddenSelectedCount} hidden by filters`) : ""}</span>
        {hiddenSelectedCount ? <button type="button" className="min-h-11 px-2 text-accent underline" onClick={() => { setView("all"); setAnnotationQuery(""); setTypeFilter("all"); setColorFilter("all"); setStatusFilter("all"); }}>{zh ? "显示全部批注" : "Show all annotations"}</button> : null}
        <select aria-label={zh ? "批量样式" : "Batch style"} value={batchType} onChange={(event) => setBatchType(event.target.value as Exclude<AnnotationType, "bookmark">)} className="min-h-11 rounded-md border border-ui bg-page px-2 text-xs">{TEXT_TYPES.map((type) => <option key={type.value} value={type.value}>{localizedAnnotationType(type.value, zh)}</option>)}</select>
        <AnnotationColorPicker value={batchColor} onChange={setBatchColor} zh={zh} />
        <button type="button" disabled={!styleCount || Boolean(styleFeedback) || Boolean(deleteFeedback) || commentWrites.size > 0} onClick={() => void applyBatchStyle()} className="min-h-11 rounded-md border border-ui px-2 text-secondary disabled:opacity-40">{zh ? `应用样式（${styleCount}）` : `Apply style (${styleCount})`}</button>
        <button type="button" disabled={!selectedAnnotations.length || (notebookReady && !noteAdditionCount)} onClick={() => void addSelectedToNotebook()} className="min-h-11 rounded-md border border-ui px-2 text-accent disabled:opacity-40">{zh ? "加入精选笔记" : "Add to notes"}{notebookReady ? ` (${noteAdditionCount})` : ""}</button>
        <button type="button" disabled={!selectedAnnotations.length || Boolean(styleFeedback) || Boolean(deleteFeedback) || commentWrites.size > 0} onClick={() => void deleteAnnotations(new Set(selectedAnnotations.map(item => item.id)))} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 font-medium text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-40"><Trash2 className="h-4 w-4" />{zh ? "删除" : "Delete"}</button>
        {selectedAnnotations.length > styleCount ? <p className="w-full text-secondary">{zh ? "书签不参与样式修改。" : "Bookmarks keep their existing style."}</p> : null}
        {notebookReady && noteAdditionCount < selectedAnnotations.length ? <p className="w-full text-secondary">{zh ? "已在笔记中的批注不会重复添加。" : "Annotations already in notes will not be added again."}</p> : null}
      </div> : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{writeFeedback}{view === "notebook" ? notebookContent : <>{readFeedback("annotations")}{reads.annotations.data !== null ? <AnnotationList items={visibleAnnotations} editable={desktop} commentsLoading={commentStorage === "loading"} messages={messages} focusedAnnotationId={focusedAnnotationId} selectionMode={selectionMode} selectedAnnotationIds={selectedAnnotationIds} onToggleSelected={toggleSelected} onNavigate={navigateFromAnnotation} readCommentDraft={(id) => commentDraftsRef.current[id]} onDraftChange={changeCommentDraft} onSaveComment={saveComment} onDiscardComment={discardCommentDraft} onCheckComments={() => reload("annotations")} onStyle={updateAnnotationStyle} onDelete={(annotation) => deleteAnnotations(new Set([annotation.id]))} onAddToNotebook={addAnnotationToNotebook} /> : null}</>}</div>
      {desktop ? <><button type="button" role="separator" aria-orientation="vertical" className="absolute bottom-0 left-0 top-12 z-20 w-2 cursor-col-resize touch-none bg-transparent hover:bg-[var(--accent)] focus:bg-[var(--accent)] focus:outline-none" onPointerDown={(event) => beginPanelDrag("resize-left", event)} onDoubleClick={() => { const next = defaultPanel(); panelRef.current = next; setPanel(next); writeStoredPanel(next); }} aria-label="从左侧调整批注窗口宽度" /><button type="button" role="separator" aria-orientation="vertical" className="absolute bottom-0 right-0 top-12 z-20 w-2 cursor-col-resize touch-none bg-transparent hover:bg-[var(--accent)] focus:bg-[var(--accent)] focus:outline-none" onPointerDown={(event) => beginPanelDrag("resize-right", event)} aria-label="从右侧调整批注窗口宽度" /><button type="button" role="separator" aria-orientation="horizontal" className="absolute bottom-0 left-0 right-6 z-20 h-2 cursor-row-resize touch-none bg-transparent hover:bg-[var(--accent)] focus:bg-[var(--accent)] focus:outline-none" onPointerDown={(event) => beginPanelDrag("resize-bottom", event)} aria-label="调整批注窗口高度" /><button type="button" className="absolute bottom-0 right-0 z-30 flex h-6 w-6 cursor-se-resize items-end justify-end p-0.5 text-secondary" onPointerDown={(event) => beginPanelDrag("resize-bottom-right", event)} aria-label="调整批注窗口大小"><Maximize2 className="h-3.5 w-3.5" /></button></> : null}
    </section> : null}
    {open && expanded ? <section className="fixed inset-0 z-[150] flex min-h-0 flex-col bg-raised" aria-label={zh ? "批注阅读" : "Annotation reading"} data-annotation-mode="expanded">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-ui px-4"><MessageSquareText className="h-5 w-5 text-accent" /><h2 className="min-w-0 flex-1 truncate text-base font-semibold">{zh ? "批注阅读" : "Annotation reading"}</h2><button type="button" onClick={() => setExpanded(false)} className="inline-flex h-9 items-center gap-1 rounded-md border border-ui px-2 text-xs text-secondary hover:bg-subtle" aria-label={zh ? "退出展开阅读" : "Exit expanded reading"}><Minimize2 className="h-4 w-4" />{zh ? "退出" : "Exit"}</button><button type="button" onClick={() => void closeWorkspace()} className="flex h-9 w-9 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={zh ? "关闭" : "Close"}><X className="h-4 w-4" /></button></header>
      {annotationExport}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ui px-4 py-3"><div className="flex items-center gap-1 rounded-md bg-subtle p-1"><button type="button" onClick={() => { setReviewMode("continuous"); setReviewIndex(0); }} className={`min-h-8 rounded px-3 text-xs ${reviewMode === "continuous" ? "bg-surface font-medium text-primary shadow-sm" : "text-secondary"}`}>{zh ? "连续阅读" : "Continuous"}</button><button type="button" onClick={() => { setReviewMode("single"); setReviewIndex(0); }} className={`min-h-8 rounded px-3 text-xs ${reviewMode === "single" ? "bg-surface font-medium text-primary shadow-sm" : "text-secondary"}`}>{zh ? "逐条回顾" : "Review one by one"}</button></div><div className="flex min-w-0 flex-1 items-center gap-2"><span className="text-xs text-secondary">{view === "notebook" ? (notebook?.title || (zh ? "精选笔记" : "Notes")) : `${visibleAnnotations.length} ${zh ? "条批注" : "annotations"}`}</span></div>{view !== "notebook" ? <div className="flex items-center gap-2"><select aria-label={zh ? "批注类型" : "Annotation type"} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as AnnotationType | "all")} className="min-h-9 rounded-md border border-ui bg-page px-2 text-xs"><option value="all">{zh ? "全部类型" : "All types"}</option>{TEXT_TYPES.map((type) => <option key={type.value} value={type.value}>{localizedAnnotationType(type.value, zh)}</option>)}<option value="bookmark">{localizedAnnotationType("bookmark", zh)}</option></select><button type="button" onClick={() => setView("notebook")} className="min-h-9 rounded-md border border-ui px-3 text-xs text-accent hover:bg-subtle">{zh ? "精选笔记" : "Notes"}</button></div> : <button type="button" onClick={() => setView("all")} className="min-h-9 rounded-md border border-ui px-3 text-xs text-accent hover:bg-subtle">{zh ? "全部批注" : "All annotations"}</button>}</div>
      <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-4xl p-4 md:p-8">{writeFeedback}{view === "notebook" ? notebookContent : <>{readFeedback("annotations")}{reads.annotations.data !== null ? <AnnotationList items={visibleAnnotations} editable={desktop} commentsLoading={commentStorage === "loading"} messages={messages} focusedAnnotationId={focusedAnnotationId} selectionMode={selectionMode} selectedAnnotationIds={selectedAnnotationIds} onToggleSelected={toggleSelected} onNavigate={navigateFromAnnotation} readCommentDraft={(id) => commentDraftsRef.current[id]} onDraftChange={changeCommentDraft} onSaveComment={saveComment} onDiscardComment={discardCommentDraft} onCheckComments={() => reload("annotations")} onStyle={updateAnnotationStyle} onDelete={(annotation) => deleteAnnotations(new Set([annotation.id]))} onAddToNotebook={addAnnotationToNotebook} reviewMode={reviewMode} reviewIndex={reviewIndex} onReviewIndexChange={setReviewIndex} /> : null}</>}</div></div>
    </section> : null}
  </>;
}

function AnnotationReadFeedback({ kind, status, hasData, unavailable, zh, onRetry }: {
  kind: AnnotationReadKind; status: AnnotationReadStatus; hasData: boolean; unavailable: boolean;
  zh: boolean; onRetry: () => void;
}) {
  if (status === "ready" || (status !== "error" && hasData)) return null;
  const label = kind === "annotations" ? (zh ? "批注" : "annotations")
    : kind === "notebook" ? (zh ? "笔记" : "notebook") : (zh ? "笔记冲突" : "notebook conflicts");
  if (status !== "error") return <p role="status" className="text-sm text-secondary">{zh ? `正在读取${label}…` : `Loading ${label}…`}</p>;
  return <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-ui pb-3" role="status">
    <p className="min-w-0 flex-1 text-sm text-secondary">{unavailable
      ? (zh ? `无法访问${label}。请检查登录状态或重新打开对话。` : `Cannot access ${label}. Check your sign-in or reopen the conversation.`)
      : (zh ? `${label}读取失败。${hasData ? "已有内容仍可阅读。" : "请重试。"}` : `Unable to load ${label}. ${hasData ? "Previously loaded content remains available." : "Retry loading."}`)}</p>
    <button type="button" className="btn-secondary min-h-11 px-3 text-sm" onClick={onRetry}>{zh ? `重试读取${label}` : `Retry ${label}`}</button>
  </div>;
}

function AnnotationList({ items, editable, commentsLoading, messages, focusedAnnotationId, selectionMode, selectedAnnotationIds, onToggleSelected, onNavigate, readCommentDraft, onDraftChange, onSaveComment, onDiscardComment, onCheckComments, onStyle, onDelete, onAddToNotebook, reviewMode = "continuous", reviewIndex = 0, onReviewIndexChange }: {
  items: AnnotationRead[];
  editable: boolean;
  commentsLoading: boolean;
  messages: MessageListItem[];
  focusedAnnotationId: string | null;
  selectionMode: boolean;
  selectedAnnotationIds: Set<string>;
  onToggleSelected: (annotationId: string) => void;
  onNavigate: (target: NavigateTarget) => void | Promise<unknown>;
  readCommentDraft: (id: string) => CommentDraft | undefined;
  onDraftChange: (annotation: AnnotationRead, value: string) => void;
  onSaveComment: (annotation: AnnotationRead, overwrite?: boolean, automatic?: boolean) => Promise<void>;
  onDiscardComment: (annotation: AnnotationRead) => Promise<void>;
  onCheckComments: () => Promise<void>;
  onStyle: (annotation: AnnotationRead, annotationType: Exclude<AnnotationType, "bookmark">, color: AnnotationColor) => Promise<void>;
  onDelete: (annotation: AnnotationRead) => Promise<void>;
  onAddToNotebook: (annotation: AnnotationRead) => Promise<void>;
  reviewMode?: "continuous" | "single";
  reviewIndex?: number;
  onReviewIndexChange?: (index: number) => void;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  if (!items.length) return <p className="py-8 text-center text-sm text-secondary">暂无批注</p>;
  const displayedItems = reviewMode === "single" ? [items[Math.min(reviewIndex, items.length - 1)]] : items;
  const currentIndex = Math.min(reviewIndex, items.length - 1);
  return <div className="space-y-4">{reviewMode === "single" ? <div className="flex items-center justify-between gap-2 border-b border-ui pb-3 text-xs text-secondary"><button type="button" disabled={currentIndex <= 0} onClick={() => onReviewIndexChange?.(Math.max(0, currentIndex - 1))} className="inline-flex min-h-8 items-center gap-1 rounded-md border border-ui px-2 disabled:opacity-40"><ArrowLeft className="h-3.5 w-3.5" />{zh ? "上一条" : "Previous"}</button><span>{currentIndex + 1} / {items.length}</span><button type="button" disabled={currentIndex >= items.length - 1} onClick={() => onReviewIndexChange?.(Math.min(items.length - 1, currentIndex + 1))} className="inline-flex min-h-8 items-center gap-1 rounded-md border border-ui px-2 disabled:opacity-40">{zh ? "下一条" : "Next"}<ArrowRight className="h-3.5 w-3.5" /></button></div> : null}{displayedItems.map((annotation) => {
    const message = messages.find((item) => item.id === annotation.message_id);
    const metadataRole = typeof annotation.metadata.message_role === "string" ? annotation.metadata.message_role : message?.role;
    const metadataNumber = typeof annotation.metadata.message_role_number === "number" ? annotation.metadata.message_role_number : message?.ordinal;
    const sectionTitle = typeof annotation.metadata.section_title === "string" ? annotation.metadata.section_title : null;
    const label = `${metadataRole === "user" ? "U" : "A"}${metadataNumber ?? ""}`;
    const blockIndex = hasUnresolvedAnchor(annotation) ? undefined : annotation.start_block_index ?? undefined;
    const selected = selectedAnnotationIds.has(annotation.id);
    return <article id={`annotation-${annotation.id}`} key={annotation.id} className={`rounded-sm border-b border-ui pb-4 last:border-0 ${focusedAnnotationId === annotation.id ? "bg-[var(--accent-soft)] ring-2 ring-[var(--focus)]" : ""}`}>
      <div className="flex items-start gap-1">
        {selectionMode ? <button type="button" onClick={() => onToggleSelected(annotation.id)} className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={selected ? "取消选择批注" : "选择批注"}>{selected ? <CheckSquare2 className="h-4 w-4 text-accent" /> : <Square className="h-4 w-4" />}</button> : null}
        <button type="button" onClick={() => selectionMode ? onToggleSelected(annotation.id) : void onNavigate(annotationNavigationTarget(annotation, blockIndex))} className="min-w-0 flex-1 px-1 text-left">
         <div className="flex flex-wrap items-center gap-2 text-xs text-secondary"><span className={`h-2.5 w-2.5 rounded-full ${colorClass(annotation.color)}`} /><span>{label}</span><span className="rounded bg-subtle px-1.5 py-0.5">{localizedAnnotationType(annotation.annotation_type, zh)}</span>{sectionTitle ? <span className="min-w-0 truncate">{sectionTitle}</span> : null}{hasUnresolvedAnchor(annotation) ? <span className="text-[var(--danger)]">{zh ? "原文需要检查" : "Source needs review"}</span> : null}{annotation.conflict_of_id ? <span className="text-amber-600">{zh ? "冲突副本" : "Conflict copy"}</span> : null}</div>
          <blockquote data-annotation-color={annotation.color ?? "yellow"} className="annotation-quote mt-2 border-l-2 px-3 py-2 text-sm leading-6 text-primary">{annotation.quote || "整条消息书签"}</blockquote>
        </button>
        {editable && !selectionMode ? <button type="button" onClick={() => void onDelete(annotation)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]" aria-label={zh ? "删除批注" : "Delete annotation"} title={zh ? "删除批注" : "Delete annotation"}><Trash2 className="h-4 w-4" /></button> : null}
      </div>
       {editable ? <div className="mt-2 flex flex-wrap items-center gap-2"><select value={annotation.annotation_type === "bookmark" ? "bookmark" : annotation.annotation_type} disabled={annotation.annotation_type === "bookmark"} onChange={(event) => void onStyle(annotation, event.target.value as Exclude<AnnotationType, "bookmark">, annotation.color ?? "yellow")} className="min-h-8 rounded-md border border-ui bg-page px-2 text-xs">{TEXT_TYPES.map((type) => <option key={type.value} value={type.value}>{localizedAnnotationType(type.value, zh)}</option>)}{annotation.annotation_type === "bookmark" ? <option value="bookmark">{localizedAnnotationType("bookmark", zh)}</option> : null}</select><AnnotationColorPicker value={annotation.color ?? "yellow"} disabled={annotation.annotation_type === "bookmark"} onChange={(color) => void onStyle(annotation, annotation.annotation_type as Exclude<AnnotationType, "bookmark">, color)} zh={zh} /></div> : null}
       {editable ? <AnnotationCommentEditor annotation={annotation} readDraft={readCommentDraft} focused={focusedAnnotationId === annotation.id} zh={zh} loading={commentsLoading} onChange={onDraftChange} onSave={onSaveComment} onDiscard={onDiscardComment} onCheck={onCheckComments} /> : annotation.comment_markdown ? <div className="mt-2 text-sm"><MarkdownRenderer text={annotation.comment_markdown} /></div> : null}
       {editable ? <button type="button" onClick={() => void onAddToNotebook(annotation)} className="mt-2 inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-accent hover:bg-subtle"><BookmarkPlus className="h-3.5 w-3.5" />{zh ? "加入精选笔记" : "Add to notes"}</button> : null}
    </article>;
  })}</div>;
}

function AnnotationContextMenu({ item, x, y, returnFocus, onClose, onNavigate, onDelete, onStyle, onAddToNotebook, onSelect }: {
  item: AnnotationRead;
  x: number;
  y: number;
  returnFocus: HTMLElement | null;
  onClose: () => void;
  onNavigate: () => void;
  onDelete: () => void;
  onStyle: (annotationType: Exclude<AnnotationType, "bookmark">, color: AnnotationColor) => void;
  onAddToNotebook: () => void;
  onSelect: () => void;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [type, setType] = useState<Exclude<AnnotationType, "bookmark">>(item.annotation_type === "bookmark" ? "highlight" : item.annotation_type);
  const [color, setColor] = useState<AnnotationColor>(item.color ?? "yellow");
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    menuRef.current?.focus({ preventScroll: true });
    return () => {
      if (!returnFocus?.isConnected) return;
      if (!returnFocus.hasAttribute("tabindex")) returnFocus.tabIndex = -1;
      returnFocus.focus({ preventScroll: true });
    };
  }, [returnFocus]);
  useEffect(() => {
    const closeOnOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [onClose]);
  return <div ref={menuRef} tabIndex={-1} className="fixed z-[130] w-64 rounded-md border border-ui bg-raised p-2 shadow-2xl outline-none" style={{ left: x, top: y }} role="dialog" aria-label="Annotation actions">
    <div className="mb-2 flex items-center justify-between gap-2"><span className="min-w-0 truncate text-xs font-semibold">{localizedAnnotationType(item.annotation_type, zh)}</span><button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={zh ? "关闭" : "Close"}><X className="h-4 w-4" /></button></div>
    <div className="space-y-2"><select value={type} disabled={item.annotation_type === "bookmark"} onChange={(event) => setType(event.target.value as Exclude<AnnotationType, "bookmark">)} className="min-h-8 w-full rounded-md border border-ui bg-page px-2 text-xs">{TEXT_TYPES.map((option) => <option key={option.value} value={option.value}>{localizedAnnotationType(option.value, zh)}</option>)}</select><AnnotationColorPicker value={color} disabled={item.annotation_type === "bookmark"} onChange={setColor} zh={zh} /></div>
    <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={onNavigate} className="min-h-8 rounded-md border border-ui px-2 text-xs text-secondary hover:bg-subtle">{zh ? "定位" : "Locate"}</button><button type="button" onClick={onSelect} className="min-h-8 rounded-md border border-ui px-2 text-xs text-secondary hover:bg-subtle">{zh ? "选择" : "Select"}</button><button type="button" disabled={item.annotation_type === "bookmark"} onClick={() => onStyle(type, color)} className="min-h-8 rounded-md border border-ui px-2 text-xs text-accent hover:bg-subtle disabled:opacity-40">{zh ? "保存样式" : "Save style"}</button><button type="button" onClick={onAddToNotebook} className="min-h-8 rounded-md border border-ui px-2 text-xs text-accent hover:bg-subtle">{zh ? "加入精选笔记" : "Add to notes"}</button><button type="button" onClick={onDelete} className="col-span-2 inline-flex min-h-8 items-center justify-center gap-1 rounded-md px-2 text-xs text-[var(--danger)] hover:bg-[var(--danger-soft)]"><Trash2 className="h-3.5 w-3.5" />{zh ? "删除" : "Delete"}</button></div>
  </div>;
}

function AnnotationColorPicker({ value, disabled = false, onChange, zh }: {
  value: AnnotationColor;
  disabled?: boolean;
  onChange: (color: AnnotationColor) => void;
  zh: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-ui bg-page p-1" role="radiogroup" aria-label={zh ? "批注颜色" : "Annotation color"}>
      {COLORS.map((color) => {
        const selected = value === color.value;
        const label = localizedColor(color.value, zh);
        return (
          <button
            key={color.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={() => onChange(color.value)}
            className={`relative flex h-7 w-7 items-center justify-center rounded ${color.className} ${selected ? "ring-2 ring-[var(--focus)] ring-offset-1 ring-offset-[var(--surface)]" : "hover:ring-2 hover:ring-[var(--border)]"}`}
          >
            {selected ? <Check className="h-3.5 w-3.5 text-[var(--annotation-swatch-check)]" strokeWidth={3} /> : null}
          </button>
        );
      })}
    </div>
  );
}

function captureSelection(messages: MessageListItem[]): SelectionDraft | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const startElement = elementFromNode(range.startContainer);
  const endElement = elementFromNode(range.endContainer);
  const article = startElement?.closest<HTMLElement>("article[data-message-id]");
  if (!article || article !== endElement?.closest("article[data-message-id]")) return null;
  const startBlock = startElement?.closest<HTMLElement>("[data-block-index]");
  const endBlock = endElement.closest<HTMLElement>("[data-block-index]");
  if (!startBlock || !endBlock) return null;
  const messageId = article.dataset.messageId;
  const message = messages.find((item) => item.id === messageId);
  if (!messageId || !message?.current_version?.id) return null;
  const quote = range.toString();
  if (!quote.trim()) return null;
  const startOffset = characterOffset(startBlock, range.startContainer, range.startOffset);
  const endOffset = characterOffset(endBlock, range.endContainer, range.endOffset);
  const startText = startBlock.textContent ?? "";
  const endText = endBlock.textContent ?? "";
  return {
    messageId,
    messageVersionId: message.current_version.id,
    startBlockIndex: Number(startBlock.dataset.blockIndex),
    startOffset,
    endBlockIndex: Number(endBlock.dataset.blockIndex),
    endOffset,
    quote,
    prefix: startText.slice(Math.max(0, startOffset - 120), startOffset),
    suffix: endText.slice(endOffset, endOffset + 120),
    rect: range.getBoundingClientRect(),
  };
}

function characterOffset(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  try { range.setEnd(node, offset); } catch { return 0; }
  return range.toString().length;
}

function applyCssHighlights(annotations: AnnotationRead[], renderedBlocks: ReturnType<typeof getRenderedBlocks>) {
  const css = (CSS as unknown as { highlights?: { set: (name: string, highlight: unknown) => void } }).highlights;
  const HighlightConstructor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  const blocksByKey = new Map<string, HTMLElement[]>();
  for (const block of renderedBlocks) {
    const key = `${block.messageId}:${block.blockIndex}`;
    const entries = blocksByKey.get(key) ?? [];
    entries.push(block.element);
    blocksByKey.set(key, entries);
  }
  for (const annotation of annotations.filter((item) => item.annotation_type === "bookmark" && item.message_id)) {
    document.getElementById(`message-${annotation.message_id}`)?.classList.add("annotation-bookmark");
  }
  const groups = new Map<string, Array<{ range: Range; root: HTMLElement; annotationType: Exclude<AnnotationType, "bookmark">; color: AnnotationColor }>>();
  for (const annotationType of TEXT_TYPES) {
    for (const color of COLORS) {
      const entries: Array<{ range: Range; root: HTMLElement; annotationType: Exclude<AnnotationType, "bookmark">; color: AnnotationColor }> = [];
      for (const annotation of annotations.filter((item) => item.annotation_type === annotationType.value && (item.color ?? "yellow") === color.value && !hasUnresolvedAnchor(item))) {
        if (!annotation.message_id || annotation.start_block_index === null || annotation.end_block_index === null || annotation.start_offset === null || annotation.end_offset === null) continue;
        for (let blockIndex = annotation.start_block_index; blockIndex <= annotation.end_block_index; blockIndex += 1) {
          const roots = blocksByKey.get(`${annotation.message_id}:${blockIndex}`) ?? [];
          for (const root of roots) {
            const start = blockIndex === annotation.start_block_index ? annotation.start_offset : 0;
            const end = blockIndex === annotation.end_block_index ? annotation.end_offset : (root.textContent?.length ?? 0);
            const useQuote = annotation.start_block_index === annotation.end_block_index;
            const range = resolveTextAnchorRange(root, {
              quote: useQuote ? annotation.quote : null,
              prefix: useQuote ? annotation.prefix : null,
              suffix: useQuote ? annotation.suffix : null,
              startOffset: start,
              endOffset: end,
            });
            if (range && root.contains(range.commonAncestorContainer)) {
              entries.push({ range, root, annotationType: annotationType.value, color: color.value });
            }
          }
        }
      }
      if (entries.length) groups.set(`annotation-${annotationType.value}-${color.value}`, entries);
    }
  }
  if (css && HighlightConstructor) {
    for (const [name, entries] of groups) {
      css.set(name, new HighlightConstructor(...entries.map((entry) => entry.range)));
    }
    return;
  }
  for (const entries of groups.values()) {
    for (const entry of entries) createRangeOverlay(entry.root, entry.range, entry.annotationType, entry.color);
  }
}

function clearCssHighlights() {
  const css = (CSS as unknown as { highlights?: { delete: (name: string) => void } }).highlights;
  document.querySelectorAll(".annotation-bookmark").forEach((element) => element.classList.remove("annotation-bookmark"));
  document.querySelectorAll("[data-annotation-overlay-root]").forEach((element) => element.remove());
  for (const color of COLORS) {
    css?.delete(`annotation-${color.value}`);
    for (const annotationType of TEXT_TYPES) css?.delete(`annotation-${annotationType.value}-${color.value}`);
  }
}

function createRangeOverlay(
  root: HTMLElement,
  range: Range,
  annotationType: Exclude<AnnotationType, "bookmark">,
  color: AnnotationColor,
) {
  const rootRect = root.getBoundingClientRect();
  let overlay = root.querySelector<HTMLElement>(":scope > [data-annotation-overlay-root]");
  if (!overlay) {
    overlay = document.createElement("span");
    overlay.dataset.annotationOverlayRoot = "true";
    overlay.setAttribute("aria-hidden", "true");
    overlay.className = "annotation-range-overlay";
    root.append(overlay);
  }
  for (const rect of Array.from(range.getClientRects())) {
    if (!rect.width && !rect.height) continue;
    const segment = document.createElement("span");
    segment.className = "annotation-range-segment";
    segment.dataset.annotationType = annotationType;
    segment.dataset.annotationColor = color;
    segment.style.left = `${rect.left - rootRect.left}px`;
    segment.style.top = `${rect.top - rootRect.top}px`;
    segment.style.width = `${rect.width}px`;
    segment.style.height = `${rect.height}px`;
    overlay.append(segment);
  }
}

function elementFromNode(node: Node): HTMLElement | null { return node instanceof HTMLElement ? node : node.parentElement; }
function colorClass(color: AnnotationColor | null): string { return COLORS.find((item) => item.value === color)?.className ?? "bg-secondary"; }
function clamp(value: number, min: number, max: number): number { return Math.min(Math.max(value, min), max); }

function annotationAtPoint(event: MouseEvent, annotations: AnnotationRead[], hitElement: Element | null = null): AnnotationRead | null {
  const target = hitElement ?? (event.target instanceof Element ? event.target : null) ?? document.elementFromPoint(event.clientX, event.clientY);
  const block = target?.closest<HTMLElement>("[data-block-index]");
  const article = block?.closest<HTMLElement>("article[data-message-id]");
  const messageId = article?.dataset.messageId;
  const blockIndex = block ? Number.parseInt(block.dataset.blockIndex ?? "", 10) : Number.NaN;
  if (!block || !messageId || !Number.isFinite(blockIndex)) return null;
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    const annotation = annotations[index];
    if (annotation.message_id !== messageId || hasUnresolvedAnchor(annotation)) continue;
    if (annotation.start_block_index === null || annotation.end_block_index === null) continue;
    if (blockIndex < annotation.start_block_index || blockIndex > annotation.end_block_index) continue;
    const start = blockIndex === annotation.start_block_index ? annotation.start_offset ?? 0 : 0;
    const end = blockIndex === annotation.end_block_index ? annotation.end_offset ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    const range = resolveTextAnchorRange(block, {
      quote: annotation.start_block_index === annotation.end_block_index ? annotation.quote : null,
      prefix: annotation.start_block_index === annotation.end_block_index ? annotation.prefix : null,
      suffix: annotation.start_block_index === annotation.end_block_index ? annotation.suffix : null,
      startOffset: start,
      endOffset: Math.min(end, block.textContent?.length ?? end),
    });
    if (range && Array.from(range.getClientRects()).some((rect) => event.clientX >= rect.left - 2 && event.clientX <= rect.right + 2 && event.clientY >= rect.top - 2 && event.clientY <= rect.bottom + 2)) {
      return annotation;
    }
  }
  const offset = characterOffsetAtPoint(block, event.clientX, event.clientY);
  if (offset === null) return null;
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    const annotation = annotations[index];
    if (annotation.message_id !== messageId || hasUnresolvedAnchor(annotation)) continue;
    if (annotation.start_block_index === null || annotation.end_block_index === null) continue;
    if (blockIndex < annotation.start_block_index || blockIndex > annotation.end_block_index) continue;
    const start = blockIndex === annotation.start_block_index ? annotation.start_offset ?? 0 : 0;
    const end = blockIndex === annotation.end_block_index ? annotation.end_offset ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    if (offset >= start && offset <= end) return annotation;
  }
  return null;
}

function characterOffsetAtPoint(root: HTMLElement, x: number, y: number): number | null {
  const caretDocument = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = caretDocument.caretPositionFromPoint?.(x, y);
  const range = position ? null : caretDocument.caretRangeFromPoint?.(x, y) ?? null;
  const node = position?.offsetNode ?? range?.startContainer ?? null;
  const offset = position?.offset ?? range?.startOffset ?? 0;
  if (!node || !root.contains(node)) return null;
  return characterOffset(root, node, offset);
}

function hasUnresolvedAnchor(annotation: AnnotationRead): boolean {
  return annotation.anchor_status === "orphaned" || annotation.anchor_status === "needs_review";
}

function defaultPanel(): PanelState {
  const safeLeft = panelSafeLeft();
  const width = Math.min(400, Math.max(1, window.innerWidth - safeLeft - PANEL_MARGIN));
  const height = Math.min(620, Math.max(1, window.innerHeight - 72 - PANEL_MARGIN));
  return clampPanel({ x: window.innerWidth - width - 28, y: 72, width, height });
}

function clampPanel(panel: PanelState): PanelState {
  const safeLeft = panelSafeLeft();
  const safeTop = 64;
  const maxWidth = Math.max(1, window.innerWidth - safeLeft - PANEL_MARGIN);
  const maxHeight = Math.max(1, window.innerHeight - safeTop - PANEL_MARGIN);
  const width = clamp(panel.width, Math.min(PANEL_MIN_WIDTH, maxWidth), maxWidth);
  const height = clamp(panel.height, Math.min(PANEL_MIN_HEIGHT, maxHeight), maxHeight);
  return {
    width,
    height,
    x: clamp(panel.x, safeLeft, Math.max(safeLeft, window.innerWidth - width - PANEL_MARGIN)),
    y: clamp(panel.y, safeTop, Math.max(safeTop, window.innerHeight - height - PANEL_MARGIN)),
  };
}

function panelSafeLeft(): number {
  const sidebar = document.querySelector<HTMLElement>("[data-reader-primary-sidebar]");
  const rect = sidebar?.getBoundingClientRect();
  return rect && rect.width > 0 && rect.right > PANEL_MARGIN ? Math.min(window.innerWidth - PANEL_MARGIN, rect.right + 12) : PANEL_MARGIN;
}

function localizedAnnotationType(type: AnnotationType, zh: boolean): string {
  const labels: Record<AnnotationType, [string, string]> = {
    highlight: ["高亮", "Highlight"], underline: ["下划线", "Underline"], strikethrough: ["删除线", "Strikethrough"], comment: ["评论", "Comment"], bookmark: ["书签", "Bookmark"],
  };
  return labels[type][zh ? 0 : 1];
}

function localizedColor(color: AnnotationColor, zh: boolean): string {
  const labels: Record<AnnotationColor, [string, string]> = { yellow: ["黄色", "Yellow"], green: ["绿色", "Green"], blue: ["蓝色", "Blue"], pink: ["粉色", "Pink"] };
  return labels[color][zh ? 0 : 1];
}

function readStoredPanel(): PanelState | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PANEL_STORAGE_KEY) ?? "null") as Partial<PanelState> | null;
    if (!parsed || ![parsed.x, parsed.y, parsed.width, parsed.height].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
    return parsed as PanelState;
  } catch {
    return null;
  }
}

function writeStoredPanel(panel: PanelState) {
  try {
    window.localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify({
      x: Math.round(panel.x),
      y: Math.round(panel.y),
      width: Math.round(panel.width),
      height: Math.round(panel.height),
    }));
  } catch {
    // Storage can be unavailable in private browsing; resizing still works for the session.
  }
}

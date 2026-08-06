"use client";

import { ArrowLeft, ArrowRight, BookmarkPlus, Check, CheckSquare2, GripVertical, Highlighter, Maximize2, MessageSquareText, Minimize2, Pin, PinOff, Plus, RotateCcw, Search, Square, Trash2, Underline, Strikethrough, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { AnnotationRepository } from "../../lib/annotation-repository";
import type { AnnotationColor, AnnotationRead, AnnotationType, MessageListItem, NavigateTarget, NavigationResult, NotebookBlock, NotebookRead } from "../../lib/types";
import { MarkdownRenderer } from "../conversations/markdown-renderer";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { usePreferences } from "../../components/preferences-provider";
import { getRenderedBlocks, subscribeRenderedBlocks } from "../conversations/rendered-block-registry";
import { resolveTextAnchorRange } from "../conversations/text-anchor";

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

export function AnnotationWorkspace({ conversationId, messages, activeMessageId, initialAnnotationId, repository, open, onOpenChange, onNavigate }: {
  conversationId: string;
  messages: MessageListItem[];
  activeMessageId: string | null;
  initialAnnotationId?: string | null;
  repository: AnnotationRepository;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onNavigate: (target: NavigateTarget) => NavigationResult | Promise<NavigationResult>;
}) {
  const dialog = useInteractionDialog();
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const [annotations, setAnnotations] = useState<AnnotationRead[]>([]);
  const [notebook, setNotebook] = useState<NotebookRead | null>(null);
  const [notebookConflicts, setNotebookConflicts] = useState<NotebookRead[]>([]);
  const [selection, setSelection] = useState<SelectionDraft | null>(null);
  const [selectionType, setSelectionType] = useState<Exclude<AnnotationType, "bookmark">>("highlight");
  const [view, setView] = useState<"current" | "all" | "notebook">("current");
  const [annotationQuery, setAnnotationQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<AnnotationType | "all">("all");
  const [colorFilter, setColorFilter] = useState<AnnotationColor | "all">("all");
  const [statusFilter, setStatusFilter] = useState<AnnotationRead["anchor_status"] | "all">("all");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<Set<string>>(new Set());
  const [batchType, setBatchType] = useState<Exclude<AnnotationType, "bookmark">>("highlight");
  const [batchColor, setBatchColor] = useState<AnnotationColor>("yellow");
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | null>(null);
  const [navigationFeedback, setNavigationFeedback] = useState<{ status: "idle" | "loading" | "failed" | "stale"; target: NavigateTarget | null }>({ status: "idle", target: null });
  const [contextAnnotation, setContextAnnotation] = useState<{ annotation: AnnotationRead; x: number; y: number } | null>(null);
  const [panelPinned, setPanelPinned] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [reviewMode, setReviewMode] = useState<"continuous" | "single">("continuous");
  const [reviewIndex, setReviewIndex] = useState(0);
  const [desktop, setDesktop] = useState(false);
  const [panel, setPanel] = useState<PanelState>({ x: 0, y: 72, width: 400, height: 620 });
  const panelRef = useRef(panel);
  const dragRef = useRef<{ type: DragType; startX: number; startY: number; panel: PanelState } | null>(null);
  const focusedMessageId = activeMessageId;

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
  }, [initialAnnotationId]);

  const reload = useCallback(async () => {
    const [annotationRows, notebookRow, conflictRows] = await Promise.all([
      repository.list(conversationId),
      repository.getNotebook(conversationId),
      repository.listNotebookConflicts(conversationId),
    ]);
    setAnnotations(annotationRows);
    setNotebook(notebookRow);
    setNotebookConflicts(conflictRows);
  }, [conversationId, repository]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => {
      setDesktop(media.matches);
      if (!media.matches) {
        setPanelPinned(false);
        return;
      }
      const stored = readStoredPanel();
      setPanelPinned(window.localStorage.getItem("chat-reader:annotation-workspace-mode") === "docked");
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
    const updateMode = (event: Event) => setPanelPinned(desktop && (event as CustomEvent<string>).detail === "docked");
    window.addEventListener("chat-reader:annotation-workspace-mode-change", updateMode);
    return () => window.removeEventListener("chat-reader:annotation-workspace-mode-change", updateMode);
  }, [desktop]);

  useEffect(() => {
    const captureKeyboardSelection = () => {
      window.setTimeout(() => {
        const next = captureSelection(messages);
        setSelection(next);
      }, 0);
    };
    const capturePointerSelection = (event: MouseEvent) => {
      window.setTimeout(() => {
        const next = captureSelection(messages);
        setSelection(next);
        if (next) return;
        if (!desktop) return;
        const annotation = annotationAtPoint(event, annotations);
        if (!annotation) return;
        setFocusedAnnotationId(annotation.id);
        setView("all");
        onOpenChange(true);
        setContextAnnotation({
          annotation,
          x: clamp(event.clientX + 12, 8, window.innerWidth - 300),
          y: clamp(event.clientY + 12, 8, window.innerHeight - 180),
        });
      }, 0);
    };
    let selectionTimer = 0;
    const captureNativeSelection = () => {
      window.clearTimeout(selectionTimer);
      selectionTimer = window.setTimeout(() => {
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
  }, [annotations, desktop, messages, onOpenChange]);

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

  useEffect(() => {
    if (!open || !focusedAnnotationId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`annotation-${focusedAnnotationId}`)?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedAnnotationId, open, view]);

  async function createTextAnnotation(annotationType: Exclude<AnnotationType, "bookmark">, color: AnnotationColor) {
    if (!selection) return;
    const comment = annotationType === "comment"
      ? await dialog.prompt({
          title: zh ? "添加评论" : "Add comment",
          label: zh ? "评论" : "Comment",
          placeholder: zh ? "输入 Markdown 评论" : "Write a Markdown comment",
          confirmLabel: zh ? "创建" : "Create",
        })
      : "";
    if (annotationType === "comment" && !comment) return;
    const message = messages.find((item) => item.id === selection.messageId);
    const created = await repository.create(conversationId, {
      annotation_type: annotationType,
      color,
      message_id: selection.messageId,
      message_version_id: selection.messageVersionId,
      start_block_index: selection.startBlockIndex,
      start_offset: selection.startOffset,
      end_block_index: selection.endBlockIndex,
      end_offset: selection.endOffset,
      quote: selection.quote,
      prefix: selection.prefix,
      suffix: selection.suffix,
      comment_markdown: comment ?? "",
      metadata: message ? { message_role: message.role, message_order_key: message.order_key, message_role_number: message.ordinal ?? null } : {},
    });
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setView("current");
    setFocusedAnnotationId(created.id);
    onOpenChange(true);
    await reload();
  }

  async function createBookmark(message: MessageListItem) {
    await repository.create(conversationId, {
      annotation_type: "bookmark",
      message_id: message.id,
      message_version_id: message.current_version?.id ?? null,
      quote: null,
      color: null,
      metadata: { message_role: message.role, message_order_key: message.order_key, message_role_number: message.ordinal ?? null },
    });
    onOpenChange(true);
    await reload();
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
    const available = new Set(annotations.map((item) => item.id));
    setSelectedAnnotationIds((current) => new Set(Array.from(current).filter((id) => available.has(id))));
  }, [annotations]);

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
    const targets = annotations.filter((item) => annotationIds.has(item.id));
    if (!targets.length) return;
    const confirmed = await dialog.confirm({
      title: targets.length === 1 ? "删除这条批注？" : `删除 ${targets.length} 条批注？`,
      description: "正文高亮和精选笔记中的对应引用也会移除。离线修改会在恢复联网后同步。",
      confirmLabel: "删除",
      danger: true,
    });
    if (!confirmed) return;
    if (notebook) {
      const nextBlocks = notebook.blocks.filter((block) => !block.annotation_id || !annotationIds.has(block.annotation_id));
      if (nextBlocks.length !== notebook.blocks.length) {
        setNotebook(await repository.saveNotebook(notebook, nextBlocks));
      }
    }
    for (const annotation of targets) await repository.delete(annotation);
    setSelectedAnnotationIds(new Set());
    setFocusedAnnotationId(null);
    setContextAnnotation(null);
    await reload();
  }

  async function updateAnnotationStyle(annotation: AnnotationRead, annotationType: Exclude<AnnotationType, "bookmark">, color: AnnotationColor) {
    if (!desktop || annotation.annotation_type === "bookmark") return;
    await repository.update(annotation, { annotation_type: annotationType, color });
    setContextAnnotation(null);
    await reload();
  }

  async function applyBatchStyle() {
    const targets = annotations.filter((item) => selectedAnnotationIds.has(item.id) && item.annotation_type !== "bookmark");
    for (const annotation of targets) {
      await repository.update(annotation, { annotation_type: batchType, color: batchColor });
    }
    await reload();
  }

  async function addSelectedToNotebook() {
    if (!notebook || !selectedAnnotationIds.size) return;
    const existing = new Set(notebook.blocks.flatMap((block) => block.annotation_id ? [block.annotation_id] : []));
    const additions = visibleAnnotations
      .filter((annotation) => selectedAnnotationIds.has(annotation.id) && !existing.has(annotation.id))
      .map((annotation) => ({ id: crypto.randomUUID(), type: "annotation_reference" as const, annotation_id: annotation.id }));
    if (!additions.length) return;
    setNotebook(await repository.saveNotebook(notebook, [...notebook.blocks, ...additions]));
    setView("notebook");
  }

  async function addAnnotationToNotebook(annotation: AnnotationRead) {
    if (!notebook || notebook.blocks.some((block) => block.annotation_id === annotation.id)) return;
    setNotebook(await repository.saveNotebook(notebook, [
      ...notebook.blocks,
      { id: crypto.randomUUID(), type: "annotation_reference", annotation_id: annotation.id },
    ]));
    setView("notebook");
    setContextAnnotation(null);
  }

  function toggleSelected(annotationId: string) {
    setSelectedAnnotationIds((current) => {
      const next = new Set(current);
      if (next.has(annotationId)) next.delete(annotationId);
      else next.add(annotationId);
      return next;
    });
  }

  async function navigateFromAnnotation(target: NavigateTarget) {
    setNavigationFeedback({ status: "loading", target });
    const result = await onNavigate(target);
    if (result.ok) {
      setNavigationFeedback({ status: result.fallback ? "stale" : "idle", target });
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

  return <>
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
      onClose={() => setContextAnnotation(null)}
      onNavigate={() => { setContextAnnotation(null); void navigateFromAnnotation(annotationNavigateTarget(contextAnnotation.annotation)); }}
      onDelete={() => void deleteAnnotations(new Set([contextAnnotation.annotation.id]))}
      onStyle={(type, color) => void updateAnnotationStyle(contextAnnotation.annotation, type, color)}
      onAddToNotebook={() => void addAnnotationToNotebook(contextAnnotation.annotation)}
      onSelect={() => { setSelectionMode(true); setSelectedAnnotationIds((current) => new Set(current).add(contextAnnotation.annotation.id)); setContextAnnotation(null); }}
    /> : null}
    {open ? <section className={`fixed z-[110] flex min-h-0 flex-col overflow-hidden border border-ui bg-raised shadow-2xl ${panelPinned && desktop ? "inset-y-0 left-0 w-[min(22rem,32vw)] rounded-none" : "inset-x-2 bottom-2 top-16 rounded-md md:inset-auto"}`} style={desktop && !panelPinned ? { left: panel.x, top: panel.y, width: panel.width, height: panel.height } : undefined} aria-label="批注" data-annotation-mode={panelPinned && desktop ? "docked" : "floating"}>
      <header className="flex h-12 shrink-0 touch-none items-center gap-2 border-b border-ui px-3" onPointerDown={(event) => { if (panelPinned || (event.target as HTMLElement).closest("button")) return; beginPanelDrag("move", event); }}><MessageSquareText className="h-4 w-4 text-accent" /><h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{zh ? "批注" : "Annotations"}</h2>{desktop && !panelPinned ? <button type="button" onClick={resetPanelPosition} className="flex h-8 w-8 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={zh ? "重置批注窗口位置" : "Reset annotation window position"} title={zh ? "重置位置" : "Reset position"}><RotateCcw className="h-4 w-4" /></button> : null}{desktop ? <button type="button" onClick={() => { const next = !panelPinned; setPanelPinned(next); window.localStorage.setItem("chat-reader:annotation-workspace-mode", next ? "docked" : "floating"); }} className="flex h-8 w-8 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={panelPinned ? (zh ? "恢复为浮窗" : "Return to floating") : (zh ? "固定到左侧栏" : "Dock to the left")} title={panelPinned ? (zh ? "恢复为浮窗" : "Return to floating") : (zh ? "固定到左侧栏" : "Dock to the left")}>{panelPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}</button> : null}<button type="button" onClick={() => setExpanded(true)} className="flex h-8 w-8 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={zh ? "展开批注阅读" : "Expand annotation reading"} title={zh ? "展开阅读" : "Expand reading"}><Maximize2 className="h-4 w-4" /></button><button type="button" onClick={() => onOpenChange(false)} className="flex h-8 w-8 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={zh ? "关闭" : "Close"}><X className="h-4 w-4" /></button></header>
      <div className="grid shrink-0 grid-cols-3 border-b border-ui bg-subtle p-1">{(["current", "all", "notebook"] as const).map((item) => <button key={item} type="button" onClick={() => setView(item)} className={`min-h-9 rounded px-2 text-xs font-medium ${view === item ? "bg-surface text-primary shadow-sm" : "text-secondary"}`}>{item === "current" ? (zh ? "当前消息" : "Current") : item === "all" ? (zh ? "全部批注" : "All") : (zh ? "精选笔记" : "Notes")}</button>)}</div>
      {navigationFeedback.status !== "idle" ? <div className={`flex shrink-0 items-center gap-2 border-b border-ui px-3 py-2 text-xs ${navigationFeedback.status === "failed" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : navigationFeedback.status === "stale" ? "bg-amber-50 text-amber-800" : "bg-subtle text-accent"}`} role="status"><span className="min-w-0 flex-1">{navigationFeedback.status === "loading" ? "正在按对话与章节位置加载批注原文…" : navigationFeedback.status === "stale" ? "原文已更改，已定位到最近的段落或消息。" : "无法定位批注原文，当前正文保持不变。"}</span>{navigationFeedback.status === "failed" && navigationFeedback.target ? <button type="button" onClick={() => void navigateFromAnnotation(navigationFeedback.target as NavigateTarget)} className="shrink-0 font-semibold underline">重试</button> : null}</div> : null}
      {view !== "notebook" ? <div className="mx-3 mt-3 grid shrink-0 grid-cols-2 gap-2"><label className="col-span-2 flex min-h-9 min-w-0 items-center gap-2 rounded-md border border-ui bg-page px-2"><Search className="h-4 w-4 text-secondary" /><input value={annotationQuery} onChange={(event) => setAnnotationQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder={zh ? "搜索批注" : "Search annotations"} /></label><select aria-label={zh ? "批注类型" : "Annotation type"} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as AnnotationType | "all")} className="min-h-9 min-w-0 rounded-md border border-ui bg-page px-2 text-xs"><option value="all">{zh ? "全部类型" : "All types"}</option>{TEXT_TYPES.map((type) => <option key={type.value} value={type.value}>{localizedAnnotationType(type.value, zh)}</option>)}<option value="bookmark">{localizedAnnotationType("bookmark", zh)}</option></select><select aria-label={zh ? "批注颜色" : "Annotation color"} value={colorFilter} onChange={(event) => setColorFilter(event.target.value as AnnotationColor | "all")} className="min-h-9 min-w-0 rounded-md border border-ui bg-page px-2 text-xs"><option value="all">{zh ? "全部颜色" : "All colors"}</option>{COLORS.map((color) => <option key={color.value} value={color.value}>{localizedColor(color.value, zh)}</option>)}</select><select aria-label={zh ? "锚点状态" : "Anchor status"} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AnnotationRead["anchor_status"] | "all")} className="min-h-9 min-w-0 rounded-md border border-ui bg-page px-2 text-xs"><option value="all">{zh ? "全部状态" : "All status"}</option><option value="valid">{zh ? "正常" : "Valid"}</option><option value="remapped">{zh ? "已重定位" : "Remapped"}</option><option value="needs_review">{zh ? "需要检查" : "Needs review"}</option><option value="orphaned">{zh ? "原文缺失" : "Orphaned"}</option></select>{desktop ? <button type="button" onClick={() => { setSelectionMode((current) => !current); setSelectedAnnotationIds(new Set()); }} className={`min-h-9 rounded-md border px-3 text-xs font-medium ${selectionMode ? "border-[var(--accent)] bg-[var(--accent-soft)] text-accent" : "border-ui text-secondary hover:bg-subtle"}`}>{selectionMode ? (zh ? "完成" : "Done") : (zh ? "管理" : "Manage")}</button> : null}</div> : null}
      {view !== "notebook" && selectionMode ? <div className="mx-3 mt-2 flex flex-wrap items-center gap-2 border-b border-ui pb-2 text-xs"><button type="button" onClick={() => setSelectedAnnotationIds(new Set(visibleAnnotations.map((item) => item.id)))} className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-secondary hover:bg-subtle"><CheckSquare2 className="h-4 w-4" />{zh ? "全选" : "Select all"}</button><button type="button" onClick={() => setSelectedAnnotationIds((current) => new Set(visibleAnnotations.filter((item) => !current.has(item.id)).map((item) => item.id)))} className="inline-flex min-h-8 items-center rounded-md px-2 text-secondary hover:bg-subtle">{zh ? "反选" : "Invert"}</button><button type="button" onClick={() => setSelectedAnnotationIds(new Set())} className="inline-flex min-h-8 items-center rounded-md px-2 text-secondary hover:bg-subtle">{zh ? "清除" : "Clear"}</button><span className="min-w-0 flex-1 text-secondary">{zh ? `已选 ${selectedAnnotationIds.size} 项` : `${selectedAnnotationIds.size} selected`}</span><select value={batchType} onChange={(event) => setBatchType(event.target.value as Exclude<AnnotationType, "bookmark">)} className="min-h-8 rounded-md border border-ui bg-page px-2 text-xs">{TEXT_TYPES.map((type) => <option key={type.value} value={type.value}>{localizedAnnotationType(type.value, zh)}</option>)}</select><AnnotationColorPicker value={batchColor} onChange={setBatchColor} zh={zh} /><button type="button" disabled={!selectedAnnotationIds.size} onClick={() => void applyBatchStyle()} className="min-h-8 rounded-md border border-ui px-2 text-secondary disabled:opacity-40">{zh ? "应用样式" : "Apply style"}</button><button type="button" disabled={!selectedAnnotationIds.size} onClick={() => void addSelectedToNotebook()} className="min-h-8 rounded-md border border-ui px-2 text-accent disabled:opacity-40">{zh ? "加入精选笔记" : "Add to notes"}</button><button type="button" disabled={!selectedAnnotationIds.size} onClick={() => void deleteAnnotations(selectedAnnotationIds)} className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 font-medium text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-40"><Trash2 className="h-4 w-4" />{zh ? "删除" : "Delete"}</button></div> : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{view === "notebook" ? <NotebookView notebook={notebook} conflicts={notebookConflicts} annotations={annotations} editable={desktop} onSave={async (blocks) => { if (!notebook) return; setNotebook(await repository.saveNotebook(notebook, blocks)); }} onNavigate={navigateFromAnnotation} /> : <AnnotationList items={visibleAnnotations} editable={desktop} messages={messages} focusedAnnotationId={focusedAnnotationId} selectionMode={selectionMode} selectedAnnotationIds={selectedAnnotationIds} onToggleSelected={toggleSelected} onNavigate={navigateFromAnnotation} onUpdate={async (annotation, comment) => { await repository.update(annotation, { comment_markdown: comment }); await reload(); }} onStyle={updateAnnotationStyle} onDelete={(annotation) => deleteAnnotations(new Set([annotation.id]))} onAddToNotebook={addAnnotationToNotebook} />}</div>
      {desktop ? <><button type="button" role="separator" aria-orientation="vertical" className="absolute bottom-0 left-0 top-12 z-20 w-2 cursor-col-resize touch-none bg-transparent hover:bg-[var(--accent)] focus:bg-[var(--accent)] focus:outline-none" onPointerDown={(event) => beginPanelDrag("resize-left", event)} onDoubleClick={() => { const next = defaultPanel(); panelRef.current = next; setPanel(next); writeStoredPanel(next); }} aria-label="从左侧调整批注窗口宽度" /><button type="button" role="separator" aria-orientation="vertical" className="absolute bottom-0 right-0 top-12 z-20 w-2 cursor-col-resize touch-none bg-transparent hover:bg-[var(--accent)] focus:bg-[var(--accent)] focus:outline-none" onPointerDown={(event) => beginPanelDrag("resize-right", event)} aria-label="从右侧调整批注窗口宽度" /><button type="button" role="separator" aria-orientation="horizontal" className="absolute bottom-0 left-0 right-6 z-20 h-2 cursor-row-resize touch-none bg-transparent hover:bg-[var(--accent)] focus:bg-[var(--accent)] focus:outline-none" onPointerDown={(event) => beginPanelDrag("resize-bottom", event)} aria-label="调整批注窗口高度" /><button type="button" className="absolute bottom-0 right-0 z-30 flex h-6 w-6 cursor-se-resize items-end justify-end p-0.5 text-secondary" onPointerDown={(event) => beginPanelDrag("resize-bottom-right", event)} aria-label="调整批注窗口大小"><Maximize2 className="h-3.5 w-3.5" /></button></> : null}
    </section> : null}
    {open && expanded ? <section className="fixed inset-0 z-[150] flex min-h-0 flex-col bg-raised" aria-label={zh ? "批注阅读" : "Annotation reading"} data-annotation-mode="expanded">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-ui px-4"><MessageSquareText className="h-5 w-5 text-accent" /><h2 className="min-w-0 flex-1 truncate text-base font-semibold">{zh ? "批注阅读" : "Annotation reading"}</h2><button type="button" onClick={() => setExpanded(false)} className="inline-flex h-9 items-center gap-1 rounded-md border border-ui px-2 text-xs text-secondary hover:bg-subtle" aria-label={zh ? "退出展开阅读" : "Exit expanded reading"}><Minimize2 className="h-4 w-4" />{zh ? "退出" : "Exit"}</button><button type="button" onClick={() => { setExpanded(false); onOpenChange(false); }} className="flex h-9 w-9 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={zh ? "关闭" : "Close"}><X className="h-4 w-4" /></button></header>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ui px-4 py-3"><div className="flex items-center gap-1 rounded-md bg-subtle p-1"><button type="button" onClick={() => { setReviewMode("continuous"); setReviewIndex(0); }} className={`min-h-8 rounded px-3 text-xs ${reviewMode === "continuous" ? "bg-surface font-medium text-primary shadow-sm" : "text-secondary"}`}>{zh ? "连续阅读" : "Continuous"}</button><button type="button" onClick={() => { setReviewMode("single"); setReviewIndex(0); }} className={`min-h-8 rounded px-3 text-xs ${reviewMode === "single" ? "bg-surface font-medium text-primary shadow-sm" : "text-secondary"}`}>{zh ? "逐条回顾" : "Review one by one"}</button></div><div className="flex min-w-0 flex-1 items-center gap-2"><span className="text-xs text-secondary">{view === "notebook" ? (notebook?.title || (zh ? "精选笔记" : "Notes")) : `${visibleAnnotations.length} ${zh ? "条批注" : "annotations"}`}</span></div>{view !== "notebook" ? <div className="flex items-center gap-2"><select aria-label={zh ? "批注类型" : "Annotation type"} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as AnnotationType | "all")} className="min-h-9 rounded-md border border-ui bg-page px-2 text-xs"><option value="all">{zh ? "全部类型" : "All types"}</option>{TEXT_TYPES.map((type) => <option key={type.value} value={type.value}>{localizedAnnotationType(type.value, zh)}</option>)}<option value="bookmark">{localizedAnnotationType("bookmark", zh)}</option></select><button type="button" onClick={() => setView("notebook")} className="min-h-9 rounded-md border border-ui px-3 text-xs text-accent hover:bg-subtle">{zh ? "精选笔记" : "Notes"}</button></div> : <button type="button" onClick={() => setView("all")} className="min-h-9 rounded-md border border-ui px-3 text-xs text-accent hover:bg-subtle">{zh ? "全部批注" : "All annotations"}</button>}</div>
      <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-4xl p-4 md:p-8">{view === "notebook" ? <NotebookView notebook={notebook} conflicts={notebookConflicts} annotations={annotations} editable={desktop} onSave={async (blocks, title) => { if (!notebook) return; setNotebook(await repository.saveNotebook(notebook, blocks, title)); }} onNavigate={navigateFromAnnotation} /> : <AnnotationList items={visibleAnnotations} editable={desktop} messages={messages} focusedAnnotationId={focusedAnnotationId} selectionMode={selectionMode} selectedAnnotationIds={selectedAnnotationIds} onToggleSelected={toggleSelected} onNavigate={navigateFromAnnotation} onUpdate={async (annotation, comment) => { await repository.update(annotation, { comment_markdown: comment }); await reload(); }} onStyle={updateAnnotationStyle} onDelete={(annotation) => deleteAnnotations(new Set([annotation.id]))} onAddToNotebook={addAnnotationToNotebook} reviewMode={reviewMode} reviewIndex={reviewIndex} onReviewIndexChange={setReviewIndex} />}</div></div>
    </section> : null}
  </>;
}

function AnnotationList({ items, editable, messages, focusedAnnotationId, selectionMode, selectedAnnotationIds, onToggleSelected, onNavigate, onUpdate, onStyle, onDelete, onAddToNotebook, reviewMode = "continuous", reviewIndex = 0, onReviewIndexChange }: {
  items: AnnotationRead[];
  editable: boolean;
  messages: MessageListItem[];
  focusedAnnotationId: string | null;
  selectionMode: boolean;
  selectedAnnotationIds: Set<string>;
  onToggleSelected: (annotationId: string) => void;
  onNavigate: (target: NavigateTarget) => void | Promise<unknown>;
  onUpdate: (annotation: AnnotationRead, comment: string) => Promise<void>;
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
        <button type="button" onClick={() => selectionMode ? onToggleSelected(annotation.id) : void onNavigate(annotationNavigateTarget(annotation, blockIndex))} className="min-w-0 flex-1 px-1 text-left">
         <div className="flex flex-wrap items-center gap-2 text-xs text-secondary"><span className={`h-2.5 w-2.5 rounded-full ${colorClass(annotation.color)}`} /><span>{label}</span><span className="rounded bg-subtle px-1.5 py-0.5">{localizedAnnotationType(annotation.annotation_type, zh)}</span>{sectionTitle ? <span className="min-w-0 truncate">{sectionTitle}</span> : null}{hasUnresolvedAnchor(annotation) ? <span className="text-[var(--danger)]">{zh ? "原文需要检查" : "Source needs review"}</span> : null}{annotation.conflict_of_id ? <span className="text-amber-600">{zh ? "冲突副本" : "Conflict copy"}</span> : null}</div>
          <blockquote data-annotation-color={annotation.color ?? "yellow"} className="annotation-quote mt-2 border-l-2 px-3 py-2 text-sm leading-6 text-primary">{annotation.quote || "整条消息书签"}</blockquote>
        </button>
        {editable && !selectionMode ? <button type="button" onClick={() => void onDelete(annotation)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]" aria-label={zh ? "删除批注" : "Delete annotation"} title={zh ? "删除批注" : "Delete annotation"}><Trash2 className="h-4 w-4" /></button> : null}
      </div>
       {editable ? <div className="mt-2 flex flex-wrap items-center gap-2"><select value={annotation.annotation_type === "bookmark" ? "bookmark" : annotation.annotation_type} disabled={annotation.annotation_type === "bookmark"} onChange={(event) => void onStyle(annotation, event.target.value as Exclude<AnnotationType, "bookmark">, annotation.color ?? "yellow")} className="min-h-8 rounded-md border border-ui bg-page px-2 text-xs">{TEXT_TYPES.map((type) => <option key={type.value} value={type.value}>{localizedAnnotationType(type.value, zh)}</option>)}{annotation.annotation_type === "bookmark" ? <option value="bookmark">{localizedAnnotationType("bookmark", zh)}</option> : null}</select><AnnotationColorPicker value={annotation.color ?? "yellow"} disabled={annotation.annotation_type === "bookmark"} onChange={(color) => void onStyle(annotation, annotation.annotation_type as Exclude<AnnotationType, "bookmark">, color)} zh={zh} /></div> : null}
       {editable ? <textarea key={`${annotation.id}:${annotation.revision}`} autoFocus={focusedAnnotationId === annotation.id && annotation.annotation_type === "comment"} defaultValue={annotation.comment_markdown} onBlur={(event) => { if (event.target.value !== annotation.comment_markdown) void onUpdate(annotation, event.target.value); }} className="mt-2 min-h-20 w-full resize-y rounded-md border border-ui bg-page px-3 py-2 text-sm outline-none focus:border-[var(--accent)]" placeholder={zh ? "Markdown 评论" : "Markdown comment"} /> : annotation.comment_markdown ? <div className="mt-2 text-sm"><MarkdownRenderer text={annotation.comment_markdown} /></div> : null}
       {editable ? <button type="button" onClick={() => void onAddToNotebook(annotation)} className="mt-2 inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-accent hover:bg-subtle"><BookmarkPlus className="h-3.5 w-3.5" />{zh ? "加入精选笔记" : "Add to notes"}</button> : null}
    </article>;
  })}</div>;
}

function AnnotationContextMenu({ item, x, y, onClose, onNavigate, onDelete, onStyle, onAddToNotebook, onSelect }: {
  item: AnnotationRead;
  x: number;
  y: number;
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
  return <div className="fixed z-[130] w-64 rounded-md border border-ui bg-raised p-2 shadow-2xl" style={{ left: x, top: y }} role="dialog" aria-label="Annotation actions">
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

function annotationNavigateTarget(annotation: AnnotationRead, explicitBlockIndex?: number): NavigateTarget {
  const blockIndex = hasUnresolvedAnchor(annotation) ? undefined : explicitBlockIndex ?? annotation.start_block_index ?? undefined;
  return {
    messageId: annotation.message_id ?? "",
    messageVersionId: annotation.message_version_id,
    blockIndex,
    characterOffset: blockIndex === undefined ? undefined : annotation.start_offset ?? undefined,
    endCharacterOffset: blockIndex === undefined ? undefined : annotation.end_offset ?? undefined,
    quote: blockIndex === undefined ? null : annotation.quote,
    prefix: blockIndex === undefined ? null : annotation.prefix,
    suffix: blockIndex === undefined ? null : annotation.suffix,
    anchorStatus: annotation.anchor_status,
    annotationId: annotation.id,
    preferTocPipeline: true,
    allowMessageFallback: true,
    source: "annotation",
  };
}

function NotebookView({ notebook, conflicts, annotations, editable, onSave, onNavigate }: { notebook: NotebookRead | null; conflicts: NotebookRead[]; annotations: AnnotationRead[]; editable: boolean; onSave: (blocks: NotebookBlock[], title?: string | null) => Promise<void>; onNavigate: (target: NavigateTarget) => void | Promise<unknown> }) {
  const [blocks, setBlocks] = useState<NotebookBlock[]>(notebook?.blocks ?? []);
  const [title, setTitle] = useState(notebook?.title ?? "");
  const dragIndex = useRef<number | null>(null);
  useEffect(() => { setBlocks(notebook?.blocks ?? []); setTitle(notebook?.title ?? ""); }, [notebook]);
  async function persist(next: NotebookBlock[]) { setBlocks(next); await onSave(next); }
  async function persistTitle(nextTitle: string) { setTitle(nextTitle); await onSave(blocks, nextTitle || null); }
  return <div className="space-y-3">
    <div className="flex items-center gap-2 border-b border-ui pb-3"><input value={title} onChange={(event) => setTitle(event.target.value)} onBlur={(event) => { if ((notebook?.title ?? "") !== event.target.value) void persistTitle(event.target.value); }} placeholder="精选笔记" className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none" aria-label="Notebook title" />{notebook ? <span className="text-xs text-secondary">{blocks.length} items</span> : null}</div>
    {conflicts.map((conflict) => <section key={conflict.id} className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
      <p className="text-xs font-semibold">冲突副本 · {new Date(conflict.updated_at).toLocaleString()}</p>
      <p className="mt-1 text-xs opacity-80">{conflict.title || `${conflict.blocks.length} 个笔记块`}</p>
      {editable ? <button type="button" onClick={() => void persist([...blocks, ...conflict.blocks.map((block) => ({ ...block, id: crypto.randomUUID() }))])} className="mt-2 min-h-8 rounded-md border border-amber-400 px-2 text-xs font-medium">合并到当前笔记</button> : null}
    </section>)}
    {blocks.map((block, index) => {
      const annotation = block.annotation_id ? annotations.find((item) => item.id === block.annotation_id) : null;
      return <div key={block.id} draggable={editable} onDragStart={() => { dragIndex.current = index; }} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragIndex.current === null || dragIndex.current === index) return; const next = [...blocks]; const [moved] = next.splice(dragIndex.current, 1); next.splice(index, 0, moved); dragIndex.current = null; void persist(next); }} className="group flex gap-2 border-b border-ui pb-3 last:border-0">
        {editable ? <GripVertical className="mt-2 h-4 w-4 shrink-0 cursor-grab text-secondary" /> : null}
        <div className="min-w-0 flex-1">{block.type === "markdown" ? editable ? <textarea defaultValue={block.markdown ?? ""} onBlur={(event) => { const next = blocks.map((item) => item.id === block.id ? { ...item, markdown: event.target.value } : item); void persist(next); }} className="min-h-24 w-full resize-y rounded-md border border-ui bg-page px-3 py-2 text-sm outline-none" /> : <MarkdownRenderer text={block.markdown ?? ""} /> : annotation ? <button type="button" data-annotation-color={annotation.color ?? "yellow"} onClick={() => void onNavigate(annotationNavigateTarget(annotation))} className="annotation-quote w-full border-l-2 px-3 py-2 text-left text-sm leading-6">{annotation.quote || "整条消息书签"}</button> : <p className="text-sm text-[var(--danger)]">引用的批注不可用</p>}</div>{editable && block.type === "annotation_reference" ? <button type="button" onClick={() => void persist(blocks.filter((item) => item.id !== block.id))} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]" aria-label="Remove from notes" title="Remove from notes"><Trash2 className="h-4 w-4" /></button> : null}
      </div>;
    })}
    {editable ? <button type="button" onClick={() => void persist([...blocks, { id: crypto.randomUUID(), type: "markdown", markdown: "" }])} className="flex min-h-9 items-center gap-2 rounded-md border border-ui px-3 text-sm hover:bg-subtle"><Plus className="h-4 w-4" />插入说明</button> : null}
    {!blocks.length ? <p className="py-8 text-center text-sm text-secondary">暂无精选笔记</p> : null}
  </div>;
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

function annotationAtPoint(event: MouseEvent, annotations: AnnotationRead[]): AnnotationRead | null {
  const target = event.target instanceof Element ? event.target : null;
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

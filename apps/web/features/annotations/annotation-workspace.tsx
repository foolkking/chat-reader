"use client";

import { BookmarkPlus, CheckSquare2, GripVertical, Highlighter, Maximize2, MessageSquareText, Pin, PinOff, Plus, Search, Square, Trash2, Underline, Strikethrough, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { AnnotationRepository } from "../../lib/annotation-repository";
import type { AnnotationColor, AnnotationRead, AnnotationType, MessageListItem, NavigateTarget, NavigationResult, NotebookBlock, NotebookRead } from "../../lib/types";
import { MarkdownRenderer } from "../conversations/markdown-renderer";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";

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
  { value: "yellow", className: "bg-amber-300", label: "黄色高亮" },
  { value: "green", className: "bg-emerald-300", label: "绿色高亮" },
  { value: "blue", className: "bg-sky-300", label: "蓝色高亮" },
  { value: "pink", className: "bg-pink-300", label: "粉色高亮" },
];

const TEXT_TYPES: Array<{ value: Exclude<AnnotationType, "bookmark">; label: string; icon: typeof Highlighter }> = [
  { value: "highlight", label: "Highlight", icon: Highlighter },
  { value: "underline", label: "Underline", icon: Underline },
  { value: "strikethrough", label: "Strike", icon: Strikethrough },
  { value: "comment", label: "Comment", icon: MessageSquareText },
];

export function AnnotationWorkspace({ conversationId, messages, activeMessageId, repository, open, onOpenChange, onNavigate }: {
  conversationId: string;
  messages: MessageListItem[];
  activeMessageId: string | null;
  repository: AnnotationRepository;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onNavigate: (target: NavigateTarget) => NavigationResult | Promise<NavigationResult>;
}) {
  const dialog = useInteractionDialog();
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
  const [contextAnnotation, setContextAnnotation] = useState<{ annotation: AnnotationRead; x: number; y: number } | null>(null);
  const [lockedMessageId, setLockedMessageId] = useState<string | null>(null);
  const [panelPinned, setPanelPinned] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [panel, setPanel] = useState<PanelState>({ x: 0, y: 72, width: 400, height: 620 });
  const panelRef = useRef(panel);
  const dragRef = useRef<{ type: DragType; startX: number; startY: number; panel: PanelState } | null>(null);
  const focusedMessageId = panelPinned ? lockedMessageId : activeMessageId;

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
      if (!media.matches) return;
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
    if (!desktop) return;
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
    document.addEventListener("mouseup", capturePointerSelection);
    document.addEventListener("keyup", captureKeyboardSelection);
    return () => {
      document.removeEventListener("mouseup", capturePointerSelection);
      document.removeEventListener("keyup", captureKeyboardSelection);
    };
  }, [annotations, desktop, messages, onOpenChange]);

  useEffect(() => {
    applyCssHighlights(annotations);
    return clearCssHighlights;
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
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("resize", resize);
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
          title: "Add comment",
          label: "Comment",
          placeholder: "Write a Markdown comment",
          confirmLabel: "Create",
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
    const result = await onNavigate(target);
    if (!desktop && result.ok) onOpenChange(false);
  }

  return <>
    {selection && desktop ? <div className="fixed z-[120] flex max-w-[min(92vw,34rem)] flex-wrap items-center gap-1 rounded-md border border-ui bg-raised p-1.5 shadow-xl" style={{ left: clamp(selection.rect.left + selection.rect.width / 2 - 170, 8, window.innerWidth - 360), top: Math.max(8, selection.rect.top - 88) }} role="toolbar" aria-label="Create annotation">
      {TEXT_TYPES.map((type) => { const Icon = type.icon; return <button key={type.value} type="button" onClick={() => setSelectionType(type.value)} className={`inline-flex h-8 items-center gap-1 rounded px-2 text-xs ${selectionType === type.value ? "bg-[var(--accent-soft)] text-accent" : "text-secondary hover:bg-subtle"}`} aria-label={type.label} title={type.label}><Icon className="h-3.5 w-3.5" />{type.label}</button>; })}
      <span className="mx-1 h-5 w-px bg-[var(--border)]" />
      {COLORS.map((color) => <button key={color.value} type="button" onClick={() => void createTextAnnotation(selectionType, color.value)} className={`h-7 w-7 rounded ${color.className} ring-offset-2 hover:ring-2 hover:ring-[var(--focus)]`} aria-label={`Create ${selectionType} ${color.label}`} title={`Create ${selectionType} ${color.label}`} />)}
    </div> : null}
    {contextAnnotation && desktop ? <AnnotationContextMenu
      key={contextAnnotation.annotation.id}
      item={contextAnnotation.annotation}
      x={contextAnnotation.x}
      y={contextAnnotation.y}
      onClose={() => setContextAnnotation(null)}
      onNavigate={() => { setContextAnnotation(null); void navigateFromAnnotation({ messageId: contextAnnotation.annotation.message_id ?? "", blockIndex: contextAnnotation.annotation.start_block_index ?? undefined, characterOffset: contextAnnotation.annotation.start_offset ?? undefined, source: "message-action" }); }}
      onDelete={() => void deleteAnnotations(new Set([contextAnnotation.annotation.id]))}
      onStyle={(type, color) => void updateAnnotationStyle(contextAnnotation.annotation, type, color)}
      onAddToNotebook={() => void addAnnotationToNotebook(contextAnnotation.annotation)}
      onSelect={() => { setSelectionMode(true); setSelectedAnnotationIds((current) => new Set(current).add(contextAnnotation.annotation.id)); setContextAnnotation(null); }}
    /> : null}
    {open ? <section className="fixed inset-x-2 bottom-2 top-16 z-[110] flex min-h-0 flex-col overflow-hidden rounded-md border border-ui bg-raised shadow-2xl md:inset-auto" style={desktop ? { left: panel.x, top: panel.y, width: panel.width, height: panel.height } : undefined} aria-label="批注">
      <header className="flex h-12 shrink-0 touch-none items-center gap-2 border-b border-ui px-3" onPointerDown={(event) => { if ((event.target as HTMLElement).closest("button")) return; beginPanelDrag("move", event); }}><MessageSquareText className="h-4 w-4 text-accent" /><h2 className="min-w-0 flex-1 truncate text-sm font-semibold">批注</h2>{desktop ? <button type="button" onClick={() => { const next = !panelPinned; setPanelPinned(next); setLockedMessageId(next ? activeMessageId : null); }} className="flex h-8 w-8 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={panelPinned ? "取消固定当前消息" : "固定当前消息"} title={panelPinned ? "取消固定当前消息" : "固定当前消息"}>{panelPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}</button> : null}<button type="button" onClick={() => onOpenChange(false)} className="flex h-8 w-8 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label="关闭"><X className="h-4 w-4" /></button></header>
      <div className="grid shrink-0 grid-cols-3 border-b border-ui bg-subtle p-1">{(["current", "all", "notebook"] as const).map((item) => <button key={item} type="button" onClick={() => setView(item)} className={`min-h-9 rounded px-2 text-xs font-medium ${view === item ? "bg-surface text-primary shadow-sm" : "text-secondary"}`}>{item === "current" ? "当前消息" : item === "all" ? "全部批注" : "精选笔记"}</button>)}</div>
      {view !== "notebook" ? <div className="mx-3 mt-3 flex shrink-0 flex-wrap items-center gap-2"><label className="flex min-h-9 min-w-[12rem] flex-1 items-center gap-2 rounded-md border border-ui bg-page px-2"><Search className="h-4 w-4 text-secondary" /><input value={annotationQuery} onChange={(event) => setAnnotationQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="搜索批注" /></label><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as AnnotationType | "all")} className="min-h-9 rounded-md border border-ui bg-page px-2 text-xs"><option value="all">All types</option>{TEXT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}<option value="bookmark">Bookmark</option></select><select value={colorFilter} onChange={(event) => setColorFilter(event.target.value as AnnotationColor | "all")} className="min-h-9 rounded-md border border-ui bg-page px-2 text-xs"><option value="all">All colors</option>{COLORS.map((color) => <option key={color.value} value={color.value}>{color.label}</option>)}</select><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AnnotationRead["anchor_status"] | "all")} className="min-h-9 rounded-md border border-ui bg-page px-2 text-xs"><option value="all">All status</option><option value="active">Active</option><option value="relocated">Relocated</option><option value="stale">Changed</option></select>{desktop ? <button type="button" onClick={() => { setSelectionMode((current) => !current); setSelectedAnnotationIds(new Set()); }} className={`min-h-9 shrink-0 rounded-md border px-3 text-xs font-medium ${selectionMode ? "border-[var(--accent)] bg-[var(--accent-soft)] text-accent" : "border-ui text-secondary hover:bg-subtle"}`}>{selectionMode ? "Done" : "Manage"}</button> : null}</div> : null}
      {view !== "notebook" && selectionMode ? <div className="mx-3 mt-2 flex flex-wrap items-center gap-2 border-b border-ui pb-2 text-xs"><button type="button" onClick={() => setSelectedAnnotationIds(new Set(visibleAnnotations.map((item) => item.id)))} className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-secondary hover:bg-subtle"><CheckSquare2 className="h-4 w-4" />Select all</button><button type="button" onClick={() => setSelectedAnnotationIds((current) => new Set(visibleAnnotations.filter((item) => !current.has(item.id)).map((item) => item.id)))} className="inline-flex min-h-8 items-center rounded-md px-2 text-secondary hover:bg-subtle">Invert</button><button type="button" onClick={() => setSelectedAnnotationIds(new Set())} className="inline-flex min-h-8 items-center rounded-md px-2 text-secondary hover:bg-subtle">Clear</button><span className="min-w-0 flex-1 text-secondary">{selectedAnnotationIds.size} selected</span><select value={batchType} onChange={(event) => setBatchType(event.target.value as Exclude<AnnotationType, "bookmark">)} className="min-h-8 rounded-md border border-ui bg-page px-2 text-xs">{TEXT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select><select value={batchColor} onChange={(event) => setBatchColor(event.target.value as AnnotationColor)} className="min-h-8 rounded-md border border-ui bg-page px-2 text-xs">{COLORS.map((color) => <option key={color.value} value={color.value}>{color.label}</option>)}</select><button type="button" disabled={!selectedAnnotationIds.size} onClick={() => void applyBatchStyle()} className="min-h-8 rounded-md border border-ui px-2 text-secondary disabled:opacity-40">Apply style</button><button type="button" disabled={!selectedAnnotationIds.size} onClick={() => void addSelectedToNotebook()} className="min-h-8 rounded-md border border-ui px-2 text-accent disabled:opacity-40">Add to notes</button><button type="button" disabled={!selectedAnnotationIds.size} onClick={() => void deleteAnnotations(selectedAnnotationIds)} className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 font-medium text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-40"><Trash2 className="h-4 w-4" />Delete</button></div> : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{view === "notebook" ? <NotebookView notebook={notebook} conflicts={notebookConflicts} annotations={annotations} editable={desktop} onSave={async (blocks) => { if (!notebook) return; setNotebook(await repository.saveNotebook(notebook, blocks)); }} onNavigate={navigateFromAnnotation} /> : <AnnotationList items={visibleAnnotations} editable={desktop} messages={messages} focusedAnnotationId={focusedAnnotationId} selectionMode={selectionMode} selectedAnnotationIds={selectedAnnotationIds} onToggleSelected={toggleSelected} onNavigate={navigateFromAnnotation} onUpdate={async (annotation, comment) => { await repository.update(annotation, { comment_markdown: comment }); await reload(); }} onStyle={updateAnnotationStyle} onDelete={(annotation) => deleteAnnotations(new Set([annotation.id]))} onAddToNotebook={addAnnotationToNotebook} />}</div>
      {desktop ? <><button type="button" role="separator" aria-orientation="vertical" className="absolute bottom-0 left-0 top-12 z-20 w-2 cursor-col-resize touch-none bg-transparent hover:bg-[var(--accent)] focus:bg-[var(--accent)] focus:outline-none" onPointerDown={(event) => beginPanelDrag("resize-left", event)} onDoubleClick={() => { const next = defaultPanel(); panelRef.current = next; setPanel(next); writeStoredPanel(next); }} aria-label="从左侧调整批注窗口宽度" /><button type="button" role="separator" aria-orientation="vertical" className="absolute bottom-0 right-0 top-12 z-20 w-2 cursor-col-resize touch-none bg-transparent hover:bg-[var(--accent)] focus:bg-[var(--accent)] focus:outline-none" onPointerDown={(event) => beginPanelDrag("resize-right", event)} aria-label="从右侧调整批注窗口宽度" /><button type="button" role="separator" aria-orientation="horizontal" className="absolute bottom-0 left-0 right-6 z-20 h-2 cursor-row-resize touch-none bg-transparent hover:bg-[var(--accent)] focus:bg-[var(--accent)] focus:outline-none" onPointerDown={(event) => beginPanelDrag("resize-bottom", event)} aria-label="调整批注窗口高度" /><button type="button" className="absolute bottom-0 right-0 z-30 flex h-6 w-6 cursor-se-resize items-end justify-end p-0.5 text-secondary" onPointerDown={(event) => beginPanelDrag("resize-bottom-right", event)} aria-label="调整批注窗口大小"><Maximize2 className="h-3.5 w-3.5" /></button></> : null}
    </section> : null}
  </>;
}

function AnnotationList({ items, editable, messages, focusedAnnotationId, selectionMode, selectedAnnotationIds, onToggleSelected, onNavigate, onUpdate, onStyle, onDelete, onAddToNotebook }: {
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
}) {
  if (!items.length) return <p className="py-8 text-center text-sm text-secondary">暂无批注</p>;
  return <div className="space-y-4">{items.map((annotation) => {
    const message = messages.find((item) => item.id === annotation.message_id);
    const metadataRole = typeof annotation.metadata.message_role === "string" ? annotation.metadata.message_role : message?.role;
    const metadataNumber = typeof annotation.metadata.message_role_number === "number" ? annotation.metadata.message_role_number : message?.ordinal;
    const sectionTitle = typeof annotation.metadata.section_title === "string" ? annotation.metadata.section_title : null;
    const label = `${metadataRole === "user" ? "U" : "A"}${metadataNumber ?? ""}`;
    const blockIndex = annotation.anchor_status === "stale" ? undefined : annotation.start_block_index ?? undefined;
    const selected = selectedAnnotationIds.has(annotation.id);
    return <article id={`annotation-${annotation.id}`} key={annotation.id} className={`rounded-sm border-b border-ui pb-4 last:border-0 ${focusedAnnotationId === annotation.id ? "bg-[var(--accent-soft)] ring-2 ring-[var(--focus)]" : ""}`}>
      <div className="flex items-start gap-1">
        {selectionMode ? <button type="button" onClick={() => onToggleSelected(annotation.id)} className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={selected ? "取消选择批注" : "选择批注"}>{selected ? <CheckSquare2 className="h-4 w-4 text-accent" /> : <Square className="h-4 w-4" />}</button> : null}
        <button type="button" onClick={() => selectionMode ? onToggleSelected(annotation.id) : void onNavigate({ messageId: annotation.message_id ?? "", blockIndex, characterOffset: blockIndex === undefined ? undefined : annotation.start_offset ?? undefined, source: "message-action" })} className="min-w-0 flex-1 px-1 text-left">
         <div className="flex flex-wrap items-center gap-2 text-xs text-secondary"><span className={`h-2.5 w-2.5 rounded-full ${colorClass(annotation.color)}`} /><span>{label}</span><span className="rounded bg-subtle px-1.5 py-0.5">{annotationTypeLabel(annotation.annotation_type)}</span>{sectionTitle ? <span className="min-w-0 truncate">{sectionTitle}</span> : null}{annotation.anchor_status === "stale" ? <span className="text-[var(--danger)]">原文已更改</span> : null}{annotation.conflict_of_id ? <span className="text-amber-600">冲突副本</span> : null}</div>
          <blockquote className="mt-2 border-l-2 border-[var(--accent)] pl-3 text-sm leading-6 text-primary">{annotation.quote || "整条消息书签"}</blockquote>
        </button>
        {editable && !selectionMode ? <button type="button" onClick={() => void onDelete(annotation)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]" aria-label="删除批注" title="删除批注"><Trash2 className="h-4 w-4" /></button> : null}
      </div>
       {editable ? <div className="mt-2 flex flex-wrap gap-2"><select value={annotation.annotation_type === "bookmark" ? "bookmark" : annotation.annotation_type} disabled={annotation.annotation_type === "bookmark"} onChange={(event) => void onStyle(annotation, event.target.value as Exclude<AnnotationType, "bookmark">, annotation.color ?? "yellow")} className="min-h-8 rounded-md border border-ui bg-page px-2 text-xs">{TEXT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}{annotation.annotation_type === "bookmark" ? <option value="bookmark">Bookmark</option> : null}</select><select value={annotation.color ?? "yellow"} disabled={annotation.annotation_type === "bookmark"} onChange={(event) => void onStyle(annotation, annotation.annotation_type as Exclude<AnnotationType, "bookmark">, event.target.value as AnnotationColor)} className="min-h-8 rounded-md border border-ui bg-page px-2 text-xs">{COLORS.map((color) => <option key={color.value} value={color.value}>{color.label}</option>)}</select></div> : null}
       {editable ? <textarea key={`${annotation.id}:${annotation.revision}`} autoFocus={focusedAnnotationId === annotation.id && annotation.annotation_type === "comment"} defaultValue={annotation.comment_markdown} onBlur={(event) => { if (event.target.value !== annotation.comment_markdown) void onUpdate(annotation, event.target.value); }} className="mt-2 min-h-20 w-full resize-y rounded-md border border-ui bg-page px-3 py-2 text-sm outline-none focus:border-[var(--accent)]" placeholder="Markdown comment" /> : annotation.comment_markdown ? <div className="mt-2 text-sm"><MarkdownRenderer text={annotation.comment_markdown} /></div> : null}
       {editable ? <button type="button" onClick={() => void onAddToNotebook(annotation)} className="mt-2 inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-accent hover:bg-subtle"><BookmarkPlus className="h-3.5 w-3.5" />Add to notes</button> : null}
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
  const [type, setType] = useState<Exclude<AnnotationType, "bookmark">>(item.annotation_type === "bookmark" ? "highlight" : item.annotation_type);
  const [color, setColor] = useState<AnnotationColor>(item.color ?? "yellow");
  return <div className="fixed z-[130] w-64 rounded-md border border-ui bg-raised p-2 shadow-2xl" style={{ left: x, top: y }} role="dialog" aria-label="Annotation actions">
    <div className="mb-2 flex items-center justify-between gap-2"><span className="min-w-0 truncate text-xs font-semibold">{annotationTypeLabel(item.annotation_type)}</span><button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label="Close"><X className="h-4 w-4" /></button></div>
    <div className="grid grid-cols-2 gap-2"><select value={type} disabled={item.annotation_type === "bookmark"} onChange={(event) => setType(event.target.value as Exclude<AnnotationType, "bookmark">)} className="min-h-8 rounded-md border border-ui bg-page px-2 text-xs">{TEXT_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><select value={color} disabled={item.annotation_type === "bookmark"} onChange={(event) => setColor(event.target.value as AnnotationColor)} className="min-h-8 rounded-md border border-ui bg-page px-2 text-xs">{COLORS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
    <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={onNavigate} className="min-h-8 rounded-md border border-ui px-2 text-xs text-secondary hover:bg-subtle">Locate</button><button type="button" onClick={onSelect} className="min-h-8 rounded-md border border-ui px-2 text-xs text-secondary hover:bg-subtle">Select</button><button type="button" disabled={item.annotation_type === "bookmark"} onClick={() => onStyle(type, color)} className="min-h-8 rounded-md border border-ui px-2 text-xs text-accent hover:bg-subtle disabled:opacity-40">Save style</button><button type="button" onClick={onAddToNotebook} className="min-h-8 rounded-md border border-ui px-2 text-xs text-accent hover:bg-subtle">Add to notes</button><button type="button" onClick={onDelete} className="col-span-2 inline-flex min-h-8 items-center justify-center gap-1 rounded-md px-2 text-xs text-[var(--danger)] hover:bg-[var(--danger-soft)]"><Trash2 className="h-3.5 w-3.5" />Delete</button></div>
  </div>;
}

function annotationTypeLabel(type: AnnotationType): string {
  return type === "highlight" ? "Highlight" : type === "underline" ? "Underline" : type === "strikethrough" ? "Strike" : type === "comment" ? "Comment" : "Bookmark";
}

function NotebookView({ notebook, conflicts, annotations, editable, onSave, onNavigate }: { notebook: NotebookRead | null; conflicts: NotebookRead[]; annotations: AnnotationRead[]; editable: boolean; onSave: (blocks: NotebookBlock[]) => Promise<void>; onNavigate: (target: NavigateTarget) => void | Promise<unknown> }) {
  const [blocks, setBlocks] = useState<NotebookBlock[]>(notebook?.blocks ?? []);
  const dragIndex = useRef<number | null>(null);
  useEffect(() => setBlocks(notebook?.blocks ?? []), [notebook]);
  async function persist(next: NotebookBlock[]) { setBlocks(next); await onSave(next); }
  return <div className="space-y-3">
    {conflicts.map((conflict) => <section key={conflict.id} className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
      <p className="text-xs font-semibold">冲突副本 · {new Date(conflict.updated_at).toLocaleString()}</p>
      <p className="mt-1 text-xs opacity-80">{conflict.title || `${conflict.blocks.length} 个笔记块`}</p>
      {editable ? <button type="button" onClick={() => void persist([...blocks, ...conflict.blocks.map((block) => ({ ...block, id: crypto.randomUUID() }))])} className="mt-2 min-h-8 rounded-md border border-amber-400 px-2 text-xs font-medium">合并到当前笔记</button> : null}
    </section>)}
    {blocks.map((block, index) => {
      const annotation = block.annotation_id ? annotations.find((item) => item.id === block.annotation_id) : null;
      return <div key={block.id} draggable={editable} onDragStart={() => { dragIndex.current = index; }} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragIndex.current === null || dragIndex.current === index) return; const next = [...blocks]; const [moved] = next.splice(dragIndex.current, 1); next.splice(index, 0, moved); dragIndex.current = null; void persist(next); }} className="group flex gap-2 border-b border-ui pb-3 last:border-0">
        {editable ? <GripVertical className="mt-2 h-4 w-4 shrink-0 cursor-grab text-secondary" /> : null}
        <div className="min-w-0 flex-1">{block.type === "markdown" ? editable ? <textarea defaultValue={block.markdown ?? ""} onBlur={(event) => { const next = blocks.map((item) => item.id === block.id ? { ...item, markdown: event.target.value } : item); void persist(next); }} className="min-h-24 w-full resize-y rounded-md border border-ui bg-page px-3 py-2 text-sm outline-none" /> : <MarkdownRenderer text={block.markdown ?? ""} /> : annotation ? <button type="button" onClick={() => void onNavigate({ messageId: annotation.message_id ?? "", blockIndex: annotation.anchor_status === "stale" ? undefined : annotation.start_block_index ?? undefined, characterOffset: annotation.anchor_status === "stale" ? undefined : annotation.start_offset ?? undefined, source: "message-action" })} className="w-full border-l-2 border-[var(--accent)] pl-3 text-left text-sm leading-6">{annotation.quote || "整条消息书签"}</button> : <p className="text-sm text-[var(--danger)]">引用的批注不可用</p>}</div>
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

function applyCssHighlights(annotations: AnnotationRead[]) {
  clearCssHighlights();
  const css = (CSS as unknown as { highlights?: { set: (name: string, highlight: unknown) => void } }).highlights;
  const HighlightConstructor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  for (const annotation of annotations.filter((item) => item.annotation_type === "bookmark" && item.message_id)) {
    document.getElementById(`message-${annotation.message_id}`)?.classList.add("annotation-bookmark");
  }
  if (!css || !HighlightConstructor) return;
  for (const annotationType of TEXT_TYPES) {
    for (const color of COLORS) {
      const ranges: Range[] = [];
      for (const annotation of annotations.filter((item) => item.annotation_type === annotationType.value && item.color === color.value && item.anchor_status !== "stale")) {
        if (!annotation.message_id || annotation.start_block_index === null || annotation.end_block_index === null || annotation.start_offset === null || annotation.end_offset === null) continue;
        for (let blockIndex = annotation.start_block_index; blockIndex <= annotation.end_block_index; blockIndex += 1) {
          const root = document.querySelector<HTMLElement>(`#block-${annotation.message_id}-${blockIndex}`);
          if (!root) continue;
          const start = blockIndex === annotation.start_block_index ? annotation.start_offset : 0;
          const end = blockIndex === annotation.end_block_index ? annotation.end_offset : (root.textContent?.length ?? 0);
          const range = rangeForOffsets(root, start, end);
          if (range) ranges.push(range);
        }
      }
      if (ranges.length) css.set(`annotation-${annotationType.value}-${color.value}`, new HighlightConstructor(...ranges));
    }
  }
}

function clearCssHighlights() {
  const css = (CSS as unknown as { highlights?: { delete: (name: string) => void } }).highlights;
  document.querySelectorAll(".annotation-bookmark").forEach((element) => element.classList.remove("annotation-bookmark"));
  for (const color of COLORS) {
    css?.delete(`annotation-${color.value}`);
    for (const annotationType of TEXT_TYPES) css?.delete(`annotation-${annotationType.value}-${color.value}`);
  }
}

function rangeForOffsets(root: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let position = 0;
  let startNode: Node | null = null;
  let endNode: Node | null = null;
  let startOffset = 0;
  let endOffset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const length = node.textContent?.length ?? 0;
    if (!startNode && start <= position + length) { startNode = node; startOffset = Math.max(0, start - position); }
    if (end <= position + length) { endNode = node; endOffset = Math.max(0, end - position); break; }
    position += length;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
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
  const offset = characterOffsetAtPoint(block, event.clientX, event.clientY);
  if (offset === null) return null;
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    const annotation = annotations[index];
    if (annotation.message_id !== messageId || annotation.anchor_status === "stale") continue;
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

function defaultPanel(): PanelState {
  const width = Math.min(400, Math.max(1, window.innerWidth - PANEL_MARGIN * 2));
  const height = Math.min(620, Math.max(1, window.innerHeight - PANEL_MARGIN * 2));
  return clampPanel({ x: window.innerWidth - width - 28, y: 72, width, height });
}

function clampPanel(panel: PanelState): PanelState {
  const maxWidth = Math.max(1, window.innerWidth - PANEL_MARGIN * 2);
  const maxHeight = Math.max(1, window.innerHeight - PANEL_MARGIN * 2);
  const width = clamp(panel.width, Math.min(PANEL_MIN_WIDTH, maxWidth), maxWidth);
  const height = clamp(panel.height, Math.min(PANEL_MIN_HEIGHT, maxHeight), maxHeight);
  return {
    width,
    height,
    x: clamp(panel.x, PANEL_MARGIN, Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN)),
    y: clamp(panel.y, PANEL_MARGIN, Math.max(PANEL_MARGIN, window.innerHeight - height - PANEL_MARGIN)),
  };
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

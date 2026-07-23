"use client";

import { BookmarkPlus, GripVertical, Highlighter, Maximize2, MessageSquareText, Pin, PinOff, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnnotationRepository } from "../../lib/annotation-repository";
import type { AnnotationColor, AnnotationRead, MessageListItem, NavigateTarget, NotebookBlock, NotebookRead } from "../../lib/types";
import { MarkdownRenderer } from "../conversations/markdown-renderer";

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

const COLORS: Array<{ value: AnnotationColor; className: string; label: string }> = [
  { value: "yellow", className: "bg-amber-300", label: "黄色高亮" },
  { value: "green", className: "bg-emerald-300", label: "绿色高亮" },
  { value: "blue", className: "bg-sky-300", label: "蓝色高亮" },
  { value: "pink", className: "bg-pink-300", label: "粉色高亮" },
];

export function AnnotationWorkspace({ conversationId, messages, activeMessageId, repository, open, onOpenChange, onNavigate }: {
  conversationId: string;
  messages: MessageListItem[];
  activeMessageId: string | null;
  repository: AnnotationRepository;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onNavigate: (target: NavigateTarget) => void | Promise<unknown>;
}) {
  const [annotations, setAnnotations] = useState<AnnotationRead[]>([]);
  const [notebook, setNotebook] = useState<NotebookRead | null>(null);
  const [notebookConflicts, setNotebookConflicts] = useState<NotebookRead[]>([]);
  const [selection, setSelection] = useState<SelectionDraft | null>(null);
  const [view, setView] = useState<"current" | "all" | "notebook">("current");
  const [annotationQuery, setAnnotationQuery] = useState("");
  const [lockedMessageId, setLockedMessageId] = useState<string | null>(null);
  const [panelPinned, setPanelPinned] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [panel, setPanel] = useState({ x: 0, y: 72, width: 400, height: 620 });
  const dragRef = useRef<{ type: "move" | "resize"; startX: number; startY: number; panel: typeof panel } | null>(null);
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
      setPanel((current) => ({ ...current, x: current.x || Math.max(16, window.innerWidth - current.width - 28), height: Math.min(current.height, window.innerHeight - 92) }));
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!desktop) return;
    const capture = () => {
      window.setTimeout(() => {
        const next = captureSelection(messages);
        setSelection(next);
      }, 0);
    };
    document.addEventListener("mouseup", capture);
    document.addEventListener("keyup", capture);
    return () => {
      document.removeEventListener("mouseup", capture);
      document.removeEventListener("keyup", capture);
    };
  }, [desktop, messages]);

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
      if (drag.type === "move") {
        setPanel({ ...drag.panel, x: clamp(drag.panel.x + dx, 8, window.innerWidth - drag.panel.width - 8), y: clamp(drag.panel.y + dy, 8, window.innerHeight - 80) });
      } else {
        setPanel({ ...drag.panel, width: clamp(drag.panel.width + dx, 320, Math.min(680, window.innerWidth - drag.panel.x - 8)), height: clamp(drag.panel.height + dy, 360, window.innerHeight - drag.panel.y - 8) });
      }
    };
    const stop = () => { dragRef.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, []);

  async function createHighlight(color: AnnotationColor) {
    if (!selection) return;
    const message = messages.find((item) => item.id === selection.messageId);
    await repository.create(conversationId, {
      annotation_type: "highlight",
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
      metadata: message ? { message_role: message.role, message_order_key: message.order_key, message_role_number: message.ordinal ?? null } : {},
    });
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setView("current");
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
    if (!normalized) return base;
    return base.filter((item) => `${item.quote ?? ""}\n${item.comment_markdown}`.toLocaleLowerCase().includes(normalized));
  }, [annotationQuery, annotations, focusedMessageId, view]);

  return <>
    {selection && desktop ? <div className="fixed z-[120] flex items-center gap-1 rounded-md border border-ui bg-raised p-1 shadow-xl" style={{ left: clamp(selection.rect.left + selection.rect.width / 2 - 74, 8, window.innerWidth - 160), top: Math.max(8, selection.rect.top - 48) }} role="toolbar" aria-label="创建高亮"><Highlighter className="mx-1 h-4 w-4 text-secondary" />{COLORS.map((color) => <button key={color.value} type="button" onClick={() => void createHighlight(color.value)} className={`h-7 w-7 rounded ${color.className} ring-offset-2 hover:ring-2 hover:ring-[var(--focus)]`} aria-label={color.label} title={color.label} />)}</div> : null}
    {open ? <section className="fixed inset-x-2 bottom-2 top-16 z-[110] flex min-h-0 flex-col overflow-hidden rounded-md border border-ui bg-raised shadow-2xl md:inset-auto" style={desktop ? { left: panel.x, top: panel.y, width: panel.width, height: panel.height } : undefined} aria-label="批注">
      <header className="flex h-12 shrink-0 touch-none items-center gap-2 border-b border-ui px-3" onPointerDown={(event) => { if (!desktop || (event.target as HTMLElement).closest("button")) return; dragRef.current = { type: "move", startX: event.clientX, startY: event.clientY, panel }; }}><MessageSquareText className="h-4 w-4 text-accent" /><h2 className="min-w-0 flex-1 truncate text-sm font-semibold">批注</h2>{desktop ? <button type="button" onClick={() => { const next = !panelPinned; setPanelPinned(next); setLockedMessageId(next ? activeMessageId : null); }} className="flex h-8 w-8 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={panelPinned ? "取消固定当前消息" : "固定当前消息"} title={panelPinned ? "取消固定当前消息" : "固定当前消息"}>{panelPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}</button> : null}<button type="button" onClick={() => onOpenChange(false)} className="flex h-8 w-8 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label="关闭"><X className="h-4 w-4" /></button></header>
      <div className="grid shrink-0 grid-cols-3 border-b border-ui bg-subtle p-1">{(["current", "all", "notebook"] as const).map((item) => <button key={item} type="button" onClick={() => setView(item)} className={`min-h-9 rounded px-2 text-xs font-medium ${view === item ? "bg-surface text-primary shadow-sm" : "text-secondary"}`}>{item === "current" ? "当前消息" : item === "all" ? "全部批注" : "精选笔记"}</button>)}</div>
      {view !== "notebook" ? <label className="mx-3 mt-3 flex min-h-9 shrink-0 items-center gap-2 rounded-md border border-ui bg-page px-2"><Search className="h-4 w-4 text-secondary" /><input value={annotationQuery} onChange={(event) => setAnnotationQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="搜索批注" /></label> : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{view === "notebook" ? <NotebookView notebook={notebook} conflicts={notebookConflicts} annotations={annotations} editable={desktop} onSave={async (blocks) => { if (!notebook) return; setNotebook(await repository.saveNotebook(notebook, blocks)); }} onNavigate={onNavigate} /> : <AnnotationList items={visibleAnnotations} editable={desktop} messages={messages} onNavigate={onNavigate} onUpdate={async (annotation, comment) => { await repository.update(annotation, { comment_markdown: comment }); await reload(); }} onAddToNotebook={async (annotation) => { if (!notebook) return; const exists = notebook.blocks.some((block) => block.annotation_id === annotation.id); if (!exists) setNotebook(await repository.saveNotebook(notebook, [...notebook.blocks, { id: crypto.randomUUID(), type: "annotation_reference", annotation_id: annotation.id }])); setView("notebook"); }} />}</div>
      {desktop ? <button type="button" className="absolute bottom-0 right-0 h-5 w-5 cursor-se-resize text-secondary" onPointerDown={(event) => { event.stopPropagation(); dragRef.current = { type: "resize", startX: event.clientX, startY: event.clientY, panel }; }} aria-label="调整批注窗口大小"><Maximize2 className="h-3.5 w-3.5" /></button> : null}
    </section> : null}
  </>;
}

function AnnotationList({ items, editable, messages, onNavigate, onUpdate, onAddToNotebook }: { items: AnnotationRead[]; editable: boolean; messages: MessageListItem[]; onNavigate: (target: NavigateTarget) => void | Promise<unknown>; onUpdate: (annotation: AnnotationRead, comment: string) => Promise<void>; onAddToNotebook: (annotation: AnnotationRead) => Promise<void> }) {
  if (!items.length) return <p className="py-8 text-center text-sm text-secondary">暂无批注</p>;
  return <div className="space-y-4">{items.map((annotation) => {
    const message = messages.find((item) => item.id === annotation.message_id);
    const metadataRole = typeof annotation.metadata.message_role === "string" ? annotation.metadata.message_role : message?.role;
    const metadataNumber = typeof annotation.metadata.message_role_number === "number" ? annotation.metadata.message_role_number : message?.ordinal;
    const sectionTitle = typeof annotation.metadata.section_title === "string" ? annotation.metadata.section_title : null;
    const label = `${metadataRole === "user" ? "U" : "A"}${metadataNumber ?? ""}`;
    const blockIndex = annotation.anchor_status === "stale" ? undefined : annotation.start_block_index ?? undefined;
    return <article key={annotation.id} className="border-b border-ui pb-4 last:border-0">
      <button type="button" onClick={() => void onNavigate({ messageId: annotation.message_id ?? "", blockIndex, source: "message-action" })} className="w-full text-left">
        <div className="flex items-center gap-2 text-xs text-secondary"><span className={`h-2.5 w-2.5 rounded-full ${colorClass(annotation.color)}`} /><span>{label}</span>{sectionTitle ? <span className="min-w-0 truncate">{sectionTitle}</span> : null}{annotation.anchor_status === "stale" ? <span className="text-[var(--danger)]">原文已更改</span> : null}{annotation.conflict_of_id ? <span className="text-amber-600">冲突副本</span> : null}</div>
        <blockquote className="mt-2 border-l-2 border-[var(--accent)] pl-3 text-sm leading-6 text-primary">{annotation.quote || "整条消息书签"}</blockquote>
      </button>
      {editable ? <textarea key={`${annotation.id}:${annotation.revision}`} defaultValue={annotation.comment_markdown} onBlur={(event) => { if (event.target.value !== annotation.comment_markdown) void onUpdate(annotation, event.target.value); }} className="mt-2 min-h-20 w-full resize-y rounded-md border border-ui bg-page px-3 py-2 text-sm outline-none focus:border-[var(--accent)]" placeholder="Markdown 评论" /> : annotation.comment_markdown ? <div className="mt-2 text-sm"><MarkdownRenderer text={annotation.comment_markdown} /></div> : null}
      {editable ? <button type="button" onClick={() => void onAddToNotebook(annotation)} className="mt-2 inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-accent hover:bg-subtle"><BookmarkPlus className="h-3.5 w-3.5" />加入精选笔记</button> : null}
    </article>;
  })}</div>;
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
        <div className="min-w-0 flex-1">{block.type === "markdown" ? editable ? <textarea defaultValue={block.markdown ?? ""} onBlur={(event) => { const next = blocks.map((item) => item.id === block.id ? { ...item, markdown: event.target.value } : item); void persist(next); }} className="min-h-24 w-full resize-y rounded-md border border-ui bg-page px-3 py-2 text-sm outline-none" /> : <MarkdownRenderer text={block.markdown ?? ""} /> : annotation ? <button type="button" onClick={() => void onNavigate({ messageId: annotation.message_id ?? "", blockIndex: annotation.anchor_status === "stale" ? undefined : annotation.start_block_index ?? undefined, source: "message-action" })} className="w-full border-l-2 border-[var(--accent)] pl-3 text-left text-sm leading-6">{annotation.quote || "整条消息书签"}</button> : <p className="text-sm text-[var(--danger)]">引用的批注不可用</p>}</div>
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
  if (!css || !HighlightConstructor) return;
  for (const color of COLORS) {
    const ranges: Range[] = [];
    for (const annotation of annotations.filter((item) => item.color === color.value && item.anchor_status !== "stale")) {
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
    if (ranges.length) css.set(`annotation-${color.value}`, new HighlightConstructor(...ranges));
  }
}

function clearCssHighlights() {
  const css = (CSS as unknown as { highlights?: { delete: (name: string) => void } }).highlights;
  for (const color of COLORS) css?.delete(`annotation-${color.value}`);
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

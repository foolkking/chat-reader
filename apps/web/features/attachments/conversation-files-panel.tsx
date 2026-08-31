"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardCopy,
  Download,
  Eye,
  File,
  GripVertical,
  Image as ImageIcon,
  Link2,
  LocateFixed,
  MoreHorizontal,
  Info,
  Pencil,
  Plus,
  Rows3,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  cloneElement,
  useMemo,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactElement,
} from "react";
import { usePreferences } from "../../components/preferences-provider";
import {
  createAttachmentUploadSession,
  deleteConversationAttachment,
  finalizeConversationAttachments,
  getCapabilities,
  getConversationAttachments,
  updateConversationAttachment,
  uploadAttachmentItem,
} from "../../lib/api";
import type { AttachmentRead, NavigateTarget } from "../../lib/types";
import { AttachmentPreviewDialog, readableBytes } from "./attachment-block";
import { attachmentExtension } from "./preview-adapter-registry";
import { useDialogFocus } from "../../components/use-dialog-focus";
import { attachmentOccurrenceTarget } from "./attachment-location";

type Placement = "inline" | "after_message";
type FileFilter = "all" | "used" | "unused" | "missing";
type FileSort = "recent" | "name" | "type" | "size" | "usage";

type ConversationFilesPanelProps = {
  conversationId: string;
  onLocate: (target: NavigateTarget) => void | Promise<void>;
  onInsert: (attachment: AttachmentRead, placement: Placement) => void;
};

export function ConversationFilesPanel({
  conversationId,
  onLocate,
  onInsert,
}: ConversationFilesPanelProps) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FileFilter>("all");
  const [sort, setSort] = useState<FileSort>("recent");
  const [grouped, setGrouped] = useState(true);
  const [preview, setPreview] = useState<AttachmentRead | null>(null);
  const [details, setDetails] = useState<AttachmentRead | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const filesQuery = useQuery({
    queryKey: ["conversation-attachments", conversationId],
    queryFn: () => getConversationAttachments(conversationId),
  });
  const capabilitiesQuery = useQuery({
    queryKey: ["capabilities"],
    queryFn: getCapabilities,
    staleTime: 60_000,
  });
  const renameMutation = useMutation({
    mutationFn: ({ attachmentId, displayName }: { attachmentId: string; displayName: string }) =>
      updateConversationAttachment(conversationId, attachmentId, displayName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["conversation-attachments", conversationId] }),
  });
  const detachMutation = useMutation({
    mutationFn: (attachmentId: string) => deleteConversationAttachment(conversationId, attachmentId),
    onSuccess: (_data, attachmentId) => {
      setSelected((current) => {
        const next = new Set(current);
        next.delete(attachmentId);
        return next;
      });
      return queryClient.invalidateQueries({ queryKey: ["conversation-attachments", conversationId] });
    },
  });

  const files = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return [...(filesQuery.data ?? [])]
      .filter((item) => !needle || `${item.display_name} ${item.original_filename}`.toLocaleLowerCase().includes(needle))
      .filter((item) => {
        if (filter === "used") return Boolean(item.is_used);
        if (filter === "unused") return !item.is_used && item.resolution_status !== "missing";
        if (filter === "missing") return item.resolution_status === "missing" || item.status !== "available";
        return true;
      })
      .sort((a, b) => {
        if (sort === "name") return a.display_name.localeCompare(b.display_name);
        if (sort === "type") return attachmentMime(a).localeCompare(attachmentMime(b));
        if (sort === "size") return (a.asset_object?.byte_size ?? 0) - (b.asset_object?.byte_size ?? 0);
        if (sort === "usage") return (b.current_occurrence_count ?? (b.is_used ? b.occurrence_count : 0) ?? 0) - (a.current_occurrence_count ?? (a.is_used ? a.occurrence_count : 0) ?? 0);
        return b.created_at.localeCompare(a.created_at);
      });
  }, [filesQuery.data, filter, search, sort]);

  const groups = [
    { id: "unused", title: zh ? "尚未放入正文" : "Not placed", items: files.filter((item) => !item.is_used && item.resolution_status !== "missing" && item.status === "available") },
    { id: "used", title: zh ? "已在正文使用" : "Used in messages", items: files.filter((item) => item.is_used && item.resolution_status !== "missing" && item.status === "available") },
    { id: "missing", title: zh ? "缺失或不可用" : "Missing or unavailable", items: files.filter((item) => item.resolution_status === "missing" || item.status !== "available") },
  ];
  const visibleGroups = grouped
    ? groups
    : [{ id: "all", title: zh ? "全部文件" : "All files", items: files }];

  async function uploadFiles(selectedFiles: File[]) {
    if (!selectedFiles.length) return;
    setError(null);
    try {
      const session = await createAttachmentUploadSession(conversationId);
      const itemIds: string[] = [];
      for (const file of selectedFiles) {
        setProgress((current) => ({ ...current, [file.name]: 0 }));
        const upload = uploadAttachmentItem(session.id, file, (value) => {
          setProgress((current) => ({ ...current, [file.name]: value }));
        });
        itemIds.push((await upload.promise).id);
      }
      await finalizeConversationAttachments(conversationId, itemIds);
      await queryClient.invalidateQueries({ queryKey: ["conversation-attachments", conversationId] });
      setProgress({});
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Attachment upload failed.");
    }
  }

  function toggleSelected(attachmentId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(attachmentId)) next.delete(attachmentId);
      else next.add(attachmentId);
      return next;
    });
  }

  function selectedFiles() {
    const allFiles = filesQuery.data ?? [];
    return allFiles.filter((item) => selected.has(item.id));
  }

  function downloadSelection() {
    for (const attachment of selectedFiles()) {
      if (!attachment.download_url) continue;
      const link = document.createElement("a");
      link.href = attachment.download_url;
      link.download = attachment.display_name;
      link.click();
    }
  }

  function detachSelection() {
    const removable = selectedFiles().filter((item) => !item.is_used);
    if (removable.length !== selected.size) {
      setError(zh ? "仍在当前正文中引用的文件不能移除。" : "Files still used by current messages cannot be detached.");
      return;
    }
    const promptText = zh ? `从当前对话文件中移除 ${removable.length} 个文件？` : `Detach ${removable.length} files from this conversation?`;
    if (!window.confirm(promptText)) return;
    for (const attachment of removable) detachMutation.mutate(attachment.id);
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-page"
      aria-label={zh ? "当前对话文件" : "Conversation files"}
      data-testid="conversation-files-panel"
    >
      <div className="shrink-0 space-y-2 border-b border-ui p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">
            {zh ? "当前对话文件" : "Conversation files"} · {filesQuery.data?.length ?? 0}
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            data-testid="conversation-files-upload-input"
            onChange={(event) => {
              const nextFiles = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void uploadFiles(nextFiles);
            }}
          />
          <button
            type="button"
            disabled={capabilitiesQuery.data?.attachments.upload_enabled === false}
            onClick={() => inputRef.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--text)] px-2.5 text-xs font-medium text-[var(--surface)] disabled:opacity-40"
          >
            <Upload className="h-3.5 w-3.5" />
            {zh ? "上传" : "Upload"}
          </button>
        </div>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={zh ? "搜索文件" : "Search files"}
            className="min-h-9 w-full rounded-md border border-ui bg-surface pl-9 pr-3 text-sm outline-none focus:border-[var(--accent)]"
          />
        </label>
        <div className="flex items-center gap-1 overflow-x-auto">
          {(["all", "used", "unused", "missing"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`shrink-0 rounded px-2 py-1 text-xs ${filter === value ? "bg-[var(--text)] text-[var(--surface)]" : "text-secondary hover:bg-subtle"}`}
            >
              {filterLabel(value, zh)}
            </button>
          ))}
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as FileSort)}
            className="ml-auto min-h-7 rounded border border-ui bg-surface px-1.5 text-xs text-primary"
            aria-label={zh ? "文件排序" : "Sort files"}
          >
            <option value="recent">{zh ? "最近添加" : "Recent"}</option>
            <option value="name">{zh ? "名称" : "Name"}</option>
            <option value="type">{zh ? "类型" : "Type"}</option>
            <option value="size">{zh ? "大小" : "Size"}</option>
            <option value="usage">{zh ? "引用数" : "Usage"}</option>
          </select>
          <IconButton label={grouped ? (zh ? "切换为统一列表" : "Show one list") : (zh ? "按使用状态分组" : "Group by usage")} onClick={() => setGrouped((value) => !value)}>
            <Rows3 />
          </IconButton>
        </div>
        {selected.size ? (
          <div className="flex items-center gap-1 rounded bg-subtle px-2 py-1 text-xs">
            <span className="mr-auto">{zh ? `已选择 ${selected.size} 项` : `${selected.size} selected`}</span>
            <IconButton label={zh ? "下载所选" : "Download selected"} onClick={downloadSelection}><Download /></IconButton>
            <IconButton label={zh ? "插入到消息末尾" : "Insert at message end"} onClick={() => selectedFiles().forEach((item) => onInsert(item, "after_message"))}><Link2 /></IconButton>
            <IconButton label={zh ? "移除所选" : "Detach selected"} onClick={detachSelection}><Trash2 /></IconButton>
          </div>
        ) : null}
        {capabilitiesQuery.data?.attachments.scanner_provider === "disabled" ? (
          <p className="flex items-center gap-1.5 text-[11px] text-secondary">
            <Info className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
            {zh ? "当前部署未启用扫描，附件状态显示为“未扫描”。" : "Scanning is disabled; attachments remain unscanned."}
          </p>
        ) : null}
        {Object.entries(progress).map(([name, value]) => <UploadProgress key={name} name={name} value={value} />)}
        {error ? <p role="alert" className="rounded bg-[var(--danger-soft)] p-2 text-xs text-[var(--danger)]">{error}</p> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {filesQuery.isLoading ? <p className="text-sm text-secondary">{zh ? "正在加载文件..." : "Loading files..."}</p> : null}
        {visibleGroups.map((group) => group.items.length ? (
          <section key={group.id} className="mb-4" data-testid={`conversation-files-group-${group.id}`}>
            <h3 className="mb-1 text-[11px] font-semibold text-secondary">{group.title} · {group.items.length}</h3>
            <div className="space-y-1">
              {group.items.map((attachment) => (
                <FileRow
                  key={attachment.id}
                  attachment={attachment}
                  zh={zh}
                  selected={selected.has(attachment.id)}
                  onSelect={() => toggleSelected(attachment.id)}
                  onPreview={() => setPreview(attachment)}
                  onShowDetails={() => setDetails(attachment)}
                  onLocate={(occurrence) => void onLocate(attachmentOccurrenceTarget(attachment, occurrence))}
                  onCopyReference={() => void navigator.clipboard.writeText(`cr-asset://${attachment.id}`)}
                  onInsert={(placement) => onInsert(attachment, placement)}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData("application/x-chat-reader-attachment", JSON.stringify({
                      attachmentId: attachment.id,
                      displayName: attachment.display_name,
                      mimeType: attachmentMime(attachment),
                    }));
                    event.dataTransfer.setData("text/plain", attachment.display_name);
                  }}
                  onRename={() => {
                    const displayName = window.prompt(zh ? "显示名称" : "Display name", attachment.display_name)?.trim();
                    if (displayName) renameMutation.mutate({ attachmentId: attachment.id, displayName });
                  }}
                  onDelete={() => {
                    const promptText = zh
                      ? `从当前对话文件中移除“${attachment.display_name}”？`
                      : `Detach "${attachment.display_name}" from this conversation?`;
                    if (window.confirm(promptText)) detachMutation.mutate(attachment.id);
                  }}
                />
              ))}
            </div>
          </section>
        ) : null)}
        {!filesQuery.isLoading && files.length === 0 ? <EmptyFiles filtered={Boolean(search || filter !== "all")} zh={zh} /> : null}
      </div>
      {preview ? <AttachmentPreviewDialog attachment={preview} onClose={() => setPreview(null)} /> : null}
      {details ? <AttachmentDetailsDialog attachment={details} zh={zh} onClose={() => setDetails(null)} onLocate={onLocate} /> : null}
    </section>
  );
}

function FileRow({
  attachment,
  zh,
  selected,
  onSelect,
  onPreview,
  onShowDetails,
  onLocate,
  onCopyReference,
  onInsert,
  onRename,
  onDelete,
  onDragStart,
}: {
  attachment: AttachmentRead;
  zh: boolean;
  selected: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onShowDetails: () => void;
  onLocate: (occurrence: NonNullable<AttachmentRead["occurrences"]>[number]) => void;
  onCopyReference: () => void;
  onInsert: (placement: Placement) => void;
  onRename: () => void;
  onDelete: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
}) {
  const mime = attachmentMime(attachment);
  const image = mime.startsWith("image/");
  const unscanned = ["scanner_disabled", "unscanned", "scan_skipped_by_deployment_policy"].includes(attachment.scan_status);
  const zeroBytes = attachment.asset_object?.byte_size === 0;
  const created = new Date(attachment.created_at).toLocaleDateString();
  const occurrences = attachment.occurrences ?? [];
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) {
        setMoreOpen(false);
        window.setTimeout(() => moreButtonRef.current?.focus({ preventScroll: true }), 0);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setMoreOpen(false);
        moreButtonRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [moreOpen]);

  const locateReferences = () => {
    if (occurrences.length === 1) {
      onLocate(occurrences[0]);
      return;
    }
    setReferencesOpen((value) => !value);
    setMoreOpen(false);
  };

  return (
    <article
      className={`rounded-md border px-2 py-2 ${selected ? "border-[var(--accent)] bg-accent-soft" : "border-ui bg-surface"}`}
      data-testid="conversation-file-row"
      data-attachment-id={attachment.id}
      data-scan-status={attachment.scan_status}
      data-resolution-status={attachment.resolution_status}
    >
      <div className="flex gap-2">
        <input type="checkbox" checked={selected} onChange={onSelect} aria-label={zh ? `选择 ${attachment.display_name}` : `Select ${attachment.display_name}`} />
        <button
          type="button"
          draggable
          onDragStart={onDragStart}
          className="inline-flex h-9 w-6 shrink-0 cursor-grab items-center justify-center rounded text-secondary hover:bg-subtle active:cursor-grabbing"
          aria-label={zh ? "拖到源码编辑器中插入" : "Drag into source editor to insert"}
          title={zh ? "拖到源码编辑器中插入" : "Drag into source editor to insert"}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-subtle text-secondary">
          {image ? <ImageIcon className="h-4 w-4" /> : <File className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{attachment.display_name}</p>
          <p className="truncate text-[11px] text-secondary">
            {zeroBytes
              ? (zh ? "空文件 · 0 B" : "Empty file · 0 B")
              : `${mimeLabel(mime, attachment.display_name)} · ${readableBytes(attachment.asset_object?.byte_size ?? 0)}`}
          </p>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-secondary">
            <span>{unscanned ? (zh ? "未扫描" : "Unscanned") : attachment.scan_status}</span>
            <span>{zh ? `正文引用 ${attachment.current_occurrence_count ?? (attachment.is_used ? attachment.occurrence_count : 0) ?? 0} 处` : `${attachment.current_occurrence_count ?? (attachment.is_used ? attachment.occurrence_count : 0) ?? 0} current occurrences`}</span>
            <span>{created} · {attachment.id.slice(0, 6)}</span>
          </div>
        </div>
      </div>
      <div className="mt-1 flex justify-end gap-1 border-t border-ui pt-1">
        <IconButton label={zh ? "插入" : "Insert"} onClick={() => onInsert("inline")}><Plus /></IconButton>
        <IconButton label={zh ? "预览" : "Preview"} onClick={onPreview}><Eye /></IconButton>
        {occurrences.length === 1 ? <IconButton label="Locate in conversation" onClick={() => onLocate(occurrences[0])}><LocateFixed /></IconButton> : null}
        {occurrences.length > 1 ? <IconButton label={referencesOpen ? "Hide references" : "Show references"} onClick={locateReferences}><LocateFixed /></IconButton> : null}
        <div ref={moreRef} className="relative">
          <button
            ref={moreButtonRef}
            type="button"
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            onClick={() => setMoreOpen((value) => !value)}
            className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded text-secondary hover:bg-subtle"
            aria-label={zh ? "更多文件操作" : "More file actions"}
            title={zh ? "更多" : "More"}
          >
            {moreOpen ? <X className="h-4 w-4" /> : <MoreHorizontal className="h-4 w-4" />}
          </button>
          {moreOpen ? <div role="menu" className="absolute right-0 z-20 mt-1 min-w-44 rounded-md border border-ui bg-raised p-1 shadow-xl">
            {attachment.download_url ? (
              <a href={attachment.download_url} className="flex min-h-8 items-center gap-2 rounded px-2 text-xs text-primary hover:bg-subtle">
                <Download className="h-3.5 w-3.5" />{zh ? "下载" : "Download"}
              </a>
            ) : null}
            {occurrences.length > 1 ? (
              <button type="button" onClick={locateReferences} className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-xs text-primary hover:bg-subtle">
                <LocateFixed className="h-3.5 w-3.5" />{zh ? "查看引用位置" : "Locate references"}
              </button>
            ) : null}
            {attachment.resolution_status !== "missing" ? (
              <button type="button" onClick={() => onInsert("after_message")} className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-xs text-primary hover:bg-subtle">
                <Link2 className="h-3.5 w-3.5" />{zh ? "插入到消息末尾" : "Insert after message"}
              </button>
            ) : null}
            <button type="button" onClick={onRename} className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-xs text-primary hover:bg-subtle">
              <Pencil className="h-3.5 w-3.5" />{zh ? "重命名显示名称" : "Rename display name"}
            </button>
            <button type="button" onClick={onCopyReference} className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-xs text-primary hover:bg-subtle">
              <ClipboardCopy className="h-3.5 w-3.5" />{zh ? "复制附件引用" : "Copy attachment reference"}
            </button>
            <button type="button" onClick={onShowDetails} className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-xs text-primary hover:bg-subtle">
              <Info className="h-3.5 w-3.5" />{zh ? "文件详情" : "File details"}
            </button>
            {!attachment.is_used ? (
              <button type="button" onClick={onDelete} className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-xs text-[var(--danger)] hover:bg-[var(--danger-soft)]">
                <Trash2 className="h-3.5 w-3.5" />{zh ? "从当前对话文件移除" : "Detach"}
              </button>
            ) : null}
          </div> : null}
        </div>
      </div>
      {referencesOpen && occurrences.length > 1 ? <div className="mt-2 space-y-1 border-t border-ui pt-2" role="list" aria-label="Message references">
        {occurrences.map((occurrence, index) => <button key={`${occurrence.message_version_id}:${occurrence.occurrence_key}`} type="button" onClick={() => onLocate(occurrence)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-secondary hover:bg-subtle hover:text-primary"><LocateFixed className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{zh ? `引用 ${index + 1}` : `Reference ${index + 1}`}</span><span className="text-[10px]">{occurrence.is_current_version ? (zh ? "当前" : "Current") : (zh ? "历史" : "History")}</span></button>)}
      </div> : null}
    </article>
  );
}

function AttachmentDetailsDialog({
  attachment,
  zh,
  onClose,
  onLocate,
}: {
  attachment: AttachmentRead;
  zh: boolean;
  onClose: () => void;
  onLocate: (target: NavigateTarget) => void | Promise<void>;
}) {
  const occurrences = attachment.occurrences ?? [];
  const rootRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus({ open: true, rootRef, onClose });
  return (
    <div ref={rootRef} tabIndex={-1} className="fixed inset-0 z-[260] flex items-end justify-center bg-[var(--overlay)] p-0 outline-none sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby={`attachment-details-${attachment.id}`}>
      <div aria-hidden="true" data-dialog-backdrop className="absolute inset-0" onPointerDown={onClose} />
      <section className="relative max-h-[80dvh] w-full overflow-y-auto rounded-t-xl border border-ui bg-raised p-5 shadow-2xl sm:max-w-xl sm:rounded-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={`attachment-details-${attachment.id}`} className="truncate text-base font-semibold text-primary">{attachment.display_name}</h2>
            <p className="mt-1 text-xs text-secondary">{attachment.original_filename} · {attachmentMime(attachment)} · {readableBytes(attachment.asset_object?.byte_size ?? 0)}</p>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-subtle" aria-label={zh ? "关闭文件详情" : "Close file details"} title={zh ? "关闭" : "Close"}>×</button>
        </div>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-secondary">{zh ? "状态" : "Status"}</dt><dd>{attachment.resolution_status === "missing" ? (zh ? "缺失" : "Missing") : attachment.status}</dd>
          <dt className="text-secondary">{zh ? "扫描" : "Scan"}</dt><dd>{["scanner_disabled", "unscanned", "scan_skipped_by_deployment_policy"].includes(attachment.scan_status) ? (zh ? "未扫描" : "Unscanned") : attachment.scan_status}</dd>
          <dt className="text-secondary">{zh ? "来源" : "Source"}</dt><dd>{attachment.source_type}</dd>
          <dt className="text-secondary">{zh ? "创建时间" : "Created"}</dt><dd>{new Date(attachment.created_at).toLocaleString()}</dd>
        </dl>
        <h3 className="mt-5 text-sm font-semibold text-primary">{zh ? `引用位置 · ${occurrences.length}` : `References · ${occurrences.length}`}</h3>
        <div className="mt-2 space-y-2">
          {occurrences.map((occurrence) => (
            <button
              key={`${occurrence.message_version_id}:${occurrence.occurrence_key}`}
              type="button"
              onClick={() => { onClose(); void onLocate(attachmentOccurrenceTarget(attachment, occurrence)); }}
              className="block w-full rounded-md border border-ui bg-surface p-3 text-left hover:border-[var(--accent)]"
            >
              <span className="flex items-center justify-between gap-2 text-xs font-medium text-primary">
                <span>#{occurrence.message_order_key ?? occurrence.message_id.slice(0, 8)} · {occurrence.message_role ?? "message"}</span>
                <span className={occurrence.is_current_version ? "text-accent" : "text-secondary"}>{occurrence.is_current_version ? (zh ? "当前版本" : "Current") : `${zh ? "历史版本" : "History"} v${occurrence.version_number ?? "?"}`}</span>
              </span>
              {occurrence.message_preview ? <span className="mt-1 block line-clamp-2 text-xs text-secondary">{occurrence.message_preview}</span> : null}
            </button>
          ))}
          {!occurrences.length ? <p className="rounded-md bg-subtle p-3 text-xs text-secondary">{zh ? "当前没有正文引用。" : "There are no message references."}</p> : null}
        </div>
      </section>
    </div>
  );
}

function UploadProgress({ name, value }: { name: string; value: number }) {
  return (
    <div className="text-xs text-secondary">
      <div className="flex justify-between gap-2"><span className="truncate">{name}</span><span>{value}%</span></div>
      <div className="mt-1 h-1 overflow-hidden rounded bg-subtle"><div className="h-full bg-accent" style={{ width: `${value}%` }} /></div>
    </div>
  );
}

function EmptyFiles({ filtered, zh }: { filtered: boolean; zh: boolean }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center text-center text-secondary">
      <File className="h-7 w-7" />
      <p className="mt-2 text-sm">{filtered ? (zh ? "没有匹配文件" : "No matching files") : (zh ? "当前对话还没有文件" : "No files in this conversation")}</p>
    </div>
  );
}

function attachmentMime(attachment: AttachmentRead): string {
  return attachment.detected_mime_type
    ?? attachment.asset_object?.detected_mime_type
    ?? attachment.declared_mime_type
    ?? "application/octet-stream";
}

function filterLabel(value: FileFilter, zh: boolean): string {
  if (value === "used") return zh ? "已引用" : "Used";
  if (value === "unused") return zh ? "未引用" : "Unused";
  if (value === "missing") return zh ? "缺失" : "Missing";
  return zh ? "全部" : "All";
}

function mimeLabel(mime: string, filename: string): string {
  const extension = attachmentExtension(filename);
  if (extension === "md" || extension === "markdown") return "Markdown";
  if (extension) return extension.toUpperCase();
  if (mime === "inode/x-empty" || mime === "application/octet-stream") return "FILE";
  const index = mime.indexOf("/");
  return (index >= 0 ? mime.slice(index + 1) : mime).toUpperCase();
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactElement<{ className?: string }> }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-8 w-8 items-center justify-center rounded text-secondary hover:bg-subtle" aria-label={label} title={label}>
      {cloneElement(children, { className: "h-4 w-4" })}
    </button>
  );
}

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, Eye, File, Image as ImageIcon, Link2, LocateFixed, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { cloneElement, useMemo, useRef, useState, type ReactElement } from "react";
import {
  createAttachmentUploadSession,
  deleteConversationAttachment,
  finalizeConversationAttachments,
  getCapabilities,
  getConversationAttachments,
  updateConversationAttachment,
  uploadAttachmentItem,
} from "../../lib/api";
import type { AttachmentRead } from "../../lib/types";
import { usePreferences } from "../../components/preferences-provider";
import { AttachmentPreviewDialog, readableBytes } from "./attachment-block";

type Placement = "inline" | "after_message";

export function ConversationFilesPanel({ conversationId, onLocate, onInsert }: {
  conversationId: string;
  onLocate: (messageId: string, blockIndex?: number) => void | Promise<void>;
  onInsert: (attachment: AttachmentRead, placement: Placement) => void;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<AttachmentRead | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const filesQuery = useQuery({ queryKey: ["conversation-attachments", conversationId], queryFn: () => getConversationAttachments(conversationId) });
  const capabilitiesQuery = useQuery({ queryKey: ["capabilities"], queryFn: getCapabilities, staleTime: 60_000 });
  const renameMutation = useMutation({
    mutationFn: ({ attachmentId, displayName }: { attachmentId: string; displayName: string }) => updateConversationAttachment(conversationId, attachmentId, displayName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["conversation-attachments", conversationId] }),
  });
  const deleteMutation = useMutation({
    mutationFn: (attachmentId: string) => deleteConversationAttachment(conversationId, attachmentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["conversation-attachments", conversationId] }),
  });
  const files = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (filesQuery.data ?? []).filter((item) => !needle || `${item.display_name} ${item.original_filename}`.toLocaleLowerCase().includes(needle));
  }, [filesQuery.data, search]);
  const groups = [
    { id: "used", title: zh ? "\u5df2\u653e\u5165\u6b63\u6587" : "Used in messages", items: files.filter((item) => item.is_used && item.resolution_status !== "missing") },
    { id: "unused", title: zh ? "\u5c1a\u672a\u653e\u5165\u6b63\u6587" : "Not placed", items: files.filter((item) => !item.is_used && item.resolution_status !== "missing") },
    { id: "missing", title: zh ? "\u7f3a\u5931\u6216\u4e0d\u53ef\u7528" : "Missing or unavailable", items: files.filter((item) => item.resolution_status === "missing" || item.status !== "available") },
  ];

  async function uploadFiles(selected: File[]) {
    if (!selected.length) return;
    setError(null);
    try {
      const session = await createAttachmentUploadSession(conversationId);
      const itemIds: string[] = [];
      for (const file of selected) {
        setProgress((current) => ({ ...current, [file.name]: 0 }));
        const upload = uploadAttachmentItem(session.id, file, (value) => setProgress((current) => ({ ...current, [file.name]: value })));
        itemIds.push((await upload.promise).id);
      }
      await finalizeConversationAttachments(conversationId, itemIds);
      await queryClient.invalidateQueries({ queryKey: ["conversation-attachments", conversationId] });
      setProgress({});
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Attachment upload failed.");
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-page" aria-label={zh ? "\u5f53\u524d\u5bf9\u8bdd\u6587\u4ef6" : "Conversation files"} data-testid="conversation-files-panel">
      <div className="shrink-0 space-y-3 border-b border-ui p-4">
        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={zh ? "\u641c\u7d22\u6587\u4ef6" : "Search files"} className="min-h-10 w-full rounded-lg border border-ui bg-surface pl-9 pr-3 text-sm outline-none focus:border-[var(--accent)]" />
          </label>
          <input ref={inputRef} type="file" multiple className="hidden" data-testid="conversation-files-upload-input" onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void uploadFiles(files); }} />
          <button type="button" disabled={capabilitiesQuery.data?.attachments.upload_enabled === false} onClick={() => inputRef.current?.click()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[var(--text)] px-3 text-sm font-medium text-[var(--surface)] disabled:opacity-40">
            <Upload className="h-4 w-4" />{zh ? "\u6dfb\u52a0\u6587\u4ef6" : "Add files"}
          </button>
        </div>
        {capabilitiesQuery.data?.attachments.scanner_provider === "disabled" ? (
          <p className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2 text-xs leading-5 text-primary"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />{zh ? "\u5f53\u524d\u90e8\u7f72\u672a\u542f\u7528\u75c5\u6bd2\u626b\u63cf\uff0c\u6587\u4ef6\u59cb\u7ec8\u6807\u8bb0\u4e3a\u672a\u626b\u63cf\u3002" : "Virus scanning is disabled. Files remain marked as unscanned."}</p>
        ) : null}
        {Object.entries(progress).map(([name, value]) => <UploadProgress key={name} name={name} value={value} />)}
        {error ? <p role="alert" className="rounded-lg bg-[var(--danger-soft)] p-2 text-xs text-[var(--danger)]">{error}</p> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {filesQuery.isLoading ? <p className="text-sm text-secondary">{zh ? "\u6b63\u5728\u52a0\u8f7d\u6587\u4ef6..." : "Loading files..."}</p> : null}
        {groups.map((group) => group.items.length ? (
          <section key={group.id} className="mb-6" data-testid={`conversation-files-group-${group.id}`}>
            <h3 className="mb-2 text-xs font-semibold text-secondary">{group.title} - {group.items.length}</h3>
            <div className="space-y-2">
              {group.items.map((attachment) => (
                <FileRow
                  key={attachment.id}
                  attachment={attachment}
                  zh={zh}
                  onPreview={() => setPreview(attachment)}
                  onLocate={() => {
                    const occurrence = attachment.occurrences?.find((item) => item.is_current_version) ?? attachment.occurrences?.[0];
                    if (occurrence) void onLocate(occurrence.message_id, occurrence.block_index ?? undefined);
                  }}
                  onInsert={(placement) => onInsert(attachment, placement)}
                  onRename={() => {
                    const displayName = window.prompt(zh ? "\u663e\u793a\u540d\u79f0" : "Display name", attachment.display_name)?.trim();
                    if (displayName) renameMutation.mutate({ attachmentId: attachment.id, displayName });
                  }}
                  onDelete={() => {
                    const prompt = zh ? `\u6c38\u4e45\u79fb\u9664\u672a\u5f15\u7528\u6587\u4ef6\u201c${attachment.display_name}\u201d\uff1f` : `Permanently remove unreferenced file "${attachment.display_name}"?`;
                    if (window.confirm(prompt)) deleteMutation.mutate(attachment.id);
                  }}
                />
              ))}
            </div>
          </section>
        ) : null)}
        {!filesQuery.isLoading && files.length === 0 ? <EmptyFiles filtered={Boolean(search)} zh={zh} /> : null}
      </div>
      {preview ? <AttachmentPreviewDialog attachment={preview} onClose={() => setPreview(null)} /> : null}
    </section>
  );
}

function UploadProgress({ name, value }: { name: string; value: number }) {
  return <div className="text-xs text-secondary"><div className="flex justify-between gap-2"><span className="truncate">{name}</span><span>{value}%</span></div><div className="mt-1 h-1 overflow-hidden rounded bg-subtle"><div className="h-full bg-accent" style={{ width: `${value}%` }} /></div></div>;
}

function EmptyFiles({ filtered, zh }: { filtered: boolean; zh: boolean }) {
  return <div className="flex min-h-48 flex-col items-center justify-center text-center text-secondary"><File className="h-8 w-8" /><p className="mt-3 text-sm">{filtered ? (zh ? "\u6ca1\u6709\u5339\u914d\u6587\u4ef6" : "No matching files") : (zh ? "\u5f53\u524d\u5bf9\u8bdd\u8fd8\u6ca1\u6709\u6587\u4ef6" : "No files in this conversation")}</p></div>;
}

function FileRow({ attachment, zh, onPreview, onLocate, onInsert, onRename, onDelete }: {
  attachment: AttachmentRead;
  zh: boolean;
  onPreview: () => void;
  onLocate: () => void;
  onInsert: (placement: Placement) => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const mime = attachment.detected_mime_type ?? attachment.asset_object?.detected_mime_type ?? attachment.declared_mime_type ?? "application/octet-stream";
  const image = mime.startsWith("image/");
  const unscanned = ["scanner_disabled", "unscanned", "scan_skipped_by_deployment_policy"].includes(attachment.scan_status);
  return (
    <article className="rounded-lg border border-ui bg-surface p-3" data-testid="conversation-file-row" data-attachment-id={attachment.id} data-scan-status={attachment.scan_status} data-resolution-status={attachment.resolution_status}>
      <div className="flex gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-subtle text-secondary">{image ? <ImageIcon className="h-5 w-5" /> : <File className="h-5 w-5" />}</div>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{attachment.display_name}</p><p className="truncate text-xs text-secondary">{attachment.original_filename}</p><p className="mt-1 text-xs text-secondary">{readableBytes(attachment.asset_object?.byte_size ?? 0)} - {mime}</p><div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-secondary"><span>{unscanned ? (zh ? "\u672a\u626b\u63cf" : "Unscanned") : attachment.scan_status}</span><span>{zh ? `\u5f15\u7528 ${attachment.occurrence_count ?? 0} \u5904` : `${attachment.occurrence_count ?? 0} occurrences`}</span></div></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1 border-t border-ui pt-2">
        <IconButton label={zh ? "\u9884\u89c8" : "Preview"} onClick={onPreview}><Eye /></IconButton>
        {attachment.download_url ? <a href={attachment.download_url} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-secondary hover:bg-subtle" title={zh ? "\u4e0b\u8f7d" : "Download"}><Download className="h-4 w-4" /></a> : null}
        {attachment.is_used ? <IconButton label={zh ? "\u5b9a\u4f4d\u5f15\u7528" : "Locate reference"} onClick={onLocate}><LocateFixed /></IconButton> : null}
        {attachment.resolution_status !== "missing" ? <><IconButton label={zh ? "\u63d2\u5165\u5149\u6807\u4f4d\u7f6e" : "Insert inline"} onClick={() => onInsert("inline")}><Plus /></IconButton><IconButton label={zh ? "\u653e\u5230\u6d88\u606f\u672b\u5c3e" : "Place after message"} onClick={() => onInsert("after_message")}><Link2 /></IconButton></> : null}
        <IconButton label={zh ? "\u91cd\u547d\u540d" : "Rename"} onClick={onRename}><Pencil /></IconButton>
        {!attachment.is_used ? <IconButton label={zh ? "\u79fb\u9664\u6587\u4ef6" : "Remove file"} onClick={onDelete} danger><Trash2 /></IconButton> : null}
      </div>
    </article>
  );
}

function IconButton({ label, onClick, danger = false, children }: { label: string; onClick: () => void; danger?: boolean; children: ReactElement<{ className?: string }> }) {
  return <button type="button" onClick={onClick} className={`inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-subtle ${danger ? "text-[var(--danger)]" : "text-secondary"}`} aria-label={label} title={label}>{cloneElement(children, { className: "h-4 w-4" })}</button>;
}

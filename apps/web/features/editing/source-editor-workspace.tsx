"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { File, Image as ImageIcon, Link2, LocateFixed, Paperclip, Plus, SaveAll, Search, Undo2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FloatingWorkspacePanel } from "../../components/floating-workspace-panel";
import { usePreferences } from "../../components/preferences-provider";
import { createAttachmentUploadSession, deleteAttachmentUploadItem, editMessage, finalizeConversationAttachments, getConversationAttachments, uploadAttachmentItem } from "../../lib/api";
import type { AttachmentRead, MessageListItem } from "../../lib/types";
import { EditMessageForm } from "./edit-message-form";
import { blockIndexForSourceOffset, normalizedMessageBlocks } from "./message-source-position";
import type { AttachmentDraft, AttachmentDraftCallbacks } from "./source-attachment-drop";

export type SourceEditorTarget = {
  message: MessageListItem;
  cursorOffset: number;
};

const FORM_ID = "reader-source-editor-form";

type UploadJob = {
  token: string;
  file: File;
  itemId?: string;
  cancel?: () => void;
  callbacks: AttachmentDraftCallbacks;
  cancelled?: boolean;
};

export function SourceEditorWorkspace({
  target,
  requestedCursorOffset,
  pendingTarget,
  pendingAttachmentInsertion,
  onDirtyChange,
  onTargetUpdated,
  onMessageChanged,
  onClose,
  onLocate,
  onDiscardAndSwitch,
  onAttachmentInsertionApplied,
}: {
  target: SourceEditorTarget;
  requestedCursorOffset?: number;
  pendingTarget?: SourceEditorTarget | null;
  pendingAttachmentInsertion?: { referenceUri: string; displayName: string; image: boolean; placement: "inline" | "after_message" } | null;
  onDirtyChange: (dirty: boolean) => void;
  onTargetUpdated: (target: SourceEditorTarget) => void;
  onMessageChanged: (message: MessageListItem) => Promise<void> | void;
  onClose: () => void;
  onLocate: (messageId: string, blockIndex: number) => void | Promise<void>;
  onDiscardAndSwitch: () => void;
  onAttachmentInsertionApplied?: () => void;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const queryClient = useQueryClient();
  const cursorOffsetRef = useRef(target.cursorOffset);
  const message = target.message;
  const [, setUploadSessionId] = useState<string | null>(null);
  const [, setUploadItemIds] = useState<string[]>([]);
  const uploadSessionIdRef = useRef<string | null>(null);
  const uploadItemIdsRef = useRef<string[]>([]);
  const uploadSessionPromiseRef = useRef<Promise<string> | null>(null);
  const uploadJobsRef = useRef(new Map<string, UploadJob>());
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false);
  const [localAttachmentInsertion, setLocalAttachmentInsertion] = useState<{ referenceUri: string; displayName: string; image: boolean; placement: "inline" | "after_message" } | null>(null);
  const text = message.current_version?.display_text ?? message.current_version?.plain_text ?? "";
  const versionNumber = message.current_version?.version_number ?? 1;
  const effectiveAttachmentInsertion = localAttachmentInsertion ?? pendingAttachmentInsertion;

  async function ensureUploadSession(): Promise<string> {
    if (uploadSessionIdRef.current) return uploadSessionIdRef.current;
    if (!uploadSessionPromiseRef.current) {
      uploadSessionPromiseRef.current = createAttachmentUploadSession(message.conversation_id, {
        targetMessageId: message.id,
        baseMessageVersionId: message.current_version?.id,
      }).then((session) => {
        uploadSessionIdRef.current = session.id;
        setUploadSessionId(session.id);
        return session.id;
      }).finally(() => { uploadSessionPromiseRef.current = null; });
    }
    return uploadSessionPromiseRef.current;
  }

  async function startUploadJob(job: UploadJob): Promise<void> {
    try {
      const sessionId = await ensureUploadSession();
      if (job.cancelled) return;
      const request = uploadAttachmentItem(sessionId, job.file, (progress) => job.callbacks.onProgress(job.token, progress));
      job.cancel = request.cancel;
      const item = await request.promise;
      if (job.cancelled) return;
      job.itemId = item.id;
      uploadItemIdsRef.current = uploadItemIdsRef.current.includes(item.id) ? uploadItemIdsRef.current : [...uploadItemIdsRef.current, item.id];
      setUploadItemIds((current) => current.includes(item.id) ? current : [...current, item.id]);
      job.callbacks.onComplete(job.token, item);
    } catch (error) {
      if (job.cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
      job.callbacks.onError(job.token, error instanceof Error ? error.message : "Attachment upload failed.");
    }
  }

  function handleAttachmentFiles(files: File[], _position: number, callbacks: AttachmentDraftCallbacks): AttachmentDraft[] {
    const drafts = files.map((file) => ({
      token: `draft-${crypto.randomUUID()}`,
      displayName: file.name || "attachment.bin",
      image: (file.type || "").startsWith("image/"),
    }));
    drafts.forEach((draft, index) => {
      const job: UploadJob = { token: draft.token, file: files[index], callbacks };
      uploadJobsRef.current.set(job.token, job);
      void startUploadJob(job);
    });
    return drafts;
  }

  function retryAttachment(token: string): void {
    const job = uploadJobsRef.current.get(token);
    if (!job) return;
    job.cancelled = false;
    void startUploadJob(job);
  }

  function removeAttachment(token: string): void {
    const job = uploadJobsRef.current.get(token);
    if (!job) return;
    job.cancelled = true;
    job.cancel?.();
    if (job.itemId && uploadSessionIdRef.current) {
      uploadItemIdsRef.current = uploadItemIdsRef.current.filter((id) => id !== job.itemId);
      setUploadItemIds((current) => current.filter((id) => id !== job.itemId));
      void deleteAttachmentUploadItem(uploadSessionIdRef.current, job.itemId).catch(() => undefined);
    }
    uploadJobsRef.current.delete(token);
  }

  async function handleAttachmentCancel(preserve: boolean, itemIds: string[]): Promise<void> {
    for (const job of uploadJobsRef.current.values()) {
      job.cancelled = true;
      job.cancel?.();
    }
    const readyIds = itemIds.filter((itemId) => uploadItemIdsRef.current.includes(itemId));
    if (uploadSessionIdRef.current && readyIds.length) {
      if (preserve) {
        await finalizeConversationAttachments(message.conversation_id, readyIds);
      } else {
        await Promise.all(readyIds.map((itemId) => deleteAttachmentUploadItem(uploadSessionIdRef.current!, itemId).catch(() => undefined)));
      }
    }
    await queryClient.invalidateQueries({ queryKey: ["conversation-attachments", message.conversation_id] });
    setUploadItemIds([]);
    uploadItemIdsRef.current = [];
    uploadSessionIdRef.current = null;
    setUploadSessionId(null);
    uploadJobsRef.current.clear();
    onClose();
  }

  useEffect(() => {
    cursorOffsetRef.current = target.cursorOffset;
  }, [target.cursorOffset, target.message.id]);

  function requestClose() {
    const button = document.querySelector<HTMLButtonElement>(`#${FORM_ID} [data-source-editor-close='true']`);
    button?.click();
  }

  async function locateCurrentSource() {
    const blockIndex = blockIndexForSourceOffset(text, normalizedMessageBlocks(message), cursorOffsetRef.current);
    await onLocate(message.id, blockIndex);
  }

  const pendingBanner = pendingTarget ? (
    <div className="shrink-0 border-b border-[var(--mark-border)] bg-[var(--mark-bg)] p-3 text-sm text-primary" role="status">
      <p className="font-medium">{zh ? "\u6e90\u7801\u6709\u672a\u4fdd\u5b58\u4fee\u6539\uff0c\u5df2\u9501\u5b9a\u5f53\u524d\u6d88\u606f\u3002" : "Unsaved changes keep the editor locked to this message."}</p>
      <p className="mt-1 text-xs text-secondary">{zh ? "\u9605\u8bfb\u4f4d\u7f6e\u5df2\u8fdb\u5165\u4e0b\u4e00\u6761\u6d88\u606f\u3002" : "The reading line has moved into another message."}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => void locateCurrentSource()} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-ui bg-surface px-3 text-xs font-medium text-primary hover:bg-subtle"><Undo2 className="h-4 w-4" />{zh ? "\u8fd4\u56de\u539f\u6587" : "Return to source"}</button>
        <button type="submit" form={FORM_ID} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[var(--text)] px-3 text-xs font-medium text-[var(--surface)]"><SaveAll className="h-4 w-4" />{zh ? "\u4fdd\u5b58\u540e\u5207\u6362" : "Save and switch"}</button>
        <button type="button" onClick={onDiscardAndSwitch} className="min-h-9 rounded-lg px-3 text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger-soft)]">{zh ? "\u653e\u5f03\u540e\u5207\u6362" : "Discard and switch"}</button>
      </div>
    </div>
  ) : null;

  return (
    <FloatingWorkspacePanel
      storageKey="chat-reader:source-editor-panel"
      placement="left-overlay"
      title={zh ? "Markdown \u6e90\u7801" : "Markdown source"}
      subtitle={`${message.role === "user" ? (zh ? "\u4f60" : "You") : "Assistant"} - #${message.ordinal ?? message.order_key} - v${versionNumber}`}
      closeLabel={zh ? "\u5173\u95ed\u6e90\u7801\u7f16\u8f91" : "Close source editor"}
      resetLabel={zh ? "\u590d\u4f4d\u7f16\u8f91\u5668" : "Reset editor position"}
      onClose={requestClose}
      banner={pendingBanner}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-10 shrink-0 items-center justify-between border-b border-ui bg-surface px-2">
          <div className="flex min-w-0 items-center gap-1">
            <label htmlFor={`${FORM_ID}-attachment-input`} className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-3 text-xs font-medium text-secondary hover:bg-subtle"><Upload className="h-4 w-4" />{zh ? "添加附件" : "Add attachment"}</label>
            <button type="button" onClick={() => setAttachmentPickerOpen(true)} className="inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium text-secondary hover:bg-subtle"><Paperclip className="h-4 w-4" />{zh ? "选择当前对话文件" : "Choose conversation file"}</button>
          </div>
          <button type="button" onClick={() => void locateCurrentSource()} className="inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium text-secondary hover:bg-subtle" title={zh ? "\u5728\u6b63\u6587\u4e2d\u5b9a\u4f4d" : "Locate in reader"}><LocateFixed className="h-4 w-4" />{zh ? "\u5728\u6b63\u6587\u4e2d\u5b9a\u4f4d" : "Locate in reader"}</button>
        </div>
        <div className="min-h-0 flex-1">
          <EditMessageForm
            key={`${message.id}:${message.current_version?.id ?? "initial"}`}
            formId={FORM_ID}
            initialText={text}
            initialCursorOffset={target.cursorOffset}
            requestedCursorOffset={requestedCursorOffset}
            pendingAttachmentInsertion={effectiveAttachmentInsertion}
            onAttachmentInsertionApplied={() => { setLocalAttachmentInsertion(null); onAttachmentInsertionApplied?.(); }}
            messageId={message.id}
            versionNumber={versionNumber}
            onCursorOffsetChange={(offset) => { cursorOffsetRef.current = offset; }}
            onDirtyChange={onDirtyChange}
            onCancel={() => onClose()}
            onAttachmentFiles={handleAttachmentFiles}
            onAttachmentRetry={retryAttachment}
            onAttachmentRemove={removeAttachment}
            onAttachmentCancel={handleAttachmentCancel}
            onSave={async (nextText, reason, saveMode) => {
              const response = await editMessage(message.id, {
                displayText: nextText,
                editReason: reason,
                baseVersionId: message.current_version?.id,
                saveMode,
                uploadItemIds: uploadItemIdsRef.current,
              });
              await queryClient.invalidateQueries({ queryKey: ["message-versions", message.id] });
              await onMessageChanged(response.message);
              onTargetUpdated({ message: response.message, cursorOffset: cursorOffsetRef.current });
              setUploadItemIds([]);
              uploadItemIdsRef.current = [];
              uploadSessionIdRef.current = null;
              setUploadSessionId(null);
              uploadJobsRef.current.clear();
            }}
          />
        </div>
        {attachmentPickerOpen ? (
          <ConversationAttachmentPicker
            conversationId={message.conversation_id}
            zh={zh}
            onClose={() => setAttachmentPickerOpen(false)}
            onChoose={(attachment, placement) => {
              const mime = attachment.detected_mime_type ?? attachment.asset_object?.detected_mime_type ?? attachment.declared_mime_type ?? "";
              setLocalAttachmentInsertion({
                referenceUri: `cr-asset://${attachment.id}`,
                displayName: attachment.display_name,
                image: mime.startsWith("image/"),
                placement,
              });
              setAttachmentPickerOpen(false);
            }}
          />
        ) : null}
      </div>
    </FloatingWorkspacePanel>
  );
}

function ConversationAttachmentPicker({ conversationId, zh, onClose, onChoose }: {
  conversationId: string;
  zh: boolean;
  onClose: () => void;
  onChoose: (attachment: AttachmentRead, placement: "inline" | "after_message") => void;
}) {
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["conversation-attachments", conversationId],
    queryFn: () => getConversationAttachments(conversationId),
  });
  const items = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (query.data ?? []).filter((item) => item.resolution_status === "resolved" && item.status === "available")
      .filter((item) => !needle || `${item.display_name} ${item.original_filename}`.toLocaleLowerCase().includes(needle));
  }, [query.data, search]);
  return (
    <div className="fixed inset-0 z-[240] flex items-end justify-center bg-[var(--overlay)] sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={zh ? "选择当前对话文件" : "Choose conversation file"}>
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label={zh ? "关闭" : "Close"} />
      <section className="relative flex max-h-[min(78dvh,44rem)] w-full max-w-2xl flex-col overflow-hidden rounded-t-xl border border-ui bg-raised shadow-2xl sm:rounded-xl" data-testid="source-editor-attachment-picker">
        <header className="flex min-h-14 items-center gap-3 border-b border-ui px-4">
          <Paperclip className="h-4 w-4 text-accent" />
          <h2 className="min-w-0 flex-1 text-sm font-semibold text-primary">{zh ? "选择当前对话文件" : "Choose conversation file"}</h2>
          <button type="button" onClick={onClose} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={zh ? "关闭" : "Close"}><X className="h-4 w-4" /></button>
        </header>
        <label className="relative m-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} autoFocus className="min-h-10 w-full rounded-lg border border-ui bg-surface pl-9 pr-3 text-sm text-primary outline-none focus:border-[var(--accent)]" placeholder={zh ? "搜索文件" : "Search files"} />
        </label>
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-ui p-3">
          {query.isLoading ? <p className="py-8 text-center text-sm text-secondary">{zh ? "正在加载文件..." : "Loading files..."}</p> : null}
          {!query.isLoading && items.length === 0 ? <p className="py-8 text-center text-sm text-secondary">{zh ? "没有可用文件" : "No available files"}</p> : null}
          <div className="space-y-1">
            {items.map((attachment) => {
              const mime = attachment.detected_mime_type ?? attachment.asset_object?.detected_mime_type ?? attachment.declared_mime_type ?? "";
              const image = mime.startsWith("image/") && mime !== "image/svg+xml";
              return (
                <div key={attachment.id} className="flex min-h-14 items-center gap-3 rounded-lg px-2 hover:bg-subtle" data-testid="source-editor-attachment-option">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface text-secondary">{image ? <ImageIcon className="h-4 w-4" /> : <File className="h-4 w-4" />}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-primary">{attachment.display_name}</span><span className="block truncate text-xs text-secondary">{mime}</span></span>
                  <button type="button" onClick={() => onChoose(attachment, "inline")} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-surface" aria-label={zh ? `在光标处插入 ${attachment.display_name}` : `Insert ${attachment.display_name} at cursor`} title={zh ? "插入光标位置" : "Insert at cursor"}><Plus className="h-4 w-4" /></button>
                  <button type="button" onClick={() => onChoose(attachment, "after_message")} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-surface" aria-label={zh ? `放到消息末尾 ${attachment.display_name}` : `Place ${attachment.display_name} after message`} title={zh ? "放到消息末尾" : "Place after message"}><Link2 className="h-4 w-4" /></button>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

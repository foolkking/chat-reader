"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eraser, Eye, EyeOff, File, Image as ImageIcon, Link2, LocateFixed, Paperclip, Plus, SaveAll, Search, Undo2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FloatingWorkspacePanel } from "../../components/floating-workspace-panel";
import { usePreferences } from "../../components/preferences-provider";
import { createAttachmentUploadSession, deleteAttachmentUploadItem, deleteConversationAttachment, editMessage, finalizeConversationAttachments, getConversation, getConversationAttachments, getConversationReaderTurn, uploadAttachmentItem } from "../../lib/api";
import type { AttachmentRead, MessageEditResponse, MessageListItem, NavigateTarget } from "../../lib/types";
import { ContentCleanupDialog, type CleanupSourceSelection } from "../conversations/content-cleanup-panel";
import { EditMessageForm, type SourceTextSelection } from "./edit-message-form";
import { blockIndexForSourceOffset, normalizedMessageBlocks, sourceOffsetForBlock } from "./message-source-position";
import type { AttachmentDraft, AttachmentDraftCallbacks } from "./source-attachment-drop";

export type SourceEditorTarget = {
  message: MessageListItem;
  cursorOffset: number;
};

const FORM_ID = "reader-source-editor-form";

type UploadJob = {
  token: string;
  file: File;
  sessionId?: string;
  itemId?: string;
  attachmentId?: string;
  cancel?: () => void;
  callbacks: AttachmentDraftCallbacks;
  cancelled?: boolean;
  inFlight?: boolean;
};

export function SourceEditorWorkspace({
  target,
  requestedCursorOffset,
  pendingTarget,
  pendingAttachmentInsertion,
  onDirtyChange,
  onTargetUpdated,
  onMessageChanged,
  onConversationRevision,
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
  onConversationRevision?: (revision: number) => void;
  onClose: () => void;
  onLocate: (target: NavigateTarget) => void | Promise<void>;
  onDiscardAndSwitch: () => void;
  onAttachmentInsertionApplied?: () => void;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const queryClient = useQueryClient();
  const cursorOffsetRef = useRef(target.cursorOffset);
  const message = target.message;
  const uploadJobsRef = useRef(new Map<string, UploadJob>());
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false);
  // Source editing is the primary task. Rich preview is opt-in so opening the
  // workspace never halves the editor or starts a potentially heavy render
  // until the user asks for it.
  const [showPreview, setShowPreview] = useState(false);
  const [localAttachmentInsertion, setLocalAttachmentInsertion] = useState<{ referenceUri: string; displayName: string; image: boolean; placement: "inline" | "after_message" } | null>(null);
  const [saveBaseVersionId, setSaveBaseVersionId] = useState(message.current_version?.id);
  const [editorDirty, setEditorDirty] = useState(false);
  const [sourceSelection, setSourceSelection] = useState<SourceTextSelection | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);

  const conversationAttachmentsQuery = useQuery({
    queryKey: ["conversation-attachments", message.conversation_id],
    queryFn: () => getConversationAttachments(message.conversation_id),
  });
  const text = message.current_version?.display_text ?? message.current_version?.plain_text ?? "";
  const versionNumber = message.current_version?.version_number ?? 1;
  const effectiveAttachmentInsertion = localAttachmentInsertion ?? pendingAttachmentInsertion;

  async function startUploadJob(job: UploadJob): Promise<void> {
    if (job.inFlight || job.cancelled) return;
    job.inFlight = true;
    try {
      if (!job.sessionId) {
        const session = await createAttachmentUploadSession(message.conversation_id, {
          targetMessageId: message.id,
          baseMessageVersionId: message.current_version?.id,
        });
        job.sessionId = session.id;
      }
      if (job.cancelled) return;
      if (!job.itemId) {
        const request = uploadAttachmentItem(job.sessionId, job.file, (progress) => job.callbacks.onProgress(job.token, progress));
        job.cancel = request.cancel;
        const item = await request.promise;
        job.itemId = item.id;
      }
      if (job.cancelled) return;
      const finalized = await finalizeConversationAttachments(message.conversation_id, [job.itemId]);
      const attachment = finalized[0];
      if (!attachment) throw new Error("Uploaded attachment could not be finalized.");
      job.attachmentId = attachment.id;
      if (job.cancelled) {
        await deleteConversationAttachment(message.conversation_id, attachment.id).catch(() => undefined);
        return;
      }
      queryClient.setQueryData<AttachmentRead[]>(
        ["conversation-attachments", message.conversation_id],
        (current) => current?.some((item) => item.id === attachment.id) ? current : [...(current ?? []), attachment],
      );
      job.callbacks.onComplete(job.token, { id: job.itemId, attachmentId: attachment.id });
    } catch (error) {
      if (job.cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
      // Publish the retryable state only after the job is no longer in flight.
      // Otherwise the Retry control can render while this guard is still true,
      // making an immediate user retry a no-op.
      job.inFlight = false;
      job.callbacks.onError(job.token, error instanceof Error ? error.message : "Attachment upload failed.");
    } finally {
      job.inFlight = false;
      job.cancel = undefined;
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
    });
    // Insert transient markers into the authoritative document before even an
    // immediate upload can complete and attempt canonicalization.
    queueMicrotask(() => {
      for (const draft of drafts) {
        const job = uploadJobsRef.current.get(draft.token);
        if (job && !job.cancelled) void startUploadJob(job);
      }
    });
    return drafts;
  }

  async function retryAttachment(token: string): Promise<void> {
    const previousJob = uploadJobsRef.current.get(token);
    if (!previousJob || previousJob.inFlight) return;
    previousJob.cancelled = true;
    const job: UploadJob = {
      token,
      file: previousJob.file,
      callbacks: previousJob.callbacks,
      inFlight: true,
    };
    // Replace the failed job object so late callbacks from the failed attempt
    // cannot overwrite the retry's ready/error state.
    uploadJobsRef.current.set(token, job);
    // Claim the retry synchronously before the cleanup await. This prevents
    // two immediate clicks from racing and starting duplicate finalization.
    job.inFlight = true;
    // A failed finalize may leave its staging item ready but unusable (for
    // example after a transient 5xx). Start a fresh idempotent upload attempt
    // instead of reusing that item, while retaining the same editor marker.
    const previousSessionId = previousJob.sessionId;
    const previousItemId = previousJob.itemId;
    if (previousSessionId && previousItemId && !job.attachmentId) {
      job.sessionId = undefined;
      job.itemId = undefined;
      // Cleanup is best-effort and must not hold the user-facing retry path.
      // The upload session/item has already failed finalization; retry with a
      // fresh item while the server reclaims the stale staging row.
      void deleteAttachmentUploadItem(previousSessionId, previousItemId).catch(() => undefined);
    }
    job.inFlight = false;
    await startUploadJob(job);
  }

  function removeAttachment(token: string): void {
    const job = uploadJobsRef.current.get(token);
    if (!job) return;
    job.cancelled = true;
    job.cancel?.();
    if (job.attachmentId) {
      void deleteConversationAttachment(message.conversation_id, job.attachmentId)
        .then(() => queryClient.invalidateQueries({ queryKey: ["conversation-attachments", message.conversation_id] }))
        .catch(() => undefined);
    } else if (job.itemId && job.sessionId) {
      void deleteAttachmentUploadItem(job.sessionId, job.itemId).catch(() => undefined);
    }
    uploadJobsRef.current.delete(token);
  }

  async function handleAttachmentCancel(preserve: boolean, _itemIds: string[]): Promise<void> {
    const cleanup: Promise<unknown>[] = [];
    for (const job of uploadJobsRef.current.values()) {
      job.cancelled = true;
      job.cancel?.();
      if (!preserve && job.attachmentId) {
        cleanup.push(deleteConversationAttachment(message.conversation_id, job.attachmentId).catch(() => undefined));
      } else if (job.itemId && job.sessionId && !job.attachmentId) {
        cleanup.push(deleteAttachmentUploadItem(job.sessionId, job.itemId).catch(() => undefined));
      }
    }
    await Promise.all(cleanup);
    await queryClient.invalidateQueries({ queryKey: ["conversation-attachments", message.conversation_id] });
    uploadJobsRef.current.clear();
    onClose();
  }

  useEffect(() => {
    cursorOffsetRef.current = target.cursorOffset;
  }, [target.cursorOffset, target.message.id]);

  useEffect(() => {
    setSaveBaseVersionId(message.current_version?.id);
    setSourceSelection(null);
    setCleanupOpen(false);
  }, [message.id, message.current_version?.id]);

  function requestClose() {
    const button = document.querySelector<HTMLButtonElement>(`#${FORM_ID} [data-source-editor-close='true']`);
    button?.click();
  }

  async function locateCurrentSource() {
    const blocks = normalizedMessageBlocks(message);
    const sourceOffset = Math.max(0, Math.min(cursorOffsetRef.current, text.length));
    const blockIndex = blockIndexForSourceOffset(text, blocks, sourceOffset);
    const blockStart = sourceOffsetForBlock(text, blocks, `block-${message.id}-${blockIndex}`);
    const localOffset = Math.max(0, sourceOffset - blockStart);
    const quoteStart = Math.max(0, sourceOffset - 80);
    const quoteEnd = Math.min(text.length, sourceOffset + 80);
    await onLocate({
      messageId: message.id,
      messageVersionId: message.current_version?.id,
      blockIndex,
      characterOffset: localOffset,
      endCharacterOffset: localOffset,
      canonicalStart: sourceOffset,
      canonicalEnd: sourceOffset,
      quote: text.slice(quoteStart, quoteEnd).trim() || undefined,
      prefix: text.slice(Math.max(0, quoteStart - 40), quoteStart),
      suffix: text.slice(quoteEnd, Math.min(text.length, quoteEnd + 40)),
      source: "message-action",
    });
  }

  async function loadLatestMessage(): Promise<MessageListItem> {
    const [conversation, turn] = await Promise.all([
      getConversation(message.conversation_id),
      getConversationReaderTurn(message.conversation_id, message.id),
    ]);
    const latestMessage = turn.items.find((item) => item.id === message.id);
    if (!latestMessage?.current_version?.id) {
      throw new Error(zh ? "无法加载最新消息状态。" : "Unable to load the latest message state.");
    }
    setSaveBaseVersionId(latestMessage.current_version.id);
    onConversationRevision?.(conversation.offline_revision);
    await onMessageChanged(latestMessage);
    onTargetUpdated({ message: latestMessage, cursorOffset: cursorOffsetRef.current });
    return latestMessage;
  }

  const cleanupSelection: CleanupSourceSelection | null = sourceSelection ? {
    messageId: message.id,
    startOffset: sourceSelection.startOffset,
    endOffset: sourceSelection.endOffset,
    text: sourceSelection.text,
  } : null;
  const selectionState = editorDirty
    ? "dirty-blocked"
    : sourceSelection
      ? (sourceSelection.startOffset === sourceSelection.endOffset ? "collapsed" : "active")
      : "none";
  const selectedCharacterCount = sourceSelection ? Array.from(sourceSelection.text).length : 0;

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
    <>
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
      <div className="flex h-full min-h-0 flex-col" data-source-selection-state={selectionState}>
        <div className="flex min-h-10 shrink-0 items-center justify-between border-b border-ui bg-surface px-2">
          <div className="flex min-w-0 items-center gap-1">
            <label htmlFor={`${FORM_ID}-attachment-input`} className="inline-flex h-10 w-10 cursor-pointer items-center justify-center gap-2 rounded-lg text-xs font-medium text-secondary hover:bg-subtle sm:h-auto sm:min-h-9 sm:w-auto sm:px-3" aria-label={zh ? "添加附件" : "Add attachment"} title={zh ? "添加附件" : "Add attachment"}><Upload className="h-4 w-4" /><span className="hidden sm:inline">{zh ? "添加附件" : "Add attachment"}</span></label>
            <button type="button" onClick={() => setAttachmentPickerOpen(true)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={zh ? "选择当前对话文件" : "Choose conversation file"} title={zh ? "选择当前对话文件" : "Choose conversation file"}><Paperclip className="h-4 w-4" /></button>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" data-testid="source-editor-preview-toggle" aria-pressed={showPreview} onClick={() => setShowPreview((value) => !value)} className="inline-flex h-10 w-10 items-center justify-center gap-2 rounded-lg text-xs font-medium text-secondary hover:bg-subtle sm:h-auto sm:min-h-9 sm:w-auto sm:px-3" title={zh ? (showPreview ? "\u9690\u85cf\u5b9e\u65f6\u9884\u89c8" : "\u663e\u793a\u5b9e\u65f6\u9884\u89c8") : (showPreview ? "Hide live preview" : "Show live preview")}>{showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}<span className="hidden sm:inline">{zh ? "\u9884\u89c8" : "Preview"}</span></button>
            <button type="button" data-testid="source-editor-cleanup-selection" disabled={!sourceSelection || editorDirty} onClick={() => setCleanupOpen(true)} className="inline-flex h-10 w-10 items-center justify-center gap-2 rounded-lg text-xs font-medium text-secondary hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40 sm:h-auto sm:min-h-9 sm:w-auto sm:px-3" aria-label={zh ? "清理噪声" : "Clean noise"} title={!sourceSelection ? (zh ? "先在 Markdown 源码中选择需要清理的文本" : "Select text in the Markdown source first") : editorDirty ? (zh ? "请先保存源码修改，再清理已保存版本" : "Save source changes before cleaning the persisted version") : (zh ? "审查并清理选中的噪声" : "Review and clean the selected noise")}><Eraser className="h-4 w-4" /><span className="hidden sm:inline">{zh ? "清理噪声" : "Clean noise"}</span></button>
            <button type="button" onClick={() => void locateCurrentSource()} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={zh ? "在正文中定位" : "Locate in reader"} title={zh ? "\u5728\u6b63\u6587\u4e2d\u5b9a\u4f4d" : "Locate in reader"}><LocateFixed className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
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
            onSelectionChange={setSourceSelection}
            onDirtyChange={(dirty) => { setEditorDirty(dirty); onDirtyChange(dirty); }}
            onCancel={() => onClose()}
            onAttachmentFiles={handleAttachmentFiles}
            onAttachmentRetry={retryAttachment}
            onAttachmentRemove={removeAttachment}
            onAttachmentCancel={handleAttachmentCancel}
            conversationAttachments={conversationAttachmentsQuery.data ?? []}
            showPreview={showPreview}
            onReloadLatest={async () => { await loadLatestMessage(); }}
            onSave={async (nextText, reason, saveMode, removedActions) => {
              const clickedAt = window.performance.now();
              const requestStartedAt = window.performance.now();
              const response = await editMessage(message.id, {
                contentMarkdown: nextText,
                editReason: reason,
                baseVersionId: saveBaseVersionId,
                saveMode,
                removedAttachmentActions: removedActions,
              });
              const networkCompletedAt = window.performance.now();
              queryClient.setQueryData(
                ["conversation-attachments", message.conversation_id],
                (current: AttachmentRead[] | undefined) => patchConversationAttachmentCache(
                  current,
                  response,
                  message.id,
                  saveMode,
                  removedActions,
                ),
              );
              const cacheCompletedAt = window.performance.now();
              onConversationRevision?.(response.conversation_revision);
              await onMessageChanged(response.message);
              await nextPaint();
              const renderCompletedAt = window.performance.now();
              window.dispatchEvent(new CustomEvent("chat-reader:message-save-performance", { detail: {
                save_click_to_request_ms: requestStartedAt - clickedAt,
                network_ms: networkCompletedAt - requestStartedAt,
                cache_update_ms: cacheCompletedAt - networkCompletedAt,
                reader_render_ms: renderCompletedAt - cacheCompletedAt,
              } }));
              void queryClient.invalidateQueries({ queryKey: ["message-versions", message.id] });
              onTargetUpdated({ message: response.message, cursorOffset: cursorOffsetRef.current });
              setSaveBaseVersionId(response.message.current_version?.id);
              uploadJobsRef.current.clear();
            }}
          />
          {sourceSelection && selectedCharacterCount > 0 ? <div className="source-editor-selection-badge" data-testid="source-editor-selection-status" role="status" aria-live="polite">{zh ? `已选择 ${selectedCharacterCount} 个字符` : `${selectedCharacterCount} chars selected`}</div> : null}
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
    <ContentCleanupDialog
      open={cleanupOpen}
      conversationId={message.conversation_id}
      selection={cleanupSelection}
      onClose={() => setCleanupOpen(false)}
      onApplied={async () => { await loadLatestMessage(); setSourceSelection(null); }}
    />
    </>
  );
}

function patchConversationAttachmentCache(
  current: AttachmentRead[] | undefined,
  response: MessageEditResponse,
  messageId: string,
  saveMode: "create_version" | "replace_current",
  removedActions: Array<{ attachment_id: string; action: "keep_in_conversation" | "detach_from_conversation" }>,
): AttachmentRead[] | undefined {
  if (!current) return current;
  const detached = new Set(
    removedActions
      .filter((item) => item.action === "detach_from_conversation")
      .map((item) => item.attachment_id),
  );
  const nextByAttachment = new Map<string, MessageEditResponse["attachment_occurrences"]>();
  for (const occurrence of response.attachment_occurrences) {
    const rows = nextByAttachment.get(occurrence.attachment.id) ?? [];
    rows.push(occurrence);
    nextByAttachment.set(occurrence.attachment.id, rows);
  }

  return current
    .filter((attachment) => !detached.has(attachment.id))
    .map((attachment) => {
      const previous = attachment.occurrences ?? [];
      const retained = previous
        .filter((occurrence) => !(saveMode === "replace_current" && occurrence.message_id === messageId && occurrence.is_current_version))
        .map((occurrence) => occurrence.message_id === messageId && occurrence.is_current_version
          ? { ...occurrence, is_current_version: false }
          : occurrence);
      const next = (nextByAttachment.get(attachment.id) ?? []).map((occurrence) => ({
        message_id: messageId,
        message_version_id: occurrence.message_version_id,
        is_current_version: true,
        occurrence_key: occurrence.occurrence_key,
        placement: occurrence.placement,
        block_index: occurrence.block_index,
        render_block_id: occurrence.render_block_id,
        start_offset: occurrence.start_offset,
        end_offset: occurrence.end_offset,
      }));
      const occurrences = [...retained, ...next];
      const currentOccurrenceCount = occurrences.filter((occurrence) => occurrence.is_current_version).length;
      return {
        ...attachment,
        occurrence_count: occurrences.length,
        current_occurrence_count: currentOccurrenceCount,
        message_count: new Set(occurrences.map((occurrence) => occurrence.message_id)).size,
        is_used: currentOccurrenceCount > 0,
        occurrences,
      };
    });
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
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
              const image = mime.startsWith("image/");
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

"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eraser, Eye, EyeOff, File, Image as ImageIcon, Link2, LocateFixed, Paperclip, Plus, Redo2, SaveAll, Search, Undo2, Upload, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FloatingWorkspacePanel } from "../../components/floating-workspace-panel";
import { usePreferences } from "../../components/preferences-provider";
import { measureImportImageLane } from "../import/image-import-lane";
import { useDialogFocus } from "../../components/use-dialog-focus";
import { ApiRequestError, createAttachmentUploadSession, deleteAttachmentUploadItem, deleteConversationAttachment, editMessage, finalizeConversationAttachments, getAttachmentUploadSession, getMessage, getMessageSaveReceipt, getConversation, getConversationAttachments, getConversationReaderTurn, uploadAttachmentItem } from "../../lib/api";
import { authenticationGeneration } from "../../lib/offline-access";
import type { AttachmentRead, MessageEditResponse, MessageListItem, NavigateTarget } from "../../lib/types";
import { ContentCleanupDialog, type CleanupSourceSelection } from "../conversations/content-cleanup-panel";
import { sourceEditorNavigationTarget } from "../conversations/reader-locator-target";
import { EditMessageForm, type SourceReloadRequest, type SourceSaveResult, type SourceTextSelection } from "./edit-message-form";
import type { AttachmentDraft, AttachmentDraftCallbacks, AttachmentReferenceTarget, SourceAttachmentInsertion } from "./source-attachment-drop";
import { findMarkdownAttachmentReferences } from "./source-attachment-drop";
import { forgetSourceSave, readSourceSave, rememberSourceSave, type SourceSaveAttempt } from "./source-save-receipt";
import { keepUploadReceipt, readUploadReceipts } from "../attachments/upload-receipts";

export type SourceEditorTarget = {
  message: MessageListItem;
  cursorOffset: number;
};

const FORM_ID = "reader-source-editor-form";

type UploadJob = {
  token: string;
  generation: number;
  file?: File;
  filename: string;
  byteSize: number;
  mimeType: string;
  lastModified: number;
  sessionId?: string;
  itemId?: string;
  attachmentId?: string;
  imageLaneWidth?: number;
  cancel?: () => void;
  callbacks: AttachmentDraftCallbacks;
  cancelled?: boolean;
  inFlight?: boolean;
  requestId: string;
  sessionRequestId: string;
  attempted?: boolean;
  sessionAttempted?: boolean;
  readyToRun?: boolean;
  finalizeAttempted?: boolean;
  baseVersionId?: string;
  rejected?: boolean;
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
  onDiscardAndSwitch: () => void | Promise<void>;
  onAttachmentInsertionApplied?: () => void;
}) {
  const { resolvedLocale, readerWidthMode, sectionTocMode } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const queryClient = useQueryClient();
  const cursorOffsetRef = useRef(target.cursorOffset);
  const message = target.message;
  const uploadJobsRef = useRef(new Map<string, UploadJob>());
  const workspaceActiveRef = useRef(true);
  const reselectUploadRef = useRef<HTMLInputElement | null>(null);
  const reselectTokenRef = useRef<string | null>(null);
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false);
  // Source editing is the primary task. Rich preview is opt-in so opening the
  // workspace never halves the editor or starts a potentially heavy render
  // until the user asks for it.
  const [showPreview, setShowPreview] = useState(false);
  const [editorToolsOpen, setEditorToolsOpen] = useState(false);
  const [historyCommandRequest, setHistoryCommandRequest] = useState<{ id: number; command: "undo" | "redo"; messageId: string } | null>(null);
  const editorToolsButtonRef = useRef<HTMLButtonElement | null>(null);
  const [localAttachmentInsertion, setLocalAttachmentInsertion] = useState<SourceAttachmentInsertion | null>(null);
  const [focusedAttachment, setFocusedAttachment] = useState<AttachmentReferenceTarget | null>(null);
  const [saveBase, setSaveBase] = useState(message.current_version);
  const [sourceReloadRequest, setSourceReloadRequest] = useState<SourceReloadRequest | null>(null);
  const baselineMessageRef = useRef(message.id);
  const comparisonMessageRef = useRef<MessageListItem | null>(null);
  const saveAttemptRef = useRef<SourceSaveAttempt | null>(null);
  const [recoveredSave, setRecoveredSave] = useState<SourceSaveAttempt | null>(null);
  const [saveRecoveryReady, setSaveRecoveryReady] = useState(false);
  const [receiptStorageUnavailable, setReceiptStorageUnavailable] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const uploadRunningRef = useRef(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [sourceSelection, setSourceSelection] = useState<SourceTextSelection | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [discardSwitchBusy, setDiscardSwitchBusy] = useState(false);
  const [discardSwitchError, setDiscardSwitchError] = useState<string | null>(null);
  const discardSwitchBusyRef = useRef(false);

  const conversationAttachmentsQuery = useQuery({
    queryKey: ["conversation-attachments", message.conversation_id],
    queryFn: () => getConversationAttachments(message.conversation_id),
  });
  const text = message.current_version?.display_text ?? message.current_version?.plain_text ?? "";
  const versionNumber = message.current_version?.version_number ?? 1;
  const effectiveAttachmentInsertion = localAttachmentInsertion ?? pendingAttachmentInsertion;
  const uploadReceiptScope = `${message.conversation_id}:${message.id}`;
  async function rememberUpload(job: UploadJob, status: string) {
    const saved = await keepUploadReceipt(uploadReceiptScope, {
      id: job.token, sessionRequestId: job.sessionRequestId, itemRequestId: job.requestId,
      sessionId: job.sessionId, uploadItemId: job.itemId,
      sessionAttempted: job.sessionAttempted, uploadAttempted: job.attempted,
      status, progress: 0, filename: job.filename, byteSize: job.byteSize,
      mimeType: job.mimeType, lastModified: job.lastModified,
      baseVersionId: job.baseVersionId,
    }, job.file);
    if (!saved && workspaceActiveRef.current && job.generation === authenticationGeneration()) setReceiptStorageUnavailable(true);
  }
  async function restoreAttachmentDrafts(tokens: string[], callbacks: AttachmentDraftCallbacks): Promise<AttachmentDraft[]> {
    const generation = authenticationGeneration();
    const receipts = await readUploadReceipts(uploadReceiptScope);
    if (!workspaceActiveRef.current || generation !== authenticationGeneration()) return [];
    return receipts.filter(({ receipt }) => tokens.includes(receipt.id)).map(({ receipt, file }) => {
      if (!uploadJobsRef.current.has(receipt.id)) uploadJobsRef.current.set(receipt.id, {
        token: receipt.id, generation, file, filename: receipt.filename, byteSize: receipt.byteSize,
        mimeType: receipt.mimeType, lastModified: receipt.lastModified,
        callbacks, sessionRequestId: receipt.sessionRequestId, requestId: receipt.itemRequestId ?? receipt.id,
        baseVersionId: receipt.baseVersionId,
        sessionId: receipt.sessionId, itemId: receipt.uploadItemId,
        sessionAttempted: receipt.sessionAttempted, attempted: receipt.uploadAttempted,
        finalizeAttempted: ["finalizing", "resolved"].includes(receipt.status),
        rejected: receipt.status === "rejected",
      });
      return { token: receipt.id, displayName: receipt.filename, image: receipt.mimeType.startsWith("image/") };
    });
  }

  useEffect(() => {
    let active = true;
    const generation = authenticationGeneration();
    setSaveRecoveryReady(false);
    void readSourceSave(message.id).then(attempt => {
      if (!active || generation !== authenticationGeneration()) return;
      saveAttemptRef.current = attempt;
      setRecoveredSave(attempt);
      setSaveRecoveryReady(true);
    });
    return () => { active = false; };
  }, [message.id]);

  async function startUploadJob(job: UploadJob): Promise<void> {
    if (job.inFlight || job.cancelled || job.generation !== authenticationGeneration() || !workspaceActiveRef.current) return;
    job.inFlight = true;
    job.callbacks.onProgress(job.token, 0);
    const generation = job.generation;
    const check = () => { if (!workspaceActiveRef.current || generation !== authenticationGeneration() || job.cancelled) throw new Error("Account or editor changed"); };
    try {
      if (!job.sessionId) {
        const session = job.sessionAttempted
          ? await getAttachmentUploadSession(job.sessionRequestId)
          : await (async () => {
            job.sessionAttempted = true;
            await rememberUpload(job, "session");
            check();
            return createAttachmentUploadSession(message.conversation_id, {
              targetMessageId: message.id, baseMessageVersionId: job.baseVersionId, requestId: job.sessionRequestId,
            });
          })();
        check();
        job.sessionId = session.id;
      }
      if (job.cancelled) return;
      if (!job.itemId) {
        const item = job.attempted
          ? (await getAttachmentUploadSession(job.sessionId)).items.find(item => item.id === job.requestId)
          : await (async () => {
            if (!job.file) throw new Error(zh ? "请重试并重新选择原文件。" : "Retry and reselect the original file.");
            job.attempted = true;
            await rememberUpload(job, "uploading");
            check();
            const request = uploadAttachmentItem(job.sessionId!, job.file, progress => job.callbacks.onProgress(job.token, progress), job.requestId);
            job.cancel = request.cancel;
            return request.promise;
          })();
        check();
        if (!item) {
          job.attempted = false;
          throw new Error(zh ? "未找到上传回执。再次重试将使用原请求身份上传同一文件。" : "No upload receipt found. Retry again to upload the same file with its original request identity.");
        }
        job.itemId = item.id;
        if (item.validation_status !== "ready" && item.validation_status !== "committed") {
          job.rejected = true;
          void rememberUpload(job, "rejected");
          throw new Error(zh ? "附件未通过检查，请替换源文件。" : "Attachment checks did not pass. Replace the source file.");
        }
      }
      if (job.cancelled) return;
      job.imageLaneWidth ??= measureImportImageLane({ readerWidthMode, sectionTocMode });
      if (job.finalizeAttempted) {
        const attachments = await getConversationAttachments(message.conversation_id);
        check();
        const accepted = attachments.find(item => item.source_attachment_id === job.itemId);
        if (accepted) {
          job.attachmentId = accepted.id;
          void rememberUpload(job, "resolved");
          job.callbacks.onComplete(job.token, { id: job.itemId, attachmentId: accepted.id });
          return;
        }
        const receipt = (await getAttachmentUploadSession(job.sessionId)).items.find(item => item.id === job.itemId);
        check();
        if (receipt?.validation_status === "ready") job.finalizeAttempted = false;
        throw new Error(zh ? "尚未确认附件加入结果。原上传已保留，可再次核对或重试原条目。" : "Attachment acceptance is not confirmed. The original upload is retained; check again or retry this item.");
      }
      job.finalizeAttempted = true;
      await rememberUpload(job, "finalizing");
      check();
      const finalized = await finalizeConversationAttachments(message.conversation_id, [job.itemId], job.imageLaneWidth);
      check();
      const attachment = finalized[0];
      if (!attachment) throw new Error("Uploaded attachment could not be finalized.");
      job.attachmentId = attachment.id;
      void rememberUpload(job, "resolved");
      if (job.cancelled) {
        return;
      }
      queryClient.setQueryData<AttachmentRead[]>(
        ["conversation-attachments", message.conversation_id],
        (current) => current?.some((item) => item.id === attachment.id) ? current : [...(current ?? []), attachment],
      );
      job.callbacks.onComplete(job.token, { id: job.itemId, attachmentId: attachment.id });
    } catch (error) {
      if (generation !== authenticationGeneration()) return;
      if (job.cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
      if (!job.sessionId && error instanceof ApiRequestError && error.status === 404) job.sessionAttempted = false;
      // Publish the retryable state only after the job is no longer in flight.
      // Otherwise the Retry control can render while this guard is still true,
      // making an immediate user retry a no-op.
      job.inFlight = false;
      job.callbacks.onError(job.token, error instanceof Error ? error.message : "Attachment upload failed.", job.rejected ? "replace_source" : undefined);
    } finally {
      job.inFlight = false;
      job.cancel = undefined;
    }
  }

  async function drainUploads(): Promise<void> {
    if (uploadRunningRef.current) return;
    uploadRunningRef.current = true;
    try {
      for (const job of uploadJobsRef.current.values()) {
        if (!job.readyToRun || job.cancelled) continue;
        job.readyToRun = false;
        await startUploadJob(job);
      }
    } finally { uploadRunningRef.current = false; }
  }

  function handleAttachmentFiles(files: File[], _position: number, callbacks: AttachmentDraftCallbacks): AttachmentDraft[] {
    const drafts = files.map((file) => ({
      token: `draft-${crypto.randomUUID()}`,
      displayName: file.name || "attachment.bin",
      image: (file.type || "").startsWith("image/"),
    }));
    drafts.forEach((draft, index) => {
      const job: UploadJob = { token: draft.token, generation: authenticationGeneration(), file: files[index], callbacks,
        filename: files[index].name, byteSize: files[index].size, mimeType: files[index].type, lastModified: files[index].lastModified,
        requestId: crypto.randomUUID(), sessionRequestId: crypto.randomUUID(), baseVersionId: saveBase?.id, readyToRun: true };
      uploadJobsRef.current.set(job.token, job);
    });
    // Insert transient markers into the authoritative document before even an
    // immediate upload can complete and attempt canonicalization.
    queueMicrotask(() => {
      void drainUploads();
    });
    return drafts;
  }

  async function retryAttachment(token: string): Promise<void> {
    const job = uploadJobsRef.current.get(token);
    if (!job || job.inFlight || job.readyToRun) return;
    if (job.rejected || !job.file && !job.itemId && !job.attempted) {
      reselectTokenRef.current = token; reselectUploadRef.current?.click(); return;
    }
    job.readyToRun = true;
    await drainUploads();
  }

  function removeAttachment(token: string): void {
    const job = uploadJobsRef.current.get(token);
    if (!job) return;
    job.cancelled = true;
    job.cancel?.();
    // Removing a reference is not permission to delete a conversation file.
  }

  async function handleAttachmentCancel(preserve: boolean, _itemIds: string[]): Promise<void> {
    await cancelAttachmentJobs(preserve);
    onClose();
  }

  async function cancelAttachmentJobs(preserve: boolean): Promise<void> {
    const cleanup: Promise<unknown>[] = [];
    for (const job of uploadJobsRef.current.values()) {
      job.cancelled = true;
      job.cancel?.();
      if (!preserve && job.attachmentId) {
        cleanup.push(deleteConversationAttachment(message.conversation_id, job.attachmentId).catch(() => undefined));
      } else if (!preserve && job.itemId && job.sessionId && !job.attachmentId) {
        cleanup.push(deleteAttachmentUploadItem(job.sessionId, job.itemId).catch(() => undefined));
      }
    }
    await Promise.all(cleanup);
    void queryClient.invalidateQueries({ queryKey: ["conversation-attachments", message.conversation_id] }).catch(() => undefined);
    uploadJobsRef.current.clear();
  }

  async function discardAndSwitch(): Promise<void> {
    if (discardSwitchBusyRef.current) return;
    discardSwitchBusyRef.current = true;
    setDiscardSwitchBusy(true);
    setDiscardSwitchError(null);
    try {
      await cancelAttachmentJobs(false);
      await onDiscardAndSwitch();
    } catch {
      setDiscardSwitchError(zh
        ? "附件清理尚未完成，当前编辑器已保留。请稍后重试。"
        : "Attachment cleanup did not finish. This editor was kept open; try again.");
    } finally {
      discardSwitchBusyRef.current = false;
      setDiscardSwitchBusy(false);
    }
  }

  useEffect(() => {
    cursorOffsetRef.current = target.cursorOffset;
  }, [target.cursorOffset, target.message.id]);

  useEffect(() => {
    if (baselineMessageRef.current === message.id) return;
    baselineMessageRef.current = message.id;
    setSaveBase(message.current_version);
    setSourceReloadRequest(null);
    setHistoryCommandRequest(null);
    comparisonMessageRef.current = null;
    saveAttemptRef.current = null;
    setSourceSelection(null);
    setCleanupOpen(false);
    setEditorToolsOpen(false);
  }, [message.id, message.current_version?.id]);

  useEffect(() => {
    setDiscardSwitchError(null);
  }, [pendingTarget?.message.id, pendingTarget?.cursorOffset]);

  useEffect(() => {
    workspaceActiveRef.current = true;
    return () => {
    workspaceActiveRef.current = false;
    for (const job of uploadJobsRef.current.values()) {
      job.cancelled = true;
      job.cancel?.();
    }
    uploadJobsRef.current.clear();
    };
  }, [message.conversation_id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || !event.ctrlKey || event.key.toLowerCase() !== "c") return;
      const eventTarget = event.target;
      // A nested editor or confirmation owns focus; never open tools behind it.
      if (event.defaultPrevented || !(eventTarget instanceof Element)
        || eventTarget.closest('[role="dialog"][aria-modal="true"]')
        || !eventTarget.closest("[data-source-editor-shell='true']")) return;
      event.preventDefault();
      if (editorToolsOpen) {
        window.dispatchEvent(new CustomEvent("chat-reader:source-command-panel-focus"));
      } else {
        setEditorToolsOpen(true);
        window.requestAnimationFrame(() => {
          window.dispatchEvent(new CustomEvent("chat-reader:source-command-panel-focus"));
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editorToolsOpen]);

  function requestClose() {
    const button = document.querySelector<HTMLButtonElement>(`#${FORM_ID} [data-source-editor-close='true']`);
    button?.click();
  }

  async function locateCurrentSource() {
    if (editorDirty) return;
    await onLocate(sourceEditorNavigationTarget(message, text, cursorOffsetRef.current));
  }

  async function loadLatestMessage(signal?: AbortSignal): Promise<MessageListItem> {
    const generation = authenticationGeneration();
    const expectedText = saveBase?.display_text ?? saveBase?.plain_text ?? text;
    const check = () => {
      signal?.throwIfAborted();
      if (!workspaceActiveRef.current || generation !== authenticationGeneration()
        || baselineMessageRef.current !== message.id) throw new Error("Account or editor changed");
    };
    const [conversation, turn] = await Promise.all([
      getConversation(message.conversation_id, signal),
      getConversationReaderTurn(message.conversation_id, message.id, signal),
    ]);
    check();
    const latestMessage = turn.items.find((item) => item.id === message.id);
    if (!latestMessage?.current_version?.id) {
      throw new Error(zh ? "无法加载最新消息状态。" : "Unable to load the latest message state.");
    }
    const latest = savedSource(latestMessage.current_version);
    onConversationRevision?.(conversation.offline_revision);
    await onMessageChanged(latestMessage);
    check();
    comparisonMessageRef.current = latestMessage;
    setSourceReloadRequest({ messageId: message.id, expectedText, latest });
    onTargetUpdated({ message: latestMessage, cursorOffset: cursorOffsetRef.current });
    return latestMessage;
  }

  function savedSource(value: NonNullable<MessageListItem["current_version"]>): SourceSaveResult {
    if (!value.source_content_hash) throw new Error("Source receipt is missing its source hash");
    return { canonicalText: value.display_text ?? value.plain_text ?? "", versionId: value.id,
      contentHash: value.source_content_hash, versionNumber: value.version_number };
  }

  async function refreshReader(savedMessage?: MessageListItem): Promise<void> {
    const generation = authenticationGeneration();
    try {
      const latest = savedMessage ?? await getMessage(message.id);
      if (generation !== authenticationGeneration()) return;
      await onMessageChanged(latest);
      if (generation !== authenticationGeneration()) return;
      onTargetUpdated({ message: latest, cursorOffset: cursorOffsetRef.current });
      setRefreshFailed(false);
    } catch {
      if (generation === authenticationGeneration()) setRefreshFailed(true);
    }
  }

  async function verifySave(): Promise<SourceSaveResult> {
    const attempt = saveAttemptRef.current;
    if (!attempt || attempt.generation !== authenticationGeneration()) throw new Error("No pending save in this account");
    const receipt = await getMessageSaveReceipt(message.id, attempt.operationId);
    if (attempt.generation !== authenticationGeneration()) throw new Error("Account changed");
    const confirmed = { ...saveBase!, id: receipt.current_version_id, version_number: receipt.version_number,
      content_hash: receipt.content_hash, source_content_hash: receipt.source_content_hash, display_text: attempt.text, plain_text: attempt.text };
    setSaveBase(confirmed);
    setSourceReloadRequest(null);
    comparisonMessageRef.current = null;
    saveAttemptRef.current = null;
    setRecoveredSave(null);
    void forgetSourceSave(message.id, attempt.operationId);
    releaseSavedUploadReceipts(attempt.text);
    onConversationRevision?.(receipt.conversation_revision);
    void refreshReader();
    return savedSource(confirmed);
  }

  function releaseSavedUploadReceipts(source: string) {
    const referenced = new Set(findMarkdownAttachmentReferences(source, "cr-asset").map(ref => ref.identifier));
    for (const job of uploadJobsRef.current.values()) {
      if (job.attachmentId && referenced.has(job.attachmentId)) void rememberUpload(job, "committed");
    }
  }

  async function performSave(attempt: SourceSaveAttempt): Promise<SourceSaveResult> {
    const clickedAt = window.performance.now();
    const generation = attempt.generation;
    let response;
    try {
      response = await editMessage(message.id, attempt.payload);
    } catch (error) {
      if (generation !== authenticationGeneration()) throw new Error("Account changed");
      if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500 && error.status !== 408) {
        saveAttemptRef.current = null;
        setRecoveredSave(null);
        void forgetSourceSave(message.id, attempt.operationId);
        throw error;
      }
      throw new ApiRequestError("Save result unknown", 0, "", "save_result_unknown");
    }
    if (generation !== authenticationGeneration()) throw new Error("Account changed");
    if ("status" in response) return verifySave();
    const networkCompletedAt = window.performance.now();
    const confirmed = response.message_version;
    setSaveBase(confirmed);
    setSourceReloadRequest(null);
    comparisonMessageRef.current = null;
    saveAttemptRef.current = null;
    setRecoveredSave(null);
    void forgetSourceSave(message.id, attempt.operationId);
    releaseSavedUploadReceipts(attempt.text);
    // Refresh/cache publication cannot undo the confirmed write.
    try {
      queryClient.setQueryData(
        ["conversation-attachments", message.conversation_id],
        (current: AttachmentRead[] | undefined) => patchConversationAttachmentCache(
          current, response, message.id, attempt.payload.saveMode ?? "create_version",
          attempt.payload.removedAttachmentActions ?? [],
        ),
      );
      onConversationRevision?.(response.conversation_revision);
      const cacheCompletedAt = window.performance.now();
      void queryClient.invalidateQueries({ queryKey: ["message-versions", message.id] }).catch(() => setRefreshFailed(true));
      void refreshReader(response.message).then(nextPaint).then(() => {
        if (generation !== authenticationGeneration()) return;
        window.dispatchEvent(new CustomEvent("chat-reader:message-save-performance", { detail: {
          save_click_to_request_ms: 0, network_ms: networkCompletedAt - clickedAt,
          cache_update_ms: cacheCompletedAt - networkCompletedAt,
          reader_render_ms: window.performance.now() - cacheCompletedAt,
        } }));
      });
    } catch { setRefreshFailed(true); }
    return savedSource(confirmed);
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
      {discardSwitchError ? <p className="mt-1 text-xs text-[var(--danger)]" role="alert">{discardSwitchError}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={discardSwitchBusy} onClick={() => void locateCurrentSource()} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-ui bg-surface px-3 text-xs font-medium text-primary hover:bg-subtle disabled:opacity-50"><Undo2 className="h-4 w-4" />{zh ? "\u8fd4\u56de\u539f\u6587" : "Return to source"}</button>
        <button type="submit" disabled={discardSwitchBusy} form={FORM_ID} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[var(--text)] px-3 text-xs font-medium text-[var(--surface)] disabled:opacity-50"><SaveAll className="h-4 w-4" />{zh ? "\u4fdd\u5b58\u540e\u5207\u6362" : "Save and switch"}</button>
        <button type="button" disabled={discardSwitchBusy} onClick={() => void discardAndSwitch()} className="min-h-9 rounded-lg px-3 text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-50">{discardSwitchBusy ? (zh ? "\u6b63\u5728\u6e05\u7406\u2026" : "Cleaning up\u2026") : (zh ? "\u653e\u5f03\u540e\u5207\u6362" : "Discard and switch")}</button>
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
      <div className="flex h-full min-h-0 flex-col" data-source-editor-shell="true" data-source-selection-state={selectionState}>
        <input ref={reselectUploadRef} type="file" className="hidden" data-testid="source-editor-reselect-upload"
          onChange={event => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
            const token = reselectTokenRef.current; reselectTokenRef.current = null;
            const job = token ? uploadJobsRef.current.get(token) : undefined;
            if (!file || !job || job.generation !== authenticationGeneration()) return;
            if (!job.rejected && (file.name !== job.filename || file.size !== job.byteSize)) {
              job.callbacks.onError(job.token, zh ? "名称或大小不符，请重新选择原文件。" : "Name or size differs. Reselect the original file.");
              return;
            }
            if (job.rejected) {
              if (job.sessionId && job.itemId) void deleteAttachmentUploadItem(job.sessionId, job.itemId).catch(() => undefined);
              Object.assign(job, { rejected: false, sessionId: undefined, itemId: undefined,
                sessionRequestId: crypto.randomUUID(), requestId: crypto.randomUUID(),
                sessionAttempted: false, attempted: false, finalizeAttempted: false,
                filename: file.name, byteSize: file.size, mimeType: file.type, lastModified: file.lastModified });
            }
            job.file = file; job.readyToRun = true; void drainUploads();
          }} />
        <div className="flex min-h-10 shrink-0 items-center justify-between border-b border-ui bg-surface px-2">
          <div className="flex min-w-0 items-center gap-1">
            <label htmlFor={`${FORM_ID}-attachment-input`} className="inline-flex h-10 w-10 cursor-pointer items-center justify-center gap-2 rounded-lg text-xs font-medium text-secondary hover:bg-subtle sm:h-auto sm:min-h-9 sm:w-auto sm:px-3" aria-label={zh ? "添加附件" : "Add attachment"} title={zh ? "添加附件" : "Add attachment"}><Upload className="h-4 w-4" /><span className="hidden sm:inline">{zh ? "添加附件" : "Add attachment"}</span></label>
            <button type="button" onClick={() => { setEditorToolsOpen(false); setAttachmentPickerOpen(true); }} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={zh ? "选择当前对话文件" : "Choose conversation file"} title={zh ? "选择当前对话文件" : "Choose conversation file"}><Paperclip className="h-4 w-4" /></button>
            <button ref={editorToolsButtonRef} type="button" data-testid="source-editor-tools-toggle" aria-expanded={editorToolsOpen} aria-controls="source-editor-command-panel" onClick={() => setEditorToolsOpen((value) => !value)} className={`inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle ${editorToolsOpen ? "bg-subtle text-primary" : ""}`} aria-label={zh ? "编辑工具" : "Editing tools"} title={zh ? "编辑工具（Ctrl + Alt + C）" : "Editing tools (Ctrl + Alt + C)"}><Wand2 className="h-4 w-4" /></button>
            <span className="mx-0.5 h-5 w-px bg-[var(--border)]" aria-hidden="true" />
            <button type="button" data-testid="source-editor-undo" onClick={() => setHistoryCommandRequest((current) => ({ id: (current?.id ?? 0) + 1, command: "undo", messageId: message.id }))} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]" aria-label={zh ? "撤销" : "Undo"} title={zh ? "撤销（Ctrl+Z）" : "Undo (Ctrl+Z)"}><Undo2 className="h-4 w-4" /></button>
            <button type="button" data-testid="source-editor-redo" onClick={() => setHistoryCommandRequest((current) => ({ id: (current?.id ?? 0) + 1, command: "redo", messageId: message.id }))} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]" aria-label={zh ? "重做" : "Redo"} title={zh ? "重做（Ctrl+Y）" : "Redo (Ctrl+Y)"}><Redo2 className="h-4 w-4" /></button>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" data-testid="source-editor-preview-toggle" aria-pressed={showPreview} onClick={() => setShowPreview((value) => !value)} className="inline-flex h-10 w-10 items-center justify-center gap-2 rounded-lg text-xs font-medium text-secondary hover:bg-subtle sm:h-auto sm:min-h-9 sm:w-auto sm:px-3" title={zh ? (showPreview ? "\u9690\u85cf\u5b9e\u65f6\u9884\u89c8" : "\u663e\u793a\u5b9e\u65f6\u9884\u89c8") : (showPreview ? "Hide live preview" : "Show live preview")}>{showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}<span className="hidden sm:inline">{zh ? "\u9884\u89c8" : "Preview"}</span></button>
            <button type="button" data-testid="source-editor-cleanup-selection" disabled={!sourceSelection || editorDirty} onClick={() => { setEditorToolsOpen(false); setCleanupOpen(true); }} className="inline-flex h-10 w-10 items-center justify-center gap-2 rounded-lg text-xs font-medium text-secondary hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40 sm:h-auto sm:min-h-9 sm:w-auto sm:px-3" aria-label={zh ? "清理噪声" : "Clean noise"} title={!sourceSelection ? (zh ? "先在 Markdown 源码中选择需要清理的文本" : "Select text in the Markdown source first") : editorDirty ? (zh ? "请先保存源码修改，再清理已保存版本" : "Save source changes before cleaning the persisted version") : (zh ? "审查并清理选中的噪声" : "Review and clean the selected noise")}><Eraser className="h-4 w-4" /><span className="hidden sm:inline">{zh ? "清理噪声" : "Clean noise"}</span></button>
            <button type="button" onClick={() => void locateCurrentSource()} disabled={editorDirty} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40" aria-label={zh ? "在正文中定位" : "Locate in reader"} title={editorDirty ? (zh ? "请先保存源码修改，再定位已保存正文" : "Save source changes before locating the persisted text") : (zh ? "在正文中定位" : "Locate in reader")}><LocateFixed className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          <EditMessageForm
            key={message.id}
            formId={FORM_ID}
            initialText={text}
            initialCursorOffset={target.cursorOffset}
            requestedCursorOffset={requestedCursorOffset}
            pendingAttachmentInsertion={effectiveAttachmentInsertion}
            onAttachmentInsertionApplied={() => { setLocalAttachmentInsertion(null); onAttachmentInsertionApplied?.(); }}
            onOpenAttachmentPicker={() => { setEditorToolsOpen(false); setAttachmentPickerOpen(true); }}
            messageId={message.id}
            conversationId={message.conversation_id}
            versionNumber={saveBase?.version_number ?? versionNumber}
            versionId={saveBase?.id}
            contentHash={saveBase?.source_content_hash}
            sourceReloadRequest={sourceReloadRequest}
            saveRecoveryReady={saveRecoveryReady}
            pendingSave={recoveredSave}
            readerRefreshPending={refreshFailed}
            onRefreshReader={() => void refreshReader()}
            receiptStorageUnavailable={receiptStorageUnavailable}
            onCursorOffsetChange={(offset) => { cursorOffsetRef.current = offset; }}
            onSelectionChange={setSourceSelection}
            onAttachmentFocus={setFocusedAttachment}
            onDirtyChange={(dirty) => { setEditorDirty(dirty); onDirtyChange(dirty); }}
            onCancel={() => onClose()}
            onAttachmentFiles={handleAttachmentFiles}
            onAttachmentRetry={retryAttachment}
            onRestoreAttachmentDrafts={restoreAttachmentDrafts}
            onAttachmentRemove={removeAttachment}
            onAttachmentCancel={handleAttachmentCancel}
            conversationAttachments={conversationAttachmentsQuery.data ?? []}
            showPreview={showPreview}
            onPreviewChange={setShowPreview}
            editorToolsOpen={editorToolsOpen}
            onEditorToolsOpenChange={setEditorToolsOpen}
            historyCommandRequest={historyCommandRequest?.messageId === message.id ? historyCommandRequest : null}
            onReloadLatest={async () => {
              const generation = authenticationGeneration();
              const latest = await getMessage(message.id);
              if (generation !== authenticationGeneration() || !latest.current_version) throw new Error("Source unavailable");
              comparisonMessageRef.current = latest;
              return savedSource(latest.current_version);
            }}
            onAcceptLatest={() => {
              const latest = comparisonMessageRef.current;
              if (latest?.current_version) setSaveBase(latest.current_version);
              comparisonMessageRef.current = null;
              setSourceReloadRequest(null);
            }}
            onVerifySave={verifySave}
            onRetrySave={async () => {
              const attempt = saveAttemptRef.current;
              if (!attempt || attempt.generation !== authenticationGeneration()) throw new Error("No pending save");
              return performSave(attempt);
            }}
            onSave={async (nextText, reason, saveMode, removedActions, editorRevision) => {
              if (saveAttemptRef.current) throw new ApiRequestError("Save result unknown", 0, "", "save_result_unknown");
              const generation = authenticationGeneration();
              const operationId = crypto.randomUUID();
              const attempt: SourceSaveAttempt = {
                operationId, text: nextText, generation, payload: {
                  contentMarkdown: nextText, editReason: reason, baseVersionId: saveBase?.id,
                  baseContentHash: saveBase?.source_content_hash, operationId, saveMode, editorRevision,
                  removedAttachmentActions: removedActions,
                },
              };
              saveAttemptRef.current = attempt;
              const persisted = await rememberSourceSave(message.id, attempt);
              if (generation !== authenticationGeneration()) throw new Error("Account changed");
              setReceiptStorageUnavailable(!persisted);
              return performSave(attempt);
            }}
          />
          {sourceSelection && selectedCharacterCount > 0 ? <div className="source-editor-selection-badge" data-testid="source-editor-selection-status" role="status" aria-live="polite">{zh ? `已选择 ${selectedCharacterCount} 个字符` : `${selectedCharacterCount} chars selected`}</div> : null}
        </div>
        {attachmentPickerOpen ? (
          <ConversationAttachmentPicker
            conversationId={message.conversation_id}
            zh={zh}
            replaceTarget={focusedAttachment}
            onRemove={() => {
              if (focusedAttachment) setLocalAttachmentInsertion({
                referenceUri: "", displayName: "", image: false, placement: "inline",
                replace: { ...focusedAttachment, scope: "one", remove: true },
              });
              setAttachmentPickerOpen(false);
            }}
            onClose={() => setAttachmentPickerOpen(false)}
            onChoose={(attachment, placement, replaceAll) => {
              const mime = attachment.detected_mime_type ?? attachment.asset_object?.detected_mime_type ?? attachment.declared_mime_type ?? "";
              setLocalAttachmentInsertion({
                referenceUri: `cr-asset://${attachment.id}`,
                displayName: attachment.display_name,
                image: mime.startsWith("image/"),
                placement,
                ...(focusedAttachment && placement === "inline"
                  ? { replace: { ...focusedAttachment, scope: replaceAll ? "all" as const : "one" as const } } : {}),
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
      onApplied={async (signal) => { await loadLatestMessage(signal); setSourceSelection(null); }}
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
  return new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
}

function ConversationAttachmentPicker({ conversationId, zh, onClose, onChoose, replaceTarget, onRemove }: {
  conversationId: string;
  zh: boolean;
  onClose: () => void;
  onChoose: (attachment: AttachmentRead, placement: "inline" | "after_message", replaceAll?: boolean) => void;
  replaceTarget: AttachmentReferenceTarget | null;
  onRemove: () => void;
}) {
  const [replaceAll, setReplaceAll] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const query = useQuery({
    queryKey: ["conversation-attachments", conversationId],
    queryFn: () => getConversationAttachments(conversationId),
  });
  const items = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (query.data ?? []).filter((item) => item.resolution_status === "resolved" && item.status === "available")
      .filter((item) => !needle || `${item.display_name} ${item.original_filename}`.toLocaleLowerCase().includes(needle));
  }, [query.data, search]);
  useDialogFocus({ open: true, rootRef, initialFocusRef: searchRef, onClose });
  return (
    <div ref={rootRef} tabIndex={-1} className="fixed inset-0 z-[240] flex items-end justify-center bg-[var(--overlay)] sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={zh ? "选择当前对话文件" : "Choose conversation file"}>
      <button type="button" data-dialog-backdrop className="absolute inset-0" onClick={onClose} aria-label={zh ? "关闭" : "Close"} />
      <section className="relative flex max-h-[min(78dvh,44rem)] w-full max-w-2xl flex-col overflow-hidden rounded-t-xl border border-ui bg-raised shadow-2xl sm:rounded-xl" data-testid="source-editor-attachment-picker">
        <header className="flex min-h-14 items-center gap-3 border-b border-ui px-4">
          <Paperclip className="h-4 w-4 text-accent" />
          <h2 className="min-w-0 flex-1 text-sm font-semibold text-primary">{zh ? "选择当前对话文件" : "Choose conversation file"}</h2>
          <button type="button" onClick={onClose} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={zh ? "关闭" : "Close"}><X className="h-4 w-4" /></button>
        </header>
        {replaceTarget ? <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ui px-4 text-xs">
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={replaceAll} onChange={event => setReplaceAll(event.target.checked)} />{zh ? "替换本条消息中全部引用" : "Replace all references in this message"}</label>
          <button type="button" className="min-h-11 text-[var(--danger)]" onClick={onRemove}>{zh ? "移除此处引用" : "Remove this reference"}</button>
        </div> : null}
        <label className="relative m-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" />
          <input ref={searchRef} data-dialog-initial-focus value={search} onChange={(event) => setSearch(event.target.value)} className="min-h-10 w-full rounded-lg border border-ui bg-surface pl-9 pr-3 text-sm text-primary outline-none focus:border-[var(--accent)]" placeholder={zh ? "搜索文件" : "Search files"} />
        </label>
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-ui p-3">
          {query.isLoading ? <p className="py-8 text-center text-sm text-secondary">{zh ? "正在加载文件..." : "Loading files..."}</p> : null}
          {query.isError ? <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 border-l-2 border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
            <span>{items.length ? (zh ? "文件列表刷新失败，仍显示上次读取的结果。" : "Could not refresh the file list. Previously loaded files are shown.") : (zh ? "暂时无法读取可用文件，请重试。" : "Available files could not be loaded. Try again.")}</span>
            <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()} className="btn-secondary min-h-9 shrink-0 px-3 text-xs font-medium">{query.isFetching ? (zh ? "正在重试…" : "Retrying…") : (zh ? "重试" : "Retry")}</button>
          </div> : null}
          {!query.isLoading && !query.isError && items.length === 0 ? <p className="py-8 text-center text-sm text-secondary">{zh ? "没有可用文件" : "No available files"}</p> : null}
          <div className="space-y-1">
            {items.map((attachment) => {
              const mime = attachment.detected_mime_type ?? attachment.asset_object?.detected_mime_type ?? attachment.declared_mime_type ?? "";
              const image = mime.startsWith("image/");
              return (
                <div key={attachment.id} className="flex min-h-14 items-center gap-3 rounded-lg px-2 hover:bg-subtle" data-testid="source-editor-attachment-option">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface text-secondary">{image ? <ImageIcon className="h-4 w-4" /> : <File className="h-4 w-4" />}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-primary">{attachment.display_name}</span><span className="block truncate text-xs text-secondary">{mime}</span></span>
                  <button type="button" onClick={() => onChoose(attachment, "inline", replaceAll)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-xs text-secondary hover:bg-surface" aria-label={replaceTarget ? (zh ? `用 ${attachment.display_name} 替换引用` : `Replace reference with ${attachment.display_name}`) : zh ? `在光标处插入 ${attachment.display_name}` : `Insert ${attachment.display_name} at cursor`} title={replaceTarget ? (zh ? "替换此处引用" : "Replace this reference") : zh ? "插入光标位置" : "Insert at cursor"}>{replaceTarget ? (zh ? "替换" : "Replace") : <Plus className="h-4 w-4" />}</button>
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

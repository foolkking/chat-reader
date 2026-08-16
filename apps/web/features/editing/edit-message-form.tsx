"use client";

import dynamic from "next/dynamic";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { ChevronDown, Save, SaveAll, X } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import type { AttachmentRead } from "../../lib/types";
import { MarkdownRenderer } from "../conversations/markdown-renderer";
import {
  findTransientUploadReferences,
  insertPendingMarkers,
  removePendingMarker,
  replacePendingMarker,
  resolveAttachmentDropPosition,
  sourceAttachmentDropExtension,
  type AttachmentDraft,
  type AttachmentDraftCallbacks,
  type AttachmentDraftState,
} from "./source-attachment-drop";

const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), { ssr: false });

export function EditMessageForm({
  formId = "source-editor-form",
  initialText,
  messageId,
  initialCursorOffset = 0,
  requestedCursorOffset,
  pendingAttachmentInsertion,
  versionNumber,
  onCursorOffsetChange,
  onDirtyChange,
  onCancel,
  onSave,
  onReloadLatest,
  onAttachmentInsertionApplied,
  onAttachmentFiles,
  onAttachmentRetry,
  onAttachmentRemove,
  onAttachmentCancel,
  onExistingAttachment,
  conversationAttachments = [],
  showPreview = true,
}: {
  formId?: string;
  initialText: string;
  messageId?: string;
  initialCursorOffset?: number;
  requestedCursorOffset?: number;
  pendingAttachmentInsertion?: { referenceUri: string; displayName: string; image: boolean; placement: "inline" | "after_message" } | null;
  versionNumber: number;
  onCursorOffsetChange?: (offset: number) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCancel: (dirty: boolean) => void | Promise<void>;
  onSave: (text: string, reason: string | undefined, mode: "create_version" | "replace_current", removedActions: Array<{ attachment_id: string; action: "keep_in_conversation" | "detach_from_conversation" }>) => Promise<void>;
  onReloadLatest?: () => Promise<void>;
  onAttachmentInsertionApplied?: () => void;
  onAttachmentFiles?: (files: File[], position: number, callbacks: AttachmentDraftCallbacks) => AttachmentDraft[];
  onAttachmentRetry?: (token: string) => void;
  onAttachmentRemove?: (token: string) => void;
  onAttachmentCancel?: (preserve: boolean, itemIds: string[]) => Promise<void> | void;
  onExistingAttachment?: (attachment: { attachmentId: string; displayName: string; mimeType: string }, position: number, originalCodePosition?: number) => void;
  conversationAttachments?: AttachmentRead[];
  showPreview?: boolean;
}) {
  const { t, resolvedLocale, resolvedTheme } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const editorViewRef = useRef<EditorView | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const cursorOffsetChangeRef = useRef(onCursorOffsetChange);
  cursorOffsetChangeRef.current = onCursorOffsetChange;
  const insertFilesRef = useRef<(files: File[], position: number, originalCodePosition?: number) => void>(() => undefined);
  const insertExistingAttachmentRef = useRef<(attachment: { attachmentId: string; displayName: string; mimeType: string }, position: number, originalCodePosition?: number) => void>(() => undefined);
  const queuedFilesRef = useRef<File[]>([]);
  const themeCompartmentRef = useRef(new Compartment());
  const initialThemeRef = useRef(resolvedTheme);
  const appliedInsertionRef = useRef<string | null>(null);
  const [editorDocument, setEditorDocument] = useState(initialText);
  const [text, setText] = useState(initialText);
  const [baselineText, setBaselineText] = useState(initialText);
  const [reason, setReason] = useState("");
  const [showReason, setShowReason] = useState(false);
  const [showClosePrompt, setShowClosePrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revisionConflict, setRevisionConflict] = useState(false);
  const [reloadStatus, setReloadStatus] = useState<"idle" | "loading" | "ready">("idle");
  const [isSaving, setIsSaving] = useState(false);
  const [attachmentDrafts, setAttachmentDrafts] = useState<Record<string, AttachmentDraftState>>({});
  const [pendingCodeDrop, setPendingCodeDrop] = useState<{
    files: File[];
    attachment?: { attachmentId: string; displayName: string; mimeType: string };
    afterPosition: number;
    originalPosition: number;
  } | null>(null);
  const [removedConfirmMode, setRemovedConfirmMode] = useState<"create_version" | "replace_current" | null>(null);
  const [removedActions, setRemovedActions] = useState<Record<string, "keep_in_conversation" | "detach_from_conversation">>({});
  const previewText = useDeferredValue(text);
  const trimmedText = text.trim();
  const isUnchanged = trimmedText === baselineText.trim();
  const hasAttachmentWork = Object.values(attachmentDrafts).some((draft) => draft.status !== "removed");
  const transientUploadReferences = findTransientUploadReferences(text);
  const hasUnresolvedAttachment = transientUploadReferences.length > 0
    || Object.values(attachmentDrafts).some((draft) => draft.status !== "ready" && draft.status !== "removed");
  const canDetachRemovedAttachment = (attachmentId: string) => {
    const attachment = conversationAttachments.find((item) => item.id === attachmentId);
    const draftStillUses = countAttachmentReferences(trimmedText, attachmentId) > 0;
    const anotherCurrentMessageUses = Boolean(
      attachment?.occurrences?.some((item) => item.is_current_version && item.message_id !== messageId),
    );
    return !draftStillUses && !anotherCurrentMessageUses;
  };
  const performAttachmentInsert = (files: File[], position: number) => {
    if (!files.length && pendingCodeDrop?.attachment) {
      performExistingAttachmentInsert(pendingCodeDrop.attachment, position);
      return;
    }
    const callbacks: AttachmentDraftCallbacks = {
      onProgress: (token, progress) => setAttachmentDrafts((current) => current[token] ? { ...current, [token]: { ...current[token], progress } } : current),
      onComplete: (token, item) => {
        const view = editorViewRef.current;
        const canonicalId = item.attachmentId ?? item.id;
        setAttachmentDrafts((current) => current[token] ? {
          ...current,
          [token]: { ...current[token], status: "canonicalizing", itemId: canonicalId, progress: 100 },
        } : current);
        if (!view) {
          setAttachmentDrafts((current) => current[token] ? {
            ...current,
            [token]: { ...current[token], status: "error", error: "The editor is not ready to resolve this attachment." },
          } : current);
          return;
        }
        const replacement = replacePendingMarker(view, token, canonicalId);
        if (replacement === "duplicate") {
          setAttachmentDrafts((current) => current[token] ? {
            ...current,
            [token]: { ...current[token], status: "error", error: "The attachment placeholder is duplicated." },
          } : current);
          return;
        }
        if (findTransientUploadReferences(view.state.doc.toString()).some((reference) => reference.token === token)) {
          setAttachmentDrafts((current) => current[token] ? {
            ...current,
            [token]: { ...current[token], status: "error", error: "The attachment reference could not be resolved." },
          } : current);
          return;
        }
        // EditorView is the save authority. The draft becomes ready only
        // after its canonicalization transaction is visible in that document.
        setText(view.state.doc.toString());
        setAttachmentDrafts((current) => current[token] ? { ...current, [token]: { ...current[token], itemId: canonicalId, status: "ready", progress: 100 } } : current);
      },
      onError: (token, message) => setAttachmentDrafts((current) => current[token] ? { ...current, [token]: { ...current[token], status: "error", error: message } } : current),
    };
    const drafts = onAttachmentFiles?.(files, position, callbacks) ?? [];
    setAttachmentDrafts((current) => ({
      ...current,
      ...Object.fromEntries(drafts.map((draft) => [draft.token, { ...draft, status: "uploading", progress: 0 } as AttachmentDraftState])),
    }));
    const view = editorViewRef.current;
    if (view && drafts.length) {
      insertPendingMarkers(view, drafts, position);
      setText(view.state.doc.toString());
    }
  };
  const performExistingAttachmentInsert = (attachment: { attachmentId: string; displayName: string; mimeType: string }, position: number) => {
    const image = attachment.mimeType.startsWith("image/");
    const label = attachment.displayName.replaceAll("[", "\\[").replaceAll("]", "\\]");
    const markdown = image
      ? `![${label}](cr-asset://${attachment.attachmentId})`
      : `[${zh ? "附件" : "Attachment"}：${label}](cr-asset://${attachment.attachmentId})`;
    const view = editorViewRef.current;
    if (!view) return;
    const line = view.state.doc.lineAt(position);
    const before = position > line.from && view.state.doc.sliceString(position - 1, position) !== "\n" ? "\n\n" : "";
    const after = position < line.to && view.state.doc.sliceString(position, position + 1) !== "\n" ? "\n\n" : "";
    const insert = `${before}${markdown}${after}`;
    const anchor = position + insert.length;
    view.dispatch({ changes: { from: position, insert }, selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
    onExistingAttachment?.(attachment, position);
  };
  const removeAttachmentDraft = (draft: AttachmentDraftState) => {
    const removal = removePendingMarker(editorViewRef.current, draft.token, draft.itemId);
    if (removal === "duplicate") {
      setAttachmentDrafts((current) => current[draft.token] ? {
        ...current,
        [draft.token]: { ...current[draft.token], status: "error", error: "The attachment reference is duplicated." },
      } : current);
      setError(zh ? "\u9644\u4ef6\u5f15\u7528\u91cd\u590d\uff0c\u8bf7\u5728\u6e90\u7801\u4e2d\u4fdd\u7559\u4e00\u5904\u540e\u91cd\u8bd5\u3002" : "The attachment reference is duplicated. Keep one source reference and retry.");
      return;
    }
    if (editorViewRef.current) setText(editorViewRef.current.state.doc.toString());
    setAttachmentDrafts((current) => ({
      ...current,
      [draft.token]: { ...current[draft.token], status: "removed" },
    }));
    onAttachmentRemove?.(draft.token);
  };
  insertFilesRef.current = (files, position, originalCodePosition) => {
    if (originalCodePosition !== undefined) {
      setPendingCodeDrop({ files, afterPosition: position, originalPosition: originalCodePosition });
      return;
    }
    performAttachmentInsert(files, position);
  };
  insertExistingAttachmentRef.current = (attachment, position, originalCodePosition) => {
    if (originalCodePosition !== undefined) {
      setPendingCodeDrop({ files: [], attachment, afterPosition: position, originalPosition: originalCodePosition });
      return;
    }
    performExistingAttachmentInsert(attachment, position);
  };
  const extensions = useMemo(() => codeMirrorExtensions(themeCompartmentRef.current, initialThemeRef.current, {
    onFiles: (files, position, originalCodePosition) => insertFilesRef.current(files, position, originalCodePosition),
    onAttachment: (attachment, position, originalCodePosition) => insertExistingAttachmentRef.current(attachment, position, originalCodePosition),
  }), []);
  const sourceEditorBasicSetup = useMemo(() => ({
    lineNumbers: true,
    highlightActiveLine: true,
    foldGutter: true,
    searchKeymap: true,
  }), []);
  const handleEditorUpdate = useCallback((update: ViewUpdate) => {
    if (!update.docChanged && !update.selectionSet) return;
    const offset = update.state.selection.main.head;
    if (editorHostRef.current) editorHostRef.current.dataset.cursorOffset = String(offset);
    cursorOffsetChangeRef.current?.(offset);
  }, []);

  useEffect(() => {
    const onSourceLocate = (event: Event) => {
      const detail = (event as CustomEvent<{ messageId?: string; cursorOffset?: number }>).detail;
      if (!messageId || detail?.messageId !== messageId || detail.cursorOffset === undefined) return;
      const view = editorViewRef.current;
      if (!view) return;
      const anchor = Math.max(0, Math.min(detail.cursorOffset, view.state.doc.length));
      view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
      cursorOffsetChangeRef.current?.(anchor);
    };
    window.addEventListener("chat-reader:source-editor-locate", onSourceLocate);
    return () => window.removeEventListener("chat-reader:source-editor-locate", onSourceLocate);
  }, [messageId]);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    view.dispatch({ effects: themeCompartmentRef.current.reconfigure(codeMirrorTheme(resolvedTheme)) });
  }, [resolvedTheme]);

  useEffect(() => onDirtyChange?.(!isUnchanged), [isUnchanged, onDirtyChange]);

  useEffect(() => {
    if (!hasAttachmentWork && isUnchanged) return;
    const protectDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [hasAttachmentWork, isUnchanged]);

  useEffect(() => {
    if (initialText === baselineText || !isUnchanged) return;
    setEditorDocument(initialText);
    setText(initialText);
    setBaselineText(initialText);
  }, [baselineText, initialText, isUnchanged]);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || requestedCursorOffset === undefined) return;
    const anchor = Math.max(0, Math.min(requestedCursorOffset, view.state.doc.length));
    view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
    cursorOffsetChangeRef.current?.(anchor);
  }, [requestedCursorOffset]);

  useEffect(() => {
    if (!pendingAttachmentInsertion) {
      appliedInsertionRef.current = null;
      return;
    }
    const view = editorViewRef.current;
    if (view) applyAttachmentInsertion(view, pendingAttachmentInsertion);
  }, [pendingAttachmentInsertion]);

  function applyAttachmentInsertion(view: EditorView, insertion: NonNullable<typeof pendingAttachmentInsertion>) {
    const key = `${insertion.referenceUri}:${insertion.placement}`;
    if (appliedInsertionRef.current === key) return;
    const label = insertion.displayName.replaceAll("[", "\\[").replaceAll("]", "\\]");
    const markdown = insertion.image
      ? `![${label}](${insertion.referenceUri})`
      : `[${zh ? "附件" : "Attachment"}：${label}](${insertion.referenceUri})`;
    let target = insertion.placement === "after_message" ? view.state.doc.length : view.state.selection.main.head;
    if (insertion.placement === "inline") {
      const line = view.state.doc.lineAt(target);
      if (/^\s*!?\[[^\r\n]*\]\(cr-(?:asset|upload):\/\/[^)]+\)\s*$/.test(line.text)) {
        target = line.to;
      }
    }
    const previous = target > 0 ? view.state.doc.sliceString(target - 1, target) : "";
    const next = target < view.state.doc.length ? view.state.doc.sliceString(target, target + 1) : "";
    const before = target > 0 && previous !== "\n" ? "\n\n" : insertion.placement === "after_message" && target > 0 ? "\n" : "";
    const after = target < view.state.doc.length && next !== "\n" ? "\n\n" : "";
    const value = `${before}${markdown}${after}`;
    view.dispatch({ changes: { from: target, insert: value }, selection: { anchor: target + value.length }, effects: EditorView.scrollIntoView(target + value.length, { y: "center" }) });
    appliedInsertionRef.current = key;
    cursorOffsetChangeRef.current?.(target + value.length);
    onAttachmentInsertionApplied?.();
  }

  async function submit(mode: "create_version" | "replace_current", confirmedRemoval = false) {
    setError(null);
    setRevisionConflict(false);
    setReloadStatus("idle");
    const authoritativeSource = editorViewRef.current?.state.doc.toString() ?? text;
    const nextTrimmedText = authoritativeSource.trim();
    const unresolvedReferences = findTransientUploadReferences(authoritativeSource);
    const unresolved = Object.values(attachmentDrafts).find((draft) => draft.status !== "ready" && draft.status !== "removed");
    if (unresolved) {
      setError(zh ? `附件“${unresolved.displayName}”尚未完成，请先重试或移除。` : `Attachment “${unresolved.displayName}” is not ready. Retry or remove it before saving.`);
      return;
    }
    if (unresolvedReferences.length) {
      setError(zh
        ? `\u7b2c ${unresolvedReferences[0].lineNumber} \u884c\u7684\u9644\u4ef6\u4ecd\u5728\u5b8c\u6210\u4e2d\u3002\u8bf7\u7b49\u5f85\u5b8c\u6210\u6216\u79fb\u9664\u8be5\u5f15\u7528\u3002`
        : `The attachment on line ${unresolvedReferences[0].lineNumber} is still resolving. Wait for it to finish or remove the reference.`);
      return;
    }
    if (!nextTrimmedText || nextTrimmedText === baselineText.trim()) return;
    const removedIds = removedAttachmentIds(baselineText, nextTrimmedText);
    if (removedIds.length && !confirmedRemoval) {
      setRemovedActions(Object.fromEntries(removedIds.map((attachmentId) => [attachmentId, "keep_in_conversation"])));
      setRemovedConfirmMode(mode);
      return;
    }
    setIsSaving(true);
    try {
      await onSave(
        nextTrimmedText,
        reason.trim() || undefined,
        mode,
        removedIds.map((attachmentId) => ({ attachment_id: attachmentId, action: removedActions[attachmentId] ?? "keep_in_conversation" })),
      );
      setBaselineText(nextTrimmedText);
      setEditorDocument(nextTrimmedText);
      setText(nextTrimmedText);
      setReason("");
      setShowClosePrompt(false);
      setAttachmentDrafts({});
      setRemovedConfirmMode(null);
      setRemovedActions({});
      onDirtyChange?.(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("unableSaveEdit");
      setError(message);
      setRevisionConflict(isRevisionConflictMessage(message));
    } finally {
      setIsSaving(false);
    }
  }

  function requestClose() {
    if (isUnchanged && !hasAttachmentWork) {
      void onCancel(false);
      return;
    }
    setShowClosePrompt(true);
  }

  async function closeWithAttachments(preserve: boolean) {
    const itemIds = Object.values(attachmentDrafts)
      .filter((draft) => draft.status !== "removed")
      .map((draft) => draft.itemId)
      .filter((itemId): itemId is string => Boolean(itemId));
    setError(null);
    try {
      await onAttachmentCancel?.(preserve, itemIds);
      if (!onAttachmentCancel) await onCancel(true);
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : (zh ? "无法处理未保存的附件。" : "Unable to process unsaved attachments."));
    }
  }

  function insertFilesAtCurrentPosition(view: EditorView, files: File[]): void {
    const original = view.state.selection.main.head;
    const resolved = resolveAttachmentDropPosition(view.state.doc.toString(), original);
    insertFilesRef.current(files, resolved.position, resolved.adjustedFromCode ? original : undefined);
  }

  function applyPendingCodeDrop(position: number): void {
    if (!pendingCodeDrop) return;
    if (pendingCodeDrop.attachment) performExistingAttachmentInsert(pendingCodeDrop.attachment, position);
    else performAttachmentInsert(pendingCodeDrop.files, position);
    setPendingCodeDrop(null);
  }

  return (
    <form id={formId} className="flex h-full min-h-0 flex-col bg-surface" onSubmit={(event) => { event.preventDefault(); void submit("create_version"); }}>
      <input
        id={`${formId}-attachment-input`}
        type="file"
        multiple
        className="hidden"
        data-testid="source-editor-attachment-input"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          const view = editorViewRef.current;
          if (!files.length) return;
          if (!view) {
            queuedFilesRef.current.push(...files);
            return;
          }
          insertFilesAtCurrentPosition(view, files);
        }}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div ref={editorHostRef} className={`min-h-0 min-w-0 flex-1 overflow-hidden ${showPreview ? "border-r border-ui" : ""}`} data-testid="source-editor-codemirror">
          <CodeMirror
          value={editorDocument}
          height="100%"
          extensions={extensions}
          theme="none"
          basicSetup={sourceEditorBasicSetup}
          onCreateEditor={(view) => {
            editorViewRef.current = view;
            view.dispatch({ effects: themeCompartmentRef.current.reconfigure(codeMirrorTheme(resolvedTheme)) });
            const anchor = Math.max(0, Math.min(initialCursorOffset, view.state.doc.length));
            view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
            if (editorHostRef.current) editorHostRef.current.dataset.cursorOffset = String(anchor);
            cursorOffsetChangeRef.current?.(anchor);
            view.focus();
            if (pendingAttachmentInsertion) applyAttachmentInsertion(view, pendingAttachmentInsertion);
            if (queuedFilesRef.current.length) {
              const files = queuedFilesRef.current.splice(0);
              insertFilesAtCurrentPosition(view, files);
            }
          }}
          onUpdate={handleEditorUpdate}
          onChange={setText}
          className="h-full text-sm [&_.cm-editor]:h-full"
          />
        </div>
        {showPreview ? <aside className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-page p-4" data-testid="source-editor-rich-preview" aria-label={zh ? "Markdown 实时预览" : "Live Markdown preview"}>
          <MarkdownRenderer text={previewText} isAssistant={false} scopeId={`editor-${messageId ?? formId}`} />
        </aside> : null}
      </div>
      <footer className="shrink-0 space-y-2 border-t border-ui bg-raised p-3">
        {pendingCodeDrop ? <div className="rounded-lg border border-[var(--mark-border)] bg-[var(--mark-bg)] p-3 text-xs text-primary" role="status" data-testid="source-editor-code-drop-choice">
          <p>{zh ? "当前位置在代码块内。附件放在这里不会在 Reader 中显示。" : "This position is inside a code block, so an attachment placed here will not render in Reader."}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="min-h-8 rounded-md bg-[var(--text)] px-3 font-medium text-[var(--surface)]" onClick={() => { applyPendingCodeDrop(pendingCodeDrop.afterPosition); setPendingCodeDrop(null); }}>{zh ? "插入到代码块之后" : "Insert after code block"}</button>
            <button type="button" className="min-h-8 rounded-md border border-ui bg-surface px-3 font-medium text-primary" onClick={() => { applyPendingCodeDrop(pendingCodeDrop.originalPosition); setPendingCodeDrop(null); }}>{zh ? "仍作为普通文本插入" : "Insert as plain text"}</button>
            <button type="button" className="min-h-8 rounded-md px-3 font-medium text-secondary hover:bg-subtle" onClick={() => setPendingCodeDrop(null)}>{zh ? "取消" : "Cancel"}</button>
          </div>
        </div> : null}
        {Object.values(attachmentDrafts).some((draft) => draft.status !== "removed") ? <div className="space-y-1 rounded-lg border border-ui bg-subtle p-2 text-xs" data-testid="source-editor-attachment-drafts">
          <p className="text-secondary" role="status" aria-live="polite">{zh ? `待保存附件 ${Object.values(attachmentDrafts).filter((draft) => draft.status !== "removed").length} 个` : `${Object.values(attachmentDrafts).filter((draft) => draft.status !== "removed").length} attachment(s) pending save`}</p>
          {Object.values(attachmentDrafts).filter((draft) => draft.status !== "removed").map((draft) => <div key={draft.token} className="flex min-h-7 items-center gap-2" data-testid={`source-editor-upload-${draft.token}`}>
            <span className="min-w-0 flex-1 truncate text-secondary">{draft.status === "uploading" ? (zh ? `\u6b63\u5728\u4e0a\u4f20\uff1a${draft.displayName}` : `Uploading: ${draft.displayName}`) : draft.status === "error" ? (zh ? `\u4e0a\u4f20\u5931\u8d25\uff1a${draft.displayName}` : `Upload failed: ${draft.displayName}`) : draft.displayName}</span>
            {draft.status === "uploading" ? <span className="shrink-0 text-secondary">{draft.progress}%</span> : null}
            {draft.status === "error" ? <button type="button" className="shrink-0 text-[var(--accent)] hover:underline" onClick={() => { setAttachmentDrafts((current) => ({ ...current, [draft.token]: { ...current[draft.token], status: "uploading", error: undefined, progress: 0 } })); onAttachmentRetry?.(draft.token); }}>{zh ? "\u91cd\u8bd5" : "Retry"}</button> : null}
            <button type="button" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-surface" aria-label={zh ? `\u79fb\u9664 ${draft.displayName}` : `Remove ${draft.displayName}`} onClick={() => removeAttachmentDraft(draft)}><X className="h-3.5 w-3.5" /></button>
          </div>)}
        </div> : null}
        <button type="button" onClick={() => setShowReason((value) => !value)} className="inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs font-medium text-secondary hover:bg-subtle"><ChevronDown className={`h-4 w-4 transition ${showReason ? "rotate-180" : ""}`} />{zh ? "\u7f16\u8f91\u8bf4\u660e\uff08\u53ef\u9009\uff09" : "Edit note (optional)"}</button>
        {showReason ? <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("editReason")} className="min-h-10 w-full rounded-lg border border-ui bg-surface px-3 text-sm text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]" /> : null}
        {error ? <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-2 text-sm text-[var(--danger)]" role="alert"><p>{error}</p><p className="mt-1 text-xs">{zh ? "\u672a\u4fdd\u5b58\u7684\u6e90\u7801\u5df2\u4fdd\u7559\uff0c\u53ef\u91cd\u8bd5\u6216\u52a0\u8f7d\u6700\u65b0\u72b6\u6001\u540e\u91cd\u65b0\u4fdd\u5b58\u3002" : "Your unsaved source is preserved. Retry, or load the latest state and save again."}</p>{revisionConflict && onReloadLatest ? <button type="button" disabled={reloadStatus === "loading"} onClick={() => { setReloadStatus("loading"); void onReloadLatest().then(() => { setError(null); setRevisionConflict(false); setReloadStatus("ready"); }).catch((reloadError) => { setReloadStatus("idle"); setError(reloadError instanceof Error ? reloadError.message : (zh ? "\u65e0\u6cd5\u52a0\u8f7d\u6700\u65b0\u72b6\u6001\uff0c\u8bf7\u91cd\u8bd5\u3002" : "Unable to load the latest state. Please retry.")); }); }} className="mt-2 min-h-10 rounded-lg border border-[var(--danger)] px-3 font-medium hover:bg-surface disabled:opacity-60">{reloadStatus === "loading" ? (zh ? "\u6b63\u5728\u52a0\u8f7d\u2026" : "Loading…") : (zh ? "\u52a0\u8f7d\u6700\u65b0\u72b6\u6001" : "Load latest state")}</button> : null}</div> : null}
        {reloadStatus === "ready" ? <div className="rounded-lg border border-ui bg-subtle p-2 text-sm text-primary" role="status">{zh ? "\u5df2\u52a0\u8f7d\u6700\u65b0\u72b6\u6001\uff0c\u4f60\u7684\u8349\u7a3f\u4ecd\u4fdd\u7559\u3002\u8bf7\u68c0\u67e5\u540e\u91cd\u65b0\u4fdd\u5b58\u3002" : "Latest state loaded. Your draft is still preserved; review it and save again."}</div> : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" data-source-editor-close="true" onClick={requestClose} disabled={isSaving} className="min-h-10 rounded-lg px-3 text-sm font-medium text-secondary hover:bg-subtle">{zh ? "\u9605\u8bfb\u6a21\u5f0f" : "Reading mode"}</button>
          {versionNumber > 1 ? <button type="button" onClick={() => void submit("replace_current")} disabled={isSaving || !trimmedText || isUnchanged || hasUnresolvedAttachment} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"><Save className="h-4 w-4" />{zh ? "\u4fdd\u5b58\u5230\u5f53\u524d\u7248\u672c" : "Replace current version"}</button> : null}
          <button type="submit" data-testid="source-editor-create-version" disabled={isSaving || !trimmedText || isUnchanged || hasUnresolvedAttachment} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[var(--text)] px-3 text-sm font-medium text-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"><SaveAll className="h-4 w-4" />{isSaving ? t("saving") : `${zh ? "\u521b\u5efa" : "Create"} v${versionNumber + 1}`}</button>
        </div>
      </footer>
      {removedConfirmMode ? (
        <div className="fixed inset-0 z-[255] flex items-end justify-center bg-[var(--overlay)] p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby={`removed-attachments-${versionNumber}`}>
          <button type="button" className="absolute inset-0" onClick={() => setRemovedConfirmMode(null)} aria-label={zh ? "取消保存" : "Cancel save"} />
          <section className="relative max-h-[80dvh] w-full overflow-y-auto rounded-t-xl border border-ui bg-raised p-5 shadow-2xl sm:max-w-xl sm:rounded-xl">
            <h2 id={`removed-attachments-${versionNumber}`} className="text-base font-semibold text-primary">{zh ? "已从正文移除附件引用" : "Attachment references were removed"}</h2>
            <p className="mt-1 text-sm text-secondary">{zh ? "默认继续保留在当前对话文件中。" : "Files remain in the conversation by default."}</p>
            <div className="mt-4 space-y-2">{removedAttachmentIds(baselineText, trimmedText).map((attachmentId) => {
              const attachment = conversationAttachments.find((item) => item.id === attachmentId);
              const canDetach = canDetachRemovedAttachment(attachmentId);
              return <div key={attachmentId} className="rounded-lg border border-ui bg-surface p-3"><p className="truncate text-sm font-medium text-primary">{attachment?.display_name ?? attachmentId}</p>{!canDetach ? <p className="mt-1 text-xs text-secondary">{zh ? "本次只移除这一处引用，该文件仍在其他位置使用。" : "Only this occurrence is removed; the file is still used elsewhere."}</p> : null}<div className="mt-2 flex flex-wrap gap-3 text-xs"><label className="flex items-center gap-1.5"><input type="radio" name={`removed-${attachmentId}`} checked={(removedActions[attachmentId] ?? "keep_in_conversation") === "keep_in_conversation"} onChange={() => setRemovedActions((current) => ({ ...current, [attachmentId]: "keep_in_conversation" }))} />{zh ? "保留在当前对话文件" : "Keep in conversation"}</label><label className={`flex items-center gap-1.5 ${canDetach ? "" : "opacity-50"}`}><input type="radio" name={`removed-${attachmentId}`} disabled={!canDetach} checked={removedActions[attachmentId] === "detach_from_conversation"} onChange={() => setRemovedActions((current) => ({ ...current, [attachmentId]: "detach_from_conversation" }))} />{zh ? "同时从当前对话文件移除" : "Detach from conversation"}</label></div></div>;
            })}</div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setRemovedActions(Object.fromEntries(removedAttachmentIds(baselineText, trimmedText).map((id) => [id, "keep_in_conversation"])))} className="min-h-9 rounded-lg px-3 text-sm text-secondary hover:bg-subtle">{zh ? "全部保留" : "Keep all"}</button>
              <button type="button" onClick={() => setRemovedActions(Object.fromEntries(removedAttachmentIds(baselineText, trimmedText).map((id) => [id, canDetachRemovedAttachment(id) ? "detach_from_conversation" : "keep_in_conversation"])))} className="min-h-9 rounded-lg px-3 text-sm text-secondary hover:bg-subtle">{zh ? "全部移除" : "Detach all eligible"}</button>
              <button type="button" onClick={() => setRemovedConfirmMode(null)} className="min-h-9 rounded-lg border border-ui bg-surface px-3 text-sm text-primary">{zh ? "取消保存" : "Cancel save"}</button>
              <button type="button" onClick={() => { const mode = removedConfirmMode; setRemovedConfirmMode(null); void submit(mode, true); }} className="min-h-9 rounded-lg bg-[var(--text)] px-3 text-sm font-medium text-[var(--surface)]">{zh ? "确认并保存" : "Confirm and save"}</button>
            </div>
          </section>
        </div>
      ) : null}
      {showClosePrompt ? (
        <div className="fixed inset-0 z-[250] flex items-end justify-center bg-[var(--overlay)] p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby={`unsaved-edit-${versionNumber}`}>
          <button type="button" className="absolute inset-0" onClick={() => setShowClosePrompt(false)} aria-label={zh ? "\u7ee7\u7eed\u7f16\u8f91" : "Continue editing"} />
          <div className="relative w-full rounded-t-2xl border border-ui bg-raised p-5 shadow-2xl sm:max-w-md sm:rounded-xl">
            <h2 id={`unsaved-edit-${versionNumber}`} className="text-base font-semibold text-primary">{zh ? "\u4fdd\u5b58\u8fd9\u6b21\u4fee\u6539\u5417\uff1f" : "Save these changes?"}</h2>
            <p className="mt-1 text-sm leading-6 text-secondary">{zh ? "\u53ef\u4fdd\u5b58\u4e3a\u65b0\u7248\u672c\uff0c\u653e\u5f03\u4fee\u6539\uff0c\u6216\u7ee7\u7eed\u7f16\u8f91\u3002" : "Save a new version, discard the changes, or continue editing."}</p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setShowClosePrompt(false)} className="min-h-10 rounded-lg border border-ui bg-surface px-4 text-sm font-medium text-primary hover:bg-subtle">{zh ? "\u7ee7\u7eed\u7f16\u8f91" : "Continue editing"}</button>
              {hasAttachmentWork ? <button type="button" onClick={() => void closeWithAttachments(true)} className="min-h-10 rounded-lg px-4 text-sm font-medium text-secondary hover:bg-subtle">{zh ? "\u4fdd\u7559\u6587\u4ef6\u5e76\u5173\u95ed" : "Keep files and close"}</button> : null}
              <button type="button" onClick={() => hasAttachmentWork ? void closeWithAttachments(false) : void onCancel(true)} className="min-h-10 rounded-lg px-4 text-sm font-medium text-[var(--danger)] hover:bg-[var(--danger-soft)]">{zh ? "\u653e\u5f03" : "Discard"}</button>
              <button type="button" disabled={isSaving || hasUnresolvedAttachment} onClick={() => void submit("create_version")} className="min-h-10 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-50">{zh ? "\u4fdd\u5b58\u4e3a\u65b0\u7248\u672c" : "Save as new version"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}

function isRevisionConflictMessage(message: string): boolean {
  return /\u5bf9\u8bdd\u5df2\u5728\u5176\u4ed6\u64cd\u4f5c\u4e2d\u66f4\u65b0|conversation.+(?:changed|updated)|revision|stale/i.test(message);
}

function attachmentReferenceCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(/cr-asset:\/\/([0-9a-f-]{36})/gi)) counts.set(match[1].toLowerCase(), (counts.get(match[1].toLowerCase()) ?? 0) + 1);
  return counts;
}

function countAttachmentReferences(text: string, attachmentId: string): number { return attachmentReferenceCounts(text).get(attachmentId.toLowerCase()) ?? 0; }
function removedAttachmentIds(before: string, after: string): string[] { const previous = attachmentReferenceCounts(before); const next = attachmentReferenceCounts(after); return Array.from(previous.entries()).filter(([id, count]) => (next.get(id) ?? 0) < count).map(([id]) => id); }

function codeMirrorExtensions(
  themeCompartment: Compartment,
  theme: "light" | "dark",
  handlers: {
    onFiles: (files: File[], position: number, originalCodePosition?: number) => void;
    onAttachment: (attachment: { attachmentId: string; displayName: string; mimeType: string }, position: number, originalCodePosition?: number) => void;
  },
) {
  return [
    markdown(),
    EditorView.lineWrapping,
    themeCompartment.of(codeMirrorTheme(theme)),
    sourceAttachmentDropExtension(handlers),
  ];
}

function codeMirrorTheme(theme: "light" | "dark") {
  const dark = theme === "dark";
  const colors = dark
    ? { bg: "#202120", raised: "#282a28", text: "#f2f3ef", muted: "#a9aca6", line: "#343734", active: "#303430", selection: "#315b50", accent: "#6fd0b4", keyword: "#e7a66f", string: "#9fce7c", link: "#77b7e8", comment: "#8b9189", heading: "#f0c96b" }
    : { bg: "#ffffff", raised: "#f4f5f2", text: "#1f211f", muted: "#6c716b", line: "#dfe2dc", active: "#f2f7f4", selection: "#cceadf", accent: "#087f68", keyword: "#9b4d12", string: "#437b22", link: "#236ea1", comment: "#747a73", heading: "#7a5a00" };
  return [
    EditorView.theme({
      "&": { height: "100%", color: colors.text, backgroundColor: colors.bg },
      ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
      ".cm-content": { caretColor: colors.accent, padding: "12px 0" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: colors.accent },
      "&.cr-attachment-dragover .cm-cursor": { borderLeftWidth: "3px", borderLeftColor: colors.accent },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: colors.selection },
      ".cm-gutters": { backgroundColor: colors.raised, color: colors.muted, borderRight: `1px solid ${colors.line}` },
      ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: colors.active },
      ".cm-foldPlaceholder": { backgroundColor: colors.raised, borderColor: colors.line, color: colors.muted },
      ".cm-panels": { backgroundColor: colors.raised, color: colors.text },
      ".cm-panels input, .cm-panels button": { backgroundColor: colors.bg, color: colors.text, borderColor: colors.line },
      ".cm-searchMatch": { backgroundColor: dark ? "#694f17" : "#fff0a6", outline: `1px solid ${colors.heading}` },
      ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: colors.selection },
      ".cm-tooltip": { backgroundColor: colors.raised, color: colors.text, borderColor: colors.line },
    }, { dark }),
    syntaxHighlighting(HighlightStyle.define([
      { tag: tags.heading, color: colors.heading, fontWeight: "700" },
      { tag: [tags.keyword, tags.processingInstruction], color: colors.keyword },
      { tag: [tags.string, tags.quote], color: colors.string },
      { tag: [tags.link, tags.url], color: colors.link, textDecoration: "underline" },
      { tag: [tags.comment, tags.meta], color: colors.comment },
      { tag: tags.strong, fontWeight: "700" },
      { tag: tags.emphasis, fontStyle: "italic" },
      { tag: tags.monospace, color: colors.accent },
    ])),
  ];
}

"use client";

import dynamic from "next/dynamic";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { AlignLeft, AlertCircle, Bold, CheckCircle2, ChevronDown, Code2, Heading2, Italic, Link2, List, ListOrdered, ListTodo, LoaderCircle, Minus, MoreHorizontal, Paperclip, Quote, Redo2, Save, SaveAll, Strikethrough, Table2, Underline, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  onSelectionChange,
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
  onOpenAttachmentPicker,
  conversationAttachments = [],
  showPreview = true,
  onPreviewChange,
  editorToolsOpen = false,
  onEditorToolsOpenChange,
}: {
  formId?: string;
  initialText: string;
  messageId?: string;
  initialCursorOffset?: number;
  requestedCursorOffset?: number;
  pendingAttachmentInsertion?: { referenceUri: string; displayName: string; image: boolean; placement: "inline" | "after_message" } | null;
  versionNumber: number;
  onCursorOffsetChange?: (offset: number) => void;
  onSelectionChange?: (selection: SourceTextSelection | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCancel: (dirty: boolean) => void | Promise<void>;
  onSave: (text: string, reason: string | undefined, mode: "create_version" | "replace_current", removedActions: Array<{ attachment_id: string; action: "keep_in_conversation" | "detach_from_conversation" }>, editorRevision: number) => Promise<{ canonicalText?: string } | void>;
  onReloadLatest?: () => Promise<void>;
  onAttachmentInsertionApplied?: () => void;
  onAttachmentFiles?: (files: File[], position: number, callbacks: AttachmentDraftCallbacks) => AttachmentDraft[];
  onAttachmentRetry?: (token: string) => void;
  onAttachmentRemove?: (token: string) => void;
  onAttachmentCancel?: (preserve: boolean, itemIds: string[]) => Promise<void> | void;
  onExistingAttachment?: (attachment: { attachmentId: string; displayName: string; mimeType: string }, position: number, originalCodePosition?: number) => void;
  onOpenAttachmentPicker?: () => void;
  conversationAttachments?: AttachmentRead[];
  showPreview?: boolean;
  onPreviewChange?: (open: boolean) => void;
  editorToolsOpen?: boolean;
  onEditorToolsOpenChange?: (open: boolean) => void;
}) {
  const { t, resolvedLocale, resolvedTheme } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const editorViewRef = useRef<EditorView | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const cursorOffsetChangeRef = useRef(onCursorOffsetChange);
  cursorOffsetChangeRef.current = onCursorOffsetChange;
  const selectionChangeRef = useRef(onSelectionChange);
  selectionChangeRef.current = onSelectionChange;
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
  const [attachmentTrayOpen, setAttachmentTrayOpen] = useState(true);
  const attachmentTrayListRef = useRef<HTMLDivElement | null>(null);
  const attachmentTokensRef = useRef<Set<string>>(new Set());
  const attachmentFailureTokensRef = useRef<Set<string>>(new Set());
  const [attachmentActionToken, setAttachmentActionToken] = useState<string | null>(null);
  const toolsPanelRef = useRef<HTMLDivElement | null>(null);
  const previewPanelRef = useRef<HTMLElement | null>(null);
  const previewRevisionRef = useRef(0);
  const saveRequestRef = useRef(0);
  const editorRevisionRef = useRef(0);
  const [pendingCodeDrop, setPendingCodeDrop] = useState<{
    files: File[];
    attachment?: { attachmentId: string; displayName: string; mimeType: string };
    afterPosition: number;
    originalPosition: number;
  } | null>(null);
  const [removedConfirmMode, setRemovedConfirmMode] = useState<"create_version" | "replace_current" | null>(null);
  const [removedActions, setRemovedActions] = useState<Record<string, "keep_in_conversation" | "detach_from_conversation">>({});
  const [previewSnapshot, setPreviewSnapshot] = useState(() => ({ revision: 0, text: initialText }));
  useEffect(() => {
    const revision = ++previewRevisionRef.current;
    const timer = window.setTimeout(() => {
      if (revision === previewRevisionRef.current) setPreviewSnapshot({ revision, text });
    }, 90);
    return () => window.clearTimeout(timer);
  }, [text]);
  const previewText = previewSnapshot.text;
  const trimmedText = text.trim();
  const isUnchanged = trimmedText === baselineText.trim();
  const hasAttachmentWork = Object.values(attachmentDrafts).some((draft) => draft.status !== "removed");
  const visibleAttachmentDrafts = Object.values(attachmentDrafts).filter((draft) => draft.status !== "removed");
  useLayoutEffect(() => {
    const list = attachmentTrayListRef.current;
    const tokens = new Set(visibleAttachmentDrafts.map((draft) => draft.token));
    const added = visibleAttachmentDrafts.some((draft) => !attachmentTokensRef.current.has(draft.token));
    attachmentTokensRef.current = tokens;
    if (added && list) list.scrollTop = list.scrollHeight;
  }, [visibleAttachmentDrafts]);
  const uploadingAttachmentCount = visibleAttachmentDrafts.filter((draft) => draft.status === "uploading" || draft.status === "canonicalizing").length;
  const failedAttachmentCount = visibleAttachmentDrafts.filter((draft) => draft.status === "error").length;
  const attachmentProgress = uploadingAttachmentCount > 0
    ? Math.round(visibleAttachmentDrafts.filter((draft) => draft.status === "uploading" || draft.status === "canonicalizing").reduce((sum, draft) => sum + draft.progress, 0) / uploadingAttachmentCount)
    : 100;
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
        const canonicalDocument = view.state.doc.toString();
        // A retry can race with a late successful finalize from the previous
        // attempt. If that callback already replaced this token, the marker is
        // resolved even when this invocation observes a missing marker.
        const stillTransient = findTransientUploadReferences(canonicalDocument)
          .some((reference) => reference.token === token);
        if (stillTransient) {
          setAttachmentDrafts((current) => current[token] ? {
            ...current,
            [token]: { ...current[token], status: "error", error: "The attachment reference could not be resolved." },
          } : current);
          return;
        }
        // EditorView is the save authority. The draft becomes ready only
        // after its canonicalization transaction is visible in that document.
        if (replacement === "replaced") setEditorDocument(canonicalDocument);
        setText(canonicalDocument);
        setAttachmentDrafts((current) => current[token] ? { ...current, [token]: { ...current[token], itemId: canonicalId, status: "ready", progress: 100 } } : current);
      },
      onError: (token, message) => {
        if (!attachmentFailureTokensRef.current.has(token)) {
          attachmentFailureTokensRef.current.add(token);
          setAttachmentTrayOpen(true);
        }
        setAttachmentDrafts((current) => current[token] ? { ...current, [token]: { ...current[token], status: "error", error: message } } : current);
      },
    };
    const drafts = onAttachmentFiles?.(files, position, callbacks) ?? [];
    setAttachmentDrafts((current) => ({
      ...current,
      ...Object.fromEntries(drafts.map((draft) => [draft.token, { ...draft, status: "uploading", progress: 0 } as AttachmentDraftState])),
    }));
    const view = editorViewRef.current;
    if (view && drafts.length) {
      insertPendingMarkers(view, drafts, position);
      const pendingDocument = view.state.doc.toString();
      setEditorDocument(pendingDocument);
      setText(pendingDocument);
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
    if (editorViewRef.current) {
      const nextDocument = editorViewRef.current.state.doc.toString();
      if (removal === "removed") setEditorDocument(nextDocument);
      setText(nextDocument);
    }
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
  const dispatchCommand = useCallback((command: EditorCommand) => {
    const view = editorViewRef.current;
    if (!view) return;
    if (command === "undo" || command === "redo") {
      view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: command === "undo" ? "z" : "y", ctrlKey: true, bubbles: true }));
      onEditorToolsOpenChange?.(false);
      view.focus();
      return;
    }
    if (command === "attachment") {
      onEditorToolsOpenChange?.(false);
      onOpenAttachmentPicker?.();
      return;
    }
    const selection = view.state.selection.main;
    const change = commandChange(command, view.state.doc.toString(), selection.from, selection.to);
    if (!change) return;
    view.dispatch({ changes: change.changes, selection: change.selection, scrollIntoView: true });
    onEditorToolsOpenChange?.(false);
    view.focus();
  }, [onEditorToolsOpenChange, onOpenAttachmentPicker]);

  useEffect(() => {
    if (!editorToolsOpen && !showPreview) return;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (editorToolsOpen && !toolsPanelRef.current?.contains(target) && !target.closest("[data-testid='source-editor-tools-toggle']")) onEditorToolsOpenChange?.(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (editorToolsOpen) { event.preventDefault(); onEditorToolsOpenChange?.(false); }
      else if (showPreview) { event.preventDefault(); onPreviewChange?.(false); }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOnOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [editorToolsOpen, onEditorToolsOpenChange, onPreviewChange, showPreview]);

  useEffect(() => {
    if (!attachmentActionToken) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest("[data-attachment-action-menu='true']")) setAttachmentActionToken(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAttachmentActionToken(null);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [attachmentActionToken]);
  const handleEditorUpdate = useCallback((update: ViewUpdate) => {
    if (!update.docChanged && !update.selectionSet) return;
    if (update.docChanged) editorRevisionRef.current += 1;
    const offset = update.state.selection.main.head;
    const source = update.state.doc.toString();
    const codePointOffset = unicodeCodePointOffset(source, offset);
    if (editorHostRef.current) editorHostRef.current.dataset.cursorOffset = String(codePointOffset);
    cursorOffsetChangeRef.current?.(codePointOffset);
    const selection = update.state.selection.main;
    if (selection.empty) {
      selectionChangeRef.current?.(null);
      return;
    }
    const from = Math.min(selection.from, selection.to);
    const to = Math.max(selection.from, selection.to);
    selectionChangeRef.current?.({
      startOffset: unicodeCodePointOffset(source, from),
      endOffset: unicodeCodePointOffset(source, to),
      text: update.state.doc.sliceString(from, to),
    });
  }, []);

  useEffect(() => {
    const onSourceLocate = (event: Event) => {
      const detail = (event as CustomEvent<{ messageId?: string; cursorOffset?: number }>).detail;
      if (!messageId || detail?.messageId !== messageId || detail.cursorOffset === undefined) return;
      const view = editorViewRef.current;
      if (!view) return;
      const anchor = codePointToUtf16Offset(view.state.doc.toString(), detail.cursorOffset);
      view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
      cursorOffsetChangeRef.current?.(detail.cursorOffset);
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
    const anchor = codePointToUtf16Offset(view.state.doc.toString(), requestedCursorOffset);
    view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
    cursorOffsetChangeRef.current?.(requestedCursorOffset);
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
    cursorOffsetChangeRef.current?.(unicodeCodePointOffset(view.state.doc.toString(), target + value.length));
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
    const requestToken = ++saveRequestRef.current;
    try {
      const saved = await onSave(
        nextTrimmedText,
        reason.trim() || undefined,
        mode,
        removedIds.map((attachmentId) => ({ attachment_id: attachmentId, action: removedActions[attachmentId] ?? "keep_in_conversation" })),
        editorRevisionRef.current,
      );
      if (requestToken !== saveRequestRef.current) return;
      const canonicalText = saved?.canonicalText ?? nextTrimmedText;
      setBaselineText(canonicalText);
      setEditorDocument(canonicalText);
      setText(canonicalText);
      setReason("");
      setShowClosePrompt(false);
      setAttachmentDrafts({});
      setRemovedConfirmMode(null);
      setRemovedActions({});
      onDirtyChange?.(false);
    } catch (err) {
      if (requestToken !== saveRequestRef.current) return;
      const message = err instanceof Error ? err.message : t("unableSaveEdit");
      setError(message);
      setRevisionConflict(isRevisionConflictMessage(message));
    } finally {
      if (requestToken === saveRequestRef.current) setIsSaving(false);
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
    <form id={formId} className="relative flex h-full min-h-0 flex-col bg-surface" onSubmit={(event) => { event.preventDefault(); void submit("create_version"); }}>
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
      {editorToolsOpen ? <div ref={toolsPanelRef} id="source-editor-tools" data-testid="source-editor-tools" className="absolute left-2 top-12 z-40 w-[min(34rem,calc(100%-1rem))] rounded-lg border border-ui bg-raised p-3 shadow-xl">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <CommandGroup label={zh ? "文字" : "Text"} commands={[{ label: zh ? "粗体" : "Bold", icon: <Bold className="h-4 w-4" />, command: "bold" }, { label: zh ? "斜体" : "Italic", icon: <Italic className="h-4 w-4" />, command: "italic" }, { label: zh ? "删除线" : "Strike", icon: <Strikethrough className="h-4 w-4" />, command: "strike" }, { label: zh ? "下划线" : "Underline", icon: <Underline className="h-4 w-4" />, command: "underline" }, { label: zh ? "行内代码" : "Inline code", icon: <Code2 className="h-4 w-4" />, command: "code" }]} onCommand={dispatchCommand} />
          <CommandGroup label={zh ? "结构" : "Structure"} commands={[{ label: zh ? "标题" : "Heading", icon: <Heading2 className="h-4 w-4" />, command: "heading" }, { label: zh ? "引用" : "Quote", icon: <Quote className="h-4 w-4" />, command: "quote" }, { label: zh ? "分隔线" : "Rule", icon: <Minus className="h-4 w-4" />, command: "rule" }, { label: zh ? "代码块" : "Code block", icon: <Code2 className="h-4 w-4" />, command: "code-block" }]} onCommand={dispatchCommand} />
          <CommandGroup label={zh ? "列表" : "Lists"} commands={[{ label: zh ? "无序列表" : "Bullets", icon: <List className="h-4 w-4" />, command: "bullets" }, { label: zh ? "有序列表" : "Numbered", icon: <ListOrdered className="h-4 w-4" />, command: "numbered" }, { label: zh ? "任务清单" : "Tasks", icon: <ListTodo className="h-4 w-4" />, command: "tasks" }]} onCommand={dispatchCommand} />
          <CommandGroup label={zh ? "插入" : "Insert"} commands={[{ label: zh ? "链接" : "Link", icon: <Link2 className="h-4 w-4" />, command: "link" }, { label: zh ? "表格" : "Table", icon: <Table2 className="h-4 w-4" />, command: "table" }, { label: zh ? "附件引用" : "Attachment reference", icon: <Paperclip className="h-4 w-4" />, command: "attachment" }]} onCommand={dispatchCommand} />
          <CommandGroup label={zh ? "编辑" : "Edit"} commands={[{ label: zh ? "撤销" : "Undo", icon: <Undo2 className="h-4 w-4" />, command: "undo" }, { label: zh ? "重做" : "Redo", icon: <Redo2 className="h-4 w-4" />, command: "redo" }, { label: zh ? "格式化当前段落" : "Format paragraph", icon: <AlignLeft className="h-4 w-4" />, command: "format" }]} onCommand={dispatchCommand} />
        </div>
      </div> : null}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div ref={editorHostRef} className="min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="source-editor-codemirror">
          <CodeMirror
          value={editorDocument}
          height="100%"
          extensions={extensions}
          theme="none"
          basicSetup={sourceEditorBasicSetup}
          onCreateEditor={(view) => {
            editorViewRef.current = view;
            view.dispatch({ effects: themeCompartmentRef.current.reconfigure(codeMirrorTheme(resolvedTheme)) });
            const anchor = codePointToUtf16Offset(view.state.doc.toString(), initialCursorOffset);
            view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
            if (editorHostRef.current) editorHostRef.current.dataset.cursorOffset = String(initialCursorOffset);
            cursorOffsetChangeRef.current?.(unicodeCodePointOffset(view.state.doc.toString(), anchor));
            selectionChangeRef.current?.(null);
            view.focus();
            if (pendingAttachmentInsertion) applyAttachmentInsertion(view, pendingAttachmentInsertion);
            if (queuedFilesRef.current.length) {
              const files = queuedFilesRef.current.splice(0);
              insertFilesAtCurrentPosition(view, files);
            }
          }}
          onUpdate={handleEditorUpdate}
          onChange={(next) => { setEditorDocument(next); setText(next); }}
          className="h-full text-sm [&_.cm-editor]:h-full"
          />
        </div>
        {showPreview ? <>
          <aside ref={previewPanelRef} className="absolute inset-y-0 right-0 z-30 w-[min(36%,38rem)] min-w-[15rem] overflow-y-auto overscroll-contain border-l border-ui bg-page p-4 shadow-2xl max-sm:inset-x-0 max-sm:w-full max-sm:min-w-0" data-testid="source-editor-rich-preview" data-preview-revision={previewSnapshot.revision} aria-label={zh ? "Markdown 实时预览" : "Live Markdown preview"}>
            <div className="mb-3 flex items-center justify-between border-b border-ui pb-2"><span className="text-xs font-semibold text-secondary">{text === previewText ? (zh ? "实时预览" : "Live preview") : (zh ? "正在更新…" : "Updating…")}</span><button type="button" className="rounded-md p-2 text-secondary hover:bg-subtle" onClick={() => onPreviewChange?.(false)} aria-label={zh ? "关闭预览" : "Close preview"}><X className="h-4 w-4" /></button></div>
            <MarkdownRenderer text={previewText} isAssistant={false} scopeId={`editor-${messageId ?? formId}`} />
          </aside>
        </> : null}
      </div>
      <footer className="relative z-40 shrink-0 space-y-2 border-t border-ui bg-raised p-3">
        {pendingCodeDrop ? <div className="rounded-lg border border-[var(--mark-border)] bg-[var(--mark-bg)] p-3 text-xs text-primary" role="status" data-testid="source-editor-code-drop-choice">
          <p>{zh ? "当前位置在代码块内。附件放在这里不会在 Reader 中显示。" : "This position is inside a code block, so an attachment placed here will not render in Reader."}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="min-h-8 rounded-md bg-[var(--text)] px-3 font-medium text-[var(--surface)]" onClick={() => { applyPendingCodeDrop(pendingCodeDrop.afterPosition); setPendingCodeDrop(null); }}>{zh ? "插入到代码块之后" : "Insert after code block"}</button>
            <button type="button" className="min-h-8 rounded-md border border-ui bg-surface px-3 font-medium text-primary" onClick={() => { applyPendingCodeDrop(pendingCodeDrop.originalPosition); setPendingCodeDrop(null); }}>{zh ? "仍作为普通文本插入" : "Insert as plain text"}</button>
            <button type="button" className="min-h-8 rounded-md px-3 font-medium text-secondary hover:bg-subtle" onClick={() => setPendingCodeDrop(null)}>{zh ? "取消" : "Cancel"}</button>
          </div>
        </div> : null}
        {visibleAttachmentDrafts.length ? <div className="rounded-lg border border-ui bg-subtle p-2 text-xs" data-testid="source-editor-attachment-drafts">
          <div className="mb-1 flex items-center justify-between gap-2" role="status" aria-live="polite"><span className="min-w-0 truncate text-secondary">{zh ? `附件 · ${visibleAttachmentDrafts.length} 个` : `Attachments · ${visibleAttachmentDrafts.length}`}{uploadingAttachmentCount > 0 ? (zh ? ` · ${uploadingAttachmentCount} 个上传中 · ${attachmentProgress}%` : ` · ${uploadingAttachmentCount} uploading · ${attachmentProgress}%`) : failedAttachmentCount > 0 ? (zh ? ` · ${failedAttachmentCount} 个失败` : ` · ${failedAttachmentCount} failed`) : (zh ? " · 已准备保存" : " · Ready to save")}</span><button type="button" onClick={() => setAttachmentTrayOpen((value) => !value)} className="min-h-8 shrink-0 rounded-md px-2 text-secondary hover:bg-surface" aria-expanded={attachmentTrayOpen}>{attachmentTrayOpen ? (zh ? "收起" : "Collapse") : (zh ? "展开" : "Expand")}</button></div>
          {attachmentTrayOpen ? <div className="mt-1 max-h-[min(22vh,176px)] overflow-y-auto overscroll-contain pr-1 max-sm:max-h-[min(30dvh,220px)]" ref={attachmentTrayListRef}>
          {visibleAttachmentDrafts.map((draft) => {
            const retry = () => {
              setAttachmentActionToken(null);
              setAttachmentDrafts((current) => ({ ...current, [draft.token]: { ...current[draft.token], status: "uploading", error: undefined, progress: 0 } }));
              onAttachmentRetry?.(draft.token);
            };
            const remove = () => {
              setAttachmentActionToken(null);
              removeAttachmentDraft(draft);
            };
            const status = draft.status === "uploading"
              ? (zh ? `上传中 ${draft.progress}%` : `Uploading ${draft.progress}%`)
              : draft.status === "canonicalizing"
                ? (zh ? "正在准备" : "Preparing")
                : draft.status === "ready"
                  ? (zh ? "已完成" : "Complete")
                  : (zh ? "上传失败" : "Upload failed");
            return <div key={draft.token} className="relative flex h-10 items-center gap-2 border-t border-ui/60 max-sm:h-11" data-testid={`source-editor-upload-${draft.token}`} onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest" })}>
              <span className="min-w-0 flex-1 truncate text-primary" title={draft.displayName}>{draft.displayName}</span>
              <span className={`inline-flex shrink-0 items-center gap-1 ${draft.status === "error" ? "text-[var(--danger)]" : "text-secondary"}`}>
                {draft.status === "uploading" || draft.status === "canonicalizing" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : draft.status === "ready" ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--accent)]" /> : <AlertCircle className="h-3.5 w-3.5" />}
                <span>{status}</span>
              </span>
              {draft.status === "error" ? <button type="button" className="hidden min-h-8 shrink-0 rounded-md px-2 text-[var(--accent)] hover:bg-surface sm:inline-flex sm:items-center" onClick={retry}>{zh ? "重试" : "Retry"}</button> : null}
              <button type="button" className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-surface sm:inline-flex" aria-label={zh ? `移除 ${draft.displayName}` : `Remove ${draft.displayName}`} onClick={remove}><X className="h-3.5 w-3.5" /></button>
              <div className="relative sm:hidden" data-attachment-action-menu="true">
                <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-md text-secondary hover:bg-surface" aria-label={zh ? `${draft.displayName} 的操作` : `Actions for ${draft.displayName}`} aria-expanded={attachmentActionToken === draft.token} onClick={() => setAttachmentActionToken((current) => current === draft.token ? null : draft.token)}><MoreHorizontal className="h-4 w-4" /></button>
                {attachmentActionToken === draft.token ? <div className="absolute bottom-full right-0 z-20 mb-1 min-w-28 rounded-md border border-ui bg-raised p-1 shadow-lg">
                  {draft.status === "error" ? <button type="button" className="min-h-10 w-full rounded px-3 text-left text-primary hover:bg-subtle" onClick={retry}>{zh ? "重试" : "Retry"}</button> : null}
                  <button type="button" className="min-h-10 w-full rounded px-3 text-left text-[var(--danger)] hover:bg-[var(--danger-soft)]" onClick={remove}>{zh ? "移除" : "Remove"}</button>
                </div> : null}
              </div>
              {draft.status === "uploading" ? <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden rounded-full bg-ui"><span className="block h-full bg-[var(--accent)] transition-[width] motion-reduce:transition-none" style={{ width: `${draft.progress}%` }} /></span> : null}
            </div>;
          })}
          </div> : null}
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

export type SourceTextSelection = {
  startOffset: number;
  endOffset: number;
  text: string;
};

function unicodeCodePointOffset(source: string, utf16Offset: number): number {
  return Array.from(source.slice(0, utf16Offset)).length;
}

function codePointToUtf16Offset(source: string, codePointOffset: number): number {
  return Array.from(source).slice(0, Math.max(0, codePointOffset)).join("").length;
}

type EditorCommand = "bold" | "italic" | "strike" | "underline" | "code" | "heading" | "quote" | "rule" | "code-block" | "bullets" | "numbered" | "tasks" | "link" | "table" | "attachment" | "undo" | "redo" | "format";
type CommandResult = { changes: { from: number; to: number; insert: string } | { from: number; insert: string }; selection: { anchor: number; head?: number } };

function commandChange(command: EditorCommand, source: string, from: number, to: number): CommandResult | null {
  const selected = source.slice(from, to);
  if (command === "undo" || command === "redo") return null;
  if (command === "bold" || command === "italic" || command === "strike" || command === "underline" || command === "code") {
    const pair = command === "bold" ? ["**", "**"] : command === "italic" ? ["*", "*"] : command === "strike" ? ["~~", "~~"] : command === "underline" ? ["<u>", "</u>"] : ["`", "`"];
    return { changes: { from, to, insert: `${pair[0]}${selected || (command === "code" ? "code" : "text")}${pair[1]}` }, selection: { anchor: from + pair[0].length, head: from + pair[0].length + (selected || (command === "code" ? "code" : "text")).length } };
  }
  if (command === "link") {
    const value = `[${selected || "link text"}](url)`;
    return { changes: { from, to, insert: value }, selection: { anchor: from + 1, head: from + 1 + (selected || "link text").length } };
  }
  if (command === "table") return { changes: { from, insert: "| Column | Column |\n| --- | --- |\n| Value | Value |" }, selection: { anchor: from + 2 } };
  if (command === "rule") return { changes: { from, insert: "\n\n---\n\n" }, selection: { anchor: from + 7 } };
  if (command === "code-block") return { changes: { from, to, insert: `\`\`\`\n${selected || "code"}\n\`\`\`` }, selection: { anchor: from + 4, head: from + 4 + (selected || "code").length } };
  if (command === "format") {
    const paragraphStart = selected ? from : Math.max(0, source.lastIndexOf("\n\n", Math.max(0, from - 1)) + 2);
    const nextBreak = source.indexOf("\n\n", to);
    const paragraphEnd = selected ? to : (nextBreak === -1 ? source.length : nextBreak);
    const paragraph = source.slice(paragraphStart, paragraphEnd);
    const formatted = paragraph.split("\n").map((line) => line.trimEnd()).join("\n");
    return {
      changes: { from: paragraphStart, to: paragraphEnd, insert: formatted },
      selection: selected
        ? { anchor: paragraphStart, head: paragraphStart + formatted.length }
        : { anchor: Math.min(paragraphStart + formatted.length, from) },
    };
  }
  const lineStart = source.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const lineEnd = source.indexOf("\n", from) === -1 ? source.length : source.indexOf("\n", from);
  const line = source.slice(lineStart, lineEnd);
  if (command === "heading") {
    const match = line.match(/^(#{1,6})\s+/);
    const replacement = match ? (match[1].length === 6 ? "" : `${"#".repeat(match[1].length + 1)} `) : "# ";
    const removedLength = match?.[0].length ?? 0;
    return { changes: { from: lineStart, to: lineStart + removedLength, insert: replacement }, selection: { anchor: Math.max(lineStart, from - removedLength + replacement.length) } };
  }
  const prefix = command === "quote" ? "> " : command === "bullets" ? "- " : command === "numbered" ? "1. " : "- [ ] ";
  const alreadyPrefixed = line.startsWith(prefix);
  return {
    changes: { from: lineStart, to: lineStart + (alreadyPrefixed ? prefix.length : 0), insert: alreadyPrefixed ? "" : prefix },
    selection: { anchor: Math.max(lineStart, from + (alreadyPrefixed ? -prefix.length : prefix.length)) },
  };
}

function CommandGroup({ label, commands, onCommand }: { label: string; commands: Array<{ label: string; icon: ReactNode; command: EditorCommand }>; onCommand: (command: EditorCommand) => void }) {
  return <div><p className="mb-1 text-[11px] font-semibold text-secondary">{label}</p><div className="grid grid-cols-2 gap-1">{commands.map((item) => <button key={item.command} type="button" onClick={() => onCommand(item.command)} className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs text-primary hover:bg-subtle" title={item.label}>{item.icon}<span className="truncate">{item.label}</span></button>)}</div></div>;
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
    ? { bg: "#202120", raised: "#282a28", text: "#f2f3ef", muted: "#a9aca6", line: "#343734", active: "#303430", selection: "#4b9f87", selectionText: "#ffffff", accent: "#6fd0b4", keyword: "#e7a66f", string: "#9fce7c", link: "#77b7e8", comment: "#8b9189", heading: "#f0c96b" }
    : { bg: "#ffffff", raised: "#f4f5f2", text: "#1f211f", muted: "#6c716b", line: "#dfe2dc", active: "#f2f7f4", selection: "#76cdb1", selectionText: "#10221c", accent: "#087f68", keyword: "#9b4d12", string: "#437b22", link: "#236ea1", comment: "#747a73", heading: "#7a5a00" };
  return [
    EditorView.theme({
      "&": { height: "100%", color: colors.text, backgroundColor: colors.bg },
      ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
      ".cm-content": { caretColor: colors.accent, padding: "12px 0" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: colors.accent },
      "&.cr-attachment-dragover .cm-cursor": { borderLeftWidth: "3px", borderLeftColor: colors.accent },
      // Keep source selections legible even when CodeMirror loses focus while
      // the cleanup review dialog is opening.  A stronger, opaque range makes
      // the exact text the user selected unambiguous without changing the
      // document or selection offsets.
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
        backgroundColor: colors.selection,
        color: colors.selectionText,
      },
      ".cm-editor:not(.cm-focused) .cm-selectionBackground": {
        backgroundColor: colors.selection,
        opacity: "0.78",
      },
      ".cm-editor:not(.cm-focused) .cm-content ::selection": {
        backgroundColor: colors.selection,
        color: colors.selectionText,
      },
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

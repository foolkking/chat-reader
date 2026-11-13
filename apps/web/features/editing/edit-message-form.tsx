"use client";

import dynamic from "next/dynamic";
import { isolateHistory, redo, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { AlertCircle, CheckCircle2, ChevronDown, LoaderCircle, MoreHorizontal, Save, SaveAll, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import type { AttachmentRead } from "../../lib/types";
import { MarkdownRenderer } from "../conversations/markdown-renderer";
import {
  SourceCommandPanel,
  SourceContextToolbar,
  type SourceContextToolbarPosition,
  type SourceEditorCommand,
} from "./source-context-toolbar";
import {
  findTransientUploadReferences,
  findMarkdownAttachmentReferences,
  changeAttachmentReference,
  type AttachmentReferenceTarget,
  type SourceAttachmentInsertion,
  insertPendingMarkers,
  removePendingMarker,
  replacePendingMarker,
  resolveAttachmentDropPosition,
  sourceAttachmentDropExtension,
  type AttachmentDraft,
  type AttachmentDraftCallbacks,
  type AttachmentDraftState,
} from "./source-attachment-drop";
import { selectSourcePreviewAnchor, sourceAlignedPreviewScrollTop } from "./source-preview-scroll";
import { applyMarkdownTableAction, type MarkdownTableSourceContext } from "./markdown-table-tools";
import { TableToolDialog } from "./markdown-table-dialog";
import { draftMatchesSource, useSourceDraft } from "./use-source-draft";
import { SourceDraftComparison } from "./source-draft-comparison";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";

const CodeMirror = dynamic(() => import("./source-code-editor"), { ssr: false });
export type SourceSaveResult = {
  canonicalText: string; versionId: string; contentHash: string; versionNumber: number; refreshPending?: boolean;
};
export type SourceReloadRequest = {
  messageId: string; expectedText: string; latest: SourceSaveResult;
};

type SavedToolbarSelection = {
  anchor: number;
  head: number;
  from: number;
  to: number;
};

type TableToolSnapshot = {
  from: number;
  to: number;
  revision: number;
  source: string;
  context?: MarkdownTableSourceContext;
};

function captureTableTool(view: EditorView, selection: { from: number; to: number }, revision: number): TableToolSnapshot {
  const source = view.state.doc.toString();
  const parsedTo = view.state.doc.lineAt(selection.to).to;
  // Reuse CodeMirror's maintained parse. An explicit selection already grants
  // permission to edit a code example and needs no extra context parsing.
  const tree = selection.from === selection.to ? ensureSyntaxTree(view.state, parsedTo, 50) : null;
  return {
    from: selection.from, to: selection.to, revision, source,
    context: tree ? { source, parsedTo, tree } : undefined,
  };
}

export function EditMessageForm({
  formId = "source-editor-form",
  initialText,
  messageId,
  conversationId,
  initialCursorOffset = 0,
  requestedCursorOffset,
  pendingAttachmentInsertion,
  versionNumber,
  versionId,
  contentHash,
  onCursorOffsetChange,
  onSelectionChange,
  onAttachmentFocus,
  onDirtyChange,
  onCancel,
  onSave,
  onReloadLatest,
  onAcceptLatest,
  sourceReloadRequest,
  onVerifySave,
  onRetrySave,
  pendingSave,
  saveRecoveryReady = true,
  readerRefreshPending = false,
  onRefreshReader,
  receiptStorageUnavailable = false,
  onAttachmentInsertionApplied,
  onAttachmentFiles,
  onAttachmentRetry,
  onRestoreAttachmentDrafts,
  onAttachmentRemove,
  onAttachmentCancel,
  onExistingAttachment,
  onOpenAttachmentPicker,
  showPreview = true,
  onPreviewChange,
  editorToolsOpen = false,
  onEditorToolsOpenChange,
  historyCommandRequest,
}: {
  formId?: string;
  initialText: string;
  messageId?: string;
  conversationId?: string;
  initialCursorOffset?: number;
  requestedCursorOffset?: number;
  pendingAttachmentInsertion?: SourceAttachmentInsertion | null;
  versionNumber: number;
  versionId?: string;
  contentHash?: string;
  onCursorOffsetChange?: (offset: number) => void;
  onSelectionChange?: (selection: SourceTextSelection | null) => void;
  onAttachmentFocus?: (target: AttachmentReferenceTarget | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCancel: (dirty: boolean) => void | Promise<void>;
  onSave: (text: string, reason: string | undefined, mode: "create_version" | "replace_current", removedActions: Array<{ attachment_id: string; action: "keep_in_conversation" | "detach_from_conversation" }>, editorRevision: number) => Promise<SourceSaveResult>;
  onReloadLatest?: () => Promise<SourceSaveResult>;
  onAcceptLatest?: () => void;
  sourceReloadRequest?: SourceReloadRequest | null;
  onVerifySave?: () => Promise<SourceSaveResult>;
  onRetrySave?: () => Promise<SourceSaveResult>;
  pendingSave?: { operationId: string; text: string } | null;
  saveRecoveryReady?: boolean;
  readerRefreshPending?: boolean;
  onRefreshReader?: () => void;
  receiptStorageUnavailable?: boolean;
  onAttachmentInsertionApplied?: () => void;
  onAttachmentFiles?: (files: File[], position: number, callbacks: AttachmentDraftCallbacks) => AttachmentDraft[];
  onAttachmentRetry?: (token: string) => void;
  onRestoreAttachmentDrafts?: (tokens: string[], callbacks: AttachmentDraftCallbacks) => Promise<AttachmentDraft[]>;
  onAttachmentRemove?: (token: string) => void;
  onAttachmentCancel?: (preserve: boolean, itemIds: string[]) => Promise<void> | void;
  onExistingAttachment?: (attachment: { attachmentId: string; displayName: string; mimeType: string }, position: number, originalCodePosition?: number) => void;
  onOpenAttachmentPicker?: () => void;
  conversationAttachments?: AttachmentRead[];
  showPreview?: boolean;
  onPreviewChange?: (open: boolean) => void;
  editorToolsOpen?: boolean;
  onEditorToolsOpenChange?: (open: boolean) => void;
  historyCommandRequest?: { id: number; command: "undo" | "redo" } | null;
}) {
  const { t, resolvedLocale, resolvedTheme } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const editorViewRef = useRef<EditorView | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const cursorOffsetChangeRef = useRef(onCursorOffsetChange);
  cursorOffsetChangeRef.current = onCursorOffsetChange;
  const selectionChangeRef = useRef(onSelectionChange);
  selectionChangeRef.current = onSelectionChange;
  const attachmentFocusRef = useRef(onAttachmentFocus);
  attachmentFocusRef.current = onAttachmentFocus;
  const insertFilesRef = useRef<(files: File[], position: number, originalCodePosition?: number) => void>(() => undefined);
  const insertExistingAttachmentRef = useRef<(attachment: { attachmentId: string; displayName: string; mimeType: string }, position: number, originalCodePosition?: number) => void>(() => undefined);
  const queuedFilesRef = useRef<File[]>([]);
  const themeCompartmentRef = useRef(new Compartment());
  const initialThemeRef = useRef(resolvedTheme);
  const appliedInsertionRef = useRef<SourceAttachmentInsertion | null>(null);
  const appliedSourceReloadRef = useRef<SourceReloadRequest | null>(null);
  const appliedHistoryCommandRef = useRef<number | null>(null);
  // Seed the existing EditorView once. Feeding its own edits back as controlled
  // values lets the wrapper's delayed external update overwrite a newer edit.
  const editorInitialTextRef = useRef(initialText);
  const queuedEditorTextRef = useRef<string | null>(null);
  const [text, setText] = useState(initialText);
  const [baselineText, setBaselineText] = useState(initialText);
  const draft = useSourceDraft(conversationId, messageId, versionNumber, text, baselineText, versionId, contentHash);
  const draftBaseMatches = draft.candidate ? draftMatchesSource(draft.candidate.value, versionId, contentHash) : false;
  const draftDialog = useInteractionDialog();
  const [reason, setReason] = useState("");
  const [showReason, setShowReason] = useState(false);
  const [showClosePrompt, setShowClosePrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revisionConflict, setRevisionConflict] = useState(false);
  const [reloadStatus, setReloadStatus] = useState<"idle" | "loading" | "ready">("idle");
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveUnknown, setSaveUnknown] = useState(false);
  const [canRetrySave, setCanRetrySave] = useState(false);
  useEffect(() => {
    if (!pendingSave) return;
    saveSnapshotRef.current = { text: pendingSave.text, revision: -1, drafts: {} };
    setSaveUnknown(true);
    setCanRetrySave(false);
    setError(zh ? "上次保存结果待确认；请先核对，不会重新提交。" : "The previous save is unconfirmed. Check its result without submitting again.");
  }, [pendingSave?.operationId, zh]);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [comparison, setComparison] = useState<SourceSaveResult | null>(null);
  const saveSnapshotRef = useRef<{ text: string; revision: number; drafts: Record<string, AttachmentDraftState> } | null>(null);
  useEffect(() => {
    if (!saveNotice) return;
    const timer = setTimeout(() => setSaveNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [saveNotice]);
  const [attachmentDrafts, setAttachmentDrafts] = useState<Record<string, AttachmentDraftState>>({});
  const [attachmentTrayOpen, setAttachmentTrayOpen] = useState(true);
  const attachmentTrayListRef = useRef<HTMLDivElement | null>(null);
  const attachmentTokensRef = useRef<Set<string>>(new Set());
  const attachmentFailureTokensRef = useRef<Set<string>>(new Set());
  const [attachmentActionToken, setAttachmentActionToken] = useState<string | null>(null);
  const savedToolbarSelectionRef = useRef<SavedToolbarSelection | null>(null);
  const toolbarSizeRef = useRef({ width: 420, height: 40 });
  const toolbarFrameRef = useRef<number | null>(null);
  const pointerSelectingRef = useRef(false);
  const compositionActiveRef = useRef(false);
  const editorEventCleanupRef = useRef<(() => void) | null>(null);
  const editorToolsOpenRef = useRef(editorToolsOpen);
  editorToolsOpenRef.current = editorToolsOpen;
  const [selectionToolbarOpen, setSelectionToolbarOpen] = useState(false);
  const selectionToolbarOpenRef = useRef(false);
  selectionToolbarOpenRef.current = selectionToolbarOpen;
  const [toolbarPosition, setToolbarPosition] = useState<SourceContextToolbarPosition | null>(null);
  const [toolbarSelectionSnapshot, setToolbarSelectionSnapshot] = useState<SavedToolbarSelection | null>(null);
  const previewPanelRef = useRef<HTMLElement | null>(null);
  const previewRevisionRef = useRef(0);
  const previewSyncFrameRef = useRef<number | null>(null);
  const showPreviewRef = useRef(showPreview);
  showPreviewRef.current = showPreview;
  const saveRequestRef = useRef(0);
  const editorRevisionRef = useRef(0);
  const [pendingCodeDrop, setPendingCodeDrop] = useState<{
    files: File[];
    attachment?: { attachmentId: string; displayName: string; mimeType: string };
    afterPosition: number;
    originalPosition: number;
  } | null>(null);
  const [tableTool, setTableTool] = useState<TableToolSnapshot | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState(() => ({ revision: 0, text: initialText }));
  useEffect(() => {
    const revision = ++previewRevisionRef.current;
    const timer = window.setTimeout(() => {
      if (revision === previewRevisionRef.current) setPreviewSnapshot({ revision, text });
    }, 90);
    return () => window.clearTimeout(timer);
  }, [text]);
  const previewText = previewSnapshot.text;
  const previewTextRef = useRef(previewText);
  previewTextRef.current = previewText;
  const trimmedText = text.trim();
  const isUnchanged = text === baselineText;
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
  const hasUnresolvedAttachment = transientUploadReferences.length > 0 || saveUnknown || !saveRecoveryReady;
  const restoreAttachmentsRef = useRef(onRestoreAttachmentDrafts);
  restoreAttachmentsRef.current = onRestoreAttachmentDrafts;
  const restoringAttachmentsRef = useRef(new Set<string>());
  const attachmentsMountedRef = useRef(true);
  useEffect(() => {
    attachmentsMountedRef.current = true;
    return () => { attachmentsMountedRef.current = false; };
  }, []);
  useEffect(() => {
    const missing = findTransientUploadReferences(text).map(ref => ref.token)
      .filter(token => !attachmentDrafts[token] && !restoringAttachmentsRef.current.has(token));
    if (!missing.length || !restoreAttachmentsRef.current) return;
    for (const token of missing) restoringAttachmentsRef.current.add(token);
    void restoreAttachmentsRef.current(missing, attachmentCallbacks()).then(drafts => {
      if (!attachmentsMountedRef.current || !drafts.length) return;
      const liveTokens = new Set(findTransientUploadReferences(editorViewRef.current?.state.doc.toString() ?? "").map(ref => ref.token));
      setAttachmentDrafts(current => ({ ...current, ...Object.fromEntries(drafts
        .filter(draft => liveTokens.has(draft.token) && !current[draft.token]).map(draft => [draft.token, { ...draft,
          status: "error", progress: 0, error: zh ? "已恢复原上传身份，请核对结果。" : "Original upload identity restored. Check the result.",
        } as AttachmentDraftState])) }));
    }).catch(() => undefined).finally(() => { for (const token of missing) restoringAttachmentsRef.current.delete(token); });
  }, [text, attachmentDrafts, zh]);
  function attachmentCallbacks(): AttachmentDraftCallbacks {
    return {
      onProgress: (token, progress) => setAttachmentDrafts((current) => current[token] ? { ...current, [token]: { ...current[token], status: "uploading", error: undefined, recoveryAction: undefined, progress } } : current),
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
        replacePendingMarker(view, token, canonicalId);
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
        setText(canonicalDocument);
        setAttachmentDrafts((current) => current[token] ? { ...current, [token]: { ...current[token], itemId: canonicalId, status: "ready", progress: 100 } } : current);
      },
      onError: (token, message, recoveryAction) => {
        if (!attachmentFailureTokensRef.current.has(token)) {
          attachmentFailureTokensRef.current.add(token);
          setAttachmentTrayOpen(true);
        }
        setAttachmentDrafts((current) => current[token] ? { ...current, [token]: { ...current[token], status: "error", error: message, recoveryAction } } : current);
      },
    };
  }
  const performAttachmentInsert = (files: File[], position: number) => {
    if (!files.length && pendingCodeDrop?.attachment) {
      performExistingAttachmentInsert(pendingCodeDrop.attachment, position);
      return;
    }
    const callbacks = attachmentCallbacks();
    const drafts = onAttachmentFiles?.(files, position, callbacks) ?? [];
    setAttachmentDrafts((current) => ({
      ...current,
      ...Object.fromEntries(drafts.map((draft) => [draft.token, { ...draft, status: "uploading", progress: 0 } as AttachmentDraftState])),
    }));
    const view = editorViewRef.current;
    if (view && drafts.length) {
      insertPendingMarkers(view, drafts, position);
      const pendingDocument = view.state.doc.toString();
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
    removePendingMarker(editorViewRef.current, draft.token, draft.itemId);
    if (editorViewRef.current) {
      const nextDocument = editorViewRef.current.state.doc.toString();
      setText(nextDocument);
      if (findTransientUploadReferences(nextDocument).some(ref => ref.token === draft.token)
        || (draft.itemId && countAttachmentReferences(nextDocument, draft.itemId) > 0)) return;
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
  const hideContextToolbar = useCallback((restoreEditorFocus = false) => {
    if (toolbarFrameRef.current !== null) {
      window.cancelAnimationFrame(toolbarFrameRef.current);
      toolbarFrameRef.current = null;
    }
    selectionToolbarOpenRef.current = false;
    setSelectionToolbarOpen(false);
    setToolbarPosition(null);
    if (restoreEditorFocus) {
      window.requestAnimationFrame(() => editorViewRef.current?.focus());
    }
  }, []);

  const closeCommandPanel = useCallback((restoreEditorFocus = false) => {
    editorToolsOpenRef.current = false;
    onEditorToolsOpenChange?.(false);
    if (restoreEditorFocus) {
      window.requestAnimationFrame(() => editorViewRef.current?.focus());
    }
  }, [onEditorToolsOpenChange]);

  const repositionContextToolbar = useCallback(() => {
    toolbarFrameRef.current = null;
    if (!selectionToolbarOpenRef.current || compositionActiveRef.current) return;
    const view = editorViewRef.current;
    const host = editorHostRef.current;
    const saved = savedToolbarSelectionRef.current;
    if (!view || !host || !saved) {
      hideContextToolbar(false);
      return;
    }

    const side = saved.head >= saved.anchor ? 1 : -1;
    const anchorRect = view.coordsAtPos(saved.head, side);
    if (!anchorRect) {
      hideContextToolbar(false);
      return;
    }

    const editorRect = view.scrollDOM.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const visualViewport = window.visualViewport;
    const viewportLeft = visualViewport?.offsetLeft ?? 0;
    const viewportTop = visualViewport?.offsetTop ?? 0;
    const viewportRight = viewportLeft + (visualViewport?.width ?? window.innerWidth);
    const viewportBottom = viewportTop + (visualViewport?.height ?? window.innerHeight);
    const safety = 8;
    const leftBound = Math.max(editorRect.left, hostRect.left, viewportLeft) + safety;
    let rightBound = Math.min(editorRect.right, hostRect.right, viewportRight) - safety;
    const topBound = Math.max(editorRect.top, hostRect.top, viewportTop) + safety;
    const bottomBound = Math.min(editorRect.bottom, hostRect.bottom, viewportBottom) - safety;

    const previewRect = previewPanelRef.current?.getBoundingClientRect();
    if (
      previewRect
      && previewRect.bottom > topBound
      && previewRect.top < bottomBound
      && previewRect.left > leftBound
      && previewRect.left < rightBound
    ) {
      rightBound = Math.min(rightBound, previewRect.left - safety);
    }

    if (
      rightBound - leftBound < 48
      || anchorRect.bottom < topBound
      || anchorRect.top > bottomBound
      || anchorRect.right < leftBound
      || anchorRect.left > rightBound
    ) {
      hideContextToolbar(false);
      return;
    }

    const availableWidth = rightBound - leftBound;
    const width = Math.min(toolbarSizeRef.current.width, availableWidth);
    const height = toolbarSizeRef.current.height;
    const aboveTop = anchorRect.top - 8 - height;
    const belowTop = anchorRect.bottom + 8;
    let placement: SourceContextToolbarPosition["placement"];
    let top: number;
    if (aboveTop >= topBound) {
      placement = "above";
      top = aboveTop;
    } else if (belowTop + height <= bottomBound) {
      placement = "below";
      top = belowTop;
    } else {
      hideContextToolbar(false);
      return;
    }

    const desiredLeft = anchorRect.left - width / 2;
    const left = Math.min(Math.max(desiredLeft, leftBound), rightBound - width);
    setToolbarPosition({
      left: Math.round(left),
      top: Math.round(top),
      placement,
    });
  }, [hideContextToolbar]);

  const requestToolbarPosition = useCallback(() => {
    if (toolbarFrameRef.current !== null) {
      window.cancelAnimationFrame(toolbarFrameRef.current);
    }
    toolbarFrameRef.current = window.requestAnimationFrame(repositionContextToolbar);
  }, [repositionContextToolbar]);

  const synchronizePreviewScroll = useCallback(() => {
    previewSyncFrameRef.current = null;
    if (!showPreviewRef.current) return;
    const view = editorViewRef.current;
    const preview = previewPanelRef.current;
    if (!view || !preview || preview.scrollHeight <= preview.clientHeight) return;

    const editorRect = view.scrollDOM.getBoundingClientRect();
    const contentRect = view.contentDOM.getBoundingClientRect();
    const x = Math.min(contentRect.right - 2, Math.max(contentRect.left + 2, editorRect.left + 2));
    const y = Math.min(editorRect.bottom - 2, editorRect.top + 12);
    const coordinateOffset = view.posAtCoords({ x, y });
    const sourceOffset = Math.max(
      0,
      Math.min(previewTextRef.current.length, coordinateOffset ?? view.state.selection.main.head),
    );
    if (sourceOffset === 0) {
      preview.scrollTop = 0;
      return;
    }

    const anchors = Array.from(
      preview.querySelectorAll<HTMLElement>("[data-markdown-source-start][data-markdown-source-end]"),
    ).map((element) => ({
      element,
      start: Number(element.dataset.markdownSourceStart),
      end: Number(element.dataset.markdownSourceEnd),
    })).filter((anchor) => Number.isFinite(anchor.start) && Number.isFinite(anchor.end))
      .sort((left, right) => left.start - right.start || left.end - right.end);
    const anchor = selectSourcePreviewAnchor(anchors, sourceOffset);
    if (!anchor) return;

    const previewRect = preview.getBoundingClientRect();
    const elementRect = anchor.element.getBoundingClientRect();
    const elementTop = elementRect.top - previewRect.top + preview.scrollTop;
    preview.scrollTop = sourceAlignedPreviewScrollTop({
      sourceOffset,
      anchor,
      elementTop,
      elementHeight: elementRect.height,
      viewportInset: 12,
      maxScrollTop: Math.max(0, preview.scrollHeight - preview.clientHeight),
    });
  }, []);

  const requestPreviewScrollSynchronization = useCallback(() => {
    if (previewSyncFrameRef.current !== null) window.cancelAnimationFrame(previewSyncFrameRef.current);
    previewSyncFrameRef.current = window.requestAnimationFrame(synchronizePreviewScroll);
  }, [synchronizePreviewScroll]);

  useLayoutEffect(() => {
    if (!showPreview) return;
    requestPreviewScrollSynchronization();
    const observer = new ResizeObserver(requestPreviewScrollSynchronization);
    if (editorHostRef.current) observer.observe(editorHostRef.current);
    if (previewPanelRef.current) observer.observe(previewPanelRef.current);
    window.addEventListener("resize", requestPreviewScrollSynchronization);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", requestPreviewScrollSynchronization);
      if (previewSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(previewSyncFrameRef.current);
        previewSyncFrameRef.current = null;
      }
    };
  }, [previewSnapshot.revision, requestPreviewScrollSynchronization, showPreview]);

  const saveToolbarSelection = useCallback((selection: { anchor: number; head: number; from: number; to: number }) => {
    const saved = {
      anchor: selection.anchor,
      head: selection.head,
      from: selection.from,
      to: selection.to,
    };
    savedToolbarSelectionRef.current = saved;
    setToolbarSelectionSnapshot(saved);
    return saved;
  }, []);

  const openContextToolbar = useCallback((selection: { anchor: number; head: number; from: number; to: number }) => {
    if (selection.from === selection.to || editorToolsOpenRef.current) return;
    saveToolbarSelection(selection);
    selectionToolbarOpenRef.current = true;
    setSelectionToolbarOpen(true);
    requestToolbarPosition();
  }, [requestToolbarPosition, saveToolbarSelection]);

  const syncContextToolbarFromView = useCallback((allowAutomaticSelection = true) => {
    const view = editorViewRef.current;
    if (!view || compositionActiveRef.current) return;
    const selection = view.state.selection.main;
    saveToolbarSelection(selection);
    if (!selection.empty && allowAutomaticSelection && !pointerSelectingRef.current) {
      if (editorToolsOpenRef.current) closeCommandPanel(false);
      openContextToolbar(selection);
      return;
    }
    if (selection.empty) {
      hideContextToolbar(false);
      return;
    }
    if (selectionToolbarOpenRef.current) requestToolbarPosition();
  }, [closeCommandPanel, hideContextToolbar, openContextToolbar, requestToolbarPosition, saveToolbarSelection]);

  const dispatchCommand = useCallback((command: EditorCommand, source: "selection" | "panel" | "header") => {
    const view = editorViewRef.current;
    if (!view) return;
    if (command === "undo" || command === "redo") {
      (command === "undo" ? undo : redo)(view);
      view.focus();
      if (source === "selection") window.requestAnimationFrame(() => syncContextToolbarFromView(false));
      return;
    }
    if (command === "attachment") {
      hideContextToolbar(false);
      closeCommandPanel(false);
      onOpenAttachmentPicker?.();
      return;
    }
    const selection = savedToolbarSelectionRef.current ?? view.state.selection.main;
    if (command === "table") {
      setTableTool(captureTableTool(view, selection, editorRevisionRef.current));
      hideContextToolbar(false);
      closeCommandPanel(false);
      return;
    }
    const change = commandChange(command, view.state.doc.toString(), selection.from, selection.to);
    if (!change) return;
    view.dispatch({ changes: change.changes, selection: change.selection, scrollIntoView: true });
    const nextSelection = view.state.selection.main;
    saveToolbarSelection(nextSelection);
    view.focus();
    if (source === "selection") {
      if (nextSelection.empty) hideContextToolbar(false);
      else openContextToolbar(nextSelection);
    } else {
      hideContextToolbar(false);
    }
  }, [closeCommandPanel, hideContextToolbar, onOpenAttachmentPicker, openContextToolbar, saveToolbarSelection, syncContextToolbarFromView]);

  function applyHeaderHistoryCommand() {
    const request = historyCommandRequest;
    if (!request || !editorViewRef.current || appliedHistoryCommandRef.current === request.id) return;
    // Parent callbacks can change after focus, preview or attachment updates.
    // Their new identities must not replay an already consumed Undo/Redo.
    appliedHistoryCommandRef.current = request.id;
    dispatchCommand(request.command, "header");
  }
  useEffect(() => { applyHeaderHistoryCommand(); }, [dispatchCommand, historyCommandRequest]);

  useEffect(() => {
    if (!editorToolsOpen && !selectionToolbarOpen && !showPreview) return;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-testid='source-editor-selection-tools']")) return;
      if (target.closest("[data-testid='source-editor-command-panel']")) return;
      if (target.closest("[data-testid='source-editor-tools-toggle']")) return;
      if (editorHostRef.current?.contains(target)) return;
      if (selectionToolbarOpen) hideContextToolbar(false);
      if (editorToolsOpen) closeCommandPanel(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest("[data-testid='source-editor-table-tool']"))) return;
      if (editorToolsOpen) { event.preventDefault(); closeCommandPanel(true); }
      else if (selectionToolbarOpen) { event.preventDefault(); hideContextToolbar(true); }
      else if (showPreview) { event.preventDefault(); onPreviewChange?.(false); }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOnOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [closeCommandPanel, editorToolsOpen, hideContextToolbar, onPreviewChange, selectionToolbarOpen, showPreview]);

  useEffect(() => {
    editorToolsOpenRef.current = editorToolsOpen;
    if (!editorToolsOpen) return;
    hideContextToolbar(false);
    const view = editorViewRef.current;
    if (view) saveToolbarSelection(view.state.selection.main);
  }, [editorToolsOpen, hideContextToolbar, saveToolbarSelection]);

  useEffect(() => {
    if (!selectionToolbarOpen) return;
    const observer = new ResizeObserver(requestToolbarPosition);
    if (editorHostRef.current) observer.observe(editorHostRef.current);
    if (previewPanelRef.current) observer.observe(previewPanelRef.current);
    window.addEventListener("resize", requestToolbarPosition);
    window.addEventListener("scroll", requestToolbarPosition, true);
    window.visualViewport?.addEventListener("resize", requestToolbarPosition);
    window.visualViewport?.addEventListener("scroll", requestToolbarPosition);
    requestToolbarPosition();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", requestToolbarPosition);
      window.removeEventListener("scroll", requestToolbarPosition, true);
      window.visualViewport?.removeEventListener("resize", requestToolbarPosition);
      window.visualViewport?.removeEventListener("scroll", requestToolbarPosition);
    };
  }, [requestToolbarPosition, selectionToolbarOpen, showPreview]);

  useEffect(() => {
    const focusCommandPanel = () => {
      const button = document.querySelector<HTMLButtonElement>(
        "[data-testid='source-editor-command-panel'] [data-source-toolbar-command]:not(:disabled)",
      );
      button?.focus();
    };
    const restoreEditorFocus = () => editorViewRef.current?.focus();
    window.addEventListener("chat-reader:source-command-panel-focus", focusCommandPanel);
    window.addEventListener("chat-reader:source-toolbar-restore-editor-focus", restoreEditorFocus);
    return () => {
      window.removeEventListener("chat-reader:source-command-panel-focus", focusCommandPanel);
      window.removeEventListener("chat-reader:source-toolbar-restore-editor-focus", restoreEditorFocus);
    };
  }, []);

  useEffect(() => () => {
    editorEventCleanupRef.current?.();
    editorEventCleanupRef.current = null;
    if (toolbarFrameRef.current !== null) {
      window.cancelAnimationFrame(toolbarFrameRef.current);
      toolbarFrameRef.current = null;
    }
  }, []);

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
    const focused = findMarkdownAttachmentReferences(source, "cr-asset").filter(ref =>
      selection.from >= ref.nodeFrom && selection.to <= ref.nodeTo).sort((a, b) =>
      (a.nodeTo - a.nodeFrom) - (b.nodeTo - b.nodeFrom))[0];
    attachmentFocusRef.current?.(focused ? {
      identifier: focused.identifier, from: focused.nodeFrom, to: focused.nodeTo,
      original: source.slice(focused.nodeFrom, focused.nodeTo),
    } : null);
    update.view.dom.classList.toggle("cm-has-selection", !selection.empty);
    saveToolbarSelection(selection);
    if (selection.empty) {
      selectionChangeRef.current?.(null);
      hideContextToolbar(false);
      return;
    }
    const from = Math.min(selection.from, selection.to);
    const to = Math.max(selection.from, selection.to);
    selectionChangeRef.current?.({
      startOffset: unicodeCodePointOffset(source, from),
      endOffset: unicodeCodePointOffset(source, to),
      text: update.state.doc.sliceString(from, to),
    });
    if (!compositionActiveRef.current && !pointerSelectingRef.current) {
      if (editorToolsOpenRef.current) closeCommandPanel(false);
      openContextToolbar(selection);
    }
  }, [closeCommandPanel, hideContextToolbar, openContextToolbar, saveToolbarSelection]);

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

  // Reader refreshes are not editor input. A cleanup reload is an explicit
  // request with the pre-read source, not generic synchronization of props.
  function replaceEditorText(next: string) {
    const view = editorViewRef.current;
    if (!view) {
      queuedEditorTextRef.current = next;
      setText(next);
      return;
    }
    if (view.state.doc.toString() !== next) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        annotations: isolateHistory.of("full"),
      });
    }
    setText(view.state.doc.toString());
  }
  function applyRequestedSourceReload(view: EditorView | null) {
    const request = sourceReloadRequest;
    if (!view || !request || request.messageId !== messageId || appliedSourceReloadRef.current === request
      || savingRef.current || saveUnknown || !saveRecoveryReady) return;
    appliedSourceReloadRef.current = request;
    const latest = request.latest;
    const live = view.state.doc.toString();
    if (live !== request.expectedText || hasAttachmentWork) {
      setComparison(latest);
      setReloadStatus("ready");
      return;
    }
    onAcceptLatest?.();
    if (live !== latest.canonicalText) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: latest.canonicalText },
        annotations: isolateHistory.of("full"),
      });
    }
    setText(view.state.doc.toString());
    setBaselineText(latest.canonicalText);
    draft.restoreBase({
      conversation_id: conversationId ?? "", message_id: messageId ?? "",
      text: latest.canonicalText, saved_at: new Date().toISOString(), revision: editorRevisionRef.current,
      base_version: latest.versionNumber, base_version_id: latest.versionId, base_content_hash: latest.contentHash,
    });
    setComparison(null); setRevisionConflict(false); setReloadStatus("idle"); setError(null);
    onDirtyChange?.(false);
  }
  useLayoutEffect(() => { applyRequestedSourceReload(editorViewRef.current); });

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
    if (appliedInsertionRef.current === insertion) return;
    if (insertion.replace) {
      const changed = changeAttachmentReference(view, insertion.replace, insertion.referenceUri,
        insertion.replace.scope, insertion.replace.remove);
      if (!changed) setError(zh ? "引用位置已变化，请重新选择该引用。" : "The reference changed. Select it again before replacing.");
      if (changed) {
        // Publish the same live source mirror before releasing this request.
        const next = view.state.doc.toString();
        setText(next);
      }
      appliedInsertionRef.current = insertion;
      onAttachmentInsertionApplied?.();
      view.focus();
      return;
    }
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
    const nextDocument = view.state.doc.toString();
    setText(nextDocument);
    appliedInsertionRef.current = insertion;
    cursorOffsetChangeRef.current?.(unicodeCodePointOffset(view.state.doc.toString(), target + value.length));
    onAttachmentInsertionApplied?.();
  }

  function confirmSave(saved: SourceSaveResult) {
    const snapshot = saveSnapshotRef.current;
    if (!snapshot) return;
    const live = editorViewRef.current?.state.doc.toString() ?? text;
    const unchanged = snapshot.revision === editorRevisionRef.current && live === snapshot.text;
    void draft.acknowledge(snapshot.text, {
      base_version: saved.versionNumber, base_version_id: saved.versionId, base_content_hash: saved.contentHash,
    }).catch(() => undefined);
    setBaselineText(saved.canonicalText);
    if (unchanged) {
      replaceEditorText(saved.canonicalText);
      setReason("");
      setShowClosePrompt(false);
    }
    setAttachmentDrafts(current => Object.fromEntries(Object.entries(current).filter(([token, value]) =>
      value !== snapshot.drafts[token] || value.status !== "ready")));
    onDirtyChange?.(!unchanged && live !== saved.canonicalText);
    setSaveUnknown(false);
    setCanRetrySave(false);
    setComparison(null);
    setReloadStatus("idle");
    setError(null);
    setSaveNotice(zh ? "已保存" : "Saved");
    saveSnapshotRef.current = null;
  }

  async function verifySave() {
    if (savingRef.current || !onVerifySave) return;
    savingRef.current = true; setIsSaving(true);
    try { confirmSave(await onVerifySave()); }
    catch (error) {
      const absent = Boolean(error && typeof error === "object" && "code" in error && error.code === "save_not_confirmed");
      setCanRetrySave(absent);
      setError(absent
        ? (zh ? "尚无保存回执。可以重试原请求，不会重复创建版本。" : "No save receipt yet. You can retry the original request without creating a duplicate version.")
        : (zh ? "尚未确认保存结果；草稿保留，可稍后核对。" : "Save is not confirmed yet. Your draft is retained; check again later."));
    }
    finally { savingRef.current = false; setIsSaving(false); }
  }

  async function retryOriginalSave() {
    if (savingRef.current || !canRetrySave || !onRetrySave) return;
    savingRef.current = true; setIsSaving(true); setCanRetrySave(false);
    try { confirmSave(await onRetrySave()); }
    catch (error) {
      const feedback = editorErrorFeedback(error, zh, "save");
      setError(feedback.message); setRevisionConflict(feedback.revisionConflict);
      setSaveUnknown(Boolean(error && typeof error === "object" && "code" in error && error.code === "save_result_unknown"));
    } finally { savingRef.current = false; setIsSaving(false); }
  }

  async function submit(mode: "create_version" | "replace_current") {
    if (savingRef.current || saveUnknown || !saveRecoveryReady) return;
    setError(null);
    setRevisionConflict(false);
    setReloadStatus("idle");
    const authoritativeSource = editorViewRef.current?.state.doc.toString() ?? text;
    const unresolvedReferences = findTransientUploadReferences(authoritativeSource);
    const unresolved = Object.values(attachmentDrafts).find((draft) => draft.status !== "ready" && draft.status !== "removed"
      && unresolvedReferences.some(reference => reference.token === draft.token));
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
    if (!authoritativeSource.trim() || authoritativeSource === baselineText) return;
    const removedIds = removedAttachmentIds(baselineText, authoritativeSource);
    // Removing source references never implicitly deletes conversation files.
    savingRef.current = true;
    saveSnapshotRef.current = { text: authoritativeSource, revision: editorRevisionRef.current, drafts: attachmentDrafts };
    setIsSaving(true);
    const requestToken = ++saveRequestRef.current;
    try {
      const saved = await onSave(
        authoritativeSource,
        reason.trim() || undefined,
        mode,
        removedIds.map((attachmentId) => ({ attachment_id: attachmentId, action: "keep_in_conversation" })),
        editorRevisionRef.current,
      );
      if (requestToken !== saveRequestRef.current) return;
      confirmSave(saved);
    } catch (err) {
      if (requestToken !== saveRequestRef.current) return;
      const feedback = editorErrorFeedback(err, zh, "save");
      setError(feedback.message);
      setRevisionConflict(feedback.revisionConflict);
      setSaveUnknown(Boolean(err && typeof err === "object" && "code" in err && err.code === "save_result_unknown"));
    } finally {
      if (requestToken === saveRequestRef.current) setIsSaving(false);
      savingRef.current = false;
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
    setRevisionConflict(false);
    try {
      await onAttachmentCancel?.(preserve, itemIds);
      if (!onAttachmentCancel) await onCancel(true);
    } catch (closeError) {
      setError(editorErrorFeedback(closeError, zh, "close").message);
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
    <form id={formId} className="relative flex h-full min-h-0 flex-col bg-surface" onSubmit={(event) => { event.preventDefault(); if (!tableTool) void submit("create_version"); }}>
      {draft.candidate ? <div className="flex flex-wrap items-center gap-3 border-b border-ui bg-subtle px-4 py-2 text-sm" role="status">
        <span>{zh ? (draftBaseMatches ? "发现本机未保存草稿。" : "草稿基线已变化或尚未核对；请比较当前正文后再恢复。") : (draftBaseMatches ? "An unsaved local draft is available." : "The draft base changed or is unverified. Compare current source before restoring.")}</span>
        <button type="button" className="min-h-10 text-accent" onClick={async () => {
          const recovered = draft.candidate;
          if (!recovered) return;
          if ((!isUnchanged || !draftBaseMatches) && !await draftDialog.confirm({
            title: zh ? "将此草稿载入编辑器？" : "Load this draft into the editor?",
            description: zh ? "这会替换编辑器中的文字，但不会提交。请先比较当前正文与草稿，检查附件引用后手动保存。" : "This replaces editor text without submitting. Compare current source with the draft, review attachment references, then save manually.",
            confirmLabel: zh ? "载入草稿" : "Load draft",
          })) return;
          draft.restoreBase(recovered.value);
          replaceEditorText(recovered.value.text);
          // Keep the source copy until a new edit has safely persisted.
        }}>{zh ? "恢复到编辑器" : "Restore to editor"}</button>
        <button type="button" className="min-h-10 text-secondary" onClick={async () => {
          if (draft.candidate && await draftDialog.confirm({ title: zh ? "删除这份本机草稿？" : "Delete this local draft?", danger: true }))
            await draft.remove(draft.candidate.key, draft.candidate.value.revision).catch(() => undefined);
        }}>{zh ? "删除草稿" : "Delete draft"}</button>
        <SourceDraftComparison current={initialText} draft={draft.candidate.value.text} zh={zh} />
      </div> : null}
      {draft.status === "error" ? <p role="alert" className="px-4 py-2 text-sm text-[var(--danger)]">{zh ? "本机草稿保存不可用，请勿关闭页面；可以先复制文字。" : "Local draft saving is unavailable. Keep this page open or copy your text."}</p> : null}
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
      <SourceCommandPanel
        open={editorToolsOpen}
        zh={zh}
        activeCommands={activeToolbarCommands(text, toolbarSelectionSnapshot)}
        onCommand={(command) => dispatchCommand(command, "panel")}
        onClose={closeCommandPanel}
      />
      <SourceContextToolbar
        open={selectionToolbarOpen}
        position={toolbarPosition}
        zh={zh}
        activeCommands={activeToolbarCommands(text, toolbarSelectionSnapshot)}
        onCommand={(command) => dispatchCommand(command, "selection")}
        onClose={hideContextToolbar}
        onMeasure={(width, height) => {
          const previous = toolbarSizeRef.current;
          if (previous.width === width && previous.height === height) return;
          toolbarSizeRef.current = { width, height };
          requestToolbarPosition();
        }}
      />
      {tableTool ? (
        <TableToolDialog
          key={`${tableTool.revision}:${tableTool.from}:${tableTool.to}`}
          zh={zh}
          source={tableTool.source}
          range={tableTool}
          stale={editorRevisionRef.current !== tableTool.revision}
          onRefresh={() => { const view = editorViewRef.current; if (view) setTableTool(captureTableTool(view, view.state.selection.main, editorRevisionRef.current)); }}
          onClose={() => setTableTool(null)}
          restoreFocus={() => editorViewRef.current?.contentDOM ?? null}
            onApply={(action, context) => {
            const view = editorViewRef.current;
            if (!view || editorRevisionRef.current !== tableTool.revision || view.state.doc.toString() !== text) {
              setError(zh ? "编辑内容已变化，请重新打开表格工具。" : "The editor changed. Reopen the table tool before applying.");
              return;
            }
              const result = applyMarkdownTableAction(text, tableTool.from, tableTool.to, action, context);
            if (!result) {
              setError(zh ? "无法可靠识别表格范围，请选择完整的表格后重试。" : "The table range could not be identified reliably. Select the complete table and try again.");
              return;
            }
            view.dispatch({ changes: { from: result.from, to: result.to, insert: result.insert }, selection: result.selection, scrollIntoView: true });
            setTableTool(null);
            view.focus();
          }}
        />
      ) : null}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div ref={editorHostRef} className="min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="source-editor-codemirror" data-local-file-drop-target="true">
          <CodeMirror
          initialText={editorInitialTextRef.current}
          height="100%"
          extensions={extensions}
          theme="none"
          basicSetup={sourceEditorBasicSetup}
          onCreateEditor={(view) => {
            editorEventCleanupRef.current?.();
            editorViewRef.current = view;
            if (queuedEditorTextRef.current !== null) {
              const queued = queuedEditorTextRef.current;
              queuedEditorTextRef.current = null;
              replaceEditorText(queued);
            }
            view.dispatch({ effects: themeCompartmentRef.current.reconfigure(codeMirrorTheme(resolvedTheme)) });
            const anchor = codePointToUtf16Offset(view.state.doc.toString(), initialCursorOffset);
            view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
            if (editorHostRef.current) editorHostRef.current.dataset.cursorOffset = String(initialCursorOffset);
            cursorOffsetChangeRef.current?.(unicodeCodePointOffset(view.state.doc.toString(), anchor));
            selectionChangeRef.current?.(null);
            view.dom.classList.toggle("cm-has-selection", !view.state.selection.main.empty);
            saveToolbarSelection(view.state.selection.main);
            view.focus();
            const handlePointerDown = () => {
              pointerSelectingRef.current = true;
            };
            const handlePointerUp = (event: globalThis.PointerEvent) => {
              if (!pointerSelectingRef.current) return;
              pointerSelectingRef.current = false;
              window.setTimeout(
                () => syncContextToolbarFromView(true),
                event.pointerType === "touch" ? 150 : 0,
              );
            };
            const handleCompositionStart = () => {
              compositionActiveRef.current = true;
              hideContextToolbar(false);
            };
            const handleCompositionEnd = () => {
              compositionActiveRef.current = false;
              window.requestAnimationFrame(() => syncContextToolbarFromView(true));
            };
            const handleEditorScroll = () => {
              requestToolbarPosition();
              requestPreviewScrollSynchronization();
            };
            view.contentDOM.addEventListener("pointerdown", handlePointerDown);
            window.addEventListener("pointerup", handlePointerUp);
            view.contentDOM.addEventListener("compositionstart", handleCompositionStart);
            view.contentDOM.addEventListener("compositionend", handleCompositionEnd);
            view.scrollDOM.addEventListener("scroll", handleEditorScroll, { passive: true });
            editorEventCleanupRef.current = () => {
              view.contentDOM.removeEventListener("pointerdown", handlePointerDown);
              window.removeEventListener("pointerup", handlePointerUp);
              view.contentDOM.removeEventListener("compositionstart", handleCompositionStart);
              view.contentDOM.removeEventListener("compositionend", handleCompositionEnd);
              view.scrollDOM.removeEventListener("scroll", handleEditorScroll);
            };
            if (pendingAttachmentInsertion) applyAttachmentInsertion(view, pendingAttachmentInsertion);
            if (queuedFilesRef.current.length) {
              const files = queuedFilesRef.current.splice(0);
              insertFilesAtCurrentPosition(view, files);
            }
            applyRequestedSourceReload(view);
            applyHeaderHistoryCommand();
          }}
          onUpdate={handleEditorUpdate}
          onChange={(next) => { setText(next); }}
          className="h-full text-sm [&_.cm-editor]:h-full"
          />
        </div>
        {showPreview ? <>
          <aside ref={previewPanelRef} className="absolute inset-y-0 right-0 z-30 w-[min(36%,38rem)] min-w-[15rem] overflow-y-auto overscroll-contain border-l border-ui bg-page p-4 shadow-2xl max-sm:inset-x-0 max-sm:w-full max-sm:min-w-0" data-testid="source-editor-rich-preview" data-preview-revision={previewSnapshot.revision} aria-label={zh ? "Markdown 实时预览" : "Live Markdown preview"}>
            <div className="mb-3 flex items-center justify-between border-b border-ui pb-2"><span className="text-xs font-semibold text-secondary">{text === previewText ? (zh ? "实时预览" : "Live preview") : (zh ? "正在更新…" : "Updating…")}</span><button type="button" className="rounded-md p-2 text-secondary hover:bg-subtle" onClick={() => onPreviewChange?.(false)} aria-label={zh ? "关闭预览" : "Close preview"}><X className="h-4 w-4" /></button></div>
            <details className="mb-3 border-b border-ui pb-2 text-xs text-secondary" data-testid="source-editor-reading-policy">
              <summary className="min-h-11 cursor-pointer content-center font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">{zh ? "阅读兼容说明" : "Reading compatibility"}</summary>
              <p className="leading-5">{zh ? "只读兼容显示：仅对已识别的导出结构恢复排版。源码、复制内容和保存的正文不因此改变；无法识别的 HTML 显示为文字，不执行脚本或小工具。预览不能补回导出文件中缺失的内容。" : "Read-only compatibility display restores formatting only for recognized export structures. It does not change source, copied text or saved content. Unrecognized HTML is shown as text; scripts and widgets never run. Preview cannot restore content missing from an export."}</p>
            </details>
            <MarkdownRenderer text={previewText} isAssistant={false} preserveSourceOffsets scopeId={`editor-${messageId ?? formId}`} />
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
            return <div key={draft.token} className="relative flex h-10 items-center gap-2 border-t border-ui/60 max-sm:h-11" data-testid={`source-editor-upload-${draft.token}`} data-upload-status={draft.status} onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest" })}>
              <span className="min-w-0 flex-1 truncate text-primary" title={draft.displayName}>{draft.displayName}</span>
              <span className={`inline-flex shrink-0 items-center gap-1 ${draft.status === "error" ? "text-[var(--danger)]" : "text-secondary"}`}>
                {draft.status === "uploading" || draft.status === "canonicalizing" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : draft.status === "ready" ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--accent)]" /> : <AlertCircle className="h-3.5 w-3.5" />}
                <span>{status}</span>
              </span>
              {draft.status === "error" ? <button type="button" className="hidden min-h-8 shrink-0 rounded-md px-2 text-[var(--accent)] hover:bg-surface sm:inline-flex sm:items-center" onClick={retry}>{draft.recoveryAction === "replace_source" ? (zh ? "替换源文件" : "Replace source file") : (zh ? "重试" : "Retry")}</button> : null}
              <button type="button" className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-surface sm:inline-flex" aria-label={zh ? `移除 ${draft.displayName}` : `Remove ${draft.displayName}`} onClick={remove}><X className="h-3.5 w-3.5" /></button>
              <div className="relative sm:hidden" data-attachment-action-menu="true">
                <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-md text-secondary hover:bg-surface" aria-label={zh ? `${draft.displayName} 的操作` : `Actions for ${draft.displayName}`} aria-expanded={attachmentActionToken === draft.token} onClick={() => setAttachmentActionToken((current) => current === draft.token ? null : draft.token)}><MoreHorizontal className="h-4 w-4" /></button>
                {attachmentActionToken === draft.token ? <div className="absolute bottom-full right-0 z-20 mb-1 min-w-28 rounded-md border border-ui bg-raised p-1 shadow-lg">
                  {draft.status === "error" ? <button type="button" className="min-h-10 w-full rounded px-3 text-left text-primary hover:bg-subtle" onClick={retry}>{draft.recoveryAction === "replace_source" ? (zh ? "替换源文件" : "Replace source file") : (zh ? "重试" : "Retry")}</button> : null}
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
        {receiptStorageUnavailable && saveUnknown ? <p className="text-xs text-secondary" role="status">{zh ? "本机回执不可用；核对前请保留此页面。" : "Local receipts are unavailable. Keep this page open until the result is confirmed."}</p> : null}
        {readerRefreshPending ? <p className="text-xs text-secondary" role="status">{zh ? "已保存，正文待刷新。" : "Saved. Reader refresh is pending."}<button type="button" className="min-h-11 px-2 underline" onClick={onRefreshReader}>{zh ? "刷新正文" : "Refresh reader"}</button></p> : null}
        {error ? <div className="rounded-lg border border-[var(--danger)] p-2 text-sm text-[var(--danger)]" role="alert">
          <p>{error}</p>
          {saveUnknown && onVerifySave ? <button type="button" disabled={isSaving} onClick={() => void verifySave()} className="min-h-11 underline">{zh ? "核对结果" : "Check result"}</button> : null}
          {saveUnknown && canRetrySave && onRetrySave ? <button type="button" disabled={isSaving} onClick={() => void retryOriginalSave()} className="ml-3 min-h-11 underline">{zh ? "重试原保存" : "Retry original save"}</button> : null}
          {revisionConflict && onReloadLatest ? <button type="button" disabled={reloadStatus === "loading"} onClick={() => {
            setReloadStatus("loading");
            void onReloadLatest().then(latest => { setComparison(latest); setReloadStatus("ready"); })
              .catch(reloadError => { setReloadStatus("idle"); setError(editorErrorFeedback(reloadError, zh, "reload").message); });
          }} className="min-h-11 underline">{reloadStatus === "loading" ? (zh ? "正在加载…" : "Loading…") : (zh ? "比较最新内容" : "Compare latest source")}</button> : null}
        </div> : null}
        {comparison ? <div className="rounded-lg border border-ui p-2 text-sm">
          <SourceDraftComparison current={comparison.canonicalText} draft={text} zh={zh} />
          <button type="button" className="min-h-11 text-accent" onClick={() => {
            onAcceptLatest?.();
            setBaselineText(comparison.canonicalText);
            draft.restoreBase({ conversation_id: conversationId ?? "", message_id: messageId ?? "",
              text, saved_at: new Date().toISOString(), revision: editorRevisionRef.current,
              base_version: comparison.versionNumber, base_version_id: comparison.versionId, base_content_hash: comparison.contentHash });
            setComparison(null); setRevisionConflict(false); setError(null);
          }}>{zh ? "已核对，以最新版本为基线继续编辑草稿" : "Reviewed — keep editing this draft against the latest version"}</button>
        </div> : null}
        <span className="pointer-events-none absolute bottom-16 right-4 text-xs text-secondary" role="status">{saveNotice}</span>
        {reloadStatus === "ready" ? <div className="rounded-lg border border-ui bg-subtle p-2 text-sm text-primary" role="status">{zh ? "\u5df2\u52a0\u8f7d\u6700\u65b0\u72b6\u6001\uff0c\u4f60\u7684\u8349\u7a3f\u4ecd\u4fdd\u7559\u3002\u8bf7\u68c0\u67e5\u540e\u91cd\u65b0\u4fdd\u5b58\u3002" : "Latest state loaded. Your draft is still preserved; review it and save again."}</div> : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" data-source-editor-close="true" onClick={requestClose} disabled={isSaving} className="min-h-10 rounded-lg px-3 text-sm font-medium text-secondary hover:bg-subtle">{zh ? "\u9605\u8bfb\u6a21\u5f0f" : "Reading mode"}</button>
          {versionNumber > 1 ? <button type="button" onClick={() => void submit("replace_current")} disabled={isSaving || !trimmedText || isUnchanged || hasUnresolvedAttachment} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-ui bg-surface px-3 text-sm font-medium text-primary hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"><Save className="h-4 w-4" />{zh ? "\u4fdd\u5b58\u5230\u5f53\u524d\u7248\u672c" : "Replace current version"}</button> : null}
          <button type="submit" data-testid="source-editor-create-version" disabled={isSaving || !trimmedText || isUnchanged || hasUnresolvedAttachment} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[var(--text)] px-3 text-sm font-medium text-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"><SaveAll className="h-4 w-4" />{isSaving ? t("saving") : `${zh ? "\u521b\u5efa" : "Create"} v${versionNumber + 1}`}</button>
        </div>
      </footer>
      {showClosePrompt ? (
        <div className="fixed inset-0 z-[250] flex items-end justify-center bg-[var(--overlay)] p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby={`unsaved-edit-${versionNumber}`}>
          <button type="button" className="absolute inset-0" onClick={() => setShowClosePrompt(false)} aria-label={zh ? "\u7ee7\u7eed\u7f16\u8f91" : "Continue editing"} />
          <div className="relative w-full rounded-t-2xl border border-ui bg-raised p-5 shadow-2xl sm:max-w-md sm:rounded-xl">
            <h2 id={`unsaved-edit-${versionNumber}`} className="text-base font-semibold text-primary">{zh ? "\u4fdd\u5b58\u8fd9\u6b21\u4fee\u6539\u5417\uff1f" : "Save these changes?"}</h2>
            <p className="mt-1 text-sm leading-6 text-secondary">{zh ? "\u53ef\u4fdd\u5b58\u4e3a\u65b0\u7248\u672c\uff0c\u653e\u5f03\u4fee\u6539\uff0c\u6216\u7ee7\u7eed\u7f16\u8f91\u3002" : "Save a new version, discard the changes, or continue editing."}</p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setShowClosePrompt(false)} className="min-h-10 rounded-lg border border-ui bg-surface px-4 text-sm font-medium text-primary hover:bg-subtle">{zh ? "\u7ee7\u7eed\u7f16\u8f91" : "Continue editing"}</button>
              {hasAttachmentWork ? <button type="button" onClick={() => void closeWithAttachments(true)} className="min-h-10 rounded-lg px-4 text-sm font-medium text-secondary hover:bg-subtle">{zh ? "\u4fdd\u7559\u6587\u4ef6\u5e76\u5173\u95ed" : "Keep files and close"}</button> : null}
              <button type="button" onClick={async () => {
                try {
                  await draft.acknowledge(editorViewRef.current?.state.doc.toString() ?? text);
                  if (hasAttachmentWork) await closeWithAttachments(false);
                  else await onCancel(true);
                } catch {
                  setError(zh ? "未能移除本机草稿，修改仍保留，请重试。" : "Could not remove the local draft. Your changes are retained; please retry.");
                }
              }} className="min-h-10 rounded-lg px-4 text-sm font-medium text-[var(--danger)] hover:bg-[var(--danger-soft)]">{zh ? "\u653e\u5f03" : "Discard"}</button>
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

type EditorCommand = SourceEditorCommand;
type CommandChange = { from: number; to?: number; insert: string };
type CommandResult = { changes: CommandChange | CommandChange[]; selection: { anchor: number; head?: number } };

function commandChange(command: EditorCommand, source: string, from: number, to: number): CommandResult | null {
  const selected = source.slice(from, to);
  if (command === "undo" || command === "redo") return null;
  if (command === "bold" || command === "italic" || command === "strike" || command === "underline" || command === "code") {
    const pair = command === "bold" ? ["**", "**"] : command === "italic" ? ["*", "*"] : command === "strike" ? ["~~", "~~"] : command === "underline" ? ["<u>", "</u>"] : ["`", "`"];
    const value = `${pair[0]}${selected}${pair[1]}`;
    const contentStart = from + pair[0].length;
    return {
      changes: { from, to, insert: value },
      selection: selected
        ? { anchor: contentStart, head: contentStart + selected.length }
        : { anchor: contentStart },
    };
  }
  if (command === "link") {
    const value = `[${selected}]()`;
    return {
      changes: { from, to, insert: value },
      selection: selected
        ? { anchor: from + selected.length + 3 }
        : { anchor: from + 1 },
    };
  }
  if (command === "image") {
    const value = `![${selected}]()`;
    return {
      changes: { from, to, insert: value },
      selection: selected
        ? { anchor: from + selected.length + 4 }
        : { anchor: from + 2 },
    };
  }
  if (command === "footnote") {
    const label = nextFootnoteLabel(source);
    const reference = `[^${label}]`;
    const replacement = selected + reference;
    const separator = source.endsWith("\n") ? "\n" : "\n\n";
    const definition = `${separator}[^${label}]: `;
    if (to === source.length) {
      return {
        changes: { from, to, insert: replacement + definition },
        selection: { anchor: from + replacement.length + definition.length },
      };
    }
    const delta = replacement.length - (to - from);
    return {
      changes: [
        { from, to, insert: replacement },
        { from: source.length, insert: definition },
      ],
      selection: { anchor: source.length + delta + definition.length },
    };
  }
  if (command === "rule") return { changes: { from, insert: "\n\n---\n\n" }, selection: { anchor: from + 7 } };
  if (command === "code-block") {
    const value = `\`\`\`\n${selected}\n\`\`\``;
    return {
      changes: { from, to, insert: value },
      selection: selected
        ? { anchor: from + 4, head: from + 4 + selected.length }
        : { anchor: from + 4 },
    };
  }
  if (command === "math-block") {
    const value = `$$\n${selected}\n$$`;
    return {
      changes: { from, to, insert: value },
      selection: selected
        ? { anchor: from + 3, head: from + 3 + selected.length }
        : { anchor: from + 3 },
    };
  }
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

function nextFootnoteLabel(source: string): string {
  let index = 1;
  while (source.includes(`[^${index}]`)) index += 1;
  return String(index);
}

function activeToolbarCommands(
  source: string,
  selection: SavedToolbarSelection | null,
): ReadonlySet<SourceEditorCommand> {
  const active = new Set<SourceEditorCommand>();
  if (!selection) return active;

  const from = Math.max(0, Math.min(selection.from, source.length));
  const to = Math.max(from, Math.min(selection.to, source.length));
  const selected = source.slice(from, to);
  const before = source.slice(Math.max(0, from - 8), from);
  const after = source.slice(to, Math.min(source.length, to + 8));
  const lineStart = source.lastIndexOf("\n", Math.max(0, selection.head - 1)) + 1;
  const nextBreak = source.indexOf("\n", selection.head);
  const lineEnd = nextBreak === -1 ? source.length : nextBreak;
  const line = source.slice(lineStart, lineEnd);

  if ((before.endsWith("**") && after.startsWith("**")) || /^\*\*[^\n]+\*\*$/.test(selected)) active.add("bold");
  if ((before.endsWith("~~") && after.startsWith("~~")) || /^~~[^\n]+~~$/.test(selected)) active.add("strike");
  if ((before.endsWith("\u0060") && after.startsWith("\u0060")) || /^\u0060[^\n]+\u0060$/.test(selected)) active.add("code");
  if ((before.endsWith("<u>") && after.startsWith("</u>")) || /^<u>[^\n]+<\/u>$/.test(selected)) active.add("underline");
  if (
    (before.endsWith("*") && !before.endsWith("**") && after.startsWith("*") && !after.startsWith("**"))
    || /^\*[^\n]+\*$/.test(selected)
  ) active.add("italic");
  if (/^#{1,6}\s+/.test(line)) active.add("heading");
  if (/^>\s+/.test(line)) active.add("quote");
  if (/^[-*+]\s+(?!\[[ xX]\])/.test(line)) active.add("bullets");
  if (/^\d+\.\s+/.test(line)) active.add("numbered");
  if (/^-\s+\[[ xX]\]\s+/.test(line)) active.add("tasks");
  return active;
}

type EditorErrorKind = "conflict" | "temporary" | "not-found" | "content" | "attachment" | "unknown";
type EditorErrorOperation = "save" | "close" | "reload";

function editorErrorFeedback(error: unknown, zh: boolean, operation: EditorErrorOperation): { message: string; revisionConflict: boolean } {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const statusValue = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  const status = typeof statusValue === "number"
    ? statusValue
    : undefined;
  const structured = error && typeof error === "object" ? error as { code?: string; details?: { line_number?: number } } : {};
  if (structured.code) {
    const line = structured.details?.line_number;
    const prefix = line ? (zh ? `第 ${line} 行：` : `Line ${line}: `) : "";
    const messages: Record<string, [string, string]> = {
      source_changed: ["正文已更新；请比较最新内容。", "Source changed. Compare the latest version."],
      source_baseline_required: ["需要先核对最新正文。", "Compare the latest source first."],
      save_result_unknown: ["保存结果待确认；草稿仍保留。", "Save result is unknown; your draft is retained."],
      attachment_unavailable: ["附件不可用，请定位此处引用并替换；其他文字仍保留。", "Attachment unavailable. Locate and replace this reference; your other edits are retained."],
      attachment_reference_unmapped: ["附件引用无法定位，请检查 Markdown 写法。", "The reference cannot be mapped. Check its Markdown syntax."],
      attachment_reference_invalid: ["附件身份无效，请重新插入文件引用。", "Invalid attachment identity. Insert the file reference again."],
    };
    const copy = messages[structured.code];
    if (copy) return { message: prefix + copy[zh ? 0 : 1], revisionConflict: ["source_changed", "source_baseline_required"].includes(structured.code) };
  }
  const kind = editorErrorKind(raw, status);
  return {
    message: editorErrorMessage(kind, zh, operation),
    revisionConflict: kind === "conflict",
  };
}

function editorErrorKind(message: string, status?: number): EditorErrorKind {
  const normalized = message.toLowerCase();
  if (isRevisionConflictMessage(message)) return "conflict";
  if (status === 404 || /message not found|消息不存在|消息已删除|conversation not found|对话不存在/.test(normalized)) return "not-found";
  if (
    status === 413
    || /content (?:is )?too (?:large|long)|message content cannot be empty|内容(?:不能为空|过大|超过)|正文(?:不能为空|过长|过大)/.test(normalized)
  ) return "content";
  if (/attachment|附件|upload|上传|finaliz|canonicaliz|cr-asset/.test(normalized)) return "attachment";
  if (
    (status !== undefined && status >= 500)
    || /connection_failed|network|fetch|temporarily unavailable|service unavailable|服务暂时不可用|请求失败|连接|超时|timeout|interrupted/.test(normalized)
  ) return "temporary";
  return "unknown";
}

function editorErrorMessage(kind: EditorErrorKind, zh: boolean, operation: EditorErrorOperation): string {
  if (kind === "conflict") {
    return zh
      ? "这条消息已被其他操作更新。你的修改仍保留，请加载最新状态后检查并重试。"
      : "This message was updated elsewhere. Your changes are preserved; load the latest state, review it, and retry.";
  }
  if (kind === "not-found") {
    return zh
      ? "当前消息已不可用。你的草稿仍保留，请加载最新状态或返回阅读。"
      : "This message is no longer available. Your draft is preserved; load the latest state or return to reading.";
  }
  if (kind === "content") {
    return zh
      ? "内容不符合当前保存限制。你的草稿仍保留，请调整内容后重试。"
      : "The content does not meet the current save limits. Your draft is preserved; adjust it and retry.";
  }
  if (kind === "attachment") {
    return operation === "close"
      ? (zh
        ? "未保存的附件暂时无法处理。你的源码和附件草稿仍保留，请重试或继续编辑。"
        : "Unsaved attachments could not be processed. Your source and attachment drafts are preserved; retry or continue editing.")
      : (zh
        ? "附件处理未完成。你的源码和附件草稿仍保留，请重试附件或移除引用。"
        : "Attachment processing did not finish. Your source and attachment drafts are preserved; retry the attachment or remove its reference.");
  }
  if (kind === "temporary") {
    return operation === "reload"
      ? (zh
        ? "暂时无法加载最新状态。你的草稿仍保留，请检查连接后重试。"
        : "The latest state is temporarily unavailable. Your draft is preserved; check the connection and retry.")
      : (zh
        ? "暂时无法完成这项操作。你的草稿仍保留，请检查连接后重试。"
        : "This operation is temporarily unavailable. Your draft is preserved; check the connection and retry.");
  }
  return operation === "reload"
    ? (zh
      ? "无法加载最新状态。你的草稿仍保留，请稍后重试。"
      : "Unable to load the latest state. Your draft is preserved; please retry.")
    : operation === "close"
      ? (zh
        ? "无法处理未保存的附件。你的源码和附件草稿仍保留，请重试或继续编辑。"
        : "Unable to process unsaved attachments. Your source and attachment drafts are preserved; retry or continue editing.")
      : (zh
        ? "无法保存这次修改。你的草稿仍保留，请重试或加载最新状态后再保存。"
        : "Unable to save this change. Your draft is preserved; retry or load the latest state before saving again.");
}

function isRevisionConflictMessage(message: string): boolean {
  return /\u5bf9\u8bdd\u5df2\u5728\u5176\u4ed6\u64cd\u4f5c\u4e2d\u66f4\u65b0|conversation.+(?:changed|updated)|revision|stale|base version|source changed/.test(message.toLowerCase());
}

function attachmentReferenceCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ref of findMarkdownAttachmentReferences(text, "cr-asset")) counts.set(ref.identifier.toLowerCase(), (counts.get(ref.identifier.toLowerCase()) ?? 0) + 1);
  return counts;
}

function countAttachmentReferences(text: string, attachmentId: string): number { return attachmentReferenceCounts(text).get(attachmentId.toLowerCase()) ?? 0; }
function removedAttachmentIds(before: string, after: string): string[] { const previous = attachmentReferenceCounts(before); const next = attachmentReferenceCounts(after); return Array.from(previous.keys()).filter(id => !next.get(id)); }

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
      "&:not(.cm-focused) .cm-selectionBackground": {
        backgroundColor: colors.selection,
        opacity: "0.78",
      },
      "&:not(.cm-focused) .cm-content ::selection": {
        backgroundColor: colors.selection,
        color: colors.selectionText,
      },
      ".cm-gutters": { backgroundColor: colors.raised, color: colors.muted, borderRight: `1px solid ${colors.line}` },
      ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: colors.active },
      "&.cm-has-selection .cm-activeLine": { backgroundColor: "transparent" },
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

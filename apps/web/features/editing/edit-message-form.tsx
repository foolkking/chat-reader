"use client";

import dynamic from "next/dynamic";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { ChevronDown, Save, SaveAll, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import {
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
  onAttachmentInsertionApplied,
  onAttachmentFiles,
  onAttachmentRetry,
  onAttachmentRemove,
  onAttachmentCancel,
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
  onSave: (text: string, reason: string | undefined, mode: "create_version" | "replace_current") => Promise<void>;
  onAttachmentInsertionApplied?: () => void;
  onAttachmentFiles?: (files: File[], position: number, callbacks: AttachmentDraftCallbacks) => AttachmentDraft[];
  onAttachmentRetry?: (token: string) => void;
  onAttachmentRemove?: (token: string) => void;
  onAttachmentCancel?: (preserve: boolean, itemIds: string[]) => Promise<void> | void;
}) {
  const { t, resolvedLocale, resolvedTheme } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const editorViewRef = useRef<EditorView | null>(null);
  const insertFilesRef = useRef<(files: File[], position: number, originalCodePosition?: number) => void>(() => undefined);
  const completedUploadItemsRef = useRef(new Map<string, string>());
  const queuedFilesRef = useRef<File[]>([]);
  const themeCompartmentRef = useRef(new Compartment());
  const initialThemeRef = useRef(resolvedTheme);
  const appliedInsertionRef = useRef<string | null>(null);
  const [text, setText] = useState(initialText);
  const [baselineText, setBaselineText] = useState(initialText);
  const [reason, setReason] = useState("");
  const [showReason, setShowReason] = useState(false);
  const [showClosePrompt, setShowClosePrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [attachmentDrafts, setAttachmentDrafts] = useState<Record<string, AttachmentDraftState>>({});
  const [pendingCodeDrop, setPendingCodeDrop] = useState<{ files: File[]; afterPosition: number; originalPosition: number } | null>(null);
  const trimmedText = text.trim();
  const isUnchanged = trimmedText === baselineText.trim();
  const hasAttachmentWork = Object.values(attachmentDrafts).some((draft) => draft.status !== "removed");
  const hasUnresolvedAttachment = Object.values(attachmentDrafts).some((draft) => draft.status === "uploading" || draft.status === "error");
  const performAttachmentInsert = (files: File[], position: number) => {
    const callbacks: AttachmentDraftCallbacks = {
      onProgress: (token, progress) => setAttachmentDrafts((current) => current[token] ? { ...current, [token]: { ...current[token], progress } } : current),
      onComplete: (token, item) => {
        const view = editorViewRef.current;
        if (!view || !replacePendingMarker(view, token, item.id)) completedUploadItemsRef.current.set(token, item.id);
        setAttachmentDrafts((current) => current[token] ? { ...current, [token]: { ...current[token], itemId: item.id, status: "ready", progress: 100 } } : current);
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
      for (const draft of drafts) {
        const itemId = completedUploadItemsRef.current.get(draft.token);
        if (itemId && replacePendingMarker(view, draft.token, itemId)) completedUploadItemsRef.current.delete(draft.token);
      }
    }
  };
  insertFilesRef.current = (files, position, originalCodePosition) => {
    if (originalCodePosition !== undefined) {
      setPendingCodeDrop({ files, afterPosition: position, originalPosition: originalCodePosition });
      return;
    }
    performAttachmentInsert(files, position);
  };
  const extensions = useMemo(() => codeMirrorExtensions(themeCompartmentRef.current, initialThemeRef.current, {
    onFiles: (files, position, originalCodePosition) => insertFilesRef.current(files, position, originalCodePosition),
  }), []);

  useEffect(() => {
    const onSourceLocate = (event: Event) => {
      const detail = (event as CustomEvent<{ messageId?: string; cursorOffset?: number }>).detail;
      if (!messageId || detail?.messageId !== messageId || detail.cursorOffset === undefined) return;
      const view = editorViewRef.current;
      if (!view) return;
      const anchor = Math.max(0, Math.min(detail.cursorOffset, view.state.doc.length));
      view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
      onCursorOffsetChange?.(anchor);
    };
    window.addEventListener("chat-reader:source-editor-locate", onSourceLocate);
    return () => window.removeEventListener("chat-reader:source-editor-locate", onSourceLocate);
  }, [messageId, onCursorOffsetChange]);

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
    setText(initialText);
    setBaselineText(initialText);
  }, [baselineText, initialText, isUnchanged]);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || requestedCursorOffset === undefined) return;
    const anchor = Math.max(0, Math.min(requestedCursorOffset, view.state.doc.length));
    view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
    onCursorOffsetChange?.(anchor);
  }, [onCursorOffsetChange, requestedCursorOffset]);

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
    onCursorOffsetChange?.(target + value.length);
    onAttachmentInsertionApplied?.();
  }

  async function submit(mode: "create_version" | "replace_current") {
    setError(null);
    const unresolved = Object.values(attachmentDrafts).find((draft) => draft.status === "uploading" || draft.status === "error");
    if (unresolved) {
      setError(zh ? `附件“${unresolved.displayName}”尚未完成，请先重试或移除。` : `Attachment “${unresolved.displayName}” is not ready. Retry or remove it before saving.`);
      return;
    }
    if (!trimmedText || isUnchanged) return;
    setIsSaving(true);
    try {
      await onSave(trimmedText, reason.trim() || undefined, mode);
      setBaselineText(trimmedText);
      setText(trimmedText);
      setReason("");
      setShowClosePrompt(false);
      setAttachmentDrafts({});
      completedUploadItemsRef.current.clear();
      onDirtyChange?.(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("unableSaveEdit"));
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
      <div className="min-h-0 flex-1 overflow-hidden" data-testid="source-editor-codemirror">
        <CodeMirror
          value={text}
          height="100%"
          extensions={extensions}
          theme="none"
          basicSetup={{ lineNumbers: true, highlightActiveLine: true, foldGutter: true, searchKeymap: true }}
          onCreateEditor={(view) => {
            editorViewRef.current = view;
            view.dispatch({ effects: themeCompartmentRef.current.reconfigure(codeMirrorTheme(resolvedTheme)) });
            const anchor = Math.max(0, Math.min(initialCursorOffset, view.state.doc.length));
            view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
            onCursorOffsetChange?.(anchor);
            view.focus();
            if (pendingAttachmentInsertion) applyAttachmentInsertion(view, pendingAttachmentInsertion);
            if (queuedFilesRef.current.length) {
              const files = queuedFilesRef.current.splice(0);
              insertFilesAtCurrentPosition(view, files);
            }
          }}
          onUpdate={(update) => onCursorOffsetChange?.(update.state.selection.main.head)}
          onChange={setText}
          className="h-full text-sm [&_.cm-editor]:h-full"
        />
      </div>
      <footer className="shrink-0 space-y-2 border-t border-ui bg-raised p-3">
        {pendingCodeDrop ? <div className="rounded-lg border border-[var(--mark-border)] bg-[var(--mark-bg)] p-3 text-xs text-primary" role="status" data-testid="source-editor-code-drop-choice">
          <p>{zh ? "当前位置在代码块内。附件放在这里不会在 Reader 中显示。" : "This position is inside a code block, so an attachment placed here will not render in Reader."}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="min-h-8 rounded-md bg-[var(--text)] px-3 font-medium text-[var(--surface)]" onClick={() => { performAttachmentInsert(pendingCodeDrop.files, pendingCodeDrop.afterPosition); setPendingCodeDrop(null); }}>{zh ? "插入到代码块之后" : "Insert after code block"}</button>
            <button type="button" className="min-h-8 rounded-md border border-ui bg-surface px-3 font-medium text-primary" onClick={() => { performAttachmentInsert(pendingCodeDrop.files, pendingCodeDrop.originalPosition); setPendingCodeDrop(null); }}>{zh ? "仍作为普通文本插入" : "Insert as plain text"}</button>
            <button type="button" className="min-h-8 rounded-md px-3 font-medium text-secondary hover:bg-subtle" onClick={() => setPendingCodeDrop(null)}>{zh ? "取消" : "Cancel"}</button>
          </div>
        </div> : null}
        {Object.values(attachmentDrafts).some((draft) => draft.status !== "removed") ? <div className="space-y-1 rounded-lg border border-ui bg-subtle p-2 text-xs" data-testid="source-editor-attachment-drafts">
          <p className="text-secondary">{zh ? `待保存附件 ${Object.values(attachmentDrafts).filter((draft) => draft.status !== "removed").length} 个` : `${Object.values(attachmentDrafts).filter((draft) => draft.status !== "removed").length} attachment(s) pending save`}</p>
          {Object.values(attachmentDrafts).filter((draft) => draft.status !== "removed").map((draft) => <div key={draft.token} className="flex min-h-7 items-center gap-2" data-testid={`source-editor-upload-${draft.token}`}>
            <span className="min-w-0 flex-1 truncate text-secondary">{draft.status === "uploading" ? (zh ? `\u6b63\u5728\u4e0a\u4f20\uff1a${draft.displayName}` : `Uploading: ${draft.displayName}`) : draft.status === "error" ? (zh ? `\u4e0a\u4f20\u5931\u8d25\uff1a${draft.displayName}` : `Upload failed: ${draft.displayName}`) : draft.displayName}</span>
            {draft.status === "uploading" ? <span className="shrink-0 text-secondary">{draft.progress}%</span> : null}
            {draft.status === "error" ? <button type="button" className="shrink-0 text-[var(--accent)] hover:underline" onClick={() => { setAttachmentDrafts((current) => ({ ...current, [draft.token]: { ...current[draft.token], status: "uploading", error: undefined, progress: 0 } })); onAttachmentRetry?.(draft.token); }}>{zh ? "\u91cd\u8bd5" : "Retry"}</button> : null}
            <button type="button" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-surface" aria-label={zh ? `\u79fb\u9664 ${draft.displayName}` : `Remove ${draft.displayName}`} onClick={() => { removePendingMarker(editorViewRef.current, draft.token); completedUploadItemsRef.current.delete(draft.token); setAttachmentDrafts((current) => ({ ...current, [draft.token]: { ...current[draft.token], status: "removed" } })); onAttachmentRemove?.(draft.token); }}><X className="h-3.5 w-3.5" /></button>
          </div>)}
        </div> : null}
        <button type="button" onClick={() => setShowReason((value) => !value)} className="inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs font-medium text-secondary hover:bg-subtle"><ChevronDown className={`h-4 w-4 transition ${showReason ? "rotate-180" : ""}`} />{zh ? "\u7f16\u8f91\u8bf4\u660e\uff08\u53ef\u9009\uff09" : "Edit note (optional)"}</button>
        {showReason ? <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("editReason")} className="min-h-10 w-full rounded-lg border border-ui bg-surface px-3 text-sm text-primary outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]" /> : null}
        {error ? <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-2 text-sm text-[var(--danger)]" role="alert"><p>{error}</p><p className="mt-1 text-xs">{zh ? "\u672a\u4fdd\u5b58\u7684\u6e90\u7801\u5df2\u4fdd\u7559\uff0c\u53ef\u91cd\u8bd5\u6216\u5173\u95ed\u540e\u91cd\u65b0\u8f7d\u5165\u5f53\u524d\u7248\u672c\u3002" : "Your unsaved source is preserved. Retry, or close and reload the current version."}</p></div> : null}
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
              <button type="button" onClick={() => hasAttachmentWork ? void closeWithAttachments(false) : void onCancel(true)} className="min-h-10 rounded-lg px-4 text-sm font-medium text-[var(--danger)] hover:bg-[var(--danger-soft)]">{zh ? "\u653e\u5f03" : "Discard"}</button>
              <button type="button" disabled={isSaving} onClick={() => void submit("create_version")} className="min-h-10 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-50">{zh ? "\u4fdd\u5b58\u4e3a\u65b0\u7248\u672c" : "Save as new version"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}

function codeMirrorExtensions(
  themeCompartment: Compartment,
  theme: "light" | "dark",
  handlers: { onFiles: (files: File[], position: number, originalCodePosition?: number) => void },
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

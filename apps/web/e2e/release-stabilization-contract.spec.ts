import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("conversation mutations hand the committed revision to the client", () => {
  const reader = source("features/conversations/conversation-reader.tsx");
  const actionMenu = source("features/conversations/conversation-action-menu.tsx");
  const dataSource = source("lib/reader-data-source.ts");
  const createDialog = source("features/conversations/new-conversation-dialog.tsx");
  const insertDialog = source("features/conversations/message-insert-dialog.tsx");
  const types = source("lib/types.ts");
  expect(types).toContain("conversation_revision: number");
  expect(createDialog).toContain("onCreated(result)");
  expect(insertDialog).toContain("onSubmitted(result)");
  expect(reader).toContain("applyConversationRevision(result.conversation_revision)");
  expect(reader).toContain("applyConversationRevision(result.conversation.offline_revision)");
  expect(reader).toContain("reloadReaderWindowPreservingPosition");
  expect(reader).toContain("captureMutationScrollAnchor");
  expect(reader).toContain("loadCompleteTurnWindowWithAnchorFallback");
  expect(reader).toContain("isMissingReaderAnchorError");
  expect(reader).toContain("The remembered message may have been deleted or absorbed by a merge");
  expect(reader).toContain("removedMessageIds: [message.id]");
  expect(reader).toContain("changedMessageIds: [result.survivor_message_id]");
  expect(reader).not.toContain("async function refreshReader");
  expect(reader).not.toContain('["reader-turn-window", dataSource.mode, conversationId, conversationQuery.data?.offline_revision');
  expect(actionMenu).toContain("triggerConversationDownload");
  expect(actionMenu).not.toContain("window.location.href = getConversationExportUrl");
  expect(reader).toContain("router.push(buildReaderUrl");
  expect(reader).not.toContain("window.location.href = buildReaderUrl");
  expect(reader).toContain("canonicalConversation.offline_revision");
  expect(reader).toContain("recordedRecentConversationRef.current === conversationId");
  expect(reader).toContain("if (!conversationQuery.data");
  expect(dataSource).toContain("return recent.conversation");
  expect(reader).toContain("\\u64a4\\u9500\\u5931\\u8d25");
  expect(source("lib/api.ts")).toContain("response.status >= 500");
  const editForm = source("features/editing/edit-message-form.tsx");
  const sourceWorkspace = source("features/editing/source-editor-workspace.tsx");
  expect(editForm).toContain("onReloadLatest");
  expect(editForm).toContain("\\u52a0\\u8f7d\\u6700\\u65b0\\u72b6\\u6001");
  expect(editForm).toContain("isRevisionConflictMessage");
  expect(sourceWorkspace).toContain("getConversationReaderTurn");
  expect(sourceWorkspace).toContain("baseVersionId: saveBaseVersionId");
});

test("managed dialogs have one pointer-only backdrop and shared focus lifecycle", () => {
  const hook = source("components/use-dialog-focus.ts");
  expect(hook).toContain("Tab");
  expect(hook).toContain("focusFallback");
  for (const path of [
    "components/import-dialog-provider.tsx",
    "components/interaction-dialog-provider.tsx",
    "features/conversations/new-conversation-dialog.tsx",
    "features/conversations/message-insert-dialog.tsx",
    "features/attachments/conversation-files-panel.tsx",
  ]) {
    const content = source(path);
    expect(content).toContain("useDialogFocus");
    expect(content).toContain('data-dialog-backdrop');
    expect(content).not.toContain('aria-label="关闭" onClick={onClose}');
  }
  const viewerSource = source("features/attachments/attachment-viewer.tsx");
  expect(viewerSource).toContain("useDialogFocus");
  expect(viewerSource).toContain("ref={closeRef}");
  expect(viewerSource).toContain("restoreFocus:");
  const focusSource = source("components/use-dialog-focus.ts");
  expect(focusSource).toContain("useLayoutEffect");
  expect(focusSource).toContain("logicalTarget?.isConnected");
  const utilityDrawer = source("components/reader-utility-drawer.tsx");
  expect(utilityDrawer).toContain("useDialogFocus");
  expect(utilityDrawer).toContain("data-dialog-backdrop");
  expect(utilityDrawer).toContain("restoreFocus");
  const reader = source("features/conversations/conversation-reader.tsx");
  expect(reader).toContain("desktopUtilityOpenerRef");
  expect(reader).toContain("!opener.closest(\"[aria-hidden='true']\")");
  expect(reader).toContain("[data-reader-header-more-actions='true']");
});

test("attachment usage count remains a current-version projection", () => {
  const api = source("../api/app/api/routes/attachments.py");
  const panel = source("features/attachments/conversation-files-panel.tsx");
  const sourceWorkspace = source("features/editing/source-editor-workspace.tsx");
  expect(api).toContain("current_occurrence_count");
  expect(panel).toContain("current_occurrence_count");
  expect(panel).toContain('filter === "unused"');
  expect(sourceWorkspace).toContain("current_occurrence_count: currentOccurrenceCount");
});

test("project create Escape restores its trigger", () => {
  const projectSidebar = source("features/projects/project-sidebar.tsx");
  expect(projectSidebar).toContain("projectCreateTriggerRef");
  expect(projectSidebar).toContain('event.key === "Escape"');
  expect(projectSidebar).toContain("props.onCancel()");
});

test("archive restore stays in Import data and files use the annotation-style reader workspace", () => {
  const backupPanel = source("components/data-backup-panel.tsx");
  const importPanel = source("features/import/import-panel.tsx");
  const reader = source("features/conversations/conversation-reader.tsx");
  expect(backupPanel).toContain("Restore system archives from the Import data entry");
  expect(backupPanel).not.toContain("restoreSystemArchive");
  expect(backupPanel).not.toContain("恢复系统归档");
  expect(importPanel).toContain('label=".cr 归档"');
  expect(reader).toContain('storageKey="chat-reader:conversation-files-workspace-floating-v2"');
  expect(reader).toContain('placement="reader-floating"');
  expect(reader).toContain("重置文件窗口位置");
  const workspace = source("components/floating-workspace-panel.tsx");
  expect(workspace).toContain('placement === "reader-floating"');
  expect(workspace).toContain("readerPanelSafeLeft");
  expect(workspace).toContain("data-workspace-drag-handle");
  expect(workspace).toContain("{ left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height }");
  expect(workspace).not.toContain(": geometry : undefined}");
  expect(workspace).toContain("md:cursor-grab md:active:cursor-grabbing");
  expect(workspace).toContain("Paperclip className=\"h-4 w-4 shrink-0 text-accent\"");
});

test("source cursor location is a one-shot request and cannot replay after a dirty rerender", () => {
  const editForm = source("features/editing/edit-message-form.tsx");
  const reader = source("features/conversations/conversation-reader.tsx");
  expect(editForm).toContain("cursorOffsetChangeRef.current = onCursorOffsetChange");
  expect(editForm).toContain("}, [requestedCursorOffset]);");
  expect(editForm).not.toContain("[onCursorOffsetChange, requestedCursorOffset]");
  expect(editForm).toContain("const sourceEditorBasicSetup = useMemo");
  expect(editForm).toContain("const handleEditorUpdate = useCallback");
  expect(editForm).toContain("basicSetup={sourceEditorBasicSetup}");
  expect(editForm).toContain("onUpdate={handleEditorUpdate}");
  expect(editForm).toContain("dataset.cursorOffset = String(codePointOffset)");
  expect(editForm).toContain("codePointToUtf16Offset");
  expect(editForm).toContain("const [editorDocument, setEditorDocument] = useState(initialText)");
  expect(editForm).toContain("value={editorDocument}");
  expect(editForm).not.toContain("value={text}");
  expect(reader).toContain("[data-testid='floating-source-workspace'], input, textarea, select, [contenteditable='true'], [role='textbox']");
});

test("Reader performance evidence separates first content, locator resolution, and target mount without object data", () => {
  const reader = source("features/conversations/conversation-reader.tsx");
  const performanceContract = source("features/conversations/reader-performance.ts");

  expect(performanceContract).toContain('"first-content"');
  expect(performanceContract).toContain('"locator-resolution"');
  expect(performanceContract).toContain('"target-mount"');
  expect(performanceContract).toContain('"chat-reader:reader-performance"');
  expect(performanceContract).toContain("durationMs");
  expect(performanceContract).not.toContain("conversationId");
  expect(performanceContract).not.toContain("messageId");
  expect(performanceContract).not.toContain("attachmentId");
  expect(performanceContract).not.toContain("quote");
  expect(performanceContract).not.toContain("url");

  expect(reader).toContain('reportReaderPerformance(\n          "first-content"');
  expect(reader).toContain('reportReaderPerformance("locator-resolution"');
  expect(reader).toContain('"target-mount",\n          mountStartedAt');
  expect(reader).toContain('timingPath = "local"');
  expect(reader).toContain('const unfinishedOutcome: ReaderPerformanceOutcome');
});

test("Reader locate feedback is a bounded first-line pulse with a reduced-motion fallback", () => {
  const reader = source("features/conversations/conversation-reader.tsx");
  const styles = source("app/globals.css");

  expect(reader).toContain("const rangeRect = range ? firstVisibleRangeRect(range) : null");
  expect(reader).toContain('kind: "text" as const');
  expect(reader).toContain('kind: "marker" as const');
  expect(reader).toContain("width: 3");
  expect(reader).toContain("}, 720)");
  expect(reader).toContain('window.addEventListener("scroll", clear, true)');
  expect(reader).toContain('window.addEventListener("pointerdown", clear, true)');
  expect(styles).toContain(".reader-locate-pulse {\n  position: fixed;");
  expect(styles).toContain("pointer-events: none;");
  expect(styles).toContain("animation: reader-locate-pulse 720ms ease-out both;");
  expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  expect(styles).toContain("animation: reader-locate-static 700ms linear both;");
  expect(styles).not.toContain(".reader-locate-pulse {\n  position: absolute;");
});

test("Reader messages do not use the shared clickable-row hover surface", () => {
  const messageItem = source("features/conversations/message-item.tsx");
  const styles = source("app/globals.css");

  expect(messageItem).toContain('data-hover-surface="none"');
  expect(styles).toContain(
    '.reader-interactive-row:not([data-state]):not([data-hover-surface="none"]):hover',
  );
  expect(styles).toContain(
    '.reader-interactive-row[data-state="selected"]:not([data-hover-surface="none"]):hover',
  );
  expect(styles).not.toContain('.reader-interactive-row:not([data-state]):hover');
});

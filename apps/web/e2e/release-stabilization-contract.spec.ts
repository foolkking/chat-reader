import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("conversation mutations hand the committed revision to the client", () => {
  const reader = source("features/conversations/conversation-reader.tsx");
  const dataSource = source("lib/reader-data-source.ts");
  const createDialog = source("features/conversations/new-conversation-dialog.tsx");
  const insertDialog = source("features/conversations/message-insert-dialog.tsx");
  const types = source("lib/types.ts");
  expect(types).toContain("conversation_revision: number");
  expect(createDialog).toContain("onCreated(result)");
  expect(insertDialog).toContain("onSubmitted(result)");
  expect(reader).toContain("applyConversationRevision(result.conversation_revision)");
  expect(reader).toContain("applyConversationRevision(result.conversation.offline_revision)");
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
  expect(editForm).toContain("cursorOffsetChangeRef.current = onCursorOffsetChange");
  expect(editForm).toContain("}, [requestedCursorOffset]);");
  expect(editForm).not.toContain("[onCursorOffsetChange, requestedCursorOffset]");
  expect(editForm).toContain("update.docChanged || update.selectionSet");
});

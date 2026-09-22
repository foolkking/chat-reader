import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("tablet reader navigation owns one focus-managed dialogue and section surface", () => {
  const reader = source("features/conversations/conversation-reader.tsx");
  const styles = source("app/globals.css");

  expect(reader).toContain("function TabletReaderNavigationDrawer");
  expect(reader).toContain('role="dialog" aria-modal="true"');
  expect(reader).toContain("useDialogFocus({ open, rootRef: panelRef, onClose, restoreFocus })");
  expect(reader).toContain('data-reader-navigation-trigger="true"');
  expect(reader).toContain("restoreNavigationFocus");
  expect(reader).toContain('navigationViewport === "mobile"');
  expect(reader).toContain('navigationViewport === "tablet"');
  expect(reader).toContain("md:flex 2xl:hidden");
  expect(styles).toContain("@media (min-width: 1536px)");
});

test("dialogue and section navigation distinguish loading failure and empty states", () => {
  const index = source("features/toc/conversation-index.tsx");
  const toc = source("features/toc/conversation-toc.tsx");

  for (const state of ["loading", "error", "empty"]) {
    expect(index).toContain(`state="${state}"`);
    expect(toc).toContain(`state="${state}"`);
  }
  expect(index).toContain("pageCandidate?.conversation_id === conversationId");
  expect(toc).toContain("items === undefined && ready && Boolean(effectiveMessageId)");
  expect(toc).toContain('mode === "panel" ? "h-full rounded-md border border-ui shadow-lg" : "h-full"');
});

test("all reader section TOC entry points use version and stable render block identity", () => {
  const reader = source("features/conversations/conversation-reader.tsx");

  expect(reader).toContain("function tocNavigationTarget(item: TocItem): NavigateTarget");
  expect(reader).toContain("messageVersionId: item.message_version_id");
  expect(reader).toContain("renderBlockId: item.render_block_id");
  expect(reader).toContain("blockIndex: item.block_index");
  expect(reader.match(/navigateToTarget\(tocNavigationTarget\(item\)\)/g)?.length).toBe(2);
  expect(reader).toContain("messageVersionId: item.messageVersionId");
});

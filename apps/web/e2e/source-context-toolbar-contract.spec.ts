import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const webRoot = process.cwd();

function source(path: string) {
  return readFileSync(resolve(webRoot, path), "utf8");
}

test.describe("source editor contextual formatting toolbar contract", () => {
  test("anchors to CodeMirror selection geometry instead of the old fixed panel", () => {
    const form = source("features/editing/edit-message-form.tsx");
    expect(form).toContain("view.coordsAtPos(saved.head");
    expect(form).toContain("window.visualViewport");
    expect(form).toContain("previewPanelRef.current?.getBoundingClientRect()");
    expect(form).toContain("anchorRect.bottom < topBound");
    expect(form).not.toContain("absolute left-2 top-12");
  });

  test("renders an icon-only portal toolbar with accessible labels and overflow", () => {
    const toolbar = source("features/editing/source-context-toolbar.tsx");
    expect(toolbar).toContain("createPortal(");
    expect(toolbar).toContain('role="toolbar"');
    expect(toolbar).toContain("data-source-toolbar-command");
    expect(toolbar).toContain("aria-label={item.shortcut");
    expect(toolbar).toContain("group-hover:delay-[350ms]");
    expect(toolbar).not.toContain("<span>{item.label}</span>");
  });

  test("preserves CodeMirror selection and exposes keyboard navigation", () => {
    const form = source("features/editing/edit-message-form.tsx");
    const toolbar = source("features/editing/source-context-toolbar.tsx");
    const workspace = source("features/editing/source-editor-workspace.tsx");
    expect(form).toContain("savedToolbarSelectionRef.current ?? view.state.selection.main");
    expect(toolbar).toContain("event.preventDefault()");
    expect(toolbar).toContain('["ArrowLeft", "ArrowRight", "Home", "End"]');
    expect(workspace).toContain("chat-reader:source-toolbar-focus");
    expect(workspace).toContain("event.altKey || !event.ctrlKey");
  });

  test("tracks scroll, resize, preview and IME without a positioning dependency", () => {
    const form = source("features/editing/edit-message-form.tsx");
    const toolbar = source("features/editing/source-context-toolbar.tsx");
    const packageJson = source("package.json");
    expect(form).toContain('view.scrollDOM.addEventListener("scroll"');
    expect(form).toContain('view.contentDOM.addEventListener("compositionstart"');
    expect(form).toContain("new ResizeObserver(requestToolbarPosition)");
    expect(toolbar).toContain("z-[200]");
    expect(packageJson).not.toContain("@floating-ui");
  });
});

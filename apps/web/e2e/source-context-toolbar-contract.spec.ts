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

  test("separates selection formatting from the explicit command panel", () => {
    const toolbar = source("features/editing/source-context-toolbar.tsx");
    expect(toolbar).toContain("createPortal(");
    expect(toolbar).toContain('data-testid="source-editor-selection-tools"');
    expect(toolbar).toContain('data-testid="source-editor-command-panel"');
    expect(toolbar).toContain('role="toolbar"');
    expect(toolbar).toContain("data-source-toolbar-command");
    expect(toolbar).toContain("aria-label={label}");
    expect(toolbar).toContain("group-hover:delay-[350ms]");
    expect(toolbar).toContain('item("math-block"');
    expect(toolbar).toContain('item("tasks"');
    expect(toolbar).not.toContain('item("image"');
    expect(toolbar).not.toContain('item("attachment"');
    expect(toolbar).not.toContain('item("footnote"');
    expect(toolbar).not.toContain('item("format"');
    expect(toolbar).not.toContain('item("undo"');
    expect(toolbar).not.toContain('item("redo"');
    expect(toolbar).not.toContain("MoreHorizontal");
    expect(toolbar).not.toContain("source-editor-tools-overflow");
    expect(toolbar).not.toContain("<span>{item.label}</span>");
  });

  test("preserves CodeMirror selection and exposes keyboard navigation", () => {
    const form = source("features/editing/edit-message-form.tsx");
    const toolbar = source("features/editing/source-context-toolbar.tsx");
    const workspace = source("features/editing/source-editor-workspace.tsx");
    expect(form).toContain("savedToolbarSelectionRef.current ?? view.state.selection.main");
    expect(toolbar).toContain("event.preventDefault()");
    expect(toolbar).toContain('["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]');
    expect(workspace).toContain("chat-reader:source-command-panel-focus");
    expect(workspace).toContain("event.altKey || !event.ctrlKey");
  });

  test("uses paired caret insertions and keeps the explicit command surface on one row", () => {
    const form = source("features/editing/edit-message-form.tsx");
    const toolbar = source("features/editing/source-context-toolbar.tsx");
    const workspace = source("features/editing/source-editor-workspace.tsx");
    expect(form).toContain("const contentStart = from + pair[0].length");
    expect(form).toContain("selection: selected");
    expect(form).toContain('if (command === "math-block")');
    expect(toolbar).toContain("flex-nowrap");
    expect(toolbar).toContain("max-sm:flex-wrap");
    expect(workspace).toContain('data-testid="source-editor-undo"');
    expect(workspace).toContain('data-testid="source-editor-redo"');
    expect(toolbar).not.toContain("MoreHorizontal");
  });

  test("keeps the active line from covering the first selected row", () => {
    const form = source("features/editing/edit-message-form.tsx");
    expect(form).toContain('classList.toggle("cm-has-selection", !selection.empty)');
    expect(form).toContain('"&.cm-has-selection .cm-activeLine": { backgroundColor: "transparent" }');
    expect(form).toContain('"&:not(.cm-focused) .cm-selectionBackground"');
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

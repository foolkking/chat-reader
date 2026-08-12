import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());

test("AI Rich Markdown core is shared and parser-level", async () => {
  const renderer = fs.readFileSync(path.join(root, "features/conversations/markdown-renderer.tsx"), "utf8");
  const config = fs.readFileSync(path.join(root, "features/rich-markdown/rich-markdown-config.ts"), "utf8");
  const compatibility = fs.readFileSync(path.join(root, "features/rich-markdown/remark-ai-math-compatibility.ts"), "utf8");
  const editor = fs.readFileSync(path.join(root, "features/editing/edit-message-form.tsx"), "utf8");
  const attachment = fs.readFileSync(path.join(root, "features/attachments/attachment-viewer.tsx"), "utf8");

  expect(renderer).toContain("richMarkdownRemarkPlugins");
  expect(renderer).toContain("scopedRichMarkdownRehypePlugins");
  expect(config).toContain('output: "htmlAndMathml"');
  expect(config).toContain("trust: false");
  expect(config).toContain("maxExpand: 1000");
  expect(config).toContain("maxSize: 20");
  expect(compatibility).toContain('type: "math"');
  expect(compatibility).toContain('type: "inlineMath"');
  expect(compatibility).toContain('child.type !== "text"');
  expect(compatibility).not.toMatch(/source\.replace\([^\n]*(?:\\\\\[|\$\$)/);
  expect(renderer).not.toContain("renderMathInElement");
  expect(editor).toContain("source-editor-rich-preview");
  expect(editor).toContain("<MarkdownRenderer");
  expect(attachment).toContain('scopeId={`attachment-${attachment.id}`}');
});

test("KaTeX is locally bundled and rich content owns overflow", async () => {
  const layout = fs.readFileSync(path.join(root, "app/layout.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "features/conversations/markdown-renderer.tsx"), "utf8");
  expect(layout).toContain('import "katex/dist/katex.min.css"');
  expect(styles).toContain(".aui-chat-markdown .katex-display");
  expect(styles).toMatch(/\.aui-chat-markdown \.katex-display[\s\S]*overflow-x: auto/);
  expect(renderer).toContain('markdown-table max-w-full overflow-x-auto');
});

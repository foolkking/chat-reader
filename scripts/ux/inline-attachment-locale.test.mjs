import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const block = await readFile(
  new URL("../../apps/web/features/attachments/attachment-block.tsx", import.meta.url),
  "utf8",
);
const registry = await readFile(
  new URL("../../apps/web/features/attachments/preview-adapter-registry.ts", import.meta.url),
  "utf8",
);

test("inline attachment blocks read the resolved locale and pass it to child renderers", () => {
  assert.match(block, /usePreferences\(\)\.resolvedLocale === "zh-CN"/);
  assert.match(block, /<InlineImage[\s\S]*zh=\{zh\}/);
  assert.match(block, /<InlineTextPreview[\s\S]*zh=\{zh\}/);
  assert.match(block, /<InlineAudio[\s\S]*zh=\{zh\}/);
  assert.match(block, /<InlineVideo[\s\S]*zh=\{zh\}/);
  assert.match(block, /<FileRow[\s\S]*zh=\{zh\}/);
});

test("inline attachment controls provide English alternatives for visible and accessible labels", () => {
  for (const phrase of ["View", "Play", "Open full preview", "Retry preview", "Download", "Attachment information failed to load"]) {
    assert.match(block, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(block, /aria-label=\{`\$\{zh \? "查看" : "View"\}/);
  assert.match(block, /title=\{zh \? "下载" : "Download"\}/);
});

test("attachment type metadata follows the current locale without changing render plans", () => {
  assert.match(registry, /friendlyAttachmentType\(attachment: AttachmentRead, zh = true\)/);
  assert.match(registry, /friendlyAttachmentTypeLabel/);
  assert.match(registry, /"Markdown document"/);
  assert.match(registry, /"Markdown 文档"/);
  assert.match(block, /friendlyAttachmentType\(attachment, zh\)/);
});

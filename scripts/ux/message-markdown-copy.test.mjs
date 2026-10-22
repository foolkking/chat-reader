import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { loadTableFixtureModule } from "./markdown-table-source-fixture.mjs";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { default: ReactMarkdown } = await import(pathToFileURL(require.resolve("react-markdown")).href);
const { default: gfm } = await import(pathToFileURL(require.resolve("remark-gfm")).href);
const { createMessageCopyProbe } = (await loadTableFixtureModule("../../apps/web/features/conversations/message-markdown-copy-source.ts")).module;
const id = "11111111-1111-4111-8111-111111111111", file = "22222222-2222-4222-8222-222222222222";
const token = "a".repeat(43), path = `/api/public-images/${token}`, url = "https://archive.example.test" + path;
const attachments = [
  { id, mime_type: "image/png", source_sha256: "f".repeat(64), available: true },
  { id: file, mime_type: "application/pdf", source_sha256: "e".repeat(64), available: true },
];
function analyse(markdown, items = attachments) {
  const probe = createMessageCopyProbe({ version_id: "synthetic", markdown, attachments: items });
  assert.equal(renderToStaticMarkup(React.createElement(ReactMarkdown, {
    children: markdown, remarkPlugins: [gfm, probe.plugin], skipHtml: true,
  })), "");
  return probe.result();
}
function render(markdown, items) {
  return analyse(markdown, items).render({ [id]: path }, "https://archive.example.test");
}

test("AVIF is supported but unsupported images fail instead of silently disappearing", () => {
  const source = `![picture](cr-asset://${id})`;
  assert.ok(render(source, [{ ...attachments[0], mime_type: "image/avif" }]).includes(url));
  assert.throws(() => analyse(source, [{ ...attachments[0], mime_type: "image/tiff" }]), /COPY_IMAGE_UNSUPPORTED/);
});

test("copies complete source including long tail, math, CRLF, tables and whitespace", () => {
  const source = "# Full\r\n\r\n  **bold** $x^2$  \r\n\r\n| A | B |\r\n| --- | --- |\r\n| 1 | 2 |\r\n\r\n" + "retained ".repeat(30_000) + "TAIL\r\n";
  assert.equal(render(source), source);
});
test("inline/nested escaped image labels become stable public Markdown images", () => {
  const source = `Before ![a [nested\\]]](cr-asset://${id}) after`;
  const result = render(source);
  assert.ok(result.includes(url));
  assert.ok(result.startsWith("Before !["));
  assert.ok(result.endsWith(" after"));
  assert.equal(analyse(source).imageIds.length, 1);
});
test("image file links become embeds, non-image attachment nodes disappear", () => {
  const result = analyse(`[picture](cr-asset://${id})\n\n[file](cr-asset://${file})\n\nEnd`);
  assert.deepEqual(result.imageIds, [id]);
  assert.equal(result.omittedFiles, 1);
  assert.equal(result.render({ [id]: path }, "https://archive.example.test"), `![picture](${url})\n\n\n\nEnd`);
});
test("reference images and links use definitions while file definitions are removed", () => {
  assert.equal(render(`![picture][ref]\n\n[ref]: cr-asset://${id}`), `![picture](${url})\n\n`);
  assert.equal(render(`[file][ref]\n\n[ref]: cr-asset://${file}`), "\n\n");
});
test("inline code, fenced code, math and literal HTML never publish images", () => {
  const source = `\`![literal](cr-asset://${id})\`\n\n~~~md\n![literal](cr-asset://${id})\n~~~\n\n<pre>![literal](cr-asset://${id})</pre>`;
  assert.deepEqual(analyse(source).imageIds, []);
  assert.equal(render(source), source);
});
test("ordinary web links and externally embedded images are unchanged", () => {
  const source = "[docs](https://example.test/a.pdf) ![image](https://example.test/image.png)";
  assert.equal(render(source), source);
});
test("same attachment repeated in source is published once without removing occurrences", () => {
  const source = `![first](cr-asset://${id})\n![second](cr-asset://${id})`;
  assert.deepEqual(analyse(source).imageIds, [id]);
  assert.equal(render(source), `![first](${url})\n![second](${url})`);
});
test("image titles and escaped pipes inside table labels remain valid Markdown", () => {
  const source = `| Image |\n| --- |\n| ![a\\|b](cr-asset://${id} "Caption") |`;
  assert.equal(render(source), `| Image |\n| --- |\n| ![a\\|b](${url} "Caption") |`);
});
test("case-insensitive references and source query/fragment are rewritten", () => {
  assert.equal(render(`![x](CR-ASSET://${id.toUpperCase()}?inline=1#image)`), `![x](${url})`);
});
test("unavailable images fail rather than silently copying a broken image", () => {
  assert.throws(() => analyse(`![x](cr-asset://${id})`, [{ ...attachments[0], available: false }]), /COPY_IMAGE_UNAVAILABLE/);
});
test("untrusted publication paths cannot escape the current origin", () => {
  const result = analyse(`![x](cr-asset://${id})`);
  for (const path of ["https://evil.test/x", "//evil.test/x", "/api/attachments/private/content", "javascript:alert(1)"]) {
    assert.throws(() => result.render({ [id]: path }, "https://archive.example.test"), /COPY_IMAGE_UNAVAILABLE/);
  }
});
test("captured source coordinates and AST node budget fail closed", () => {
  let probe = createMessageCopyProbe({ markdown: "x", attachments });
  assert.throws(() => probe.plugin()({ type: "root", children: [{ type: "image", url: `cr-asset://${id}` }] }), /COPY_SOURCE_UNAVAILABLE/);
  probe = createMessageCopyProbe({ markdown: "x", attachments });
  assert.throws(() => probe.plugin()({ type: "root", children: Array.from({ length: 100_000 }, () => ({ type: "text" })) }), /COPY_TOO_LARGE/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const read = path => readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
const ast = ts.createSourceFile("offline-files.tsx", read("features/attachments/offline-conversation-files-panel.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const row = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "OfflineFileRow");
const locatorAst = ts.createSourceFile("reader-locator-target.ts", read("features/conversations/reader-locator-target.ts"), ts.ScriptTarget.Latest, true);
const target = locatorAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "attachmentNavigationTarget");
const compiled = ts.transpileModule(`${target.getText(locatorAst)}
  const attachmentOccurrenceTarget = attachmentNavigationTarget;
  ${row.getText(ast)}
  exports.row = OfflineFileRow;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const nodes = node => Array.isArray(node) ? node.flatMap(nodes)
  : node && typeof node === "object" && node.props ? [node, ...nodes(node.props.children)] : [];
const text = node => Array.isArray(node) ? node.map(text).join("") : node == null || typeof node === "boolean" ? ""
  : typeof node === "object" ? text(node.props?.children) : String(node);

test("references beyond the first three retain canonical targets without opening or downloading a file", () => {
  const api = {}, calls = [], opens = [], downloads = [];
  let count = 3;
  const scopes = { useState: () => [count, next => { count = typeof next === "function" ? next(count) : next; }],
    buildAttachmentRenderPlan: () => ({ actions: { open: true } }), useAttachmentSearchTarget: () => null,
    friendlyAttachmentType: () => "Text", formatBytes: () => "1 B",
    File: "File", ImageIcon: "Image", LocateFixed: "Locate", Eye: "Eye", Download: "Download",
  };
  // attachment-location re-exports this exact canonical constructor as an alias.
  new Function("require", "exports", ...Object.keys(scopes), compiled)(require, api, ...Object.values(scopes));
  const occurrences = Array.from({ length: 54 }, (_, index) => ({
    message_id: `synthetic-message-${index}`, message_version_id: `synthetic-version-${index}`,
    render_block_id: index === 53 ? null : `synthetic-block-${index}`, block_index: index === 53 ? null : index,
    start_offset: index, end_offset: index + 1, occurrence_key: `synthetic-occurrence-${index}`,
  }));
  const attachment = { id: "synthetic-file", display_name: "synthetic.txt", resolution_status: "resolved", occurrences };
  const render = () => api.row({ attachment, zh: false, divided: false,
    onLocate: value => calls.push(value), onOpen: () => opens.push(true), onDownload: () => downloads.push(true) });
  const refs = tree => nodes(tree).filter(node => node.type === "button" && /^Reference \d+$/.test(text(node)));
  const more = tree => nodes(tree).find(node => node.type === "button" && /More references/.test(text(node)));
  let tree = render(); assert.equal(refs(tree).length, 3);
  more(tree).props.onClick(); tree = render(); assert.equal(refs(tree).length, 53);
  refs(tree)[3].props.onClick();
  assert.equal(calls[0].messageId, "synthetic-message-3");
  assert.equal(calls[0].occurrenceKey, "synthetic-occurrence-3");
  more(tree).props.onClick(); tree = render(); assert.equal(refs(tree).length, 54);
  refs(tree)[53].props.onClick(); assert.equal(calls[1].blockIndex, undefined);
  assert.equal(calls[1].messageVersionId, "synthetic-version-53");
  assert.deepEqual(opens, []); assert.deepEqual(downloads, []);
});

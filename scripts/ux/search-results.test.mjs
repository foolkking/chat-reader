import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const jsx = require("react/jsx-runtime");
const { renderToStaticMarkup } = require("react-dom/server");
const compile = path => ts.transpileModule(
  readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
).outputText;
const target = {}, matcher = {};
new Function("exports", compile("features/search/search-result-target.ts"))(target);
new Function("exports", compile("lib/search-text-matches.ts"))(matcher);
const stubs = {
  react: require("react"),
  "@tanstack/react-query": { useQuery: () => ({ data: undefined }) },
  "../../lib/api": { searchConversations: async () => { throw Error("No query before expansion"); } },
  "react/jsx-runtime": jsx,
  "lucide-react": { Check: () => null },
  "next/link": { default: props => jsx.jsx("a", props) },
  "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: "en-US" }) },
  "../../lib/search-text-matches": matcher,
  "./search-result-target": target,
};
const exports = {};
new Function("require", "exports", compile("features/search/search-results.tsx"))(name => {
  assert.ok(Object.hasOwn(stubs, name), `Unexpected import ${name}`);
  return stubs[name];
}, exports);

test("global result ordering and rendered groups include the attachment in the keyboard candidate list", () => {
  const base = { conversation_id: "synthetic-conversation", conversation_title: "Synthetic conversation",
    message_id: null, role: null, order_key: null, block_index: null, character_offset: null,
    rank: 1, source_profile: null, occurrence_count: 1, matches: [] };
  const attachment = { ...base, document_id: "synthetic-attachment-document", document_type: "attachment",
    attachment_id: "synthetic-attachment", attachment_display_name: "Synthetic report.txt", snippet: "😀 prefix needle" };
  const body = { ...base, document_id: "synthetic-body-document", document_type: "message", snippet: "Synthetic body" };
  const ordered = exports.orderSearchResults([attachment, body]);
  assert.deepEqual(ordered.map(item => item.document_id), [body.document_id, attachment.document_id]);
  const html = renderToStaticMarkup(jsx.jsx(exports.SearchResults, { items: ordered, query: "needle", activeIndex: 1 }));
  assert.match(html, /Attachment results/);
  assert.match(html, /Synthetic report\.txt/);
  assert.match(html, /attachmentId=synthetic-attachment/);
  assert.match(html, /data-search-index="1" aria-current="true"/);
  assert.match(html, /<mark[^>]*>needle<\/mark>/);
});

function walk(node) {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!node || typeof node !== "object" || !node.props) return [];
  return [node, ...walk(node.props.children)];
}

test("a newly grouped row under a stationary pointer cannot replace the selected document", () => {
  const message = { document_id: "synthetic-message-document", document_type: "message",
    conversation_id: "synthetic-message-conversation", conversation_title: "Synthetic message",
    message_id: "synthetic-message", snippet: "Synthetic", occurrence_count: 1 };
  const annotation = { ...message, document_id: "synthetic-annotation-document", document_type: "annotation",
    conversation_id: "synthetic-annotation-conversation", conversation_title: "Synthetic annotation" };
  let selectedId = message.document_id;
  const changes = [];
  const render = items => exports.SearchResults({
    items, query: "synthetic", activeIndex: items.findIndex(item => item.document_id === selectedId),
    onActiveIndexChange(index) { changes.push(index); selectedId = items[index].document_id; },
  });
  render([message]);
  const items = exports.orderSearchResults([message, annotation]);
  let tree = render(items);
  const row = walk(tree).find(node => node.type === "div" && node.props.onMouseMove);
  assert.ok(row);
  assert.equal(row.props.onMouseEnter, undefined, "layout-driven boundary entry must not claim pointer intent");
  row.props.onMouseMove({ movementX: 0, movementY: 0 });
  assert.deepEqual(changes, []);
  assert.equal(selectedId, message.document_id);
  const selectedLink = walk(tree).find(node => node.props["aria-current"] === "true");
  assert.equal(selectedLink.props["data-search-index"], 1);
  assert.equal(selectedLink.props.href, target.searchResultHref(message));

  row.props.onMouseMove({ movementX: 1, movementY: 0 });
  assert.equal(selectedId, annotation.document_id, "real horizontal movement still selects the hovered result");
  assert.deepEqual(changes, [0]);
  tree = render(items);
  const rows = walk(tree).filter(node => node.type === "div" && node.props.onMouseMove);
  rows[1].props.onMouseMove({ movementX: 0, movementY: -1 });
  assert.equal(selectedId, message.document_id, "real vertical movement still selects the hovered result");
  assert.deepEqual(changes, [0, 1]);
});

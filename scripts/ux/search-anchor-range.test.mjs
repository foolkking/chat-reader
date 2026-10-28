import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/conversations/text-anchor.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;

// The real resolver with controlled TreeWalker/Range adapters. This verifies
// string/range selection, not browser layout, selection geometry or focus.
function resolve(text, anchor) {
  return resolveNodes([textNode(text)], anchor);
}

function textNode(text, ignoredSelector) {
  return {
    textContent: text,
    length: text.length,
    parentElement: { closest: selector => ignoredSelector && selector.includes(ignoredSelector) ? {} : null },
  };
}

function resolveNodes(nodes, anchor) {
  const document = {
    createTreeWalker: (_root, _show, filter) => {
      let index = -1;
      return {
        currentNode: null,
        nextNode() {
          while (++index < nodes.length) {
            if (filter.acceptNode(nodes[index]) !== 1) continue;
            this.currentNode = nodes[index];
            return true;
          }
          return false;
        },
      };
    },
    createRange: () => ({
      setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
      setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
      get collapsed() { return this.startOffset === this.endOffset; },
    }),
  };
  const exports = {};
  new Function("exports", "document", "NodeFilter", compiled)(
    exports, document, { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
  );
  return exports.resolveTextAnchorRange({}, anchor);
}

test("exact canonical range wins over identical repeated quote/context", () => {
  const text = "needle ".repeat(40);
  const start = 20 * "needle ".length;
  const range = resolve(text, { quote: "needle", startOffset: start, endOffset: start + 6 });
  assert.equal(range.startOffset, start);
  assert.equal(range.endOffset, start + 6);
});

test("emoji code-point offsets resolve to the correct DOM UTF-16 range", () => {
  const range = resolve("😀 needle needle", {
    quote: "needle", startOffset: 9, endOffset: 15,
  });
  assert.equal(range.startOffset, 10);
  assert.equal(range.endOffset, 16);
});

test("stronger supplied context still rejects an outdated offset for legacy annotation callers", () => {
  const range = resolve("needle/needle!", {
    quote: "needle", prefix: "/", suffix: "!", startOffset: 0, endOffset: 6,
  });
  assert.equal(range.startOffset, 7);
  assert.equal(range.endOffset, 13);
});

test("canonical code offsets exclude language, copy recovery and annotation overlay text", () => {
  const code = textNode("😀 needle");
  const range = resolveNodes([
    textNode("text", '[data-markdown-copy-ignore="true"]'),
    textNode("Clipboard unavailable. Select and copy below.", '[data-markdown-copy-ignore="true"]'),
    textNode("😀 needle", '[data-markdown-copy-ignore="true"]'),
    textNode("needle", "[data-annotation-overlay-root]"),
    code,
  ], { startOffset: 2, endOffset: 8 });
  assert.equal(range.startContainer, code);
  assert.equal(range.endContainer, code);
  assert.equal(range.startOffset, 3);
  assert.equal(range.endOffset, 9);
});

test("a legacy quote can recover when its old offset counted a renderer label", () => {
  const code = textNode("😀 needle");
  const range = resolveNodes([
    textNode("text", '[data-markdown-copy-ignore="true"]'), code,
  ], { quote: "needle", prefix: "text😀 ", startOffset: 6, endOffset: 12 });
  assert.equal(range.startContainer, code);
  assert.equal(range.startOffset, 3);
  assert.equal(range.endOffset, 9);
});

test("renderer-only UI cannot create a text anchor", () => {
  const range = resolveNodes([
    textNode("needle", '[data-markdown-copy-ignore="true"]'),
    textNode("needle", "[data-annotation-overlay-root]"),
  ], { quote: "needle", startOffset: 0, endOffset: 6 });
  assert.equal(range, null);
});

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

// The production capture algorithm with deterministic Range geometry. A
// separate Playwright case measures real wrapping; these are not visual tests.
function captureLine(text, line, { canonical = text, ignored = false } = {}) {
  const node = textNode(text, ignored ? '[data-markdown-copy-ignore="true"]' : undefined);
  let measurements = 0;
  const rect = row => ({ top: row * 20, bottom: row * 20 + 18, height: 18, width: 200 });
  const rowForUnit = unit => Math.floor(Array.from(text.slice(0, unit)).length / 20);
  const document = {
    createTreeWalker: (_root, _show, filter) => {
      let used = false;
      return { currentNode: node, nextNode() { if (used) return false; used = true; return filter.acceptNode(node) === 1; } };
    },
    createRange: () => ({
      start: 0, end: text.length,
      selectNodeContents() {},
      setStart(_node, offset) { this.start = offset; },
      setEnd(_node, offset) { this.end = offset; },
      getClientRects() { return Array.from({ length: Math.ceil(Array.from(text).length / 20) }, (_, index) => rect(index)); },
      getBoundingClientRect() {
        measurements++;
        if (this.start === 0 && this.end === text.length) return { ...rect(0), bottom: Math.ceil(Array.from(text).length / 20) * 20, height: Math.ceil(Array.from(text).length / 20) * 20 };
        return rect(rowForUnit(this.start));
      },
    }),
  };
  const exports = {};
  new Function("exports", "document", "NodeFilter", compiled)(exports, document, { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 });
  return { offset: exports.textOffsetAtReadingLine({}, line * 20 + 5, canonical), measurements };
}

test("a mid-paragraph reading point is measured inside a single text node, not at either endpoint", () => {
  const result = captureLine("a".repeat(4000), 91);
  assert.equal(result.offset, 1820);
  assert.ok(result.measurements <= 14, "bounded logarithmic glyph measurements, not one layout per character");
});

test("reading capture returns canonical code points after emoji and skips renderer-only text", () => {
  const text = "🙂".repeat(31) + "字".repeat(200);
  assert.equal(captureLine(text, 4).offset, 80);
  assert.equal(captureLine(text, 4, { ignored: true }).offset, undefined);
  assert.equal(captureLine(text, 4, { canonical: "different source" }).offset, undefined);
});

test("a canonical Markdown difference maps only when normalized source agrees", () => {
  const text = "word ".repeat(100);
  assert.equal(captureLine(text, 7, { canonical: `**${text}**` }).offset, 142);
});

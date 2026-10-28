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
  const node = { textContent: text, length: text.length };
  const document = {
    createTreeWalker: () => {
      let consumed = false;
      return { currentNode: node, nextNode: () => { if (consumed) return false; consumed = true; return true; } };
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

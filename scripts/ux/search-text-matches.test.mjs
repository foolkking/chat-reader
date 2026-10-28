import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/lib/search-text-matches.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
new Function("require", "exports", compiled)(() => ({}), exports);

test("emoji and collapsed whitespace preserve original code-point quote ranges", () => {
  const text = "😀 one\tneedle  needle";
  const matches = exports.findSearchTextMatches(text, "needle", 2, "synthetic-block", 1);
  const codePoints = Array.from(text);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].match_start, 6);
  assert.equal(codePoints.slice(matches[0].match_start, matches[0].match_end).join(""), "needle");
  assert.equal(matches[0].quote, "needle");
  assert.equal(matches[0].block_index, 2);
  assert.equal(matches[0].render_block_id, "synthetic-block");
});

test("whitespace-normalized phrase returns the exact unnormalized source slice", () => {
  const text = "A\tB";
  const match = exports.findSearchTextMatches(text, "a b", 0)[0];
  assert.deepEqual([match.match_start, match.match_end], [0, 3]);
  assert.equal(match.quote, text.slice(match.match_start, match.match_end));
  assert.equal(match.quote, "A\tB");
});

test("dense results stop constructing matches at the requested cap", () => {
  const matches = exports.findSearchTextMatches("needle ".repeat(250), "needle", 0, null, 100);
  assert.equal(matches.length, 100);
});

test("lowercase expansion before the match does not shift its canonical offset", () => {
  const text = "İ 😀 needle";
  const match = exports.findSearchTextMatches(text, "needle", 0)[0];
  assert.equal(match.match_start, 4);
  assert.equal(Array.from(text).slice(match.match_start, match.match_end).join(""), match.quote);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const code = ts.transpileModule(readFileSync(new URL("../../apps/web/features/conversations/thinking-summary.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { findOpeningThinkingSummary, findLeadingThinkingBlocks } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const cases = JSON.parse(readFileSync(new URL("../../apps/api/tests/fixtures/thinking-summary-cases.json", import.meta.url), "utf8"));
for (const value of cases) test(`API/Web shared thinking corpus: ${value.name}`, () => {
  const summary = findOpeningThinkingSummary(value.source);
  if (value.summary === null) assert.equal(summary, null);
  else {
    assert.ok(summary);
    assert.equal(value.source.slice(0, summary.endOffset), value.summary);
    assert.equal(value.source.slice(summary.endOffset), value.answer);
  }
});

const block = (text, index, type = "paragraph") => ({
  id: `synthetic-block-${index}`, block_index: index, block_type: type,
  plain_text: text, data: { text }, char_count: text.length,
  collapsed_by_default: true, // Deliberately stale metadata must not drive folds.
});
test("block-backed Reader/Share/Offline fold the same safe prefix and preserve a same-block answer", () => {
  const blocks = [block("> 搜索合成示例", 0), block("> 已思考 7s\n\nVisible answer.", 1), block("More answer.", 2)];
  const summary = findLeadingThinkingBlocks(blocks);
  assert.equal(summary.endIndex, 1);
  assert.equal(summary.remainder.plain_text, "Visible answer.");
  assert.equal(summary.remainder.id, blocks[1].id, "Keep the stable real block anchor");
  assert.equal(summary.text, "> 搜索合成示例\n\n> 已思考 7s\n\n");
  assert.equal(blocks[1].plain_text, "> 已思考 7s\n\nVisible answer.", "Projection never changes source");
});
test("block metadata, middle windows, headings and code cannot manufacture a summary", () => {
  for (const blocks of [
    [block("Ordinary introduction.\nThinking 5s", 0)],
    [block("Ordinary introduction.", 0), block("Thinking 5s", 1)],
    [block("Reasoning:\nOrdinary explanation.", 0)],
    [block("Thinking 5s", 3)],
    [block("Thinking 5s", 0, "code")],
    [block("Answer", 0, "heading"), block("Thinking 5s", 1)],
  ]) assert.equal(findLeadingThinkingBlocks(blocks), null);
});
test("scan limits are shared, including durations after forty lines", () => {
  const sources = Array.from({ length: 45 }, (_, i) => `> [Synthetic ${i}](https://example.test/${i})`).join("\n");
  assert.ok(findOpeningThinkingSummary(`${sources}\n> Thinking 7s\n\nAnswer.`));
  assert.equal(findOpeningThinkingSummary(`${"> Short trace\n".repeat(81)}Thinking 7s\nAnswer.`), null);
  assert.equal(findOpeningThinkingSummary(`${"> " + "x".repeat(8001)}\nThinking 7s\nAnswer.`), null);
});

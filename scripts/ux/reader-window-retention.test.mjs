import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript"), exports = {};
new Function("exports", ts.transpileModule(readFileSync(new URL(
  "../../apps/web/features/conversations/reader-window.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(exports);
const {
  mergeLoadedTurnWindow: merge,
  isUnchangedReaderPrefix: isPrefix,
  trimLoadedTurnWindowToProtectedMessages: trim,
  replaceLoadedWindow,
} = exports;
const makeWindow = (sizes = Array(20).fill(2)) => {
  let offset = 0;
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const turns = sizes.map((size, index) => {
    const start = offset;
    const items = Array.from({ length: size }, () => ({ id: `m${offset}`,
      order_key: String(offset++).padStart(6, "0") }));
    return { turn_key: `turn${index}`, start_offset: start, end_offset: offset,
      total_messages: total, items, previous_anchor_message_id: index ? `m${start - sizes[index - 1]}` : null,
      next_anchor_message_id: offset < total ? `m${offset}` : null };
  });
  return replaceLoadedWindow({ turns, items: turns.flatMap(t => t.items), total, offset: 0,
    has_previous: false, has_more: false }, 7);
};

test("idle reclamation surrounds the real viewport rather than forcing the first/last three turns", () => {
  const current = makeWindow(), next = trim(current, new Set(["m18", "m19", "m20", "m21"]));
  assert.deepEqual(next.items.map(m => m.id), Array.from({ length: 8 }, (_, i) => `m${16 + i}`));
  assert.equal(next.startOffset, 16); assert.equal(next.endOffset, 24);
  assert.equal(next.total, 40); assert.equal(next.generation, 7);
  assert.equal(next.hasPrevious, true); assert.equal(next.hasMore, true);
  assert.equal(next.turns[0].previous_anchor_message_id, "m14");
  assert.equal(next.turns.at(-1).next_anchor_message_id, "m24");
});

test("focus and selection protect the entire continuous interval without holes", () => {
  const current = makeWindow(), next = trim(current, new Set(["m6", "m30", "m33"]));
  assert.deepEqual(next.items.map(m => m.id), Array.from({ length: 32 }, (_, i) => `m${4 + i}`));
  assert.ok([...new Set(["m6", "m30", "m33"])].every(id => next.items.some(m => m.id === id)));
});

test("a long turn remains complete even when it alone exceeds the reclamation trigger", () => {
  const current = makeWindow([2, 2, 2, 145, 2, 2, 2]);
  const next = trim(current, new Set(["m60"]));
  assert.equal(next.turns.length, 3); assert.equal(next.items.length, 149);
  assert.equal(next.turns[1], current.turns[3]);
  assert.equal(next.turns[1].items.length, 145);
});

test("short messages covering more than three turns remain visible and complete", () => {
  const current = makeWindow(Array(20).fill(1));
  const next = trim(current, new Set(["m6", "m7", "m8", "m9", "m10", "m11"]));
  assert.equal(next.turns.length, 8);
  assert.deepEqual(next.items.map(m => m.id), Array.from({ length: 8 }, (_, i) => `m${5 + i}`));
});

test("unknown, empty, and all-window protection never guesses a destructive slice", () => {
  const current = makeWindow();
  for (const ids of [[], ["absent"], ["m5", "absent"], ["m0", "m39"]]) {
    assert.equal(trim(current, new Set(ids)), current);
  }
  const short = makeWindow([2, 2, 2]);
  assert.equal(trim(short, new Set(["m1"])), short);
});

test("endpoints retain three complete turns and truthful subsequent loading boundaries", () => {
  const current = makeWindow();
  const first = trim(current, new Set(["m0"])), last = trim(current, new Set(["m39"]));
  assert.equal(first.items.length, 6); assert.equal(last.items.length, 6);
  assert.equal(first.hasPrevious, false); assert.equal(first.hasMore, true);
  assert.equal(last.hasPrevious, true); assert.equal(last.hasMore, false);
});

test("overlapping identical turns retain row identity; changes are not inferred from version IDs", () => {
  const current = makeWindow([2, 2, 2]);
  const formulaMessage = current.turns[1].items[0];
  Object.assign(formulaMessage, {
    role: "assistant",
    current_version: { id: "version-1", display_text: String.raw`\[x^2+y^2=z^2\]`, content_hash: "hash-1" },
    render_blocks: [{
      id: "block-1", block_index: 0, block_type: "math", plain_text: "x^2+y^2=z^2",
      data: { attachmentOccurrences: [{ occurrenceKey: "image-1", imageDisplay: "natural" }] },
      char_count: 11, collapsed_by_default: false, render_priority: 1,
    }],
  });
  const pageFor = (turns) => ({
    items: turns.flatMap((turn) => turn.items), turns, limit: turns.flatMap((turn) => turn.items).length,
    offset: turns[0].start_offset, total: current.total, has_previous: true, has_more: false,
    previousTurnAnchorMessageId: turns[0].previous_anchor_message_id,
    nextTurnAnchorMessageId: turns.at(-1).next_anchor_message_id,
  });
  const identicalPage = [current.turns[1], current.turns[2]].map((turn) => structuredClone(turn));
  const unchanged = merge(current, pageFor(identicalPage));
  assert.equal(unchanged.turns[1], current.turns[1]);
  assert.equal(unchanged.items.find((message) => message.id === formulaMessage.id), formulaMessage);

  for (const edit of [
    m => { m.current_version.display_text = String.raw`\[\frac{x^2}{y^2}=z^2\]`; },
    m => { m.render_blocks[0].data.attachmentOccurrences[0].imageDisplay = "wide"; },
    m => { m.future_extension = { policy: "changed" }; },
    m => { delete m.render_blocks; },
  ]) {
    const changedPage = structuredClone(identicalPage);
    edit(changedPage[0].items[0]);
    const changed = merge(current, pageFor(changedPage));
    assert.equal(changed.turns[1].items[0], changedPage[0].items[0]);
    assert.equal(changed.turns[1].items[1], current.turns[1].items[1]);
  }
});

test("only a strict suffix with unchanged turns, rows, and header is safe without compensation", () => {
  const all = makeWindow([2, 2, 2, 2]);
  const page = (turns) => ({ turns, items: turns.flatMap(t => t.items), total: 8, offset: turns[0].start_offset,
    has_previous: !!turns[0].previous_anchor_message_id, has_more: !!turns.at(-1).next_anchor_message_id });
  const current = replaceLoadedWindow(page(all.turns.slice(0, 2)), 7);
  const suffix = structuredClone(all.turns.slice(1));
  const next = merge(current, page(suffix));
  assert.ok(isPrefix(current, next));
  assert.equal(isPrefix(current, current), false);
  assert.equal(isPrefix(replaceLoadedWindow(page(all.turns.slice(1, 3)), 7), all), false);
  for (const override of [{ generation: 8 }, { total: 9 }, { hasPrevious: true }, { startOffset: 1 },
    { items: [next.items[1], next.items[0], ...next.items.slice(2)] }]) {
    assert.equal(isPrefix(current, { ...next, ...override }), false);
  }
  for (const edit of [
    t => { t.next_anchor_message_id = "different"; }, t => { t.items[0].order_key = "999"; },
    t => { t.extension_metadata = "new"; }, t => { t.items[0].render_blocks = []; },
  ]) {
    const fresh = structuredClone(suffix); edit(fresh[0]);
    assert.equal(isPrefix(current, merge(current, page(fresh))), false);
  }
});

test("very large or deeply nested overlaps fall back to fresh data, never the fast suffix", () => {
  for (const content of ["x".repeat(150_000), Array(5000).fill(1),
    Array.from({ length: 40 }).reduce(child => ({ child }), null)]) {
    const current = makeWindow([2, 2]);
    current.turns[0].items[0].data = content;
    const fresh = structuredClone(current.turns);
    assert.equal(merge(current, { turns: fresh }).turns[0].items[0], fresh[0].items[0]);
  }
});

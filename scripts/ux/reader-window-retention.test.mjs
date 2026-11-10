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
const { trimLoadedTurnWindowToProtectedMessages: trim, replaceLoadedWindow } = exports;
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

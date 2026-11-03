import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/conversations/reader-keyboard-navigation.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const module = { exports: {} };
new Function("module", "exports", code)(module, module.exports);
const { resolveKeyboardMessage } = module.exports;

function page(offset, total) {
  const items = Array.from({ length: Math.min(80, total - offset) }, (_, index) => ({
    message_id: `message-${offset + index}`,
    role: "user",
    role_number: offset + index + 1,
    ordinal: offset + index + 1,
    order_key: String(offset + index + 1).padStart(6, "0"),
    preview: `Synthetic message ${offset + index + 1}`,
    turn_index: offset + index,
  }));
  return {
    conversation_id: "synthetic-conversation",
    items,
    message_count: total,
    turn_count: total,
    limit: 80,
    offset,
    total,
    has_previous: offset > 0,
    has_more: offset + items.length < total,
  };
}

test("Home and End resolve the complete dialogue from bounded cached pages", async () => {
  let requests = 0;
  const load = async () => { requests += 1; throw new Error("unexpected index fetch"); };
  const result = await Promise.all([
    resolveKeyboardMessage("home", "message-90", load, [page(0, 121), page(80, 121)]),
    resolveKeyboardMessage("end", "message-90", load, [page(0, 121), page(80, 121)]),
  ]);
  assert.deepEqual(result, ["message-0", "message-120"]);
  assert.equal(requests, 0);
});

test("J and K move from cached dialogue rows and fetch only at the loaded-page edge", async () => {
  const calls = [];
  const result = await resolveKeyboardMessage(
    "j",
    "message-79",
    async options => {
      calls.push(options);
      return {
        ...page(78, 121),
        offset: 78,
        items: page(78, 121).items.slice(0, 3),
        total: 121,
      };
    },
    [page(0, 121)],
  );
  assert.equal(result, "message-80");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { anchorMessageId: "message-79", limit: 3 });
});

test("dialogue boundaries do not issue invalid adjacent-page requests", async () => {
  let requests = 0;
  const load = async options => {
    requests += 1;
    return page(options.offset ?? 0, 121);
  };
  assert.equal(await resolveKeyboardMessage("k", "message-0", load, [page(0, 121)]), null);
  assert.equal(await resolveKeyboardMessage("j", "message-120", load, [page(80, 121)]), null);
  assert.equal(requests, 0);
});

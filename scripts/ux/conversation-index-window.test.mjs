import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const path = "../../apps/web/features/toc/conversation-index.tsx";
const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = [];
const visit = node => { nodes.push(node); ts.forEachChild(node, visit); };
visit(source);
const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS };
const coverage = nodes.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "dialogueIndexPageCoversAround");
assert.ok(coverage);
const exports = {};
const coverageCode = ts.transpileModule(coverage.getText(source), { compilerOptions: options }).outputText;
new Function("exports", "AROUND_WINDOW", coverageCode)(exports, 24);
const covers = exports.dialogueIndexPageCoversAround;
const effectCall = nodes.find(node => ts.isCallExpression(node)
  && node.expression.getText(source) === "useEffect"
  && node.arguments[0].getText(source).includes("dialogueIndexPageCoversAround"));
assert.ok(effectCall);
const effectCode = ts.transpileModule(`exports.effect = (${effectCall.arguments[0].getText(source)});`, { compilerOptions: options }).outputText;

function page(first = 1, last = 80, total = 10000) {
  return {
    conversation_id: "synthetic-conversation", total,
    items: Array.from({ length: last - first + 1 }, (_, offset) => ({
      ordinal: first + offset, message_id: `synthetic-${first + offset}`,
    })),
  };
}

// Execute the real coverage predicate and hook callback. These adapters do not
// claim browser scheduling or frame-rate acceptance; CI capacity covers that.
function recenter(patch = {}) {
  const requests = [];
  const bindings = {
    messages: undefined, desktopFullIndex: false, ready: true, auxiliary: { visible: true },
    activeMessageId: "synthetic-20", sameRequestScope: true, queryAnchor: undefined,
    indexQuery: { data: page(), isFetching: false },
    dialogueIndexPageCoversAround: covers,
    setAroundRequest: value => requests.push(value),
    conversationId: "synthetic-conversation", sourceKey: "remote",
    ...patch,
  };
  const loaded = {};
  new Function(...Object.keys(bindings), "exports", effectCode)(...Object.values(bindings), loaded);
  loaded.effect();
  return requests;
}

test("one 80-row read covers successive active rows without losing the +/-24 visible range", () => {
  for (let ordinal = 1; ordinal <= 56; ordinal += 1) {
    assert.equal(covers(page(), "synthetic-conversation", `synthetic-${ordinal}`), true);
    assert.deepEqual(recenter({ activeMessageId: `synthetic-${ordinal}` }), []);
  }
  assert.equal(covers(page(), "synthetic-conversation", "synthetic-57"), false);
  assert.deepEqual(recenter({ activeMessageId: "synthetic-57" }), [{
    conversationId: "synthetic-conversation", sourceKey: "remote", anchor: "synthetic-57",
  }]);
});

test("a far target, missing row, gap and foreign conversation never count as coverage", () => {
  assert.equal(covers(page(), "synthetic-conversation", "synthetic-9900"), false);
  assert.equal(covers(page(), "other-conversation", "synthetic-20"), false);
  assert.equal(covers(undefined, "synthetic-conversation", "synthetic-20"), false);
  const gapped = page();
  gapped.items = gapped.items.filter(item => item.ordinal !== 30);
  assert.equal(covers(gapped, "synthetic-conversation", "synthetic-20"), false);
  assert.equal(recenter({ activeMessageId: "synthetic-9900" })[0].anchor, "synthetic-9900");
});

test("conversation end clamps coverage to the real total rather than reading forever", () => {
  for (const ordinal of [9970, 9990, 10000]) {
    assert.equal(covers(page(9921, 10000), "synthetic-conversation", `synthetic-${ordinal}`), true);
  }
  assert.equal(covers(page(9921, 10000), "synthetic-conversation", "synthetic-9944"), false);
});

test("hidden, loading, supplied and full-index views do not start incidental around reads", () => {
  const far = { activeMessageId: "synthetic-9900" };
  for (const patch of [
    { auxiliary: { visible: false } }, { ready: false }, { messages: [] },
    { desktopFullIndex: true }, { indexQuery: { data: page(), isFetching: true } },
    { queryAnchor: "synthetic-9900" },
  ]) assert.deepEqual(recenter({ ...far, ...patch }), []);
});

test("a new data-source scope resets the request even if old rows happen to cover the target", () => {
  assert.deepEqual(recenter({ sameRequestScope: false, sourceKey: "offline:2:synthetic" }), [{
    conversationId: "synthetic-conversation", sourceKey: "offline:2:synthetic", anchor: "synthetic-20",
  }]);
});

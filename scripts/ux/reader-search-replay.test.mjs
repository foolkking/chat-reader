import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const read = path => readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
function component(source, name) {
  const ast = ts.createSourceFile(name + ".tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn, name);
  return { ast, fn };
}
function findEffect({ ast, fn }, marker) {
  const effect = fn.body.statements.find(node => ts.isExpressionStatement(node)
    && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "useEffect"
    && node.getText(ast).includes(marker));
  assert.ok(effect, marker);
  return effect.expression.arguments[0].getText(ast);
}
function runEffect(callback, bindings) {
  return new Function(...Object.keys(bindings), compile(`return (${callback})();`))(...Object.values(bindings));
}
const reader = component(read("features/conversations/conversation-reader.tsx"), "ConversationReader");
const navigationEffect = findEffect(reader, "const navigationKey = ");

test("one Reader instance replays the same canonical target once per explicit activation", async () => {
  const navigations = [];
  const bindings = {
    pendingTargetMessageId: null, targetMessageId: "synthetic-message",
    targetMessageVersionId: "synthetic-version", targetRenderBlockId: "synthetic-block",
    targetBlockIndex: 3, targetCharacterOffset: 12, targetEndCharacterOffset: 18,
    requestedAnnotationId: null, requestedAttachmentId: null, searchReplayKey: 0,
    targetNavigationKeyRef: { current: null }, restoreAttemptedRef: { current: false },
    setPendingTargetMessageId: () => undefined,
    navigateToTarget: async target => { navigations.push(target); return { ok: true }; },
  };
  runEffect(navigationEffect, bindings); await setImmediate();
  runEffect(navigationEffect, bindings);
  assert.equal(navigations.length, 1, "a bookmark or an ordinary rerender is not a second activation");
  bindings.searchReplayKey = 1;
  runEffect(navigationEffect, bindings); await setImmediate();
  runEffect(navigationEffect, bindings);
  assert.equal(navigations.length, 2);
  assert.deepEqual(navigations[0], navigations[1]);
  bindings.searchReplayKey = 2;
  runEffect(navigationEffect, bindings); await setImmediate();
  assert.equal(navigations.length, 3);
  bindings.targetMessageId = "synthetic-other-message";
  bindings.searchReplayKey = 0;
  runEffect(navigationEffect, bindings); await setImmediate();
  assert.equal(navigations.at(-1).messageId, "synthetic-other-message");
  bindings.requestedAttachmentId = "synthetic-file";
  bindings.searchReplayKey++;
  runEffect(navigationEffect, bindings);
  assert.equal(navigations.length, 4, "file targets never become body navigation");
});

test("attachment activation reuses focus ownership except on a new replay or target", () => {
  let memo;
  const exports = {};
  new Function("require", "exports", compile(read("features/attachments/use-attachment-search-target.ts")))(
    name => {
      assert.equal(name, "react");
      return { useMemo: (create, deps) => {
        if (!memo || deps.some((value, index) => value !== memo.deps[index])) memo = { deps, value: create() };
        return memo.value;
      } };
    }, exports,
  );
  const first = exports.useAttachmentSearchActivation("synthetic-conversation", "synthetic-file", 0);
  first.focused = true;
  assert.equal(exports.useAttachmentSearchActivation("synthetic-conversation", "synthetic-file", 0), first);
  const second = exports.useAttachmentSearchActivation("synthetic-conversation", "synthetic-file", 1);
  assert.notEqual(second, first);
  assert.equal(second.focused, false);
  assert.notEqual(exports.useAttachmentSearchActivation("synthetic-other", "synthetic-file", 1), second);
});

for (const name of ["ConversationFilesPanel", "OfflineConversationFilesPanel"]) {
  const file = name === "ConversationFilesPanel" ? "conversation-files-panel" : "offline-conversation-files-panel";
  const panel = component(read(`features/attachments/${file}.tsx`), name === "ConversationFilesPanel" ? "ConversationFilesWorkspace" : name);
  test(`${name} reveals a filtered-out target again on replay without opening a preview`, () => {
    const calls = [];
    const callback = findEffect(panel, 'setSearch("")');
    runEffect(callback, { initialAttachmentId: "synthetic-file",
      setSearch: value => calls.push(["search", value]), setFilter: value => calls.push(["filter", value]) });
    assert.deepEqual(calls, [["search", ""], ["filter", "all"]]);
    calls.length = 0;
    runEffect(callback, { initialAttachmentId: null,
      setSearch: value => calls.push(value), setFilter: value => calls.push(value) });
    assert.deepEqual(calls, []);
    // Keep the replay dependency, not just a manually invoked callback.
    assert.match(panel.fn.getText(panel.ast), /initialAttachmentId, searchReplayKey\]/);
  });
}

test("annotation replay resets only visibility filters and waits for a committed visible row", () => {
  const workspace = component(read("features/annotations/annotation-workspace.tsx"), "AnnotationWorkspace");
  const calls = [];
  const reset = findEffect(workspace, "setFocusedAnnotationId(initialAnnotationId)");
  const setters = Object.fromEntries([
    "setFocusedAnnotationId", "setView", "setAnnotationQuery", "setTypeFilter", "setColorFilter", "setStatusFilter",
  ].map(name => [name, value => calls.push([name, value])]));
  runEffect(reset, { initialAnnotationId: "synthetic-annotation", ...setters });
  assert.deepEqual(calls, [
    ["setFocusedAnnotationId", "synthetic-annotation"], ["setView", "all"],
    ["setAnnotationQuery", ""], ["setTypeFilter", "all"], ["setColorFilter", "all"], ["setStatusFilter", "all"],
  ]);
  const scroll = findEffect(workspace, "document.getElementById(`annotation-${focusedAnnotationId}`)");
  let frames = 0, scrolls = 0;
  const bindings = {
    open: true, focusedAnnotationId: "synthetic-annotation", focusedAnnotationVisible: false,
    window: { requestAnimationFrame: fn => { frames++; fn(); return frames; }, cancelAnimationFrame: () => undefined },
    document: { getElementById: id => {
      assert.equal(id, "annotation-synthetic-annotation");
      return { scrollIntoView: () => { scrolls++; } };
    } },
  };
  runEffect(scroll, bindings); assert.equal(frames, 0);
  bindings.focusedAnnotationVisible = true;
  runEffect(scroll, bindings); assert.equal(scrolls, 1);
  assert.match(workspace.fn.getText(workspace.ast), /\[initialAnnotationId, searchReplayKey,/);
});

test("annotation search aligns single-item review once per activation without hijacking later browsing", () => {
  const workspace = component(read("features/annotations/annotation-workspace.tsx"), "AnnotationWorkspace");
  const align = findEffect(workspace, "searchReviewActivation.aligned = true");
  const indices = [];
  const bindings = {
    open: true, initialAnnotationId: "synthetic-target", searchReviewActivation: { aligned: false },
    view: "all", annotationQuery: "old filter", typeFilter: "all", colorFilter: "all", statusFilter: "all",
    visibleAnnotations: [], setReviewIndex: index => indices.push(index),
  };
  runEffect(align, bindings);
  bindings.annotationQuery = "";
  runEffect(align, bindings);
  assert.deepEqual(indices, [], "wait for filter reset and actual annotation data");
  bindings.visibleAnnotations = [{ id: "synthetic-other" }, { id: "synthetic-target" }];
  runEffect(align, bindings);
  assert.deepEqual(indices, [1]);
  runEffect(align, bindings);
  assert.deepEqual(indices, [1], "manual review is not reset on unrelated rerenders");
  bindings.searchReviewActivation = { aligned: false };
  runEffect(align, bindings);
  assert.deepEqual(indices, [1, 1], "an explicit replay reveals the selected row again");
  assert.match(workspace.fn.getText(workspace.ast), /reviewMode !== "single" \|\| focusedAnnotationIndex === Math\.min\(reviewIndex,/);
});

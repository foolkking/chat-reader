import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript");
const { QueryClient, QueryObserver } = appRequire("@tanstack/react-query");
const source = readFileSync(new URL("../../apps/web/features/conversations/conversation-reader.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("conversation-reader.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const reader = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ConversationReader");
const owners = new Set(["recordedRecentConversationRef", "recentOwner", "recentOwnerRef"]);
const selected = reader.body.statements.filter(node => {
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.some(item => owners.has(item.name.getText(ast)));
  if (!ts.isExpressionStatement(node)) return false;
  if (ts.isBinaryExpression(node.expression)) return node.expression.left.getText(ast) === "recentOwnerRef.current";
  if (!ts.isCallExpression(node.expression)) return false;
  return node.expression.expression.getText(ast) === "useLayoutEffect" && node.getText(ast).includes("recentOwner")
    || node.expression.expression.getText(ast) === "useEffect" && node.getText(ast).includes(".recordRecent(");
});
assert.equal(selected.filter(node => node.getText(ast).includes(".recordRecent(")).length, 1);
assert.ok(selected.length >= 2);
// Exact Reader AST statements, not a rewritten effect. All other Reader code
// is deliberately excluded. Hook/effect scheduling and transport are doubles;
// installed QueryClient/Observer perform actual cache and read transitions.
// This is not full React, DOM, browser navigation or HTTP acceptance.
const compiled = ts.transpileModule(`function renderRecent(conversationId, dataSource, conversationQuery, projectContextId, queryClient) {
${selected.map(node => node.getText(ast)).join("\n")}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  transformers: { before: [context => root => {
    const visit = node => ts.isVoidExpression(node)
      ? context.factory.createCallExpression(context.factory.createIdentifier("captureTask"), undefined, [ts.visitNode(node.expression, visit)])
      : ts.visitEachChild(node, visit, context);
    return ts.visitNode(root, visit);
  }] },
}).outputText;
const flush = async () => { await setImmediate(); await setImmediate(); };
const detail = (extra = {}) => ({ id: "synthetic-recent-a", title: "Synthetic original", display_title: "Synthetic original",
  status: "active", offline_revision: 7, render_version: 1, parser_version: "synthetic-parser", content_hash: "synthetic-original",
  project_id: "synthetic-source", project_name: "Synthetic source", description_markdown: "Synthetic retained description",
  last_read_at: "2026-10-09T00:00:00Z", reading_progress: 20, ...extra });
const afterOpen = (extra = {}) => detail({ last_read_at: "2026-10-09T00:01:00Z", reading_progress: 30, ...extra });
const sameDeps = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));

function fixture() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  const initial = detail(), second = detail({ id: "synthetic-recent-b" });
  const key = (id = initial.id, mode = "remote") => ["conversation", mode, id];
  for (const item of [initial, second]) for (const mode of ["remote", "offline"]) client.setQueryData(key(item.id, mode), item);
  const positionKey = ["reading-position", "remote", initial.id], windowKey = ["reader-turn-window", "remote", initial.id, null];
  const position = { message_id: "synthetic-anchor", scroll_offset: 42, revision: 3 };
  const window = { items: [{ id: "synthetic-anchor", content_markdown: "Synthetic stable source" }] };
  client.setQueryData(positionKey, position); client.setQueryData(windowKey, window);
  client.setQueryData(["conversations", "active"], [initial]); client.setQueryData(["projects"], []);
  client.setQueryData(["recent-items"], [{ conversation_id: initial.id, conversation: initial }]);
  let currentId = initial.id, currentMode = "remote", projectId = "synthetic-source", epoch = 0, mounted = true;
  let queryDataOverride, hasOverride = false, server = afterOpen(), detailReads = 0, rejectRefresh = false, detailError = false;
  const calls = [], failures = [], invalidations = [], refs = [], memos = [], effects = [], holds = new Map();
  let refIndex = 0, memoIndex = 0, effectIndex = 0;
  const captureTask = value => { if (value?.then) Promise.resolve(value).catch(error => failures.push(error)); };
  const register = type => (operation, deps) => {
    const index = effectIndex++, previous = effects[index];
    effects[index] = { type, operation, deps, cleanup: previous?.cleanup, lastRunDeps: previous?.lastRunDeps };
  };
  const hooks = {
    useRef: value => { const index = refIndex++; return refs[index] ?? (refs[index] = { current: value }); },
    useMemo: (operation, deps) => {
      const index = memoIndex++, previous = memos[index];
      if (!previous || !sameDeps(previous.deps, deps)) memos[index] = { value: operation(), deps };
      return memos[index].value;
    },
    useEffect: register("passive"), useLayoutEffect: register("layout"),
  };
  const runEffects = type => {
    for (const effect of effects) if (effect.type === type && !sameDeps(effect.lastRunDeps, effect.deps)) {
      effect.cleanup?.(); effect.cleanup = effect.operation(); effect.lastRunDeps = effect.deps;
    }
  };
  const renderRecent = new Function("useRef", "useMemo", "useEffect", "useLayoutEffect", "authenticationGeneration", "captureTask",
    compiled + "\nreturn renderRecent;")(hooks.useRef, hooks.useMemo, hooks.useEffect, hooks.useLayoutEffect, () => epoch, captureTask);
  const sources = Object.fromEntries(["remote", "offline"].map(mode => [mode, {
    mode,
    recordRecent: (id, project) => {
      let resolvePromise, rejectPromise;
      const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
      const call = { mode, id, project, settled: false,
        resolve: value => { call.settled = true; resolvePromise(value); },
        reject: () => { call.settled = true; rejectPromise(new Error("Synthetic recent response lost")); } };
      calls.push(call);
      if (mode === "offline") call.resolve(null);
      return promise;
    },
  }]));
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = (...args) => { invalidations.push(args[0]); return rejectRefresh ? Promise.reject(new Error("Synthetic rejecting refresh callback")) : invalidate(...args); };
  const observer = new QueryObserver(client, { queryKey: key(), queryFn: async () => {
    detailReads += 1; const snapshot = structuredClone(server), fail = detailError;
    if (holds.has("detail")) await holds.get("detail").promise;
    if (fail) throw new Error("Synthetic detail GET failure");
    return snapshot;
  } });
  const unsubscribe = observer.subscribe(() => {});
  const render = ({ layout = true, passive = true } = {}) => {
    assert.equal(mounted, true); refIndex = memoIndex = effectIndex = 0;
    renderRecent(currentId, sources[currentMode], { data: hasOverride ? queryDataOverride : client.getQueryData(key(currentId, currentMode)) }, projectId, client);
    if (layout) runEffects("layout"); if (passive) runEffects("passive");
  };
  const unmount = () => { mounted = false; for (const effect of effects) effect.cleanup?.(); };
  return { client, initial, second, key, positionKey, windowKey, position, window, calls, failures, invalidations, observer, render, unmount,
    data: (id, mode) => client.getQueryData(key(id, mode)), detailReads: () => detailReads,
    setServer: value => { server = value; }, setRefreshFailure: value => { rejectRefresh = value; },
    setDetailError: value => { detailError = value; },
    setRoute: (id, mode = currentMode) => { currentId = id; currentMode = mode; }, setProject: value => { projectId = value; },
    setQueryData: value => { hasOverride = true; queryDataOverride = value; },
    changeAccount: () => { epoch += 1; }, runEffects,
    replayEffects: () => { for (const effect of effects) effect.cleanup?.(); for (const effect of effects) effect.cleanup = effect.operation(); },
    hold: name => { let release; const promise = new Promise(resolve => { release = resolve; }); holds.set(name, { promise, release }); return () => { holds.delete(name); release(); }; },
    dispose: async () => { if (mounted) unmount(); for (const hold of holds.values()) hold.release(); holds.clear();
      for (const call of calls) if (!call.settled) call.resolve(afterOpen({ id: call.id })); await flush(); unsubscribe(); observer.destroy(); client.clear(); },
  };
}

test("a valid same-revision open records once and preserves the full Reader (control)", async () => {
  const f = fixture(); try { f.render(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].project, "synthetic-source");
    f.calls[0].resolve(afterOpen()); await flush(); f.render();
    assert.equal(f.calls.length, 1); assert.deepEqual(f.data(), { ...f.initial, last_read_at: afterOpen().last_read_at, reading_progress: 30 });
  } finally { await f.dispose(); }
});
test("loading without conversation data sends no recent request (control)", async () => {
  const f = fixture(); try { f.setQueryData(undefined); f.render(); assert.equal(f.calls.length, 0); } finally { await f.dispose(); }
});
test("an older recent response cannot lower a confirmed canonical revision", async () => {
  const f = fixture(); try { f.render(); const current = afterOpen({ offline_revision: 9, title: "Synthetic renamed", project_id: "synthetic-target", reading_progress: 70 });
    f.client.setQueryData(f.key(), current); f.calls[0].resolve(afterOpen()); await flush(); assert.deepEqual(f.data(), current);
  } finally { await f.dispose(); }
});
test("a newer summary triggers exact full-detail reading instead of relabelling old detail", async () => {
  const f = fixture(); try { f.render(); const current = afterOpen({ offline_revision: 9, title: "Synthetic newest", render_version: 2, content_hash: "synthetic-newest" });
    f.setServer(current); const release = f.hold("detail"); f.calls[0].resolve(current); await flush();
    assert.deepEqual(f.data(), f.initial); assert.equal(f.detailReads(), 1);
    release(); await flush(); assert.deepEqual(f.observer.getCurrentResult().data, current); assert.equal(f.calls.length, 1);
  } finally { await f.dispose(); }
});
test("older reading time cannot overwrite progress at the same canonical revision", async () => {
  const f = fixture(); try { f.render(); const current = afterOpen({ last_read_at: "2026-10-09T00:03:00Z", reading_progress: 80 });
    f.client.setQueryData(f.key(), current); f.calls[0].resolve(afterOpen()); await flush(); assert.deepEqual(f.data(), current);
  } finally { await f.dispose(); }
});
test("equal-time conflicting progress keeps the current observation", async () => {
  const f = fixture(); try { f.render(); const current = afterOpen({ reading_progress: 80 });
    f.client.setQueryData(f.key(), current); f.calls[0].resolve(afterOpen()); await flush(); assert.deepEqual(f.data(), current);
  } finally { await f.dispose(); }
});
test("later reading time may legitimately report lower progress (control)", async () => {
  const f = fixture(); try { f.render(); f.client.setQueryData(f.key(), detail({ reading_progress: 80 }));
    f.calls[0].resolve(afterOpen({ reading_progress: 10 })); await flush(); assert.equal(f.data().reading_progress, 10);
  } finally { await f.dispose(); }
});
for (const [name, response] of [["wrong identity", afterOpen({ id: "synthetic-other" })], ["invalid revision", afterOpen({ offline_revision: 0 })]]) {
  test(name + " does not publish a recent acknowledgement", async () => {
    const f = fixture(); try { f.render(); f.calls[0].resolve(response); await flush();
      assert.deepEqual(f.data(), f.initial); assert.equal(f.invalidations.length, 0);
    } finally { await f.dispose(); }
  });
}
test("a missing detail is not fabricated from the recent summary (control)", async () => {
  const f = fixture(); try { f.render(); f.client.removeQueries({ queryKey: f.key(), exact: true });
    f.calls[0].resolve(afterOpen()); await flush(); assert.equal(f.data(), undefined);
  } finally { await f.dispose(); }
});
test("offline local recording does not invalidate remote query namespaces", async () => {
  const f = fixture(); try { f.setRoute(f.initial.id, "offline"); f.render(); await flush();
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].mode, "offline"); assert.equal(f.invalidations.length, 0);
  } finally { await f.dispose(); }
});
test("an accepted current remote open invalidates the actual Recent list", async () => {
  const f = fixture(); try { f.render(); f.calls[0].resolve(afterOpen()); await flush();
    assert.equal(f.client.getQueryState(["recent-items"]).isInvalidated, true);
  } finally { await f.dispose(); }
});
test("an uncertain open is not automatically posted again after a data refresh", async () => {
  const f = fixture(); try { f.render(); f.calls[0].reject(); await flush();
    f.client.setQueryData(f.key(), detail({ description_markdown: "Synthetic refreshed" })); f.render(); assert.equal(f.calls.length, 1);
  } finally { await f.dispose(); }
});
test("later same-visit data changes do not record another accepted open (control)", async () => {
  const f = fixture(); try { f.render(); f.calls[0].resolve(afterOpen()); await flush();
    f.client.setQueryData(f.key(), detail({ description_markdown: "Synthetic refreshed" })); f.render(); assert.equal(f.calls.length, 1);
  } finally { await f.dispose(); }
});
test("rejecting detached refreshes remain handled and cannot re-enable the POST", async () => {
  const f = fixture(); try { f.setRefreshFailure(true); f.render(); f.calls[0].resolve(afterOpen()); await flush();
    assert.equal(f.failures.length, 0); f.render(); assert.equal(f.calls.length, 1);
  } finally { await f.dispose(); }
});
test("a route switch fences old publication before effect cleanup", async () => {
  const f = fixture(); try { f.render(); f.setRoute(f.second.id); f.render({ layout: false, passive: false });
    f.calls[0].resolve(afterOpen()); await flush(); assert.deepEqual(f.data(), f.initial); assert.equal(f.invalidations.length, 0);
  } finally { await f.dispose(); }
});
test("an unmounted Reader cannot publish or start detached reads", async () => {
  const f = fixture(); try { f.render(); f.unmount(); f.calls[0].resolve(afterOpen()); await flush();
    assert.deepEqual(f.data(), f.initial); assert.equal(f.invalidations.length, 0);
  } finally { await f.dispose(); }
});
test("authentication changes fence a held response without another render", async () => {
  const f = fixture(); try { f.render(); f.changeAccount(); f.calls[0].resolve(afterOpen()); await flush();
    assert.deepEqual(f.data(), f.initial); assert.equal(f.invalidations.length, 0);
  } finally { await f.dispose(); }
});
test("authentication changes before passive admission send no old-view POST", async () => {
  const f = fixture(); try { f.render({ passive: false }); f.changeAccount(); f.runEffects("passive"); assert.equal(f.calls.length, 0); }
  finally { await f.dispose(); }
});
test("an old failure after A to B to A cannot clear the new visit reservation", async () => {
  const f = fixture(); try { f.render(); f.setRoute(f.second.id); f.render(); f.setRoute(f.initial.id); f.render();
    assert.equal(f.calls.length, 3); f.calls[0].reject(); await flush();
    f.client.setQueryData(f.key(), detail({ description_markdown: "Synthetic latest visit" })); f.render(); assert.equal(f.calls.length, 3);
  } finally { await f.dispose(); }
});
test("changing data source creates its own recording without accepting the old source", async () => {
  const f = fixture(); try { f.render(); f.setRoute(f.initial.id, "offline"); f.render(); await flush();
    assert.equal(f.calls.length, 2); assert.equal(f.calls[1].mode, "offline");
    f.calls[0].resolve(afterOpen()); await flush(); assert.equal(f.invalidations.length, 0); assert.deepEqual(f.data(), f.initial);
  } finally { await f.dispose(); }
});
test("synthetic effect replay does not double-admit an open (control)", async () => {
  const f = fixture(); try { f.render(); f.replayEffects(); assert.equal(f.calls.length, 1); f.calls[0].resolve(afterOpen()); await flush();
    assert.equal(f.data().reading_progress, 30);
  }
  finally { await f.dispose(); }
});
test("recent publication leaves complete turns, positions and offline data alone (control)", async () => {
  const f = fixture(); try { f.render(); f.calls[0].resolve(afterOpen()); await flush();
    assert.deepEqual(f.client.getQueryData(f.positionKey), f.position); assert.deepEqual(f.client.getQueryData(f.windowKey), f.window);
    assert.deepEqual(f.data(f.initial.id, "offline"), f.initial);
    assert.equal(f.invalidations.some(filter => ["reading-position", "reader-turn-window"].includes(filter.queryKey[0])), false);
  } finally { await f.dispose(); }
});
test("an invalid reading timestamp cannot replace known reading fields", async () => {
  const f = fixture(); try { f.render(); f.calls[0].resolve(afterOpen({ last_read_at: "not-a-time" })); await flush(); assert.deepEqual(f.data(), f.initial); }
  finally { await f.dispose(); }
});

for (const [name, current] of [["older revision", detail({ offline_revision: 9 })], ["older reading time", afterOpen({ last_read_at: "2026-10-09T00:03:00Z" })]]) {
  test("ignoring " + name + " does not falsely refresh the detail cache age", async () => {
    const f = fixture(); try { f.render(); f.client.setQueryData(f.key(), current, { updatedAt: 1 });
      f.calls[0].resolve(afterOpen()); await flush(); assert.equal(f.client.getQueryState(f.key()).dataUpdatedAt, 1);
    } finally { await f.dispose(); }
  });
}
test("a failed newer-detail GET preserves coherent old detail and never replays the open", async () => {
  const f = fixture(); try { f.setDetailError(true); f.render(); f.calls[0].resolve(afterOpen({ offline_revision: 9 })); await flush();
    assert.equal(f.detailReads(), 1); assert.equal(f.observer.getCurrentResult().isError, true);
    assert.deepEqual(f.data(), f.initial); f.render(); assert.equal(f.calls.length, 1); assert.equal(f.failures.length, 0);
  } finally { await f.dispose(); }
});
test("newer-detail reconciliation supersedes an already in-flight older GET", async () => {
  const f = fixture(); try { f.render(); f.setServer(f.initial); const release = f.hold("detail"), oldRead = f.observer.refetch(); await flush();
    const latest = afterOpen({ offline_revision: 9, content_hash: "synthetic-newest", render_version: 2 }); f.setServer(latest);
    f.calls[0].resolve(latest); await flush(); assert.equal(f.detailReads(), 2);
    release(); await oldRead; await flush(); assert.deepEqual(f.data(), latest);
  } finally { await f.dispose(); }
});
test("same-visit data rerenders retain the pending owner and preserve unrelated fresh fields", async () => {
  const f = fixture(); try { f.render(); f.client.setQueryData(f.key(), detail({ description_markdown: "Synthetic current field" })); f.render();
    f.calls[0].resolve(afterOpen()); await flush(); assert.equal(f.data().description_markdown, "Synthetic current field");
    assert.equal(f.data().reading_progress, 30); assert.equal(f.calls.length, 1);
  } finally { await f.dispose(); }
});
test("a known new reading time fills a previously absent reading observation", async () => {
  const f = fixture(); try { f.client.setQueryData(f.key(), detail({ last_read_at: null, reading_progress: null })); f.render();
    f.calls[0].resolve(afterOpen({ reading_progress: 0 })); await flush(); assert.equal(f.data().reading_progress, 0);
    assert.equal(f.data().last_read_at, afterOpen().last_read_at);
  } finally { await f.dispose(); }
});
test("equivalent timezone representations are not treated as a newer reading observation", async () => {
  const f = fixture(); try { const current = detail({ last_read_at: "2026-10-09T08:01:00+08:00", reading_progress: 70 });
    f.client.setQueryData(f.key(), current); f.render(); f.calls[0].resolve(afterOpen()); await flush(); assert.deepEqual(f.data(), current);
  } finally { await f.dispose(); }
});
test("null remote results neither fabricate canonical data nor pretend to confirm an open", async () => {
  const f = fixture(); try { f.render(); f.calls[0].resolve(null); await flush();
    assert.deepEqual(f.data(), f.initial); assert.equal(f.invalidations.length, 0); f.render(); assert.equal(f.calls.length, 1);
  } finally { await f.dispose(); }
});
test("changing only project context does not retry an uncertain same-visit open", async () => {
  const f = fixture(); try { f.render(); f.calls[0].reject(); await flush(); f.setProject("synthetic-different-context"); f.render();
    assert.equal(f.calls.length, 1);
  } finally { await f.dispose(); }
});
test("leaving and revisiting after a failed response permits a real new open", async () => {
  const f = fixture(); try { f.render(); f.calls[0].reject(); await flush();
    f.setRoute(f.second.id); f.render(); f.setRoute(f.initial.id); f.render();
    assert.deepEqual(f.calls.map(call => call.id), [f.initial.id, f.second.id, f.initial.id]);
    f.calls[2].resolve(afterOpen()); await flush(); assert.equal(f.data().reading_progress, 30);
  } finally { await f.dispose(); }
});
test("an authentication change does not automatically open stale same-view cached data", async () => {
  const f = fixture(); try { f.render({ passive: false }); f.changeAccount(); f.render(); assert.equal(f.calls.length, 0); }
  finally { await f.dispose(); }
});
test("mismatched loaded conversation data never admits a recent request", async () => {
  const f = fixture(); try { f.setQueryData(f.second); f.render(); assert.equal(f.calls.length, 0); } finally { await f.dispose(); }
});
test("missing reading time never clears a known observation", async () => {
  const f = fixture(); try { f.render(); f.calls[0].resolve(afterOpen({ last_read_at: null, reading_progress: null })); await flush();
    assert.deepEqual(f.data(), f.initial);
  } finally { await f.dispose(); }
});

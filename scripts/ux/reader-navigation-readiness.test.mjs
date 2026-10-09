import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript");
const source = readFileSync(new URL("../../apps/web/features/conversations/conversation-reader.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("conversation-reader.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const reader = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ConversationReader");
const declarations = new Map(reader.body.statements.filter(ts.isVariableStatement)
  .flatMap(node => [...node.declarationList.declarations].map(item => [item.name.getText(ast), item])));
const callbacks = new Set(["markReaderScrollIntent", "applyLoadedWindow", "navigateToTarget", "refreshActiveMessageFromLayout"]);
const selected = reader.body.statements.filter(node => {
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.some(item => callbacks.has(item.name.getText(ast)));
  if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression) || node.expression.expression.getText(ast) !== "useEffect") return false;
  const text = node.getText(ast);
  return text.includes("const markWheelIntent =") || text.includes("setInitialPaintReady(true)")
    || text.includes("if (!windowQuery.isSuccess || initialWindowAppliedRef.current)")
    || text.includes("messagesRef.current = messages;") || text.includes("const restoreToken = readingRestoreTokenRef.current + 1;")
    || text.includes("const persist = () =>") || text.includes('"first-content",');
});
assert.equal(selected.filter(node => node.getText(ast).includes("const persist = () =>")).length, 1);
assert.equal(selected.filter(node => node.getText(ast).includes("setInitialPaintReady(true)")).length, 1);
assert.equal(selected.filter(node => node.getText(ast).includes("const restoreToken = readingRestoreTokenRef.current + 1;")).length, 1);
assert.equal(selected.length, 11, "four actual callbacks and seven effects, no rewritten state machine");
const deriveNames = ["conversationReadUnavailable", "retainReaderOnReadError", "readerSurfaceAvailable"];
const derived = deriveNames.filter(name => declarations.has(name)).map(name => "const " + declarations.get(name).getText(ast) + ";");
const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node) && [
  "loadCompleteTurnWindow", "loadCompleteTurnWindowWithAnchorFallback", "isMissingReaderAnchorError", "captureReadingPosition",
  "findBlockIndexById", "numberOrNull", "locallyResolvableMessage", "navigationTargetIdentity", "readerCacheIdentity", "setNavigationStage",
].includes(node.name?.text));
const ownerGuard = reader.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ownsReaderReadRecovery");
const compile = (text, capture = false) => ts.transpileModule(text, { fileName: "reader-readiness-test.ts", compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
}, ...(capture ? { transformers: { before: [context => root => {
  const visit = node => ts.isVoidExpression(node)
    ? context.factory.createCallExpression(context.factory.createIdentifier("captureTask"), undefined, [ts.visitNode(node.expression, visit)])
    : ts.visitEachChild(node, visit, context);
  return ts.visitNode(root, visit);
}] } } : {}) }).outputText;
const moduleCode = name => compile(readFileSync(new URL("../../apps/web/features/conversations/" + name + ".ts", import.meta.url), "utf8"));
const loadModule = (code, imports = appRequire, document) => {
  const module = { exports: {} }; new Function("require", "module", "exports", "document", code)(imports, module, module.exports, document); return module.exports;
};
const windowHelpers = loadModule(moduleCode("reader-window"));
const registryCode = moduleCode("rendered-block-registry"), activeCode = moduleCode("reader-active-position");
const refDefaults = {
  initialWindowAppliedRef: false, windowGenerationRef: 1, navigationTokenRef: 0, navigationInProgressRef: false,
  restoreAttemptedRef: false, restoreInProgressRef: false, readingRestoreTokenRef: 0, userScrollIntentRef: false,
  scrollDirectionRef: null, scrollIntentSequenceRef: 1, lastPersistedIntentRef: 1, lastReaderUserIntentAtRef: 0,
  preferenceStableAnchorRef: null, lastSavedSignatureRef: "", latestStablePositionRef: null,
  pointerDraggingRef: false, pointerDragMovedRef: false, pointerScrollTopRef: 0, activeMessageIdRef: null, activeBlockIdRef: null,
  locatePulseTimerRef: null, lastNavigationTargetRef: null, previousTurnAnchorRef: null, nextTurnAnchorRef: null,
  edgeTransitionRef: null, loadingPreviousRef: false, loadingNextRef: false, previousSentinelVisibleRef: false,
  nextSentinelVisibleRef: false, firstContentReportedRef: false, firstContentStartedAtRef: 0,
};
const inputNames = [...Object.keys(refDefaults), "loadedWindowRef", "scrollContainerRef", "messagesRef", "resolvedLocatorKeysRef",
  "loadPreviousActionRef", "loadNextActionRef", "recentOwner", "recentOwnerRef", "conversationId", "dataSource", "conversationQuery",
  "windowQuery", "positionQuery", "targetMessageId", "savedPosition", "loadedWindow", "initialPaintReady", "mergedIntoConversationId",
  "queryClient", "setInitialPaintReady", "setLoadedWindow", "setPendingTargetMessageId", "setNavigationStatus", "setNavigationFailureReason",
  "setActiveMessageId", "setActiveBlockId", "setLocatePulse", "setReadingSaveError", "pruneMessageState"];
const compiled = compile(`function InspectReadiness(input) {
  const { ${inputNames.join(", ")} } = input;
  const conversation = conversationQuery.data, messages = loadedWindow.items, isOffline = dataSource.mode === "offline";
  ${derived.join("\n")}
  ${ownerGuard.getText(ast)}
  ${selected.map(node => node.getText(ast)).join("\n")}
  const ${declarations.get("loadingProgress").getText(ast)};
  return { navigateToTarget, markReaderScrollIntent, applyLoadedWindow, loadingProgress };
}
${helpers.map(node => node.getText(ast)).join("\n")}
module.exports = InspectReadiness;`, true);
const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const microtasks = async () => { await setImmediate(); await setImmediate(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
class ApiRequestError extends Error { constructor(status) { super("Synthetic read failure"); this.status = status; } }
class Surface {
  constructor() { this.listeners = new Map(); this.dataset = {}; this.isConnected = true; }
  addEventListener(name, action) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(action); }
  removeEventListener(name, action) { this.listeners.get(name)?.delete(action); }
  emit(name, event = {}) { for (const action of [...(this.listeners.get(name) ?? [])]) action({ type: name, ...event }); }
  count(name) { return this.listeners.get(name)?.size ?? 0; }
  closest() { return null; }
}

// Run exact extracted callbacks/effects with a dependency/cleanup scheduler.
// Complete-turn, registered-block lookup and the position payload builder are
// real code. Hook timing, query snapshots, transport, geometry, RAF/timers, leases
// and target alignment are explicit doubles, NOT a mounted Reader/browser.
function fixture({ cold = false, mode = "remote", saved = null, positionError = false } = {}) {
  const state = Object.fromEntries(Object.entries(refDefaults).map(([key, value]) => [key, { current: value }]));
  const root = new Surface(), document = new Surface(), window = new Surface();
  Object.assign(root, { scrollTop: 0, clientHeight: 700, scrollHeight: 700 });
  root.getBoundingClientRect = () => ({ top: 0, left: 0, width: 900, height: 700, bottom: 700 });
  document.documentElement = { clientWidth: 1000 }; document.visibilityState = "visible";
  let now = 0, sequence = 0, dirty = true, mounted = true, rootMounted = !cold, epoch = 1;
  let cursor = 0, effectCursor = 0, current, failTurn = false, mountResult = null;
  let elementItems = null, elements = new Map(), cleanBlocks = [];
  const frames = new Map(), timers = new Map(), memos = [], effects = [], tasks = [], failures = [], holds = new Map();
  const turns = Array.from({ length: 7 }, (_, turn) => ({ turn_key: "synthetic-turn-" + turn, start_offset: turn * 2, total_messages: 14,
    previous_anchor_message_id: turn ? `synthetic-message-${turn - 1}-user` : null,
    next_anchor_message_id: turn < 6 ? `synthetic-message-${turn + 1}-user` : null,
    items: ["user", "assistant"].map((role, part) => ({ id: `synthetic-message-${turn}-${role}`, role,
      order_key: String(turn * 2 + part).padStart(4, "0"), ordinal: turn * 2 + part + 1,
      content_markdown: "Synthetic unchanged reading text", current_version: { id: `synthetic-version-${turn}-${role}` },
      render_blocks: [{ id: `synthetic-stable-block-${turn}-${role}`, block_index: 0, block_type: "paragraph" }],
    })),
  }));
  const reads = [], mounts = [], settlements = [], saves = [], reports = [], cacheWrites = [], edgeLoads = [];
  const registry = loadModule(registryCode);
  const active = loadModule(activeCode, name => {
    assert.equal(name, "./rendered-block-registry"); return registry;
  }, document);
  root.contains = element => Boolean(element && (element === root || element.readerRoot === root && element.isConnected));
  root.querySelector = () => null;
  root.querySelectorAll = selector => [...elements.values()].filter(element => selector === "article[data-message-id]" && Boolean(element.dataset.messageId));
  document.getElementById = id => rootMounted ? elements.get(id) ?? null : null;
  document.querySelectorAll = selector => root.querySelectorAll(selector);
  document.querySelector = () => null;
  document.elementsFromPoint = (_x, line) => rootMounted ? [...elements.values()].filter(element => {
    const rect = element.getBoundingClientRect(); return element.dataset.blockIndex !== undefined && rect.top <= line && rect.bottom >= line;
  }) : [];
  const commitElements = () => {
    root.isConnected = rootMounted;
    state.scrollContainerRef.current = rootMounted ? root : null;
    if (elementItems === state.loadedWindow.items) return;
    elementItems = state.loadedWindow.items;
    for (const element of elements.values()) element.isConnected = false;
    for (const clean of cleanBlocks) clean(); cleanBlocks = []; elements = new Map();
    state.loadedWindow.items.forEach((message, index) => {
      const article = new Surface(), block = new Surface();
      Object.assign(article, { id: "message-" + message.id, readerRoot: root, absoluteTop: index * 600,
        dataset: { messageId: message.id, orderKey: message.order_key } });
      Object.assign(block, { id: "block-" + message.id + "-0", readerRoot: root, absoluteTop: index * 600,
        dataset: { blockIndex: "0", blockId: message.render_blocks[0].id, blockType: "paragraph" } });
      article.getBoundingClientRect = block.getBoundingClientRect = () => ({ top: article.absoluteTop - root.scrollTop,
        bottom: article.absoluteTop + 600 - root.scrollTop, left: 0, width: 900, height: 600 });
      article.querySelectorAll = selector => selector === "[data-block-index]" ? [block] : [];
      article.querySelector = selector => selector.includes(message.render_blocks[0].id) ? block : null;
      block.querySelector = () => null;
      article.closest = selector => selector === "article[data-message-id]" ? article : null;
      block.closest = selector => selector === "article[data-message-id]" ? article : selector === "[data-block-index]" ? block : null;
      article.contains = element => element === article || element === block;
      elements.set(article.id, article); elements.set(block.id, block);
      cleanBlocks.push(registry.registerRenderedBlock(message.id, 0, block, message.content_markdown));
    });
    root.scrollHeight = Math.max(700, state.loadedWindow.items.length * 600);
  };
  Object.assign(window, { innerWidth: 1000, performance: { now: () => now },
    requestAnimationFrame: action => { const id = ++sequence; frames.set(id, action); return id; }, cancelAnimationFrame: id => frames.delete(id),
    setTimeout: (action, ms) => { const id = ++sequence; timers.set(id, { action, at: now + ms }); return id; }, clearTimeout: id => timers.delete(id) });
  const change = (key, value) => { if (!Object.is(state[key], value)) { state[key] = value; dirty = true; } };
  const status = (kind, data) => ({ isSuccess: kind === "success", isError: kind === "error", isLoading: kind === "pending", data,
    error: kind === "error" ? new ApiRequestError(503) : null });
  const dataSource = { mode, getReaderTurn: async (id, anchor) => {
    reads.push({ id, anchor }); if (holds.has("turn")) await holds.get("turn").promise;
    if (failTurn) throw new Error("Synthetic target read failed");
    const turn = anchor ? turns.find(item => item.items.some(message => message.id === anchor)) : turns[0];
    if (!turn) throw new Error("Anchor message not found"); return turn;
  }, getTargetContext: async (id, target) => {
    const turn = await dataSource.getReaderTurn(id, target.messageId);
    return { readerTurn: turn, targetMessage: turn.items.find(message => message.id === target.messageId), dialogueIndex: { items: [] }, toc: { items: [] } };
  }, saveReadingPosition: async (id, payload) => { saves.push({ id, payload }); } };
  const owner = { conversationId: "synthetic-ready-reader", dataSource, epoch, active: true };
  Object.assign(state, { conversationId: owner.conversationId, dataSource, recentOwner: owner, recentOwnerRef: { current: owner },
    loadedWindow: windowHelpers.emptyLoadedWindow(1), loadedWindowRef: { current: windowHelpers.emptyLoadedWindow(1) },
    scrollContainerRef: { current: rootMounted ? root : null }, messagesRef: { current: [] }, resolvedLocatorKeysRef: { current: new Set() },
    loadPreviousActionRef: { current: () => edgeLoads.push("previous") }, loadNextActionRef: { current: () => edgeLoads.push("next") },
    conversationQuery: status(cold ? "pending" : "success", cold ? undefined : { id: owner.conversationId, offline_revision: 1 }),
    windowQuery: status("error"), positionQuery: status(positionError ? "error" : "success"), targetMessageId: null, savedPosition: saved,
    initialPaintReady: false, mergedIntoConversationId: null, navigationStatus: "idle", readingSaveError: false,
    queryClient: { setQueryData: (...args) => cacheWrites.push(args) },
    setInitialPaintReady: value => change("initialPaintReady", value), setLoadedWindow: value => change("loadedWindow", value),
    setPendingTargetMessageId: value => change("pendingTargetMessageId", value), setNavigationStatus: value => change("navigationStatus", value),
    setNavigationFailureReason: value => change("navigationFailureReason", value),
    setActiveMessageId: value => { state.activeMessageIdRef.current = value; change("activeMessageId", value); },
    setActiveBlockId: value => { state.activeBlockIdRef.current = value; change("activeBlockId", value); },
    setLocatePulse: () => {}, setReadingSaveError: value => change("readingSaveError", value), pruneMessageState: () => {},
  });
  state.loadedWindowRef.current = state.loadedWindow;
  const useCallback = (callback, deps) => { const index = cursor++, previous = memos[index];
    if (!previous || !sameDeps(previous.deps, deps)) memos[index] = { deps, callback }; return memos[index].callback; };
  const useEffect = (operation, deps) => { const index = effectCursor++, previous = effects[index];
    effects[index] = { operation, deps, previousDeps: previous?.previousDeps, cleanup: previous?.cleanup }; };
  const captureTask = value => { if (value?.then) tasks.push(Promise.resolve(value).catch(error => failures.push(error))); };
  const navigateMountedTarget = async options => {
    mounts.push(options); await microtasks(); render();
    if (holds.has("mount")) await holds.get("mount").promise;
    if (!options.tokenIsCurrent()) return { ok: false, targetId: options.targetId, reason: "cancelled" };
    if (mountResult) return { ...mountResult, targetId: options.targetId };
    const element = document.getElementById(options.targetId);
    if (!element || !options.root) return { ok: false, targetId: options.targetId, reason: "target-not-mounted" };
    root.scrollTop = Math.max(0, element.absoluteTop - options.offset); root.emit("scroll");
    return { ok: true, targetId: options.targetId };
  };
  const restoreScrollAnchor = async options => {
    settlements.push(options); if (holds.has("settle")) await holds.get("settle").promise; return options.tokenIsCurrent();
  };
  const module = { exports: {} };
  const dependencies = { module, useEffect, useCallback, window, document, Element: Surface, CSS: { escape: value => value },
    authenticationGeneration: () => epoch, captureTask, ApiRequestError, ACTIVE_READING_OFFSET: 120,
    ...windowHelpers, loadTurnNeighborhood: windowHelpers.loadCompleteTurnWindow,
    startTransition: action => action(), resolveActiveReadingTarget: active.resolveActiveReadingTarget,
    navigateMountedTarget, restoreScrollAnchor, estimateCharacterOffsetAtReadingLine: () => null,
    captureScrollAnchor: scope => { const target = active.resolveActiveReadingTarget(scope, 120);
      return target ? { targetId: target.blockId ?? "message-" + target.messageId, offset: 120 } : null; },
    acquireReaderBlockLease: async () => ({ release() {} }), notifyReaderWindowLayoutChanged: () => {},
    reportReaderPerformance: (...args) => reports.push(args), resolveTextAnchorRange: () => null, firstVisibleRangeRect: () => null,
  };
  new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
  function render() {
    if (!mounted) return;
    let passes = 0;
    do {
      assert.ok(++passes < 20, "bounded synthetic effect settling"); dirty = false; cursor = effectCursor = 0;
      current = module.exports(state); commitElements();
      const changed = effects.filter(effect => !sameDeps(effect.previousDeps, effect.deps));
      for (const effect of changed) { effect.cleanup?.(); effect.previousDeps = effect.deps; }
      for (const effect of changed) effect.cleanup = effect.operation();
    } while (dirty);
  }
  const flush = async () => { await microtasks(); render(); await microtasks(); render(); };
  const frame = async () => { now += 16; const batch = [...frames.entries()]; frames.clear(); for (const [, action] of batch) action(now); await flush(); };
  const advance = async ms => {
    const end = now + ms;
    for (let iterations = 0; iterations < 50; iterations++) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break; const [id, timer] = next; timers.delete(id); now = timer.at; timer.action(); await flush();
    }
    now = end; await frame(); await flush();
  };
  const firstTarget = { messageId: turns[3].items[1].id, source: "dialogue-index" };
  render();
  return { state, owner, root, document, window, turns, firstTarget, reads, mounts, settlements, saves, reports, failures, edgeLoads,
    render, flush, frame, advance, result: () => current, setView: change,
    detailReady: () => { rootMounted = true; change("conversationQuery", status("success", { id: state.conversationId, offline_revision: 1 })); render(); },
    detailError: code => { rootMounted = ![401, 403, 404].includes(code); const query = status("error", state.conversationQuery.data);
      query.error = new ApiRequestError(code); change("conversationQuery", query); render(); },
    setInitial: async ({ empty = false, anchor } = {}) => { const page = empty
      ? { items: [], turns: [], total: 0, offset: 0, has_previous: false, has_more: false, previousTurnAnchorMessageId: null, nextTurnAnchorMessageId: null }
      : await windowHelpers.loadCompleteTurnWindow(dataSource.getReaderTurn.bind(null, state.conversationId), anchor, 5);
      change("windowQuery", status("success", page)); render(); return page; },
    failInitial: () => { change("windowQuery", status("error")); render(); },
    setTurnFailure: value => { failTurn = value; }, setMountResult: value => { mountResult = value; },
    navigate: (target = firstTarget, options) => current.navigateToTarget(target, options),
    hold: name => { const held = deferred(); holds.set(name, held); return () => { holds.delete(name); held.resolve(); }; },
    changeAccount: () => { epoch += 1; }, retireVisit: () => { state.recentOwnerRef.current = { ...owner }; },
    userWheel: delta => { root.emit("wheel", { deltaY: delta }); root.scrollTop += delta; root.emit("scroll"); render(); },
    programmaticScroll: top => { root.scrollTop = top; root.emit("scroll"); render(); },
    settleTasks: async () => { await flush(); await Promise.all(tasks); await flush(); },
    dispose: () => { mounted = false; owner.active = false; for (const effect of effects) effect.cleanup?.();
      for (const clean of cleanBlocks) clean(); for (const hold of holds.values()) hold.resolve(); },
  };
}

test("an unresolved initial body remains unready and does not claim complete loading", () => {
  const f = fixture(); try { assert.equal(f.state.initialPaintReady, false); assert.equal(f.result().loadingProgress, 25); }
  finally { f.dispose(); }
});
test("a cold detail mount attaches Reader input and position listeners even if the initial body failed", () => {
  const f = fixture({ cold: true }); try {
    assert.equal(f.root.count("wheel"), 0); f.detailReady();
    assert.equal(f.root.count("wheel"), 1); assert.equal(f.root.count("scroll"), 1); assert.equal(f.window.count("keydown"), 1);
    assert.equal(f.state.initialPaintReady, false);
  } finally { f.dispose(); }
});
test("a cached-detail mount already attaches input while the initial body is unresolved (control)", () => {
  const f = fixture(); try { assert.equal(f.root.count("wheel"), 1); assert.equal(f.root.count("scroll"), 1); }
  finally { f.dispose(); }
});
test("accepted alternate complete turns become paint-ready without the failed initial query succeeding", async () => {
  const f = fixture({ cold: true }); try {
    f.detailReady(); assert.equal((await f.navigate()).ok, true); await f.flush(); await f.frame();
    assert.equal(f.state.windowQuery.isError, true); assert.equal(f.state.loadedWindow.turns.length, 3);
    assert.equal(f.state.loadedWindow.items.length, 6); assert.equal(f.state.initialPaintReady, true); assert.equal(f.result().loadingProgress, 100);
    await f.frame(); await f.frame(); assert.equal(f.reports.filter(report => report[0] === "first-content").length, 1);
  } finally { f.dispose(); }
});
test("ordinary index navigation settles the initial restore decision", async () => {
  const f = fixture(); try { assert.equal((await f.navigate()).ok, true); assert.equal(f.state.restoreAttemptedRef.current, true); }
  finally { f.dispose(); }
});
for (const cold of [false, true]) test((cold ? "cold" : "cached") + ": real wheel after alternate navigation saves an actual mounted block payload", async () => {
  const f = fixture({ cold }); try {
    if (cold) f.detailReady(); await f.navigate(); await f.frame(); f.userWheel(80); await f.advance(1200);
    assert.equal(f.saves.length, 1); const payload = f.saves[0].payload;
    assert.equal(payload.message_id, f.firstTarget.messageId); assert.equal(payload.block_index, 0);
    assert.equal(payload.anchor_data.position_mode, "block-relative-v2");
    assert.equal(payload.anchor_data.block_id, "synthetic-stable-block-3-assistant");
    assert.equal(payload.anchor_data.version_id, "synthetic-version-3-assistant");
    assert.equal(payload.anchor_data.order_key, "0007"); assert.equal(payload.anchor_data.character_offset, null);
    assert.equal(f.saves[0].id, f.state.conversationId); assert.equal(f.state.windowQuery.isError, true);
  } finally { f.dispose(); }
});
test("a failed position read does not leave saves blocked after a deliberate index navigation", async () => {
  const f = fixture({ positionError: true }); try { await f.navigate(); await f.frame(); f.userWheel(90); await f.advance(1200); assert.equal(f.saves.length, 1); }
  finally { f.dispose(); }
});
test("an explicit message action shares the same restoration ownership as index navigation", async () => {
  const f = fixture(); try { await f.navigate({ ...f.firstTarget, source: "message-action" }); assert.equal(f.state.restoreAttemptedRef.current, true); }
  finally { f.dispose(); }
});
test("a late original-window success cannot restore an old saved message over a newer index choice", async () => {
  const f = fixture(); try {
    const remembered = f.turns[2].items[0]; f.setView("savedPosition", { message_id: remembered.id, block_index: null, scroll_offset: 0, anchor_data: {} });
    f.render(); await f.navigate(); await f.flush(); const chosenTop = f.root.scrollTop, mountCount = f.mounts.length;
    const accepted = f.state.loadedWindow; await f.setInitial({ anchor: remembered.id }); await f.settleTasks();
    assert.equal(f.state.loadedWindow, accepted); assert.equal(f.mounts.length, mountCount); assert.equal(f.root.scrollTop, chosenTop);
    assert.equal(f.state.activeMessageId, f.firstTarget.messageId);
  } finally { f.dispose(); }
});
test("user wheel can cancel a cold-mounted target read before it commits", async () => {
  const f = fixture({ cold: true }); let release = () => {}; try {
    f.detailReady(); release = f.hold("turn"); const navigation = f.navigate(); await f.flush(); f.userWheel(20); release();
    assert.equal((await navigation).reason, "cancelled"); assert.equal(f.state.loadedWindow.items.length, 0);
    assert.equal(f.state.initialPaintReady, false); assert.equal(f.state.navigationInProgressRef.current, false);
  } finally { release(); f.dispose(); }
});
test("navigation cancellation retains a newer already accepted complete-turn window", async () => {
  const f = fixture(); let release = () => {}; try {
    release = f.hold("turn"); const older = f.navigate({ messageId: f.turns[1].items[0].id, source: "dialogue-index" }); await f.flush();
    f.result().markReaderScrollIntent("down"); release(); assert.equal((await older).reason, "cancelled");
    await f.navigate(); const accepted = f.state.loadedWindow; await f.frame();
    assert.equal(f.state.loadedWindow, accepted); assert.equal(f.state.initialPaintReady, true);
  } finally { release(); f.dispose(); }
});
for (const mode of ["remote", "offline"]) {
  test(mode + ": normal complete-turn first load becomes ready and only real intent can save", async () => {
    const f = fixture({ mode }); try {
      await f.setInitial(); await f.frame(); assert.equal(f.state.initialPaintReady, true); assert.equal(f.state.restoreAttemptedRef.current, true);
      const intent = f.state.scrollIntentSequenceRef.current; f.programmaticScroll(200); await f.advance(1200);
      assert.equal(f.saves.length, 0); assert.equal(f.state.scrollIntentSequenceRef.current, intent);
      f.userWheel(80); await f.advance(1200); assert.equal(f.saves.length, 1);
    } finally { f.dispose(); }
  });
  test(mode + ": genuine empty success finishes loading without making up an anchor", async () => {
    const f = fixture({ mode }); try {
      await f.setInitial({ empty: true }); await f.frame(); assert.equal(f.state.initialPaintReady, true); assert.equal(f.result().loadingProgress, 100);
      f.userWheel(80); await f.advance(1200); assert.equal(f.saves.length, 0);
    } finally { f.dispose(); }
  });
}
test("saved-position restoration and its programmed scroll do not invent new user intent", async () => {
  const f = fixture(); try {
    const remembered = f.turns[1].items[1]; f.setView("savedPosition", { message_id: remembered.id, block_index: 0, scroll_offset: 4,
      anchor_data: { position_mode: "block-relative-v2", version_id: remembered.current_version.id, block_id: remembered.render_blocks[0].id, block_offset: 4 } });
    const intent = f.state.scrollIntentSequenceRef.current; await f.setInitial({ anchor: remembered.id }); await f.settleTasks(); await f.frame(); await f.advance(1400);
    assert.equal(f.state.scrollIntentSequenceRef.current, intent); assert.equal(f.saves.length, 0);
    assert.equal(f.state.restoreAttemptedRef.current, true); assert.equal(f.state.restoreInProgressRef.current, false);
    assert.ok(f.mounts.some(mount => mount.targetId === "block-" + remembered.id + "-0"));
  } finally { f.dispose(); }
});
test("real input cancels an in-progress saved-position restore and can later save", async () => {
  const f = fixture(); let release = () => {}; try {
    const remembered = f.turns[1].items[1]; f.setView("savedPosition", { message_id: remembered.id, block_index: null, scroll_offset: 0, anchor_data: {} });
    release = f.hold("settle"); await f.setInitial({ anchor: remembered.id }); await f.flush(); await f.frame();
    assert.equal(f.state.restoreInProgressRef.current, true); f.userWheel(100); release(); await f.settleTasks(); await f.advance(1200);
    assert.equal(f.state.restoreInProgressRef.current, false); assert.equal(f.state.navigationInProgressRef.current, false); assert.equal(f.saves.length, 1);
  } finally { release(); f.dispose(); }
});
test("a new index choice cancels a pending saved-position restore even though it is not target-first", async () => {
  const f = fixture(); let release = () => {}; try {
    const remembered = f.turns[2].items[0]; f.setView("savedPosition", { message_id: remembered.id, block_index: null, scroll_offset: 0, anchor_data: {} });
    release = f.hold("settle"); await f.setInitial({ anchor: remembered.id }); await f.flush();
    const restoreToken = f.state.readingRestoreTokenRef.current;
    const chosen = f.navigate(); await f.flush();
    assert.ok(f.state.readingRestoreTokenRef.current > restoreToken); assert.equal(f.state.restoreInProgressRef.current, false);
    release(); await chosen; await f.settleTasks();
  } finally { release(); f.dispose(); }
});
test("a failed target read leaves an empty body unready and cannot save a guessed anchor", async () => {
  const f = fixture(); try {
    f.setTurnFailure(true); const result = await f.navigate(); await f.frame(); f.userWheel(80); await f.advance(1200);
    assert.equal(result.ok, false); assert.equal(f.state.initialPaintReady, false); assert.equal(f.state.loadedWindow.items.length, 0); assert.equal(f.saves.length, 0);
  } finally { f.dispose(); }
});
test("accepted readable content and an unsuccessful exact locate remain distinct states", async () => {
  const f = fixture(); try {
    f.setMountResult({ ok: false, reason: "target-not-mounted" }); const result = await f.navigate(); await f.frame();
    assert.equal(result.ok, false); assert.equal(f.state.navigationStatus, "failed");
    assert.equal(f.state.loadedWindow.items.length, 6); assert.equal(f.state.initialPaintReady, true);
    assert.equal(f.state.navigationFailureReason, "target-not-mounted");
  } finally { f.dispose(); }
});
test("cached transient detail failure does not block readiness of independently accepted content", async () => {
  const f = fixture(); try { f.detailError(503); await f.navigate(); await f.frame(); assert.equal(f.state.initialPaintReady, true); }
  finally { f.dispose(); }
});
test("denied detail removes listeners from the hidden Reader surface", () => {
  const f = fixture(); try {
    assert.equal(f.root.count("wheel"), 1); f.detailError(403);
    assert.equal(f.root.count("wheel"), 0); assert.equal(f.root.count("scroll"), 0); assert.equal(f.window.count("keydown"), 0);
  } finally { f.dispose(); }
});
for (const retirement of ["account", "visit", "window"]) test(retirement + " retirement fences a queued first-paint callback", async () => {
  const f = fixture(); try {
    await f.setInitial();
    if (retirement === "account") f.changeAccount();
    else if (retirement === "visit") f.retireVisit();
    else { f.state.windowGenerationRef.current += 1; f.state.loadedWindowRef.current = windowHelpers.emptyLoadedWindow(f.state.windowGenerationRef.current); f.state.initialWindowAppliedRef.current = false; }
    await f.frame(); assert.equal(f.state.initialPaintReady, false);
  } finally { f.dispose(); }
});
test("effect cleanup cancels a scheduled paint and removes event handlers", async () => {
  const f = fixture(); await f.setInitial(); f.dispose(); await f.frame();
  assert.equal(f.state.initialPaintReady, false); assert.equal(f.root.count("wheel"), 0); assert.equal(f.root.count("scroll"), 0);
  assert.equal(f.document.count("visibilitychange"), 0); assert.equal(f.window.count("pagehide"), 0);
});
test("routine refreshes do not bind duplicate listeners or report a second first-content event", async () => {
  const f = fixture(); try {
    await f.setInitial(); await f.frame(); await f.frame(); await f.frame();
    for (let round = 0; round < 3; round++) { f.render(); f.failInitial(); f.detailReady(); await f.frame(); }
    assert.equal(f.root.count("wheel"), 1); assert.equal(f.root.count("scroll"), 1);
    assert.equal(f.state.initialPaintReady, true); assert.equal(f.reports.filter(report => report[0] === "first-content").length, 1);
  } finally { f.dispose(); }
});
test("a deliberate index navigation can persist its settled real target without requiring extra wheel input", async () => {
  const f = fixture(); try {
    await f.navigate(); await f.frame(); await f.advance(1200);
    assert.equal(f.saves.length, 1); assert.equal(f.saves[0].payload.message_id, f.firstTarget.messageId);
    assert.equal(f.state.userScrollIntentRef.current, false, "navigation intent is not relabelled as a wheel gesture");
  } finally { f.dispose(); }
});

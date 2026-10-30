import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const compiled = ts.transpileModule(readFileSync(new URL("../../apps/web/features/toc/conversation-toc.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const items = Array.from({ length: 201 }, (_, index) => ({
  id: `synthetic-heading-${index}`, message_id: "synthetic-message", block_index: index, text: `Synthetic heading ${index}`, level: 1,
}));
const page = (offset, data) => ({ conversation_id: "synthetic-conversation", offset, limit: 200,
  total: 201, has_more: offset === 0, items: data });
const nodes = node => Array.isArray(node) ? node.flatMap(nodes)
  : node && typeof node === "object" && node.props ? [node, ...nodes(node.props.children)] : [];

// Actual component/query options and active-heading resolution. Hook/query
// delivery and DOM geometry/animation frames are adapters, not real browser
// scroll/layout/focus acceptance.
function fixture(sourceKey = "remote", withGeometry = false) {
  const hooks = [], effects = [], api = {}, calls = { next: 0, refetch: 0, loads: [] };
  const frames = new Map(), rowRefs = new Map();
  let frameId = 0;
  const scroll = { clientHeight: 200, scrollHeight: 10_000, scrollTop: 0, getBoundingClientRect: () => ({ top: 0 }) };
  const window = {
    requestAnimationFrame: callback => { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => { frames.delete(id); },
  };
  let cursor = 0, options, tree;
  let state = { data: { pages: [page(0, items.slice(0, 200))], pageParams: [0] },
    isSuccess: true, isError: false, isFetching: false, hasNextPage: true, isFetchNextPageError: false };
  let props = { conversationId: "synthetic-conversation", sourceKey, activeMessageId: "synthetic-message",
    activeBlockId: "block-synthetic-message-200",
    loadPage: async input => { calls.loads.push(input); return page(input.offset, items.slice(input.offset, input.offset + 200)); },
  };
  const hook = init => hooks[cursor++] ?? (hooks[cursor - 1] = init());
  const react = {
    memo: fn => fn,
    useState: init => { const entry = hook(() => ({ value: init }));
      return [entry.value, value => { entry.value = typeof value === "function" ? value(entry.value) : value; }]; },
    useRef: init => hook(() => ({ current: init })),
    useMemo: (fn, deps) => { const entry = hook(() => ({}));
      if (!entry.deps || deps.some((value, index) => !Object.is(value, entry.deps[index]))) Object.assign(entry, { deps, value: fn() });
      return entry.value; },
    useCallback: fn => fn,
    useEffect: (fn, deps) => { const entry = hook(() => ({}));
      if (!entry.deps || deps.some((value, index) => !Object.is(value, entry.deps[index]))) {
        entry.deps = deps; effects.push(() => { entry.cleanup?.(); entry.cleanup = fn(); });
      } },
  };
  const mocks = {
    "../../components/reader-auxiliary-visibility": { useReaderAuxiliaryVisibility: () => ({ visible: true, overlay: false }) },
    react, "react/jsx-runtime": require("react/jsx-runtime"),
    "@tanstack/react-query": { useInfiniteQuery: input => { options = input; return {
      ...state, refetch: () => { calls.refetch++; }, fetchNextPage: () => { calls.next++; },
    }; } },
    "../../components/preferences-provider": {
      usePreferences: () => ({ resolvedLocale: "en-US", sectionTocMode: "visible", setSectionTocMode() {} }),
      useTranslations: () => key => key,
    },
    "lucide-react": { PanelRightOpen: "Expand", PinOff: "Collapse" },
    "../../lib/api": { getConversationToc: async () => { throw Error("use the scoped loader"); } },
    "../conversations/markdown-renderer": { markdownHeadingLabel: text => text },
  };
  new Function("require", "exports", "window", compiled)(name => { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; }, api, window);
  const render = () => {
    cursor = 0; tree = api.ConversationToc(props);
    if (withGeometry) {
      const list = nodes(tree).find(node => node.type?.name === "TocButtonList")?.props;
      const frame = nodes(tree).find(node => node.type?.name === "TocFrame")?.props;
      if (list) {
        const id = list.activeHeadingId;
        if (id && !rowRefs.has(id)) rowRefs.set(id, { getBoundingClientRect: () => ({
          top: 400 + Number(id.split("-").at(-1)) * 36 - scroll.scrollTop, height: 20,
        }) });
        list.activeRowRef.current = rowRefs.get(id) ?? null;
      }
      if (frame?.scrollContainerRef) frame.scrollContainerRef.current = scroll;
    }
    for (const fn of effects.splice(0)) fn();
    for (const [id, callback] of [...frames]) { frames.delete(id); callback(); }
    return tree;
  };
  render();
  return { calls, render, scroll, frameCount: () => frameId, get options() { return options; },
    state(value) { state = { ...state, ...value }; return render(); },
    scope(value) { props = { ...props, sourceKey: value }; return render(); },
    activeBlock(value) { props = { ...props, activeBlockId: value }; return render(); },
    list() { return nodes(tree).find(node => node.type?.name === "TocButtonList")?.props; },
    retry() { const retry = nodes(tree).find(node => node.type === "button" && node.props.children === "retry"); assert.ok(retry); retry.props.onClick(); },
    dispose() { for (const hook of hooks) hook.cleanup?.(); },
  };
}

for (const source of ["remote", "offline:1:v7", "share:synthetic-capability"]) test(`${source}: heading 201 becomes addressable and active after loading its page`, async () => {
  const f = fixture(source);
  try {
    assert.equal(f.list().items.length, 200);
    const next = await f.options.queryFn({ pageParam: 200 });
    assert.deepEqual(f.calls.loads, [{ messageId: "synthetic-message", offset: 200, limit: 200 }]);
    assert.equal(f.options.getNextPageParam(next), undefined);
    f.state({ data: { pages: [page(0, items.slice(0, 200)), next], pageParams: [0, 200] }, hasNextPage: false });
    assert.equal(f.list().items.at(-1).id, "synthetic-heading-200");
    assert.equal(f.list().activeHeadingId, "block-synthetic-message-200");
  } finally { f.dispose(); }
});

test("next-page retry keeps existing headings and a successful empty response clears the old fallback", () => {
  const f = fixture();
  try {
    f.state({ isError: true, isSuccess: false, isFetchNextPageError: true }); f.retry();
    assert.equal(f.calls.next, 1); assert.equal(f.calls.refetch, 0);
    assert.equal(f.list().items.length, 200);
    f.state({ data: { pages: [{ ...page(0, []), total: 0, has_more: false }], pageParams: [0] },
      isError: false, isSuccess: true, hasNextPage: false });
    assert.equal(f.list(), undefined);
    f.state({ data: undefined, isSuccess: false, isError: true });
    assert.equal(f.list(), undefined);
  } finally { f.dispose(); }
});

test("a new source cannot briefly reveal the previous source's cached headings", () => {
  const f = fixture();
  try {
    f.state({ data: undefined, isSuccess: false, isError: true });
    assert.equal(f.list().items.length, 200);
    f.scope("share:synthetic-new-source");
    assert.equal(f.list(), undefined);
  } finally { f.dispose(); }
});

test("a block belonging to another message cannot activate this message's nearest heading", () => {
  const f = fixture();
  try {
    f.activeBlock("block-synthetic-other-message-200");
    assert.equal(f.list().activeHeadingId, null);
  } finally { f.dispose(); }
});

for (const source of ["remote", "offline:1:v7", "share:synthetic-capability"]) {
  test(`${source}: append and cache publication preserve manual TOC scroll until the active heading changes`, () => {
    const f = fixture(source, true);
    try {
      f.activeBlock("block-synthetic-message-0");
      assert.equal(f.scroll.scrollTop, 310);
      const framesBeforeAppend = f.frameCount();
      f.scroll.scrollTop = 600; // A real-user scroll is represented by a geometry adapter.
      f.state({ data: { pages: [page(0, items.slice(0, 200)), page(200, items.slice(200))],
        pageParams: [0, 200] }, hasNextPage: false });
      f.render(); // setCache publication causes another visibleItems identity.
      assert.equal(f.list().items.length, 201);
      assert.equal(f.list().activeHeadingId, "block-synthetic-message-0");
      assert.equal(f.scroll.scrollTop, 600);
      assert.equal(f.frameCount(), framesBeforeAppend);
      f.activeBlock("block-synthetic-message-200");
      assert.equal(f.scroll.scrollTop, 7510);
      assert.equal(f.frameCount(), framesBeforeAppend + 1);
      f.scroll.scrollTop = 800;
      f.scope(`${source}:new-version`);
      assert.equal(f.scroll.scrollTop, 7510);
      assert.equal(f.frameCount(), framesBeforeAppend + 2);
    } finally { f.dispose(); }
  });
}

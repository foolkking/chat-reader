import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const { QueryClient, onlineManager } = require("@tanstack/react-query");
const read = path => readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
const source = read("features/search/conversation-search-panel.tsx");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const walk = node => Array.isArray(node) ? node.flatMap(walk)
  : !node || typeof node !== "object" || !node.props ? [] : [node, ...walk(node.props.children)];

// Actual compiled panel and query function; hooks, effects, query state,
// refetch scheduling and data source are adapters, not mounted React/browser.
function fixture({ mode = "offline", prepare } = {}) {
  const slots = [], searches = [];
  let cursor = 0, options, tree, lastRead, heldDispatch = false, generation = 1;
  const slot = initialize => { const i = cursor++; if (!Object.hasOwn(slots, i)) slots[i] = initialize(); return i; };
  const dataSource = { mode, searchConversation: async (...args) => {
    searches.push(args); return { items: [], total: 0, limit: 50, offset: args[1].offset, has_more: false };
  } };
  let props = { conversationId: "synthetic-offline-conversation", dataSource, sourceKey: "synthetic-offline",
    initialState: { query: "synthetic", documentType: "message", role: "all", activeIndex: 0 },
    onNavigate: async () => ({ ok: false }), onClose: () => {}, onPrepareRetry: prepare };
  const stubs = {
    react: {
      useState: initial => {
        const i = slot(() => typeof initial === "function" ? initial() : initial);
        return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
      },
      useRef: initial => slots[slot(() => ({ current: initial }))],
      useMemo: (create, deps) => {
        const state = slots[slot(() => ({}))];
        if (!same(state.deps, deps)) { state.deps = deps; state.value = create(); }
        return state.value;
      },
      useEffect: () => {},
      useLayoutEffect: () => {},
    },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@tanstack/react-query": { useInfiniteQuery: next => {
      options = next;
      return { data: { pages: [{ items: [], total: 0, limit: 50, offset: 0, has_more: false }], pageParams: [0] },
        isError: true, isFetching: false, isFetchingNextPage: false, isFetchNextPageError: false,
        hasNextPage: false, fetchNextPage: () => Promise.resolve({}), refetch: () => {
        if (heldDispatch) return Promise.resolve({});
        lastRead = options.queryFn({ pageParam: options.initialPageParam, signal: undefined });
        lastRead.catch(() => {}); // Query-style error ownership, inspected below.
        return lastRead;
      } };
    } },
    "lucide-react": { Search: () => null, X: () => null },
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: "en-US" }) },
    "../../lib/reader-data-source": { remoteReaderDataSource: dataSource },
    "../../lib/offline-access": { captureOfflineAccess: () => generation, assertOfflineAccess: captured => {
      if (captured !== generation) throw Error("Synthetic retired access");
    } },
    "../../lib/reader-search-cache": { READER_SEARCH_CHANGED_EVENT: "synthetic-search-content-changed" },
  };
  const exports = {};
  new Function("require", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(stubs, name), `Unexpected import ${name}`);
    return stubs[name];
  }, exports);
  const render = () => { cursor = 0; tree = exports.ConversationSearchPanel(props); };
  render();
  return {
    searches, get options() { return options; }, get lastRead() { return lastRead; },
    readQuery: () => options.queryFn({ pageParam: options.initialPageParam, signal: undefined }),
    change: patch => { props = { ...props, ...patch }; render(); },
    holdDispatch: value => { heldDispatch = value; },
    retireAccess: () => { generation++; },
    retry: () => {
      const button = walk(tree).find(node => node.type === "button" && node.props.children === "Retry");
      assert.ok(button); button.props.onClick();
    },
  };
}

test("ordinary local searches do not rebuild; manual retry awaits one rebuild before searching", async () => {
  const hold = deferred();
  let preparations = 0;
  const f = fixture({ prepare: () => { preparations++; return hold.promise; } });
  await f.readQuery();
  assert.equal(preparations, 0);
  f.retry();
  assert.equal(preparations, 1);
  assert.equal(f.searches.length, 1);
  hold.resolve(); await f.lastRead;
  assert.equal(f.searches.length, 2);
  await f.readQuery();
  assert.equal(preparations, 1);
  assert.equal(f.searches.length, 3);
});
test("failed manual rebuild remains a query error and does not dispatch a false empty search", async () => {
  const f = fixture({ prepare: async () => { throw Error("Synthetic rebuild failure"); } });
  f.retry();
  await assert.rejects(f.lastRead, /Synthetic rebuild failure/);
  assert.deepEqual(f.searches, []);
});
test("an unconsumed retry preparation cannot move to another conversation scope", async () => {
  let preparations = 0;
  const f = fixture({ prepare: async () => { preparations++; } });
  f.holdDispatch(true); f.retry();
  f.change({ conversationId: "synthetic-other-conversation" });
  await f.readQuery();
  assert.equal(preparations, 0);
  assert.equal(f.searches[0][0], "synthetic-other-conversation");
});
test("account retirement while rebuilding cannot issue the old query against a new account", async () => {
  const hold = deferred(), f = fixture({ prepare: () => hold.promise });
  f.retry(); f.retireAccess(); hold.resolve();
  await assert.rejects(f.lastRead, /retired access/);
  assert.deepEqual(f.searches, []);
});
test("remote search keeps its inherited network policy and retry without a rebuild callback", async () => {
  const f = fixture({ mode: "remote" });
  assert.equal(f.options.networkMode, undefined);
  f.retry(); await f.lastRead;
  assert.equal(f.searches.length, 1);
});
test("actual local query options execute while the installed QueryClient is marked offline", async () => {
  const f = fixture(), previousOnline = onlineManager.isOnline();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  try {
    onlineManager.setOnline(false);
    assert.equal(f.options.networkMode, "always");
    await client.fetchInfiniteQuery({ ...f.options, retry: false });
    assert.equal(f.searches.length, 1);
  } finally { client.clear(); onlineManager.setOnline(previousOnline); }
});
test("both Reader search surfaces and the Library retain the same explicit rebuild wiring", () => {
  const attributes = (path, component) => {
    const text = read(path), ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const matches = [];
    const visit = node => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === component) {
        matches.push(new Map(node.attributes.properties.filter(ts.isJsxAttribute).map(attribute => [
          attribute.name.getText(ast), attribute.initializer?.getText(ast),
        ])));
      }
      ts.forEachChild(node, visit);
    };
    visit(ast); return matches;
  };
  const panels = attributes("features/conversations/conversation-reader.tsx", "ConversationSearchPanel");
  assert.equal(panels.length, 2);
  assert.ok(panels.every(props => props.get("onPrepareRetry") === "{onPrepareSearchRetry}"));
  const readers = attributes("features/offline/library-shell.tsx", "ConversationReader");
  assert.equal(readers.length, 1);
  assert.equal(readers[0].get("onPrepareSearchRetry"), "{reloadLocal}");
});

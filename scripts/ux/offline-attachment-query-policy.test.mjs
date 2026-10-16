import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const { QueryClient, QueryObserver, onlineManager } = require("@tanstack/react-query");
const paths = [
  ["features/attachments/offline-conversation-files-panel.tsx", "offline-conversation-attachments"],
  ["features/attachments/attachment-block.tsx", "attachment"],
  ["features/attachments/attachment-viewer.tsx", "attachment-viewer"],
  ["features/attachments/attachment-viewer.tsx", "attachment-viewer-item"],
];
const expressions = paths.map(([path, prefix]) => {
  const source = readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useQuery"
      && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
      const key = node.arguments[0].properties.find(property => ts.isPropertyAssignment(property)
        && property.name.getText(ast) === "queryKey")?.initializer;
      if (key && ts.isArrayLiteralExpression(key)
        && ts.isStringLiteral(key.elements[0]) && key.elements[0].text === prefix) found.push(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(found.length, 1, `Expected one actual query option object for ${prefix}`);
  return found[0].getText(ast);
});

// Actual query expressions and installed Query scheduling; local/API loaders and
// state bindings are synthetic adapters. No React mount, Cache Storage, bytes,
// Object URLs or access-generation lifecycle is executed by this file.
function fixture(access = { kind: "offline" }, patch = {}) {
  const calls = [];
  const attachment = { id: "synthetic-asset", display_name: "synthetic.txt", resolution_status: "resolved" };
  const bindings = {
    access, attachmentId: attachment.id, item: { attachmentId: attachment.id },
    shareToken: access.kind === "share" ? access.token : undefined,
    props: {}, conversationId: "synthetic-conversation", enabled: true,
    getOfflineAttachment: async id => { calls.push(["local-asset", id]); return attachment; },
    getAttachment: async (...args) => { calls.push(["remote-asset", ...args]); return attachment; },
    listOfflineConversationAttachments: async id => { calls.push(["local-list", id]); return [attachment]; },
    ...patch,
  };
  const options = expressions.map(expression => {
    const code = ts.transpileModule(`exports.value = (${expression});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const exports = {};
    new Function(...Object.keys(bindings), "exports", code)(...Object.values(bindings), exports);
    return exports.value;
  });
  return { calls, attachment, options };
}
async function disconnected(run, defaults = {}) {
  const previous = onlineManager.isOnline();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, ...defaults } } });
  client.mount();
  try { onlineManager.setOnline(false); await run(client); }
  finally { client.clear(); client.unmount(); onlineManager.setOnline(previous); }
}

test("file list, inline asset, Viewer shell and Viewer item all execute locally while disconnected", async () => {
  const f = fixture();
  await disconnected(async client => {
    for (const options of f.options) {
      assert.equal(options.networkMode, "always");
      await client.fetchQuery(options);
      assert.equal(client.getQueryState(options.queryKey).status, "success");
    }
    assert.deepEqual(f.calls, [
      ["local-list", "synthetic-conversation"], ["local-asset", "synthetic-asset"],
      ["local-asset", "synthetic-asset"], ["local-asset", "synthetic-asset"],
    ]);
  });
});

test("query identities, local lifetimes and non-lazy defaults remain unchanged", () => {
  const f = fixture();
  assert.deepEqual(f.options.map(options => options.queryKey), [
    ["offline-conversation-attachments", "synthetic-conversation"],
    ["attachment", "offline", "owner", "synthetic-asset"],
    ["attachment-viewer", "offline", "owner", "synthetic-asset"],
    ["attachment-viewer-item", "offline", "owner", "synthetic-asset"],
  ]);
  assert.deepEqual(f.options.map(options => options.staleTime), [10_000, 300_000, 0, 0]);
  assert.equal(f.options[2].gcTime, 0);
  assert.equal(f.options[3].gcTime, 0);
  assert.equal(f.options[1].enabled, true);
  assert.equal(f.options[2].enabled, true);
  assert.equal(f.options[3].enabled, true);
  assert.ok(f.options.every(options => !Object.hasOwn(options, "retry")));
});

test("embedded inline metadata, absent Viewer item and lazy item gates still prevent reads", async () => {
  const inline = fixture(undefined, { props: { attachment: { id: "synthetic-embedded" } } }).options[1];
  const shell = fixture(undefined, { item: undefined }).options[2];
  const item = fixture(undefined, { enabled: false }).options[3];
  await disconnected(async client => {
    for (const options of [inline, shell, item]) {
      assert.equal(options.enabled, false);
      let started = false;
      const observer = new QueryObserver(client, { ...options, queryFn: () => { started = true; return {}; } });
      const unsubscribe = observer.subscribe(() => {});
      try {
        assert.equal(observer.getCurrentResult().fetchStatus, "idle");
        assert.equal(started, false);
      } finally { unsubscribe(); observer.destroy(); }
    }
  });
});

test("owner, Share and admin metadata keep their loaders, scope arguments and inherited policies", async () => {
  const accesses = [{ kind: "owner" }, { kind: "share", token: "synthetic-token" }, { kind: "admin", userId: "synthetic-user" }];
  for (const access of accesses) {
    const f = fixture(access);
    const expectedShare = access.kind === "share" ? access.token : undefined;
    const expectedAdmin = access.kind === "admin" ? access.userId : undefined;
    for (const options of f.options.slice(1)) {
      assert.equal(Object.hasOwn(options, "networkMode"), false);
      assert.equal(options.staleTime, 300_000);
      assert.equal(options.queryKey[1], access.kind);
      assert.equal(options.queryKey[2], expectedAdmin ?? expectedShare ?? "owner");
      await options.queryFn();
    }
    assert.deepEqual(f.calls, Array.from({ length: 3 }, () => [
      "remote-asset", "synthetic-asset", expectedShare, expectedAdmin,
    ]));
    await disconnected(async client => {
      assert.ok(f.options.slice(1).every(options => client.defaultQueryOptions(options).networkMode === "offlineFirst"));
      client.setQueryDefaults(["attachment-viewer"], { networkMode: "always" });
      assert.equal(client.defaultQueryOptions(f.options[2]).networkMode, "always");
    }, { networkMode: "offlineFirst" });
  }
});

test("normal remote policy still pauses; reconnect resumes the existing remote query", async () => {
  const f = fixture({ kind: "owner" }), options = f.options[2];
  await disconnected(async client => {
    const pending = client.fetchQuery(options);
    pending.catch(() => {});
    assert.equal(client.getQueryState(options.queryKey).fetchStatus, "paused");
    assert.deepEqual(f.calls, []);
    onlineManager.setOnline(true);
    await pending;
    assert.equal(f.calls[0][0], "remote-asset");
  });
});

test("local failures reject without server fallback, and explicit refetch can recover offline", async () => {
  let failed = true, reads = 0;
  const f = fixture(undefined, { getOfflineAttachment: async () => {
    reads++;
    if (failed) throw Error("Synthetic local asset failure");
    return { id: "synthetic-asset", resolution_status: "offline_unavailable" };
  } });
  await disconnected(async client => {
    for (const options of f.options.slice(1)) {
      failed = true;
      await assert.rejects(client.fetchQuery(options), /Synthetic local asset failure/);
      assert.equal(client.getQueryState(options.queryKey).status, "error");
      failed = false;
      await client.refetchQueries({ queryKey: options.queryKey, exact: true }, { throwOnError: true });
      assert.equal(client.getQueryData(options.queryKey).resolution_status, "offline_unavailable");
    }
    assert.equal(reads, 6);
    assert.deepEqual(f.calls, []);
    assert.equal(onlineManager.isOnline(), false);
  });
});

test("an empty local file list is success, while a failed refresh retains its prior data", async () => {
  const empty = fixture(undefined, { listOfflineConversationAttachments: async () => [] }).options[0];
  await disconnected(async client => {
    assert.deepEqual(await client.fetchQuery(empty), []);
    const prior = [{ id: "synthetic-previous-asset" }];
    client.setQueryData(empty.queryKey, prior);
    const broken = fixture(undefined, { listOfflineConversationAttachments: async () => {
      throw Error("Synthetic local list failure");
    } }).options[0];
    await assert.rejects(client.fetchQuery({ ...broken, staleTime: 0 }), /Synthetic local list failure/);
    assert.deepEqual(client.getQueryData(empty.queryKey), prior);
    assert.equal(client.getQueryState(empty.queryKey).status, "error");
  });
});

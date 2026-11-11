import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript"), React = require("react"), { QueryClient } = require("@tanstack/react-query");
const compiled = path => ts.transpileModule(readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
class ApiRequestError extends Error {
  constructor(message, status, path = "", code) { super(message); Object.assign(this, { status, path, code }); }
}
function fixture() {
  const calls = { writes: [], reads: [], followups: [] };
  let state = { generation: 2, adopted_revision_id: "synthetic-r2" }, receipt = null, readsFail = false, byteRead;
  let write = async () => { throw Error("Synthetic lost acknowledgement"); };
  const bytes = { current: new TextEncoder().encode("# Synthetic current\r\n"), index: new TextEncoder().encode('{"note":"synthetic"}') };
  let readState = async () => state;
  const api = {
    state: async () => { calls.reads.push("state"); if (readsFail) throw Error("Synthetic read failure"); return readState(); },
    revisions: async () => { calls.reads.push("revisions"); return [{ id: state.adopted_revision_id, members: { current: true, index: true } }]; },
    memberBytes: async (id, rev, member) => { calls.reads.push(member); return byteRead ? byteRead(member) : bytes[member]; },
    returnReceipt: async (id, key) => { calls.reads.push({ id, key }); return { task: receipt }; },
    updateFiles: async (id, form) => { calls.writes.push({ id, form }); return write(); },
    returnPackage: async (id, form) => { calls.writes.push({ id, form }); return write(); },
  };
  const recovery = {};
  new Function("require", "exports", compiled("lib/continuation-write-recovery.ts"))(name => {
    assert.equal(name, "./api"); return { ApiRequestError, continuationApi: api };
  }, recovery);
  let epoch = 1;
  const events = new Map();
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  function mount(id = "synthetic-conversation") {
    let cursor = 0, control;
    const slots = [], effects = new Map();
    const slot = init => slots[cursor++] ??= init();
    const react = { ...React, useRef: value => slot(() => ({ current: value })),
      useState: value => { const s = slot(() => ({ value: typeof value === "function" ? value() : value })); return [s.value, v => { s.value = typeof v === "function" ? v(s.value) : v; }]; },
      useEffect: (fn, deps) => { const i = cursor, s = slot(() => ({})); if (!s.deps || deps.some((v, i) => v !== s.deps[i])) { s.deps = deps; effects.set(i, fn); } },
    };
    const hook = {}, window = {
      addEventListener: (name, fn) => { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
      removeEventListener: (name, fn) => events.get(name)?.delete(fn),
    };
    const dependencies = { react, "../../lib/api": { ApiRequestError }, "../../lib/continuation-write-recovery": recovery,
      "../../lib/offline-access": { authenticationGeneration: () => epoch, AUTH_GENERATION_CHANGED_EVENT: "auth" },
      "@tanstack/react-query": { useQueryClient: () => client, useQuery: options => ({ data: client.getQueryData(options.queryKey) }) } };
    new Function("require", "exports", "window", compiled("features/exporting/use-continuation-write.ts"))(name => {
      assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
    }, hook, window);
    const render = () => {
      cursor = 0; control = hook.useContinuationWrite(id, async result => calls.followups.push(result));
      for (const [i, fn] of effects) { slots[i].cleanup?.(); slots[i].cleanup = fn(); } effects.clear();
      return control;
    };
    render();
    return { render, get control() { return control; }, dispose: () => { for (const s of slots) s.cleanup?.(); } };
  }
  return { recovery, api, calls, bytes, mount, client,
    state: value => { state = value; }, readState: fn => { readState = fn; },
    receipt: value => { receipt = value; }, rejectReads: () => { readsFail = true; },
    write: fn => { write = fn; }, readBytes: fn => { byteRead = fn; },
    switchAccount: () => { epoch++; for (const fn of events.get("auth") ?? []) fn(); },
    dispose: () => client.clear(),
  };
}
const input = (kind = "files") => ({ key: "synthetic-original-request", base: 2, origin: "upload", ...kind === "package"
  ? { kind, file: new File(["synthetic not a real ZIP"], "synthetic.context.zip") }
  : { kind, members: { current: new File(["# Synthetic current\r\n"], "current.md") } } });

test("checking only submitted bytes confirms current content without rewriting the counterpart", async () => {
  const f = fixture();
  assert.deepEqual(await f.recovery.checkContinuationIntent("synthetic", input()), {
    state: "confirmed", result: { kind: "files", saved: { generation: 2, revision_id: "synthetic-r2" } },
  });
  assert.deepEqual(f.calls.reads, ["state", "revisions", "current", "state"]);
  assert.equal(f.calls.writes.length, 0);
});
test("same text with different newline or BOM is not an exact acknowledgement", async () => {
  for (const text of ["# Synthetic current\n", "\ufeff# Synthetic current\r\n"]) {
    const f = fixture(); f.bytes.current = new TextEncoder().encode(text);
    assert.deepEqual(await f.recovery.checkContinuationIntent("synthetic", input()), { state: "not_found" });
  }
});
test("another generation is a conflict, not permission to replace the base", async () => {
  const f = fixture(), intent = input(); f.bytes.current = new TextEncoder().encode("# Another save"); f.state({ generation: 3, adopted_revision_id: "synthetic-r3" });
  assert.deepEqual(await f.recovery.checkContinuationIntent("synthetic", intent), { state: "conflict" });
  assert.equal(intent.base, 2); assert.equal(f.calls.writes.length, 0);
});
test("state changing during byte reads remains unknown, even if bytes match", async () => {
  const f = fixture(); let count = 0;
  f.readState(async () => ({ generation: ++count === 1 ? 2 : 3, adopted_revision_id: "synthetic-r2" }));
  await assert.rejects(f.recovery.checkContinuationIntent("synthetic", input()), /changed during verification/);
});
test("missing current revision is not misrepresented as a successful empty save", async () => {
  const f = fixture(); f.api.revisions = async () => [];
  await assert.rejects(f.recovery.checkContinuationIntent("synthetic", input()), /changed during verification/);
});
test("a two-member check is serial, bounded and does not fetch historical revisions", async () => {
  const f = fixture(), intent = input(); intent.members.index = new File([f.bytes.index], "index.json");
  assert.equal((await f.recovery.checkContinuationIntent("synthetic", intent)).state, "confirmed");
  assert.deepEqual(f.calls.reads, ["state", "revisions", "current", "index", "state"]);
  intent.members.current = new File([new Uint8Array(1024 * 1024 + 1)], "current.md");
  await assert.rejects(f.recovery.checkContinuationIntent("synthetic", intent), /exceeds/);
});
test("terminal whole-package receipt is reused without reuploading or reading member bytes", async () => {
  const f = fixture(); f.receipt({ task_id: "synthetic-existing", status: "failed" });
  const result = await f.recovery.checkContinuationIntent("synthetic", input("package"));
  assert.deepEqual(result, { state: "confirmed", result: { kind: "package", task_id: "synthetic-existing" } });
  assert.equal(f.calls.writes.length, 0); assert.deepEqual(f.calls.reads, [{ id: "synthetic", key: "synthetic-original-request" }]);
});
for (const kind of ["files", "package"]) test(`${kind}: malformed success body remains unknown rather than confirmed`, async () => {
  const f = fixture(), mounted = f.mount(); f.write(async () => ({}));
  try {
    await mounted.control.submit(input(kind), async () => assert.fail("Malformed success"));
    assert.equal(mounted.render().receipt.phase, "unknown");
  } finally { mounted.dispose(); f.dispose(); }
});
test("malformed state cannot become a conflict or permission to retry", async () => {
  const f = fixture(); f.readState(async () => ({}));
  await assert.rejects(f.recovery.checkContinuationIntent("synthetic", input()), /state unavailable/);
});
for (const status of [400, 401, 403, 404, 409, 413, 422]) test(`${status} explicitly rejects a write; transport and 5xx are unknown`, () => {
  const f = fixture();
  assert.equal(f.recovery.rejectedContinuationWrite(new ApiRequestError("Synthetic", status)), true);
  for (const error of [Error("network"), SyntaxError("body"), new ApiRequestError("Synthetic", 408), new ApiRequestError("Synthetic", 503)]) {
    assert.equal(f.recovery.rejectedContinuationWrite(error), false);
  }
});
test("unknown whole-package admission survives closing, never automatically writes, and checks before same-key retry", async () => {
  const f = fixture(), first = f.mount(), intent = input("package");
  try {
    await first.control.submit(intent, async () => assert.fail("No acknowledgement received"));
    assert.equal(first.render().receipt.phase, "unknown"); first.dispose();
    const reopened = f.mount();
    assert.equal(reopened.control.receipt.intent.file, intent.file);
    await reopened.control.retry(); assert.equal(f.calls.writes.length, 1);
    await reopened.control.check(); reopened.render();
    assert.equal(reopened.control.receipt.notFound, true);
    assert.equal(f.calls.writes.length, 1);
    f.write(async () => ({ task_id: "synthetic-admitted" }));
    await reopened.control.retry();
    assert.equal(f.calls.writes.length, 2);
    assert.equal(f.calls.writes[1].form.get("idempotency_key"), intent.key);
    assert.equal(f.calls.writes[1].form.get("base_generation"), "2");
    assert.equal(f.calls.writes[1].form.get("file"), intent.file);
    assert.equal(f.calls.followups.length, 1);
    assert.equal(reopened.render().receipt, null); reopened.dispose();
  } finally { f.dispose(); }
});
test("a read failure retains the original intent without offering a blind replay", async () => {
  const f = fixture(), mounted = f.mount(), intent = input();
  try {
    await mounted.control.submit(intent, async () => {}); f.rejectReads();
    await mounted.control.check(); const control = mounted.render();
    assert.equal(control.checkFailed, true); assert.equal(control.receipt.phase, "unknown");
    assert.equal(control.receipt.notFound, undefined); assert.equal(control.receipt.intent, intent);
    await control.retry(); assert.equal(f.calls.writes.length, 1);
  } finally { mounted.dispose(); f.dispose(); }
});
test("read-only exact-byte confirmation invokes success once and never resubmits", async () => {
  const f = fixture(), mounted = f.mount(), accepted = [];
  try {
    await mounted.control.submit(input(), async result => accepted.push(result));
    await mounted.control.check();
    assert.equal(accepted.length, 1); assert.equal(f.calls.writes.length, 1);
    assert.equal(mounted.render().receipt, null);
  } finally { mounted.dispose(); f.dispose(); }
});
test("another window's newer save unlocks comparison without changing the original base", async () => {
  const f = fixture(), mounted = f.mount();
  try {
    await mounted.control.submit(input(), async () => {});
    f.bytes.current = new TextEncoder().encode("# Other"); f.state({ generation: 3, adopted_revision_id: "synthetic-r3" });
    await mounted.control.check(); const control = mounted.render();
    assert.equal(control.receipt.phase, "rejected"); assert.equal(control.receipt.error.code, "CONTEXT_BASE_CHANGED");
    assert.equal(control.receipt.intent.base, 2); assert.equal(control.locked, false);
    await control.retry(); assert.equal(f.calls.writes.length, 1);
  } finally { mounted.dispose(); f.dispose(); }
});
test("explicit write rejection is presented once in the receipt, not rethrown as a read or generic save failure", async () => {
  const f = fixture(), mounted = f.mount();
  f.write(async () => { throw new ApiRequestError("CONTEXT_MEMBER_INVALID", 422, "", "CONTEXT_MEMBER_INVALID"); });
  try {
    await mounted.control.submit(input(), async () => assert.fail("Rejected write cannot succeed"));
    assert.equal(mounted.render().receipt.phase, "rejected");
    assert.equal(mounted.control.locked, false);
    assert.equal(f.calls.writes.length, 1);
  } finally { mounted.dispose(); f.dispose(); }
});
test("acknowledged write remains confirmed when its follow-up rejects; refresh never writes", async () => {
  const f = fixture(), mounted = f.mount(); let fail = true, followups = 0;
  f.write(async () => ({ generation: 3, revision_id: "synthetic-r3" }));
  try {
    await mounted.control.submit(input(), async () => { followups++; if (fail) throw Error("Synthetic view unavailable"); });
    const control = mounted.render();
    assert.equal(control.receipt.phase, "confirmed"); assert.equal(control.followupFailed, true);
    fail = false; await control.refreshConfirmed();
    assert.equal(followups, 2); assert.equal(f.calls.writes.length, 1); assert.equal(mounted.render().receipt, null);
  } finally { mounted.dispose(); f.dispose(); }
});
test("in-flight admission blocks duplicate submit synchronously", async () => {
  const f = fixture(), mounted = f.mount(); let release;
  f.write(() => new Promise(resolve => { release = resolve; }));
  try {
    const pending = mounted.control.submit(input("package"), async () => {});
    await mounted.control.submit(input("package"), async () => {});
    assert.equal(f.calls.writes.length, 1);
    release({ task_id: "synthetic-admitted" }); await pending;
  } finally { mounted.dispose(); f.dispose(); }
});
test("a late old-account acknowledgement cannot repopulate the new account cache or callback", async () => {
  const f = fixture(), mounted = f.mount(); let release;
  f.write(() => new Promise(resolve => { release = resolve; }));
  try {
    const pending = mounted.control.submit(input("package"), async () => assert.fail("Retired success callback"));
    f.switchAccount(); release({ task_id: "synthetic-old" }); await pending;
    assert.equal(f.client.getQueryData(["continuation-write", 1, "synthetic-conversation"]), undefined);
    assert.equal(mounted.render().locked, true); assert.equal(f.calls.followups.length, 0);
  } finally { mounted.dispose(); f.dispose(); }
});
test("another conversation cannot inherit this intent", async () => {
  const f = fixture(), first = f.mount(), other = f.mount("synthetic-other");
  try {
    await first.control.submit(input("package"), async () => {});
    assert.equal(other.render().receipt, undefined); assert.equal(other.control.locked, false);
  } finally { first.dispose(); other.dispose(); f.dispose(); }
});
test("receipt arriving after unmount is consumed on re-entry, never a second upload", async () => {
  const f = fixture(), mounted = f.mount(); let release;
  f.write(() => new Promise(resolve => { release = resolve; }));
  try {
    const pending = mounted.control.submit(input("package"), async () => assert.fail("Unmounted callback"));
    mounted.dispose(); release({ task_id: "synthetic-background" }); await pending;
    const reopened = f.mount(); await setImmediate();
    assert.equal(reopened.render().receipt, null); assert.equal(f.calls.writes.length, 1); assert.equal(f.calls.followups.length, 1);
    reopened.dispose();
  } finally { f.dispose(); }
});

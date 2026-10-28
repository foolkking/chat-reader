import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/attachments/conversation-files-panel.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("conversation-files-panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ConversationFilesWorkspace");
const names = ["uploadFiles", "finalizeUploadedEntries", "finishPendingUploads", "cancelUpload", "retryUpload", "refreshAttachmentList"];
const functions = names.map(name => {
  const fn = component.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn, name); return fn.getText(ast);
}).join("\n");
const compiled = ts.transpileModule(`
  let uploadQueue = [], actionBusy = false, uploading = false, error = null, notice = null;
  const actionLock = { current: false }, uploadGeneration = { current: 0 }, uploadCancellable = { current: false };
  const activeUpload = { current: null }, mounted = { current: true };
  const setUploadQueue = value => { uploadQueue = typeof value === "function" ? value(uploadQueue) : value; };
  const setActionBusy = value => { actionBusy = value; }, setUploading = value => { uploading = value; };
  const setError = value => { error = value; }, setNotice = value => { notice = value; };
  ${functions}
  Object.assign(exports, { ${names.join(", ")} });
  exports.snapshot = () => ({ queue: uploadQueue, actionBusy, uploading, error, notice });
  exports.unmount = () => { mounted.current = false; uploadGeneration.current++; activeUpload.current?.cancel(); };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const file = name => ({ name });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

// Actual extracted queue callbacks; API/XHR, React setters and lifecycle are
// explicit adapters, not a browser network/permission acceptance.
function fixture() {
  const calls = { sessions: 0, uploaded: [], finalized: [], checked: [] }, api = {};
  let sequence = 0, generation = 1, finalize = async () => {}, upload, files = [], refreshError = false;
  let session = { id: "synthetic-session", status: "open", expires_at: "2098-01-01T00:00:00Z", items: [] };
  const bindings = {
    conversationId: "synthetic-a", zh: false, crypto: { randomUUID: () => `synthetic-entry-${++sequence}` },
    authenticationGeneration: () => generation,
    createAttachmentUploadSession: async () => { calls.sessions++; return { ...session, id: `synthetic-session-${calls.sessions}` }; },
    uploadAttachmentItem: (id, selected, progress) => {
      calls.uploaded.push({ session: id, file: selected }); progress(25);
      if (upload) return upload(id, selected);
      return { promise: Promise.resolve({ id: `synthetic-receipt-${calls.uploaded.length}`, validation_status: "ready" }), cancel() {} };
    },
    finalizeConversationAttachments: async (_conversation, ids) => { calls.finalized.push(ids); await finalize(ids); },
    getAttachmentUploadSession: async id => { calls.checked.push(id); return session; },
    filesQuery: { refetch: async () => ({ isError: refreshError, error: Error("synthetic refresh failed"), data: files }) },
  };
  new Function("exports", ...Object.keys(bindings), compiled)(api, ...Object.values(bindings));
  return { api, calls, upload(fn) { upload = fn; }, finalize(fn) { finalize = fn; },
    files(value) { files = value; }, session(value) { session = { ...session, ...value }; },
    failRefresh() { refreshError = true; }, retire() { generation++; api.unmount(); } };
}

test("a third-file failure retains the first receipts and retry uploads only that stable entry", async () => {
  const f = fixture(), files = [file("same.txt"), file("same.txt"), file("last.txt")];
  f.upload((_session, selected) => ({
    promise: selected === files[2] ? Promise.reject(Error("synthetic failed")) : Promise.resolve({ id: `receipt-${f.calls.uploaded.length}`, validation_status: "ready" }), cancel() {},
  }));
  await f.api.uploadFiles(files);
  const entries = f.api.snapshot().queue;
  assert.equal(new Set(entries.map(entry => entry.id)).size, 3);
  assert.deepEqual(entries.map(entry => entry.status), ["committed", "committed", "failed"]);
  assert.deepEqual(f.calls.finalized, [["receipt-1", "receipt-2"]]);
  f.upload(); f.api.retryUpload(entries[2]); await setImmediate();
  assert.equal(f.calls.uploaded.length, 4);
  assert.equal(f.calls.uploaded.at(-1).file, files[2]);
  assert.equal(f.api.snapshot().queue[2].id, entries[2].id);
  assert.equal(f.api.snapshot().queue[2].status, "committed");
});

test("cancel aborts the current item without finalizing earlier receipts, which remain explicitly actionable", async () => {
  const f = fixture(), waiting = deferred(), files = [file("accepted.txt"), file("pending.txt"), file("queued.txt")];
  let cancelled = 0;
  f.upload((_id, selected) => selected === files[0]
    ? { promise: Promise.resolve({ id: "synthetic-accepted", validation_status: "ready" }), cancel() {} }
    : { promise: waiting.promise, cancel() { cancelled++; waiting.reject(new DOMException("Cancelled", "AbortError")); } });
  const work = f.api.uploadFiles(files);
  await setImmediate(); f.api.cancelUpload(); await work;
  assert.equal(cancelled, 1); assert.equal(f.calls.finalized.length, 0);
  assert.deepEqual(f.api.snapshot().queue.map(entry => entry.status), ["uploaded", "cancelled", "cancelled"]);
  assert.equal(f.api.snapshot().actionBusy, false);
  await f.api.finishPendingUploads();
  assert.deepEqual(f.calls.finalized, [["synthetic-accepted"]]);
  assert.equal(f.calls.uploaded.length, 2);
});

test("unknown finalization is checked before retry and accepted receipts are never uploaded again", async () => {
  const f = fixture();
  f.finalize(async () => { throw Error("synthetic timeout"); });
  await f.api.uploadFiles([file("unknown.txt")]);
  const entry = f.api.snapshot().queue[0];
  assert.equal(entry.status, "unknown");
  f.api.retryUpload(entry); await f.api.finishPendingUploads();
  assert.equal(f.calls.uploaded.length, 1); assert.equal(f.calls.finalized.length, 1);
  f.files([{ source_attachment_id: entry.uploadItemId }]);
  await f.api.refreshAttachmentList();
  assert.equal(f.api.snapshot().queue[0].status, "committed");
  assert.deepEqual(f.calls.checked, []);
});

test("an uncommitted ready receipt returns to explicit confirmation; an expired session returns to new-session retry", async () => {
  for (const expired of [false, true]) {
    const f = fixture(); f.finalize(async () => { throw Error("synthetic unknown"); });
    await f.api.uploadFiles([file("check.txt")]);
    const entry = f.api.snapshot().queue[0];
    f.session({ status: expired ? "expired" : "open", items: [{ id: entry.uploadItemId, validation_status: "ready" }] });
    await f.api.refreshAttachmentList();
    assert.equal(f.calls.checked.length, 1);
    assert.equal(f.api.snapshot().queue[0].status, expired ? "failed" : "uploaded");
    assert.equal(f.calls.finalized.length, 1);
    f.finalize(async () => {});
    if (expired) { f.api.retryUpload(f.api.snapshot().queue[0]); await setImmediate(); assert.equal(f.calls.sessions, 2); }
    else { await f.api.finishPendingUploads(); assert.equal(f.calls.uploaded.length, 1); }
  }
});

test("confirmed finalization plus a failed list refresh is not reported as an unknown write", async () => {
  const f = fixture(); f.failRefresh();
  await f.api.uploadFiles([file("confirmed.txt")]);
  assert.equal(f.api.snapshot().queue[0].status, "committed");
  assert.match(f.api.snapshot().error, /were added.*could not refresh/);
});

test("a committed upload receipt remains accepted even if its attachment was detached before checking", async () => {
  const f = fixture(); f.finalize(async () => { throw Error("synthetic timeout"); });
  await f.api.uploadFiles([file("already-accepted.txt")]);
  const entry = f.api.snapshot().queue[0];
  f.session({ status: "committed", items: [{ id: entry.uploadItemId, validation_status: "committed" }] });
  await f.api.refreshAttachmentList();
  assert.equal(f.api.snapshot().queue[0].status, "committed");
  assert.equal(f.calls.uploaded.length, 1); assert.equal(f.calls.finalized.length, 1);
});

test("retiring a workspace blocks late upload receipt/finalization publication", async () => {
  const f = fixture(), waiting = deferred();
  f.upload(() => ({ promise: waiting.promise, cancel() {} }));
  const work = f.api.uploadFiles([file("late.txt")]); await setImmediate(); f.retire();
  waiting.resolve({ id: "synthetic-late-receipt", validation_status: "ready" }); await work;
  assert.equal(f.calls.finalized.length, 0);
  assert.equal(f.api.snapshot().queue[0].status, "uploading");
});

test("queue capacity rejects the whole overlarge selection instead of silently dropping files", async () => {
  const f = fixture(); await f.api.uploadFiles(Array.from({ length: 101 }, () => file("synthetic.txt")));
  assert.equal(f.calls.sessions, 0); assert.equal(f.api.snapshot().queue.length, 0);
  assert.match(f.api.snapshot().error, /100 files/);
});

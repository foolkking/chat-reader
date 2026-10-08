import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { clearTimeout, setTimeout } from "node:timers";
import { URL } from "node:url";
import { TextEncoder } from "node:util";
import vm from "node:vm";

const { Request, Response, AbortController } = globalThis;
const origin = "https://synthetic.chat-reader.test";
const optional = "/skills/context-acquisition.zip";
const script = "/_next/static/chunks/synthetic.js";
const stylesheet = "/_next/static/css/synthetic.css";
const searchWorker = "/library/_next/static/chunks/search.js";
const assets = [script, stylesheet, searchWorker, optional];
const record = {
  revision: "synthetic-revision-001",
  cacheName: "chat-reader-library-shell-synthetic-revision-001",
  assets: ["/library", ...assets],
  criticalAssets: [script, stylesheet, searchWorker],
  workerUrl: searchWorker,
  resourceCount: assets.length + 1,
  preparedAt: "2026-10-08T00:00:00.000Z",
};

// Execute the shipped worker with an in-memory Cache Storage double. These
// checks are not browser acceptance; the negative Playwright gate owns that.
async function workerFixture() {
  const stores = new Map();
  const fetched = [];
  const failures = new Set();
  const key = (value) => new URL(typeof value === "string" ? value : value.url, origin).href;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        match: async (request) => entries.get(key(request))?.clone(),
        put: async (request, response) => { entries.set(key(request), response.clone()); },
        delete: async (request) => entries.delete(key(request)),
      };
    },
  };
  const context = vm.createContext({
    self: { location: new URL(origin), addEventListener() {}, setTimeout, clearTimeout },
    caches, URL, Request, Response, AbortController,
    fetch: async (request) => {
      const pathname = new URL(request.url).pathname;
      fetched.push(pathname);
      return new Response(`synthetic:${pathname}`, {
        status: failures.has(pathname) ? 503 : 200,
        headers: { "Content-Type": pathname === "/library" ? "text/html" : "application/octet-stream" },
      });
    },
  });
  vm.runInContext(readFileSync(new URL("../../apps/web/public/library-sw.js", import.meta.url), "utf8"), context);
  const shell = await caches.open(record.cacheName);
  for (const asset of record.assets) await shell.put(asset, new Response(`original:${asset}`));
  const metadata = await caches.open("chat-reader-library-meta-v1");
  await metadata.put("/__chat_reader_library_active__", Response.json(record));
  const untouched = await caches.open("chat-reader-offline-assets-v1--other-account");
  await untouched.put("/untouched", new Response("other-account"));
  return {
    shell, metadata, untouched, fetched, failures,
    status: () => context.inspectActiveShell(),
    prepare: async () => {
      const messages = [];
      await context.prepareLibraryShell({ ...record, assets }, { postMessage: (value) => messages.push(value) });
      return messages.at(-1);
    },
  };
}

test("complete same-revision shells do not fetch or replace existing bytes", async () => {
  const fixture = await workerFixture();
  assert.equal((await fixture.prepare()).status.ready, true);
  assert.deepEqual(fixture.fetched, []);
  assert.equal(await (await fixture.shell.match(script)).text(), `original:${script}`);
});

test("same-revision optional misses are repaired without refetching the complete shell", async () => {
  const fixture = await workerFixture();
  await fixture.shell.delete(optional);
  const before = await fixture.status();
  assert.equal(before.ready, true, "an optional miss must not block offline reading");
  assert.deepEqual(Array.from(before.missing), [optional]);
  const result = await fixture.prepare();
  assert.equal(result.ok, true);
  assert.equal(result.status.ready, true);
  assert.deepEqual(Array.from(result.status.missing), []);
  assert.deepEqual(fixture.fetched, [optional]);
  assert.equal(await (await fixture.shell.match(script)).text(), `original:${script}`);
  assert.deepEqual(await (await fixture.metadata.match("/__chat_reader_library_active__")).json(), record);
});

test("failed same-revision repair preserves the active shell, other account and explicit retry", async () => {
  const fixture = await workerFixture();
  await fixture.shell.delete(optional);
  fixture.failures.add(optional);
  assert.equal((await fixture.prepare()).ok, false);
  assert.equal((await fixture.status()).ready, true);
  assert.equal(await (await fixture.shell.match(script)).text(), `original:${script}`);
  assert.equal(await (await fixture.untouched.match("/untouched")).text(), "other-account");
  assert.deepEqual(await (await fixture.metadata.match("/__chat_reader_library_active__")).json(), record);
  fixture.failures.clear();
  const retried = await fixture.prepare();
  assert.equal(retried.ok, true);
  assert.deepEqual(Array.from(retried.status.missing), []);
  assert.deepEqual(fixture.fetched, [optional, optional]);
});

test("same-revision critical and navigation misses are repaired without discarding the old record", async () => {
  const fixture = await workerFixture();
  for (const asset of [script, "/library"]) await fixture.shell.delete(asset);
  assert.equal((await fixture.status()).ready, false);
  const result = await fixture.prepare();
  assert.equal(result.status.ready, true);
  assert.deepEqual(Array.from(result.status.missing), []);
  assert.deepEqual([...fixture.fetched].sort(), [script, "/library"].sort());
  assert.deepEqual(await (await fixture.metadata.match("/__chat_reader_library_active__")).json(), record);
});

function clientFixture() {
  const webRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
  const ts = webRequire("typescript");
  const source = ts.transpileModule(readFileSync(new URL("../../apps/web/lib/offline-shell.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sent = [];
  const pdfWorker = "/_next/static/media/synthetic-pdf-worker.mjs";
  class ScriptElement { src = `${origin}${script}`; }
  class Channel {
    port1 = { close() {}, onmessage: null };
    port2 = { postMessage: (data) => this.port1.onmessage?.({ data }) };
  }
  const exports = {};
  const context = vm.createContext({
    exports, URL, TextEncoder, crypto: webcrypto, MessageChannel: Channel, HTMLScriptElement: ScriptElement,
    window: { location: { origin, pathname: "/library" }, setTimeout, clearTimeout },
    document: { querySelectorAll: () => [new ScriptElement(), { href: `${origin}${stylesheet}` }], styleSheets: [] },
    performance: { getEntriesByType: () => [] },
    require: (name) => {
      if (name === "./offline-search") return { getOfflineSearchRuntime: async () => ({ workerUrl: searchWorker, assets: [searchWorker] }) };
      if (name === "../features/attachments/pdfjs-runtime") return { loadPdfJs: async () => {}, getPdfJsWorkerUrl: () => pdfWorker };
      if (["./offline-db", "./offline-access", "react-zoom-pan-pinch"].includes(name)) return {};
      throw new Error(`Unexpected synthetic dependency: ${name}`);
    },
  });
  vm.runInContext(`${source}\nexports.probe = { collectLibraryShellAssets, createRevision, reconcileOfflineShell };`, context);
  return {
    sent,
    reconcile: async (missing) => {
      const revision = await exports.probe.createRevision(exports.probe.collectLibraryShellAssets([pdfWorker, searchWorker]));
      const status = { ready: true, revision, resourceCount: 10, missing };
      const worker = { postMessage: (message, ports) => {
        sent.push(message);
        ports[0].postMessage({ type: "RESULT", ok: true, status: { ...status, missing: [] } });
      } };
      return exports.probe.reconcileOfflineShell(worker, { type: "RESULT", ok: true, status });
    },
  };
}

test("client reconciliation requests same-revision optional repair while keeping reading available", async () => {
  const fixture = clientFixture();
  const result = await fixture.reconcile([optional]);
  assert.equal(result.availability, "ready");
  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.sent[0].type, "PREPARE_LIBRARY_SHELL");
  assert.deepEqual(Array.from(result.missing), []);
});

test("client reconciliation retains the no-request fast path for a complete same revision", async () => {
  const fixture = clientFixture();
  assert.equal((await fixture.reconcile([])).availability, "ready");
  assert.deepEqual(fixture.sent, []);
});

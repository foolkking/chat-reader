import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePath = new URL("../../apps/web/features/offline/library-shell.tsx", import.meta.url);
const source = await readFile(sourcePath, "utf8");

function between(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("local library read has an independent finite state", () => {
  assert.match(source, /type OfflineLibraryReadState = \{/);
  assert.match(source, /phase: "loading" \| "ready" \| "error"/);
  assert.match(source, /refreshing: boolean/);
  assert.match(source, /refreshError: boolean/);
  assert.match(source, /phase: "loading",\s*refreshing: true,\s*refreshError: false/);
});

test("successful conversation/message read commits ready before optional search reads", () => {
  const reload = between("const reloadLocal = useCallback", "  const retryLocalRead");
  assert.match(reload, /if \(!libraryMountedRef\.current\) return Promise\.resolve\(\);/);
  assert.match(reload, /const fallback = await offlineDb\.conversations\.toArray\(\)/);
  assert.match(reload, /const localMessages = await offlineDb\.messages\.toArray\(\)/);
  assert.match(reload, /localListCommitted = true/);
  assert.match(reload, /phase: "ready", refreshing: false, refreshError: false/);
  assert.ok(reload.indexOf("localListCommitted = true") < reload.indexOf("offlineDb.searchDocuments.toArray()"));
});

test("initial local read failure is not presented as an empty library", () => {
  const render = between("const readerContent =", "  return (");
  assert.match(render, /\) : !localReadReady \? \(/);
  assert.match(render, /Unable to read offline library/);
  assert.match(render, /Retry read/);
  const emptyGuard = source.indexOf('!sidebarConversations.length && !query');
  assert.notEqual(emptyGuard, -1);
  assert.ok(source.lastIndexOf('localRead.phase === "ready"', emptyGuard) < emptyGuard);
});

test("refresh failure retains the last readable local list and offers a local retry", () => {
  const reload = between("const reloadLocal = useCallback", "  const retryLocalRead");
  assert.match(reload, /localListCommitted \|\| hadVisibleLocalRead/);
  assert.match(reload, /phase: "ready", refreshing: false, refreshError: true/);
  assert.match(source, /Local refresh failed; showing the last successfully read copies/);
  assert.match(source, /onRetryLocalRead={retryLocalRead}/);
});

test("search waits for the local conversation read but keeps catalog download deep links usable", () => {
  const sidebar = between("function LibrarySidebar", "function OfflineShellIndicator");
  assert.match(sidebar, /localRead\.phase !== "ready"/);
  const reader = between("const readerContent =", "  return (");
  assert.ok(reader.indexOf("requestedCatalogConversation ?") < reader.indexOf("!localReadReady ?"));
});

test("retry only reopens the existing local reload path", () => {
  const retry = between("const retryLocalRead", "  useEffect(() => {\n    if (selectedId");
  assert.match(retry, /if \(localReadRef\.current\.refreshing\) return;/);
  assert.match(retry, /void reloadLocal\(\)\.catch\(\(\) => undefined\)/);
  assert.doesNotMatch(retry, /enqueueOfflineDownload|retryOfflineDownload|router\./);
});

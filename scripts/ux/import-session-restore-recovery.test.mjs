import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../apps/web/features/import/import-panel.tsx", import.meta.url),
  "utf8",
);

function between(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("saved import-session restore has an independent finite state and retry generation", () => {
  assert.match(source, /type ImportSessionRestoreState = \{/);
  assert.match(source, /phase: "idle" \| "loading" \| "error"/);
  assert.match(source, /const \[sessionRestore, setSessionRestore\]/);
  assert.match(source, /const \[sessionRestoreRetry, setSessionRestoreRetry\] = useState\(0\)/);
  assert.match(source, /\[current, initialProjectId, rememberImport, resumeImportId, session, sessionRestoreRetry\]/);
  const remember = between("  const rememberImport = useCallback", "  useEffect(() => {\n    setStopUnconfirmed");
  assert.match(remember, /\[activeSessionKey, current\]/);
  assert.match(source, /sessionRestore\.phase === "loading"/);
});

test("transient restore failure retains the local pointer and publishes a retryable error", () => {
  const restoreEffect = between("useEffect(() => {\n    let active = true;", "  const finishCommittedImport");
  assert.match(restoreEffect, /setSessionRestore\(\{ phase: "loading", error: null \}\)/);
  assert.match(restoreEffect, /\.catch\(\(error: unknown\) => \{/);
  assert.match(restoreEffect, /setSessionRestore\(\{ phase: "error", error \}\)/);
  assert.doesNotMatch(restoreEffect.split(".catch((error: unknown) => {")[1]?.split("return () =>")[0] ?? "",
    /rememberImport\(null\)|sessionStorage\.removeItem/);
  assert.match(source, /onRetry=\{\(\) => \{ setSessionRestore\(\{ phase: "loading", error: null \}\); setSessionRestoreRetry/);
});

test("only completed/cancelled state or explicit new-file selection clears the pointer; failed analysis stays recoverable", () => {
  const restoreEffect = between("useEffect(() => {\n    let active = true;", "  const finishCommittedImport");
  assert.match(restoreEffect, /if \(\["COMPLETED", "CANCELED"\]\.includes\(restored\.state\)\)/);
  assert.doesNotMatch(restoreEffect, /"FAILED"/);
  assert.match(restoreEffect, /rememberImport\(null\)/);
  const chooseFiles = between("  function chooseFiles", "  function handleDrop");
  assert.match(chooseFiles, /rememberImport\(null\)/);
  assert.match(chooseFiles, /reset\(nextMode\)/);
  const remember = between("  const rememberImport = useCallback", "  useEffect(() => {\n    setStopUnconfirmed");
  assert.match(remember, /if \(!current\(\)\) return/);
  assert.match(remember, /setSavedImportId\(importId\)/);
  assert.match(remember, /else window\.sessionStorage\.removeItem\(activeSessionKey\)/);
  assert.match(remember, /catch \{/);
});

test("restore feedback is status-only and blocks competing import submission while loading", () => {
  assert.match(source, /正在恢复已保存的导入会话…/);
  assert.match(source, /role="status"/);
  assert.match(source, /<ErrorLine message=\{sessionRestore\.error\}/);
  assert.match(source, /busy = sessionRestore\.phase === "loading"/);
  assert.doesNotMatch(source, /sessionRestore\.phase === "error"[\s\S]{0,250}retryTask/);
});

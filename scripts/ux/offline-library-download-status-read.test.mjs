import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const source = await readFile(
  new URL("../../apps/web/features/offline/library-shell.tsx", import.meta.url),
  "utf8",
);
const ts = createRequire(new URL("../../apps/web/package.json", import.meta.url))("typescript");
const ast = ts.createSourceFile("library-shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function downloadEffect() {
  const owner = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "LibraryShell");
  const effect = owner?.body.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(ast) === "useEffect" && node.getText(ast).includes("listOfflineDownloads()"));
  assert.ok(effect, "download subscription effect must exist");
  return effect.getText(ast);
}

function between(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("download status has an independent subscription error and retry generation", () => {
  assert.match(source, /const \[downloadStatusError, setDownloadStatusError\] = useState\(false\)/);
  assert.match(source, /const \[downloadStatusRetry, setDownloadStatusRetry\] = useState\(0\)/);
  assert.match(source, /\[downloadStatusRetry, reloadLocal, zh\]/);
  assert.match(source, /downloadStatusError=\{downloadStatusError\}/);
  assert.match(source, /onRetryDownloadStatus=\{\(\) => setDownloadStatusRetry/);
});

test("subscription failure clears unverifiable progress and persisted failure projection", () => {
  const effect = downloadEffect();
  assert.match(effect, /error: \(\) => \{/);
  assert.match(effect, /setDownloadStatusError\(true\)/);
  assert.match(effect, /setDownload\(null\)/);
  assert.match(effect, /setDownloadFailure\(null\)/);
  assert.doesNotMatch(effect, /setError\(/);
});

test("successful emissions recover the status error and preserve existing record handling", () => {
  const effect = downloadEffect();
  assert.match(effect, /next: \(records\) => \{/);
  assert.match(effect, /setDownloadStatusError\(false\)/);
  assert.match(effect, /listOfflineDownloads\(\)/);
  assert.match(effect, /reloadLocal\(\)/);
});

test("status recovery copy states uncertainty instead of claiming cancellation", () => {
  const sidebar = between("function LibrarySidebar", "function OfflineShellIndicator");
  assert.match(sidebar, /A download may still be running; retry the status read/);
  assert.match(sidebar, /Retry status read/);
  assert.match(sidebar, /role="alert"/);
});

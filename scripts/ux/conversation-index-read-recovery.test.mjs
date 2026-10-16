import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../../apps/web/features/toc/conversation-index.tsx", import.meta.url), "utf8");

test("conversation index reports interactive page-read failures with a local alert and retry", () => {
  assert.match(source, /const \[pageError, setPageError\] = useState<PageReadIntent \| null>\(null\)/);
  assert.match(source, /role="alert"/);
  assert.match(source, /t\("indexFailed"\)/);
  assert.match(source, /t\("retry"\)/);
  assert.match(source, /retryPageRead\(\)/);
});

test("conversation index retry preserves the failed jump or page request", () => {
  assert.match(source, /type PageReadIntent/);
  assert.match(source, /setPageError\(intent\)/);
  assert.match(source, /await readIndexPage\(pageError\)/);
  assert.match(source, /loader\(\{ offset: intent\.offset, limit: intent\.limit \}\)/);
});

test("conversation index keeps navigation separate from loader error recovery", () => {
  assert.match(source, /setRemotePage\(page\);/);
  assert.match(source, /if \(intent\.kind === "jump"\)/);
  assert.match(source, /onNavigate\?\.\(toIndexItem\(target\)\)/);
  const loaderFailureBlock = source.match(/catch \{([\s\S]*?)\}\s*finally/);
  assert.ok(loaderFailureBlock);
  assert.doesNotMatch(loaderFailureBlock[1], /onNavigate/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../../apps/web/features/toc/conversation-toc.tsx", import.meta.url), "utf8");

test("conversation TOC distinguishes stale refresh failure from initial empty failure", () => {
  assert.match(source, /const staleReadError = items === undefined && tocQuery\.isError && visibleItems\.length > 0/);
  assert.match(source, /tocQuery\.isError && visibleItems\.length === 0/);
  assert.match(source, /Showing the previous entries/);
  assert.match(source, /仍显示上次内容/);
  assert.match(source, /role="alert"/);
});

test("conversation TOC retries the failed page without restarting successful pages", () => {
  assert.match(source, /tocQuery\.isFetchNextPageError \? tocQuery\.fetchNextPage\(\) : tocQuery\.refetch\(\)/);
  assert.match(source, /disabled=\{tocQuery\.isFetching\}/);
  assert.match(source, /t\("retry"\)/);
  assert.match(source, /onNavigate=\{stableNavigate\}/);
});

test("conversation TOC retains canonical pagination and never substitutes old cached items for a successful empty response", () => {
  assert.match(source, /useInfiniteQuery/);
  assert.match(source, /offset: pageParam, limit: 200/);
  assert.match(source, /lastPage\.has_more \? lastPage\.offset \+ lastPage\.limit : undefined/);
  assert.match(source, /if \(items !== undefined \|\| tocQuery\.isSuccess\) return currentApiItems/);
  assert.doesNotMatch(source, /placeholderData/);
});

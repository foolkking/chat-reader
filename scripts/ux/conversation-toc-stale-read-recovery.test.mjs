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

test("conversation TOC offers a query-only retry for stale content", () => {
  assert.match(source, /onClick=\{\(\) => void tocQuery\.refetch\(\)\}/);
  assert.match(source, /disabled=\{tocQuery\.isFetching\}/);
  assert.match(source, /t\("retry"\)/);
  assert.match(source, /onNavigate=\{stableNavigate\}/);
});

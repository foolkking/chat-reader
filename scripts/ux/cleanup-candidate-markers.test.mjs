import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript");
const React = appRequire("react");
const { renderToStaticMarkup } = appRequire("react-dom/server");
const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const path = new URL(`../../apps/web/features/conversations/${name}`, import.meta.url);
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(specifier =>
    specifier === "./cleanup-range-selection" ? load("cleanup-range-selection.ts") : appRequire(specifier),
  module, module.exports);
  modules.set(name, module.exports);
  return module.exports;
}
const { CleanupCandidate } = load("cleanup-candidate.tsx");
const range = (start_offset, end_offset) => ({ start_offset, end_offset });
const item = {
  id: "synthetic-candidate", decision: "DELETE", stale: false, evidence_codes: [],
  start_offset: 7, end_offset: 15, match_text: "🙂A KEEPZ",
  context_before: "Before ", context_after: " after.", line_start: 1,
  role: "assistant", detector_id: "synthetic-detector", conversation_title: "Synthetic source",
  edit_token: "synthetic-state-digest", reviewed_ranges: [range(7, 9), range(14, 15)],
};
function render(changes = {}, props = {}) {
  return renderToStaticMarkup(React.createElement(CleanupCandidate, {
    item: { ...item, ...changes }, zh: false, reason: "Possible noise", selected: true,
    disabled: false, busy: false, showConversation: true,
    onDecision: () => {}, onIntent: () => {}, ...props,
  }));
}
function checkbox(html) {
  return html.match(/<input\b[^>]*type="checkbox"[^>]*>/)?.[0] ?? assert.fail("No native checkbox");
}
function summary(html) {
  const found = html.match(/<(span|mark)\b[^>]*data-testid="content-cleanup-match"[^>]*>([\s\S]*?)<\/\1>/);
  assert.ok(found, "The stable summary locator must retain the original match text");
  return { tag: found[1], inner: found[2], markup: found[0] };
}
function description(html) {
  const id = checkbox(html).match(/aria-describedby="([^"]+)"/)?.[1];
  assert.ok(id);
  const found = html.match(new RegExp(`<p id="${id}"[^>]*>([^<]+)</p>`));
  assert.ok(found, "The checkbox description must point to visible state text");
  return found[1];
}
function removalTexts(markup) {
  return [...markup.matchAll(/<mark\b[^>]*data-cleanup-candidate-removal="\d+"[^>]*>([^<]*)<\/mark>/g)].map(match => match[1]);
}

test("actual candidate markup marks only refined removals and preserves the entire summary text", () => {
  const html = render();
  const match = summary(html);
  assert.equal(match.tag, "span");
  assert.deepEqual(removalTexts(match.markup), ["🙂A", "Z"]);
  assert.match(match.inner, /<\/mark> KEEP<mark/);
  assert.equal(match.inner.replace(/<[^>]+>/g, ""), item.match_text);
  assert.match(checkbox(html), /\bchecked=""/);
  assert.match(checkbox(html), /aria-label="Process 🙂A KEEPZ"/);
  assert.equal(description(html), "Marked for deletion · 2 adjusted ranges");
  assert.match(match.markup, /line-through/);
});

test("legacy whole-candidate selection remains one highlighted removal", () => {
  const html = render({ reviewed_ranges: null });
  const match = summary(html);
  assert.equal(match.tag, "mark");
  assert.deepEqual(removalTexts(match.markup), [item.match_text]);
  assert.match(match.markup, /bg-\[var\(--mark-bg\)\]/);
  assert.match(match.markup, /line-through/);
  assert.equal(description(html), "Marked for deletion");
});

test("unselected refined candidates keep the original suggestion highlight without deletion styling", () => {
  const html = render({ decision: "KEEP" }, { selected: false });
  const match = summary(html);
  assert.equal(match.tag, "mark");
  assert.match(match.markup, /bg-\[var\(--mark-bg\)\]/);
  assert.equal(match.inner, item.match_text);
  assert.doesNotMatch(match.markup, /line-through|data-cleanup-candidate-removal/);
  assert.doesNotMatch(checkbox(html), /\bchecked=/);
  assert.doesNotMatch(html.match(/<article[^>]*>/)[0], /accent-soft/);
  assert.equal(description(html), "Kept");
});

test("unusable refinements show plain source and recovery instead of a guessed whole deletion", () => {
  for (const reviewed_ranges of [[], [range(0, 15)], [range(7, 11), range(10, 14)], [null]]) {
    const html = render({ reviewed_ranges });
    const match = summary(html);
    assert.equal(match.tag, "span");
    assert.equal(match.inner, item.match_text);
    assert.doesNotMatch(match.markup, /<mark|line-through/);
    assert.equal(description(html), "Ranges cannot be previewed; adjust or rescan");
    assert.doesNotMatch(checkbox(html), /\bdisabled=/, "Keeping or adjusting remains available");
  }
});

test("protected, stale, conflicting and applied candidates cannot inherit checked or saving state", () => {
  for (const [changes, en, zh] of [
    [{ decision: "PROTECTED" }, "Protected; will not be changed", "受保护，不会处理"],
    [{ evidence_codes: ["PROTECTED_RANGE"] }, "Protected; will not be changed", "受保护，不会处理"],
    [{ stale: true }, "Rescan required; source retained", "需重新扫描，原文已保留"],
    [{ decision: "CONFLICT" }, "Rescan required; source retained", "需重新扫描，原文已保留"],
    [{ decision: "APPLIED" }, "Completed; will not be applied again", "已完成，不会重复处理"],
    [{ decision: "APPLIED", stale: true }, "Completed; will not be applied again", "已完成，不会重复处理"],
  ]) {
    for (const locale of [false, true]) {
      const html = render(changes, { selected: true, selectionSaving: true, zh: locale });
      assert.equal(description(html), locale ? zh : en);
      assert.match(checkbox(html), /\bdisabled=""/);
      assert.doesNotMatch(checkbox(html), /\bchecked=/);
      assert.match(checkbox(html), /aria-busy="false"/);
      assert.doesNotMatch(summary(html).markup, /line-through|data-cleanup-candidate-removal/);
      assert.doesNotMatch(html.match(/<article[^>]*>/)[0], /accent-soft/);
      if (changes.decision === "APPLIED") assert.doesNotMatch(html, /rescan to continue|请重新扫描/);
    }
  }
});

test("eligible pending choices keep their proposed checked state and explicit busy description", () => {
  const selected = render({}, { selectionSaving: true });
  assert.match(checkbox(selected), /\bchecked=""/);
  assert.match(checkbox(selected), /aria-busy="true"/);
  assert.equal(description(selected), "Saving choice…");
  assert.deepEqual(removalTexts(summary(selected).markup), ["🙂A", "Z"]);
  const kept = render({}, { selected: false, selectionSaving: true });
  assert.doesNotMatch(checkbox(kept), /\bchecked=/);
  assert.match(checkbox(kept), /aria-busy="true"/);
  assert.equal(description(kept), "Saving choice…");
  assert.doesNotMatch(summary(kept).markup, /line-through|data-cleanup-candidate-removal/);
});

test("split markers remain React-escaped text, not HTML execution", () => {
  const source = '<img src=x onerror="bad()"> & <script>bad()</script>';
  const html = render({ start_offset: 0, end_offset: source.length, match_text: source, reviewed_ranges: [range(0, 5)] });
  assert.doesNotMatch(html, /<img\b|<script\b/);
  assert.match(summary(html).markup, /&lt;img /);
  assert.match(summary(html).markup, /&lt;script&gt;/);
});

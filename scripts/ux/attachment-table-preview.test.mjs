import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript"), policy = {};
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
new Function("exports", compile(readFileSync(new URL("../../apps/web/features/attachments/attachment-table-policy.ts", import.meta.url), "utf8")))(policy);
const { parseDelimitedPreview: parse, TABLE_PREVIEW_LIMITS: limits } = policy;
const csv = (rows, columns) => Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, col) => `r${row}c${col}`).join(",")).join("\n");

test("CSV/TSV preserve BOM, CRLF, quoted delimiters, escaped quotes and multiline values", () => {
  assert.deepEqual(parse('\ufeffname,notes\r\nAlice,"has, comma"\r\nBob,"two ""quotes""\nnext line"', ","), {
    rows: [["name", "notes"], ["Alice", "has, comma"], ["Bob", 'two "quotes"\nnext line']], columns: 2, stoppedAt: null,
  });
  assert.deepEqual(parse('a\tb\n"x\ty"\tz', "\t").rows, [["a", "b"], ["x\ty", "z"]]);
});
test("empty, quoted-empty and trailing empty fields remain distinct", () => {
  assert.deepEqual(parse("", ",").rows, []); assert.deepEqual(parse('""', ",").rows, [[""]]);
  assert.deepEqual(parse("a,b,\n1,,", ",").rows, [["a", "b", ""], ["1", "", ""]]);
  assert.deepEqual(parse("a\n\n", ",").rows, [["a"], [""]]);
});
test("257-column header stays the header; later short data is not promoted", () => {
  const result = parse(`${csv(1, 257)}\nshort,value`, ",");
  assert.equal(result.stoppedAt, "columns"); assert.equal(result.rows.length, 1); assert.equal(result.columns, 256);
  assert.equal(result.rows[0][0], "r0c0"); assert.equal(result.rows[0][255], "r0c255");
});
test("a wide data row keeps its leading fields and order before stopping", () => {
  const result = parse(`true,header\n${csv(1, 257)}\nshort,value`, ",");
  assert.equal(result.rows.length, 2); assert.deepEqual(result.rows[0], ["true", "header"]); assert.equal(result.rows[1][0], "r0c0");
  assert.equal(result.stoppedAt, "columns");
});
test("exact row/column/field boundaries do not claim truncation", () => {
  for (const content of [csv(2, 256), "a".repeat(limits.fieldUnits), Array(limits.rows).fill("x").join("\n")]) {
    assert.equal(parse(content, ",").stoppedAt, null); assert.equal(parse(content + "\n", ",").stoppedAt, null);
  }
});
test("row budget preserves the ordered prefix and exposes the stop", () => {
  const result = parse(Array.from({ length: limits.rows + 1 }, (_, i) => `row${i}`).join("\n"), ",");
  assert.equal(result.stoppedAt, "rows"); assert.equal(result.rows.length, limits.rows); assert.equal(result.rows.at(-1)[0], `row${limits.rows - 1}`);
});
test("total cell budget bounds retained cells even for wide rows", () => {
  const result = parse(csv(200, 256), ",");
  assert.equal(result.stoppedAt, "cells"); assert.equal(result.rows.flat().length, limits.cells);
  assert.equal(result.rows.at(-1)[0], "r195c0"); assert.equal(result.rows.at(-1).at(-1), "r195c79");
});
test("long fields retain a marked prefix instead of allocating the entire field", () => {
  const result = parse("heading\n" + "x".repeat(66_560) + "\nlater", ",");
  assert.equal(result.stoppedAt, "field"); assert.equal(result.rows[1][0].length, limits.fieldUnits); assert.equal(result.rows.length, 2);
});
test("field truncation never cuts a surrogate pair in half", () => {
  const result = parse("x".repeat(limits.fieldUnits - 1) + "😀end", ",");
  assert.equal(result.rows[0][0], "x".repeat(limits.fieldUnits - 1)); assert.equal(result.stoppedAt, "field");
  assert.equal(parse("x".repeat(limits.fieldUnits - 2) + "😀", ",").stoppedAt, null);
});
test("input budget bounds scanning when each individual field is valid", () => {
  const result = parse(Array(600).fill("x".repeat(limits.fieldUnits)).join("\n"), ",");
  assert.equal(result.stoppedAt, "input"); assert.ok(result.rows.flat().reduce((sum, cell) => sum + cell.length, 0) <= limits.inputUnits);
});
test("unclosed quotes are explicit and preserve the actual first row", () => {
  assert.deepEqual(parse('head,notes\na,"unfinished\nsecond', ","), { rows: [["head", "notes"], ["a", "unfinished\nsecond"]], columns: 2, stoppedAt: "quotes" });
});
test("page size stays below both row and cell budgets for every supported width", () => {
  for (let columns = 1; columns <= 256; columns++) { const size = policy.tablePreviewPageSize(columns); assert.ok(size <= limits.pageRows); assert.ok(size * columns <= limits.pageCells); }
});

// Actual viewer function with explicit React hook/element doubles; no DOM,
// visual, CPU, or RSS measurement is claimed.
const source = ts.createSourceFile("viewer.tsx", readFileSync(new URL("../../apps/web/features/attachments/attachment-viewer.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "DelimitedTableViewer");
assert.ok(fn);
const nodes = root => !root || typeof root !== "object" ? [] : Array.isArray(root) ? root.flatMap(nodes) : [root, ...nodes(root.props?.children)];
const text = root => root == null || typeof root === "boolean" ? "" : typeof root !== "object" ? String(root) : Array.isArray(root) ? root.map(text).join("") : text(root.props?.children);
function viewer(content) {
  let page = 0, sourceClicks = 0;
  const scope = { ...policy, usePreferences: () => ({ resolvedLocale: "en-US" }), useMemo: fn => fn(), useEffect: () => {}, useRef: () => ({ current: { scrollTop: 10 } }),
    useState: () => [page, value => { page = value; }] };
  const component = new Function("require", "exports", ...Object.keys(scope), compile(fn.getText(source)) + "\nreturn DelimitedTableViewer;")(appRequire, {}, ...Object.values(scope));
  const render = () => component({ text: content, delimiter: ",", onSource: () => sourceClicks++ });
  const button = (tree, label) => { const result = nodes(tree).find(node => node.type === "button" && text(node) === label); assert.ok(result, label); return result.props; };
  return { render, button, get sourceClicks() { return sourceClicks; } };
}
test("100×64 table renders only one bounded page, with continuous row numbers and reversible navigation", () => {
  const f = viewer(csv(101, 64)); let tree = f.render();
  assert.equal(nodes(tree).filter(node => node.type === "td").length, 31 * 64);
  assert.ok(text(tree).includes("Rows 1–31 of 100")); assert.equal(f.button(tree, "Previous page").disabled, true);
  f.button(tree, "Next page").onClick(); tree = f.render(); assert.ok(text(tree).includes("Rows 32–62 of 100"));
  assert.equal(text(nodes(tree).find(node => node.type === "td")), "r32c0");
  f.button(tree, "Next page").onClick(); f.button(f.render(), "Next page").onClick(); tree = f.render();
  assert.ok(text(tree).includes("Rows 94–100 of 100")); assert.equal(f.button(tree, "Next page").disabled, true);
  f.button(tree, "Previous page").onClick(); assert.ok(text(f.render()).includes("Rows 63–93 of 100"));
});
test("truncated header shows an explicit warning and a working source action, never an empty-file claim", () => {
  const f = viewer(`${csv(1, 257)}\nshort,value`), tree = f.render();
  assert.ok(text(tree).includes("Column limit reached")); assert.ok(text(tree).includes("r0c0")); assert.equal(text(tree).includes("short"), false);
  f.button(tree, "View source").onClick(); assert.equal(f.sourceClicks, 1);
});

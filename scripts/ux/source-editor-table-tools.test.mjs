import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import Module from "node:module";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const sourcePath = new URL("../../apps/web/features/editing/markdown-table-tools.ts", import.meta.url);
const source = readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(sourcePath.pathname);
loaded.filename = sourcePath.pathname;
loaded.paths = Module._nodeModulePaths(new URL("../../apps/web", import.meta.url).pathname);
loaded._compile(compiled, loaded.filename);
const { applyMarkdownTableAction, inspectMarkdownTable } = loaded.exports;

test("normalizes ragged tables without changing content outside the explicit table range", () => {
  const source = "intro\r\n| A | B |\r\n| --- |\r\n| x\\|y |\r\n| z | q | r |\r\noutro";
  const tableStart = source.indexOf("| A");
  const result = applyMarkdownTableAction(source, tableStart, tableStart, { type: "normalize" });
  assert.ok(result);
  assert.equal(source.slice(0, result.from), "intro\r\n");
  assert.equal(source.slice(result.to), "\r\noutro");
  assert.match(result.insert, /^\| A \| B \|  \|\r\n/);
  assert.match(result.insert, /x\\\|y/);
  assert.match(result.insert, /\| z \| q \| r \|/);
});

test("recognizes a table from a cursor and refuses code-fenced examples", () => {
  const body = "before\n| A | B |\n| --- | --- |\n| 1 | 2 |\nafter";
  const cursor = body.indexOf("| ---") + 2;
  const model = inspectMarkdownTable(body, cursor, cursor);
  assert.ok(model);
  assert.equal(model.headers.length, 2);
  assert.equal(model.rows.length, 1);
  const code = "```md\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```";
  const codeCursor = code.indexOf("| A");
  assert.equal(inspectMarkdownTable(code, codeCursor, codeCursor), null);
});

test("creates blank tables and inserts rows and columns as one replacement", () => {
  const blank = applyMarkdownTableAction("tail", 0, 0, { type: "create", columns: 2, rows: 2 });
  assert.equal(blank?.insert, "|  |  |\n| --- | --- |\n|  |  |\n|  |  |\n\n");
  const selectedSource = "keep selected text";
  const selected = applyMarkdownTableAction(selectedSource, 5, 13, { type: "create", columns: 1, rows: 1 });
  assert.equal(selected?.to, 5);
  assert.ok((selectedSource.slice(0, selected.from) + selected.insert + selectedSource.slice(selected.to)).includes("selected text"));
  const initial = "| A | B |\n| --- | --- |\n| 1 | 2 |";
  const position = initial.indexOf("1");
  const row = applyMarkdownTableAction(initial, position, position, { type: "add-row", position: "after", count: 1 });
  assert.equal(row?.insert, "| A | B |\n| --- | --- |\n| 1 | 2 |\n|  |  |");
  const column = applyMarkdownTableAction(initial, position, position, { type: "add-column", position: "after", count: 1 });
  assert.equal(column?.insert, "| A |  | B |\n| --- | :--- | --- |\n| 1 |  | 2 |");
});

test("rejects oversized or non-table fragments without truncating", () => {
  assert.ok(inspectMarkdownTable("| A | B |\n| --- | --- |\n| x | y |", 0, 0));
  assert.equal(inspectMarkdownTable("<table><tr><td colspan=\"2\">a</td></tr></table>", 12, 12), null);
  const tooLarge = `| A | B |\n| --- | --- |\n| ${"x".repeat(1_048_600)} | y |`;
  assert.equal(inspectMarkdownTable(tooLarge, 0, 0), null);
  assert.equal(inspectMarkdownTable("ordinary prose with | a symbol", 0, 0), null);
});

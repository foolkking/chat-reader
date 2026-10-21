import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import Module from "node:module";
import { Worker } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyseTableSource } from "./markdown-table-source-fixture.mjs";

const requireFrom = new URL("../../apps/web/package.json", import.meta.url).href;
const require = createRequire(requireFrom);
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { markdownLanguage } = require("@codemirror/lang-markdown");
const { default: ReactMarkdown } = await import(pathToFileURL(require.resolve("react-markdown")).href);
const { default: remarkGfm } = await import(pathToFileURL(require.resolve("remark-gfm")).href);
const sourcePath = new URL("../../apps/web/features/editing/markdown-table-tools.ts", import.meta.url);
const source = readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(fileURLToPath(sourcePath));
loaded.filename = fileURLToPath(sourcePath);
loaded.paths = Module._nodeModulePaths(fileURLToPath(new URL("../../apps/web", import.meta.url)));
loaded._compile(compiled + "\nexports.bracketReader = createTableBracketKindReader; exports.codeSpanReader = createTableCodeSpanReader;", loaded.filename);
const { applyMarkdownTableAction, inspectMarkdownTable, inspectMarkdownTableDraft, isMarkdownTableCellValueValid, updateSimpleMarkdownTableDraft } = loaded.exports;

// A small-input reference for the previous lookahead semantics. Never run this
// quadratic reference on the large malformed-input regression below.
function legacyBracketKind(text, start, parent) {
  if (parent === "alt" || parent === "reference") return parent;
  const precededByMark = !escaped(text, start - 1);
  const image = precededByMark && text[start - 1] === "!";
  if (!image && text[start + 1] === "^") return "reference";
  if (precededByMark && text[start - 1] === "]") return "reference";
  if (parent && !image) return parent;
  let depth = 1, backticks = 0;
  for (let index = start + 1; index < text.length; index++) {
    if (text[index] === "\\") { index++; continue; }
    if (text[index] === "`") {
      let end = index + 1;
      while (text[end] === "`") end++;
      const length = end - index;
      if (!backticks) backticks = length;
      else if (backticks === length) backticks = 0;
      index = end - 1;
      continue;
    }
    if (backticks) continue;
    if (text[index] === "[") depth++;
    if (text[index] === "]" && --depth === 0) {
      if (text[index + 1] === "[" && text[index + 2] === "]") return "reference";
      if (text[index + 1] === "(" || text[index + 1] === "[") return image ? "alt" : "caption";
      return image ? "reference" : "ambiguous";
    }
  }
  return "ambiguous";
}
function escaped(text, index) {
  let count = 0;
  while (index > 0 && text[--index] === "\\") count++;
  return count % 2 === 1;
}

test("indexed code-span matching agrees with an independent forward scan, including escaped run suffixes", () => {
  const cases = ["`unpaired", "`a\\`b`", "\\``a`", "``a`b``", "\\```a``", "`a```b`"];
  const tokens = ["a", " ", "\\", "\\\\", "`", "``", "```", "````", "|", "\\|"];
  let seed = 0x17e42a;
  for (let sample = 0; sample < 600; sample++) {
    let text = "";
    for (let token = 0; token < 40; token++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      text += tokens[seed % tokens.length];
    }
    cases.push(text);
  }
  for (const text of cases) {
    const read = loaded.exports.codeSpanReader(text);
    for (let start = 0; start < text.length;) {
      if (text[start] !== "`") { start++; continue; }
      let end = start + 1;
      while (text[end] === "`") end++;
      for (const opening of end - start > 1 ? [start, start + 1] : [start]) {
        const length = end - opening;
        let expected = false;
        for (let index = end; index < text.length;) {
          if (text[index] !== "`") { index++; continue; }
          let closingEnd = index + 1;
          while (text[closingEnd] === "`") closingEnd++;
          if (closingEnd - index === length) { expected = true; break; }
          index = closingEnd;
        }
        assert.equal(read(opening), expected, JSON.stringify({ text, opening }));
      }
      start = end;
    }
  }
});

test("many distinct unpaired backtick runs stay bounded and preserve the entire cell", async () => {
  const worker = new Worker(`
    const {parentPort,workerData}=require("node:worker_threads");
    const appRequire=require("node:module").createRequire(workerData.requireFrom);
    const api={};new Function("require","exports",workerData.compiled)(appRequire,api);
    const value=Array.from({length:1_000},(_,index)=>"\`".repeat(index+1)+"x").join(" ");
    const source="| H |\\n| --- |\\n| "+value+" |";
    const model=api.inspectMarkdownTableDraft(source);
    parentPort.postMessage({
      valid:api.isMarkdownTableCellValueValid(value),
      fullCell:model?.rows[0][0].value===value,
      exactNormalization:api.applyMarkdownTableAction(source,0,0,{type:"normalize"})?.insert===source
    });
  `, { eval: true, workerData: { compiled, requireFrom } });
  try {
    const result = await new Promise((resolve, reject) => {
      let received = false;
      // Anti-hang isolation, not a browser/device latency guarantee.
      const timer = setTimeout(() => reject(Error("Backtick run indexing exceeded the anti-hang watchdog")), 10_000);
      worker.once("message", value => { received = true; clearTimeout(timer); resolve(value); });
      worker.once("error", error => { clearTimeout(timer); reject(error); });
      worker.once("exit", code => {
        clearTimeout(timer);
        if (!received) reject(Error(`Backtick validation worker exited ${code} without a result`));
      });
    });
    assert.deepEqual(result, { valid: true, fullCell: true, exactNormalization: true });
  } finally {
    await worker.terminate();
  }
});

test("indexed bracket classification retains independent code/escape and reference semantics", () => {
  const cases = [
    "[caption](path)", "![alt](path)", "[reference][]", "[caption][key]",
    String.raw`\(\text{a` + "`" + String.raw`b}\) [caption](path)`,
    String.raw`[caption](path) \(\text{a` + "`" + String.raw`b}\) ![alt](path)`,
    "![`[]` ![inner](path)](outer)", "[`` ` [ ] ``](path)",
    String.raw`[a \] \[ ![b](path)](outer)`, "![".repeat(100),
  ];
  const tokens = ["[", "]", "![", "a", "\\", "\\[", "\\]", "`", "``", "```", "](", "][", "[]", "|", "\\(", "\\)", "$", " "];
  let seed = 0x3c1d25;
  for (let sample = 0; sample < 800; sample++) {
    let text = "";
    for (let token = 0; token < 50; token++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      text += tokens[seed % tokens.length];
    }
    cases.push(text);
  }
  for (const text of cases) {
    const read = loaded.exports.bracketReader(text);
    for (let start = 0; start < text.length; start++) {
      if (text[start] !== "[" || escaped(text, start)) continue;
      for (const parent of [undefined, "alt", "reference", "caption", "ambiguous"]) {
        assert.equal(read(start, parent), legacyBracketKind(text, start, parent), JSON.stringify({ text, start, parent }));
      }
    }
  }
});

test("deep balanced image markup is not rejected by an arbitrary nesting cutoff", () => {
  const value = "![".repeat(6_000) + "value" + "](https://example.test)".repeat(6_000);
  const source = `| H |\n| --- |\n| ${value} |`;
  assert.equal(isMarkdownTableCellValueValid(value), true);
  const model = inspectMarkdownTableDraft(source);
  assert.equal(model?.rows[0][0].value, value);
  assert.equal(applyMarkdownTableAction(source, 0, 0, { type: "normalize" })?.insert, source);
});

test("large unclosed image nesting finishes in an isolated worker without freezing the test process", async () => {
  const worker = new Worker(`
    const {parentPort,workerData}=require("node:worker_threads");
    const appRequire=require("node:module").createRequire(workerData.requireFrom);
    const api={};new Function("require","exports",workerData.compiled)(appRequire,api);
    const value="![".repeat(120_000);
    const serialized=api.renderMarkdownTable([{value:"H",raw:""}],[[{value:value+"|tail",raw:""}]],[]);
    parentPort.postMessage({
      valid:api.isMarkdownTableCellValueValid(value),
      serializationPreserved:serialized==="| H |\\n| --- |\\n| "+value+"|tail |"
    });
  `, { eval: true, workerData: { compiled, requireFrom } });
  try {
    const result = await new Promise((resolve, reject) => {
      let received = false;
      // Anti-hang watchdog, not a per-device latency or performance SLA.
      const timer = setTimeout(() => reject(Error("Table inline validation did not finish within the anti-hang watchdog")), 10_000);
      worker.once("message", value => { received = true; clearTimeout(timer); resolve(value); });
      worker.once("error", error => { clearTimeout(timer); reject(error); });
      worker.once("exit", code => {
        clearTimeout(timer);
        if (!received) reject(Error(`Table validation worker exited ${code} without a result`));
      });
    });
    assert.deepEqual(result, { valid: false, serializationPreserved: true });
  } finally {
    await worker.terminate();
  }
});

test("single-cell validation preserves accepted inline syntax without scanning a whole table", () => {
  for (const value of [
    "", "plain text", "escaped | pipe", String.raw`\(|x|\)`, String.raw`$20 | $30`,
    "`code | span`", "`unclosed", "[link](https://example.test/a|b)", String.raw`\(\left|x\right|\)`,
  ]) assert.equal(isMarkdownTableCellValueValid(value), true, value);
  for (const value of [
    String.raw`\(unfinished`, "[unclosed", String.raw`\(\text{bad | x}\)`,
    "line\nbreak", "line\rbreak", "![".repeat(600_000),
  ]) assert.equal(isMarkdownTableCellValueValid(value), false, value);
});

test("HTML table examples in code, escaped text and attribute prose stay editable Markdown cells", () => {
  for (const value of [
    '`<td colspan="2">`', "`` `<tr>` ``", "`</table>`", String.raw`\<th rowspan="2">`,
    'colspan="2" and rowspan="3"', "&lt;td colspan=2&gt;",
    '![<td>](https://example.test/image)', "[caption][<td>]",
  ]) {
    const table = `| Example | Value |\n| --- | --- |\n| ${value} | kept |`;
    const html = renderToStaticMarkup(React.createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm], skipHtml: true, children: table,
    }));
    assert.equal((html.match(/<table>/g) ?? []).length, 1, value);
    assert.equal((html.match(/<td>/g) ?? []).length, 2, value);
    assert.equal(isMarkdownTableCellValueValid(value), true, value);
    assert.equal(inspectMarkdownTableDraft(table)?.rows[0][0].value, value, value);
    assert.equal(applyMarkdownTableAction(table, 0, 0, { type: "normalize" })?.insert, table, value);
  }
});

test("actual HTML table structure is declined consistently in whole tables and grid cells", () => {
  for (const value of [
    "<table>", "</TABLE>", "<thead>", "<tbody>", "<tr>", '<td colspan="2">x</td>',
    '<th rowspan="2">x</th>', "<tfoot>", "<caption>", "<colgroup>", "<col>",
    // In actual Markdown the backslash is code content, not a backtick escape.
    "`\\`<td>`", "`unclosed <td>", "``unclosed <table>",
  ]) {
    const table = `| Example | Value |\n| --- | --- |\n| ${value} | kept |`;
    assert.equal(inspectMarkdownTableDraft(table), null, value);
    assert.equal(isMarkdownTableCellValueValid(value), false, value);
  }
});

test("normalization preserves GFM rendering for escaped pipes around code-span backslashes", () => {
  const slash = String.fromCharCode(92);
  const cases = [
    "`code " + slash + "| pipe`",
    "``code " + slash + "` still " + slash + "| pipe``",
    "``code" + slash + "`` outside " + slash + "| pipe",
    "`left ` inner " + slash + "| right`",
    slash + "`left " + slash + "| right``",
    "`left " + slash + "` inner " + slash + "| right`",
  ];
  const render = markdown => renderToStaticMarkup(React.createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm], skipHtml: true, children: markdown,
  }));

  for (const value of cases) {
    const source = `| A | B |\n| --- | --- |\n| ${value} | tail |`;
    const before = render(source);
    assert.equal((before.match(/<table>/g) ?? []).length, 1, value);
    assert.equal((before.match(/<th>/g) ?? []).length, 2, value);
    assert.equal((before.match(/<td>/g) ?? []).length, 2, value);
    assert.equal(inspectMarkdownTableDraft(source)?.rows[0].length, 2, value);

    const result = applyMarkdownTableAction(source, 0, 0, { type: "normalize" });
    assert.ok(result, value);
    assert.equal(render(result.insert), before, value);
    assert.equal(
      applyMarkdownTableAction(result.insert, 0, 0, { type: "normalize" })?.insert,
      result.insert,
      value,
    );
  }
});

test("unmatched backticks remain literal without swallowing columns or hiding table structure", () => {
  const source = "| A | B |\n| --- | --- |\n| `left | right | tail |";
  const model = inspectMarkdownTableDraft(source);
  assert.ok(model);
  assert.deepEqual(model.rows[0].map(cell => cell.value), ["`left", "right", "tail"]);
  assert.equal(applyMarkdownTableAction(source, 0, 0, { type: "normalize" })?.insert,
    "| A | B |  |\n| --- | --- | --- |\n| `left | right | tail |");
  for (const value of ["`unclosed <td>", "``unclosed <table>", "`unclosed " + String.raw`\(unfinished`]) {
    assert.equal(isMarkdownTableCellValueValid(value), false, value);
    assert.equal(inspectMarkdownTableDraft(`| A | B |\n| --- | --- |\n| ${value} | tail |`), null, value);
  }
  const math = "| A | B |\n| --- | --- |\n| `literal " + String.raw`\(|x|\)` + " | tail |";
  assert.equal(applyMarkdownTableAction(math, 0, 0, { type: "normalize" })?.insert,
    "| A | B |\n| --- | --- |\n| `literal " + String.raw`\(\vert x\vert \)` + " | tail |");
});

test("HTML-looking whitespace and repeated angles remain bounded literal cell text", async () => {
  const worker = new Worker(`
    const {parentPort,workerData}=require("node:worker_threads");
    const appRequire=require("node:module").createRequire(workerData.requireFrom);
    const api={};new Function("require","exports",workerData.compiled)(appRequire,api);
    const value="<"+" ".repeat(150_000)+"ordinary text"+" <".repeat(25_000);
    const table="| Example |\\n| --- |\\n| "+value+" |";
    const model=api.inspectMarkdownTableDraft(table);
    parentPort.postMessage({
      exactValue:model?.rows[0][0].value===value,
      exactTable:api.applyMarkdownTableAction(table,0,0,{type:"normalize"})?.insert===table
    });
  `, { eval: true, workerData: { compiled, requireFrom } });
  try {
    const result = await new Promise((resolve, reject) => {
      let received = false;
      // Isolation/watchdog protects the test process, not a latency or RAM SLA.
      const timer = setTimeout(() => reject(Error("HTML-looking cell exceeded the anti-hang watchdog")), 10_000);
      worker.once("message", value => { received = true; clearTimeout(timer); resolve(value); });
      worker.once("error", error => { clearTimeout(timer); reject(error); });
      worker.once("exit", code => {
        clearTimeout(timer);
        if (!received) reject(Error(`HTML-looking cell worker exited ${code} without a result`));
      });
    });
    assert.deepEqual(result, { exactValue: true, exactTable: true });
  } finally {
    await worker.terminate();
  }
});

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

test("quoted and list fenced examples require an explicit table selection", () => {
  for (const prefix of ["> ", "  ", "- "]) {
    const continued = prefix === "- " ? "  " : prefix;
    const table = `${continued}| A | B |\n${continued}| --- | --- |\n${continued}| 1 | 2 |`;
    const source = `${prefix}\`\`\`md\n${table}\n${continued}\`\`\``;
    const cursor = source.indexOf("| A");
    assert.equal(inspectMarkdownTable(source, cursor, cursor), null, prefix);
    const start = source.indexOf("\n") + 1;
    assert.ok(inspectMarkdownTable(source, start, start + table.length), prefix);
  }
  const source = "```md\n```not-a-closer\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```";
  const cursor = source.indexOf("| A");
  assert.equal(inspectMarkdownTable(source, cursor, cursor), null);
});

test("code protection follows quote/list container boundaries rather than fence-looking text", () => {
  const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
  const quoted = table.split("\n").map(line => "> " + line).join("\n");
  const cases = [
    { source: "> ```md\n> sample\n\n" + table, recognized: true },
    { source: "```md\n> ```\n" + table + "\n```", recognized: false },
    { source: "```md\n- ```\n" + table + "\n```", recognized: false },
    { source: "> ```md\n> > ```\n" + quoted + "\n> ```", recognized: false },
    { source: "- ```md\n  sample\n\n" + table, recognized: true },
    { source: "- item\n  ```md\n  sample\n\n" + table, recognized: true },
    { source: "```md\n    ```\n" + table + "\n```", recognized: false },
    { source: "    " + table.replaceAll("\n", "\n    "), recognized: false },
    { source: "- item\n\n    " + table.replaceAll("\n", "\n    "), recognized: true },
  ];
  for (const { source, recognized } of cases) {
    for (const value of [source, source.replaceAll("\n", "\r\n")]) {
      const cursor = value.indexOf("| A");
      assert.equal(Boolean(inspectMarkdownTable(value, cursor, cursor)), recognized, value);
      const start = value.lastIndexOf("\n", cursor - 1) + 1;
      const tableEnd = value.indexOf("| 1 | 2 |") + "| 1 | 2 |".length;
      assert.ok(inspectMarkdownTable(value, start, tableEnd), "explicit selection: " + value);
    }
  }
});

test("raw HTML literal blocks are not automatically treated as rendered tables", () => {
  const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
  const cases = [
    ["div", "<div>", "", "</div>"],
    ["details", "<details>", "", "</details>"],
    ["pre", "<pre>", "", "</pre>"],
    ["script", "<script>", "", "</script>"],
    ["style", "<style>", "", "</style>"],
    ["textarea", "<textarea>", "", "</textarea>"],
    ["comment", "<!--", "", "-->"],
    ["CDATA", "<![CDATA[", "", "]]>"],
    ["processing instruction", "<?instruction", "", "?>"],
    ["declaration", "<!DECLARATION", "", ">"],
    ["quoted HTML", "> <div>", "> ", "> </div>"],
    ["list HTML", "- <div>", "  ", "  </div>"],
  ];
  for (const [name, before, prefix, after] of cases) {
    for (const newline of ["\n", "\r\n"]) {
      const body = table.split("\n").map(line => prefix + line).join(newline);
      const source = before + newline + body + newline + after;
      const cursor = source.indexOf("| A") + 2;
      const tree = markdownLanguage.parser.parse(source);
      const html = renderToStaticMarkup(React.createElement(ReactMarkdown, {
        remarkPlugins: [remarkGfm], skipHtml: true, children: source,
      }));
      assert.equal(html.includes("<table>"), false, name + " must actually be raw HTML");
      for (const context of [
        undefined,
        { source, parsedTo: source.length, tree },
        { source: table, parsedTo: source.length, tree },
        { source, parsedTo: 0, tree },
        { source, parsedTo: source.length, tree: markdownLanguage.parser.parse(table) },
      ]) {
        assert.equal(inspectMarkdownTable(source, cursor, cursor, context), null, name);
        assert.equal(applyMarkdownTableAction(source, cursor, cursor, { type: "normalize" }, context), null, name);
      }
      // Explicit sample editing remains available, without deleting its wrapper
      // or pretending normalization makes the whole document render a table.
      const from = before.length + newline.length;
      const to = from + body.length;
      const explicit = applyMarkdownTableAction(source, from, to, { type: "normalize" });
      assert.ok(explicit, "explicit " + name);
      assert.equal(source.slice(0, explicit.from) + explicit.insert + source.slice(explicit.to), source);
    }
  }
});

test("HTML boundaries do not block real tables after blank lines, inline tags or exited containers", () => {
  const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
  const cases = [
    "<div>\n\n" + table + "\n\n</div>",
    "<div>hidden</div>\n\n" + table,
    "<!-- hidden -->\n" + table,
    "<?instruction ?>\n" + table,
    "<![CDATA[ hidden ]]>\n" + table,
    "<pre>hidden</pre>\n" + table,
    "text <span>caption</span>\n\n" + table,
    "> <div>\n" + table,
    "- <div>\n\n" + table,
    "> <div>\n>\n" + table.split("\n").map(line => "> " + line).join("\n") + "\n> </div>",
  ];
  for (const input of cases) {
    for (const source of [input, input.replaceAll("\n", "\r\n")]) {
      const html = renderToStaticMarkup(React.createElement(ReactMarkdown, {
        remarkPlugins: [remarkGfm], skipHtml: true, children: source,
      }));
      assert.equal((html.match(/<table>/g) ?? []).length, 1, source);
      const cursor = source.indexOf("| A");
      // HTML requires a source-bound renderer proof: an editor Paragraph or
      // HTMLBlock alone cannot decide this automatically anymore.
      assert.equal(inspectMarkdownTable(source, cursor, cursor), null);
      const rendered = analyseTableSource(source);
      assert.equal(rendered.complete, true);
      for (const context of [
        { source, rendered },
        { source, rendered, parsedTo: source.length, tree: markdownLanguage.parser.parse(source) },
      ]) {
        assert.ok(inspectMarkdownTable(source, cursor, cursor, context), source);
        const result = applyMarkdownTableAction(source, cursor, cursor, { type: "normalize" }, context);
        assert.ok(result, source);
        assert.equal(source.slice(0, result.from) + result.insert + source.slice(result.to), source);
      }
    }
  }
});

test("renderer proof preserves CRLF source coordinates without trusting a raw editor HTML tree", () => {
  const table = "| A | B |\r\n| --- | --- |\r\n| 1 | 2 |";
  const prefix = "🙂 intro\r\n\r\n<div>\r\n\r\n";
  const source = prefix + table + "\r\n\r\n</div>";
  const cursor = source.indexOf("| A");
  const rawTree = markdownLanguage.parser.parse(source);
  let staleReads = 0;
  const context = {
    source, rendered: analyseTableSource(source), parsedTo: source.length,
    tree: { length: rawTree.length, resolve(...args) { staleReads++; return rawTree.resolve(...args); } },
  };
  const parser = markdownLanguage.parser;
  const original = parser.parse;
  const inputs = [];
  parser.parse = function (input, ...args) {
    inputs.push(input);
    return original.call(this, input, ...args);
  };
  try {
    const model = inspectMarkdownTable(source, cursor, cursor, context);
    assert.ok(model);
    assert.equal(model.start, prefix.length);
    assert.equal(model.end, prefix.length + table.length);
    assert.equal(model.newline, "\r\n");
    const result = applyMarkdownTableAction(source, cursor, cursor, { type: "normalize" }, context);
    assert.ok(result);
    assert.equal(source.slice(0, result.from) + result.insert + source.slice(result.to), source);
  } finally {
    parser.parse = original;
  }
  assert.deepEqual(inputs, [], "a complete renderer proof needs no second editor context parse");
  assert.equal(staleReads, 0, "a raw-CRLF syntax tree cannot override the normalized parser context");
});

test("textarea across blank lines remains literal, while closing tags and container exits restore real tables", () => {
  const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
  for (const input of [
    "<textarea>\n\n" + table + "\n</textarea>",
    "> <textarea>\n>\n" + table.split("\n").map(line => "> " + line).join("\n") + "\n> </textarea>",
    "- <textarea>\n\n" + table.split("\n").map(line => "  " + line).join("\n") + "\n  </textarea>",
  ]) {
    for (const source of [input, input.replaceAll("\n", "\r\n")]) {
      const rendered = analyseTableSource(source), cursor = source.indexOf("| A");
      assert.equal(rendered.complete, true);
      for (const context of [undefined, { source, rendered }]) {
        assert.equal(inspectMarkdownTable(source, cursor, cursor, context), null, source);
        assert.equal(applyMarkdownTableAction(source, cursor, cursor, { type: "normalize" }, context), null, source);
      }
    }
  }
  for (const before of ["<textarea>\n\nsample\n</textarea>\n", "> <textarea>\n>\n", "- <textarea>\n\n"]) {
    const source = before + table;
    const cursor = source.indexOf("| A");
    const result = applyMarkdownTableAction(source, cursor, cursor, { type: "normalize" }, { source, rendered: analyseTableSource(source) });
    assert.ok(result, source);
    assert.equal(source.slice(0, result.from) + result.insert + source.slice(result.to), source);
  }
});

test("HTML authorization rejects stale, incomplete and absent renderer proof", () => {
  const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
  const source = "<textarea>\n\n" + table + "\n</textarea>", cursor = source.indexOf("| A");
  const outside = "<div>\n\n" + table;
  const safeProof = analyseTableSource(outside);
  for (const context of [
    undefined,
    { source, rendered: safeProof },
    { source: outside, rendered: { ...safeProof, source } },
    { source, rendered: { ...safeProof, source, complete: false } },
    { source, parsedTo: source.length, tree: markdownLanguage.parser.parse(source) },
  ]) {
    assert.equal(inspectMarkdownTable(source, cursor, cursor, context), null);
    assert.equal(applyMarkdownTableAction(source, cursor, cursor, { type: "normalize" }, context), null);
  }
});

test("code protection matches installed GFM on bounded quote/list and LF/CRLF contexts", () => {
  const lines = [
    "plain prose", "", "> quoted prose", "> > nested prose", "```md", "```",
    "````", "~~~md", "~~~", "~~~~", "```not-a-closer", "```invalid`info",
    "> ```md", "> ```", "> > ~~~", "> - ```md", "> - ```", "  3. ```md",
    "  ```", "\t~~~", "  - not a fence", "text ```", "``` trailing ",
  ];
  let seed = 0x5713ad;
  for (let sample = 0; sample < 500; sample++) {
    let source = "";
    for (let line = 0; line < 10; line++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      source += lines[seed % lines.length] + (seed & 1 ? "\n" : "\r\n");
    }
    source += "| H |\n| --- |\n| data |";
    const offset = source.indexOf("| H");
    const html = renderToStaticMarkup(React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], children: source }));
    const code = Array.from(html.matchAll(/<pre><code\b[^>]*>([\s\S]*?)<\/code><\/pre>/g))
      .some(match => match[1].includes("| H |"));
    assert.equal(inspectMarkdownTable(source, offset, offset) === null, code, source);
  }
});

test("a complete source-bound editor tree is reused for discovery and application", () => {
  const source = "intro\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter";
  const tree = markdownLanguage.parser.parse(source);
  let reads = 0;
  const context = {
    source, parsedTo: source.length,
    tree: { length: tree.length, resolve(...args) { reads++; return tree.resolve(...args); } },
  };
  const cursor = source.indexOf("| A");
  assert.ok(inspectMarkdownTable(source, cursor, cursor, context));
  assert.equal(reads, 1);
  assert.ok(applyMarkdownTableAction(source, cursor, cursor, { type: "normalize" }, context));
  assert.equal(reads, 2);
});

test("standalone context parsing stops at the table header instead of parsing the body and suffix", () => {
  const source = "intro\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n" + "unrelated paragraph\n\n".repeat(40_000);
  const cursor = source.indexOf("| A");
  const parser = markdownLanguage.parser;
  const original = parser.parse;
  const sizes = [];
  parser.parse = function (input, ...args) {
    sizes.push(input.length);
    return original.call(this, input, ...args);
  };
  try {
    assert.ok(inspectMarkdownTable(source, cursor, cursor));
    assert.ok(applyMarkdownTableAction(source, cursor, cursor, { type: "normalize" }));
  } finally {
    parser.parse = original;
  }
  assert.deepEqual(sizes, [source.indexOf("\n", cursor), source.indexOf("\n", cursor)]);
});

test("stale or incomplete editor context cannot authorize a code sample", () => {
  const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
  const source = "```md\n> ```\n" + table + "\n```";
  const tree = markdownLanguage.parser.parse(table);
  let reads = 0;
  const suppliedTree = { length: source.length, resolve(...args) { reads++; return tree.resolve(...args); } };
  const cursor = source.indexOf("| A");
  for (const context of [
    { source: table, parsedTo: source.length, tree: suppliedTree },
    { source, parsedTo: 0, tree: suppliedTree },
    { source, parsedTo: source.length, tree },
  ]) {
    assert.equal(inspectMarkdownTable(source, cursor, cursor, context), null);
    assert.equal(applyMarkdownTableAction(source, cursor, cursor, { type: "normalize" }, context), null);
  }
  assert.equal(reads, 0);
});

test("code-fence scan does not backtrack on deeply quoted ordinary prose", async () => {
  const quote = "> ".repeat(6_000);
  const table = "| H |\n| --- |\n| data |";
  const cases = [
    { source: quote + "ordinary prose\n" + table, expected: true },
    { source: quote + "ordinary prose\r\n" + table.replaceAll("\n", "\r\n"), expected: true },
    { source: quote + "```md\n" + table, expected: true },
    { source: quote + "```md\n" + table.split("\n").map(line => quote + line).join("\n"), expected: false },
    { source: quote + "```md\nsample\n" + quote + "```\n" + quote + "ordinary prose\n" + table, expected: true },
  ];
  const worker = new Worker(`
    const {parentPort,workerData}=require("node:worker_threads");
    const appRequire=require("node:module").createRequire(workerData.requireFrom);
    const api={};new Function("require","exports",workerData.compiled)(appRequire,api);
    parentPort.postMessage(workerData.cases.map(({source})=>{
      const cursor=source.indexOf("| H");
      return Boolean(api.inspectMarkdownTable(source,cursor,cursor));
    }));
  `, { eval: true, workerData: { compiled, cases, requireFrom } });
  try {
    const result = await new Promise((resolve, reject) => {
      let received = false;
      const timer = setTimeout(() => reject(Error("Quoted-prose fence scan exceeded the anti-hang watchdog")), 10_000);
      worker.once("message", value => { received = true; clearTimeout(timer); resolve(value); });
      worker.once("error", error => { clearTimeout(timer); reject(error); });
      worker.once("exit", code => {
        clearTimeout(timer);
        if (!received) reject(Error(`Fence scan worker exited ${code} without a result`));
      });
    });
    assert.deepEqual(result, cases.map(item => item.expected));
  } finally {
    await worker.terminate();
  }
});

test("keeps escaped pipes editable as cell content and replaces the whole table from a cursor", () => {
  const source = "before\n| A | B |\n| --- | --- |\n| x\\|y | 2 |\nafter";
  const cursor = source.indexOf("x\\|y");
  const model = inspectMarkdownTable(source, cursor, cursor);
  assert.equal(model?.rows[0][0].value, "x|y");
  const replacement = "| A | B |\n| --- | --- |\n| edited | cell |";
  const result = applyMarkdownTableAction(source, cursor, cursor, { type: "replace", markdown: replacement });
  assert.ok(result);
  assert.equal(source.slice(0, result.from), "before\n");
  assert.equal(source.slice(result.to), "\nafter");
  assert.equal(result.insert, replacement);
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

test("replacement canonicalizes ragged drafts and preserves the original container and newline", () => {
  const original = "intro\r\n> | A | B |\r\n> | --- | --- |\r\n> | 1 | 2 |\r\noutro";
  const cursor = original.indexOf("| A");
  const draft = "\n| Updated | B |\n| --- |\n| x | y | z |\n\n";
  const result = applyMarkdownTableAction(original, cursor, cursor, { type: "replace", markdown: draft });
  assert.ok(result);
  assert.equal(original.slice(0, result.from), "intro\r\n");
  assert.equal(original.slice(result.to), "\r\noutro");
  assert.equal(result.insert, "> | Updated | B |  |\r\n> | --- | --- | --- |\r\n> | x | y | z |");
  assert.equal(result.selection.anchor, result.from + 4);
});

test("draft whitespace is accepted but surrounding prose and invalid offsets are never ignored", () => {
  const source = "| A | B |\n| --- | --- |\n| 1 | 2 |";
  assert.ok(inspectMarkdownTableDraft("\r\n" + source + "\r\n\r\n"));
  assert.equal(inspectMarkdownTableDraft("prose\n" + source), null);
  assert.equal(inspectMarkdownTableDraft(source + "\nprose"), null);
  assert.equal(applyMarkdownTableAction("not a table", 0, 0, { type: "replace", markdown: source }), null);
  for (const from of [-1, 0.5, NaN, Infinity, source.length + 1]) {
    assert.equal(inspectMarkdownTable(source, from, from), null);
    assert.equal(applyMarkdownTableAction(source, from, from, { type: "create", columns: 1, rows: 1 }), null);
  }
});

test("plain draft edits update only the changed row without a full table scan", () => {
  const source = "| A | B |\n| --- | --- |\n| one | two |\n| three | four |";
  const model = inspectMarkdownTableDraft(source);
  assert.ok(model);
  const next = updateSimpleMarkdownTableDraft(source, model, "| A | B |\n| --- | --- |\n| one | two |\n| changed | four |");
  assert.equal(next?.rows[1][0].value, "changed");
  assert.equal(next?.rows[0][1].value, "two");
  assert.equal(next?.alignments[0], null);
});

test("plain incremental draft updates fail closed for structure and rich syntax", () => {
  const source = "| A | B |\n| --- | --- |\n| one | two |";
  const model = inspectMarkdownTableDraft(source);
  assert.ok(model);
  assert.equal(updateSimpleMarkdownTableDraft(source, model, "| A | B |\n| --- | --- |\n| **rich** | two |"), null);
  assert.equal(updateSimpleMarkdownTableDraft(source, model, "| A | B |\n| --- | --- |\n| one | two | extra |"), null);
  assert.equal(updateSimpleMarkdownTableDraft(source, model, "| A | B |\n| --- | --- |\n| one | two |\n"), null);
});

test("plain fast paths agree with the full scanner for LF/CRLF, Unicode, alignment and ambiguous delimiter rows", () => {
  const fields = model => model && Object.fromEntries(
    ["headers", "rows", "alignments", "newline", "prefix", "continuationPrefix"].map(key => [key, model[key]]),
  );
  for (const newline of ["\n", "\r\n"]) {
    const base = ["| A | B |", "| :--- | ---: |", "| one | two |", "| three | four |"].join(newline);
    const model = inspectMarkdownTableDraft(base);
    assert.ok(model);
    for (const [before, after] of [
      ["A", "🙂 header"], ["two", "中 e\u0301"], ["one", ""], ["three", " many   words "],
      [":---", ":---:"], ["---:", "---"], ["one | two", "--- | ---"],
      ["A | B", "--- | ---"], ["two", "[caption]"], ["three", "3.14"],
      ["four", "www.example.test"], ["one", "first\nsecond"],
    ]) {
      const nextSource = base.replace(before, after);
      const full = inspectMarkdownTable(nextSource, 0, nextSource.length);
      assert.deepEqual(fields(inspectMarkdownTableDraft(nextSource)), fields(full), JSON.stringify({ newline, before, after }));
      const incremental = updateSimpleMarkdownTableDraft(base, model, nextSource);
      if (incremental) {
        assert.deepEqual(fields(incremental), fields(full), JSON.stringify({ newline, before, after }));
      }
    }
  }
});

test("plain incremental edits do not authorize oversized UTF-8 or malformed mixed-newline drafts", () => {
  const base = "| A | B |\n| --- | --- |\n| one | two |";
  const model = inspectMarkdownTableDraft(base);
  for (const value of ["中".repeat(350_000), "x".repeat(1_048_576)]) {
    assert.equal(updateSimpleMarkdownTableDraft(base, model, base.replace("one", value)), null);
  }
  assert.equal(updateSimpleMarkdownTableDraft(base, model, base.replace("one", "first\rsecond")), null);
});

test("normalization and plain incremental edits preserve non-ASCII cell boundary whitespace", () => {
  const values = ["\u00a0kept\u00a0", "\ufeffkept\ufeff", "\u2003中\u2003", "\u202fkept\u202f"];
  for (const newline of ["\n", "\r\n"]) {
    const source = ["| " + values.join(" | ") + " |", "| --- | --- | --- | --- |", "| " + values.join(" | ") + " |"].join(newline);
    const result = applyMarkdownTableAction(source, 0, 0, { type: "normalize" });
    assert.ok(result);
    assert.equal(result.insert, source);
    const draft = inspectMarkdownTableDraft(source);
    assert.deepEqual(draft?.headers.map(cell => cell.value), values);
    assert.deepEqual(draft?.rows[0].map(cell => cell.value), values);
    const next = source.replace("\u00a0kept\u00a0", "\u00a0edited\u00a0");
    const incremental = updateSimpleMarkdownTableDraft(source, draft, next);
    assert.equal(incremental?.headers[0].value, "\u00a0edited\u00a0");
    assert.equal(incremental?.rows[0][0].value, values[0]);
    const withoutOuterPipes = values.join(" | ") + newline + "--- | --- | --- | ---" + newline + values.join(" | ");
    const repaired = inspectMarkdownTableDraft(withoutOuterPipes);
    assert.deepEqual(repaired?.headers.map(cell => cell.value), values);
    assert.deepEqual(repaired?.rows[0].map(cell => cell.value), values);
  }
});

test("delimiter-looking headers and body rows retain identical actual GFM content", () => {
  const render = children => renderToStaticMarkup(React.createElement(ReactMarkdown, { children, remarkPlugins: [remarkGfm] }));
  for (const newline of ["\n", "\r\n"]) {
    for (const lines of [
      ["| --- | --- |", "| --- | --- |", "| one | two |"],
      ["| A | B |", "| :--- | ---: |", "| --- | --- |", "| :---: | ---: |", "| tail | kept |"],
      ["| :---: | ---: |", "| --- | --- |", "| - | - |"],
      ["| --- |", "| --- |", "| :---: |", "| --- |"],
      ["--- | :---:", "--- | ---", "--- | ---:"],
    ]) {
      for (const container of ["plain", "quote", "list"]) {
        const source = lines.map((line, index) => (container === "quote" ? "> " : container === "list" ? (index ? "  " : "- ") : "") + line).join(newline);
        const before = render(source);
        assert.equal((before.match(/<table\b/g) ?? []).length, 1, source);
        const normalized = applyMarkdownTableAction(source, 0, 0, { type: "normalize" });
        assert.ok(normalized, source);
        assert.equal(render(normalized.insert), before, source);
        assert.ok(inspectMarkdownTableDraft(normalized.insert), source);
        assert.equal(applyMarkdownTableAction(normalized.insert, 0, 0, { type: "normalize" })?.insert, normalized.insert);
      }
    }
  }
});

test("automatic marker-row discovery retains surrounding pipe prose and cursor identity", () => {
  for (const newline of ["\n", "\r\n"]) {
    const table = ["| A | B |", "| --- | --- |", "| --- | --- |", "| tail | kept |"].join(newline);
    const intro = "Intro | prose" + newline;
    const outro = newline + "After | prose";
    const source = intro + table + outro;
    for (const relativeCursor of [2, table.indexOf("| ---"), table.lastIndexOf("| ---"), table.indexOf("tail")]) {
      const cursor = intro.length + relativeCursor;
      const result = applyMarkdownTableAction(source, cursor, cursor, { type: "normalize" });
      assert.ok(result);
      assert.equal(result.from, intro.length);
      assert.equal(result.to, intro.length + table.length);
      assert.equal(result.insert, table);
      assert.equal(source.slice(0, result.from), intro);
      assert.equal(source.slice(result.to), outro);
    }
  }
});

test("plain incremental edits preserve delimiter-shaped header and data values", () => {
  for (const newline of ["\n", "\r\n"]) {
    const source = ["| A | B |", "| --- | --- |", "| one | two |", "| tail | kept |"].join(newline);
    const model = inspectMarkdownTableDraft(source);
    for (const nextSource of [source.replace("A | B", "--- | ---"), source.replace("one | two", ":---: | ---:")]) {
      const next = updateSimpleMarkdownTableDraft(source, model, nextSource);
      const full = inspectMarkdownTableDraft(nextSource);
      assert.ok(next);
      assert.ok(full);
      for (const key of ["headers", "rows", "alignments"]) assert.deepEqual(next[key], full[key]);
      assert.equal(next.rows.length, 2);
      assert.equal(next.rows[1], model.rows[1]);
    }
  }
});

test("a later delimiter selects its true header but cannot silently reinterpret a complete selection", () => {
  const source = "| original | prose |\n| A | B |\n| --- | --- |\n| --- | --- |";
  const from = source.indexOf("| A");
  const result = applyMarkdownTableAction(source, from + 2, from + 2, { type: "normalize" });
  assert.ok(result);
  assert.equal(result.from, from);
  assert.equal(result.insert, source.slice(from));
  assert.equal(applyMarkdownTableAction(source, 0, source.length, { type: "normalize" }), null);
  // When two adjacent lines both look like delimiters, the first eligible one
  // after the opening line is structure; its preceding line remains the header.
  const marked = "Intro | prose\n| --- | --- |\n| --- | --- |\n| tail | kept |";
  const normalized = applyMarkdownTableAction(marked, marked.indexOf("| ---") + 2, marked.indexOf("| ---") + 2, { type: "normalize" });
  assert.ok(normalized);
  assert.deepEqual(normalized.model.headers.map(cell => cell.value), ["Intro", "prose"]);
  assert.deepEqual(normalized.model.rows[0].map(cell => cell.value), ["---", "---"]);
});

test("a delimiter-looking opening header can be repaired when its separator is missing", () => {
  const source = "| --- | --- |\n| one | two |";
  const expected = "| --- | --- |\n| --- | --- |\n| one | two |";
  for (const [from, to] of [[0, 0], [0, source.length]]) {
    assert.equal(applyMarkdownTableAction(source, from, to, { type: "normalize" })?.insert, expected);
  }
});

test("cursor discovery does not absorb adjacent prose containing pipe symbols", () => {
  const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
  for (const prose of ["After | ordinary prose", "After | ordinary | prose"]) {
    const original = `intro | note\n${table}\n${prose}\noutro`;
    const cursor = original.indexOf("| ---");
    const result = applyMarkdownTableAction(original, cursor, cursor, { type: "normalize" });
    assert.ok(result);
    assert.equal(result.insert, table);
    assert.equal(original.slice(0, result.from), "intro | note\n");
    assert.equal(original.slice(result.to), `\n${prose}\noutro`);
    const proseCursor = original.indexOf("ordinary");
    assert.equal(inspectMarkdownTable(original, proseCursor, proseCursor), null);
  }
});

test("mixed newline styles keep exact table boundaries and the current row", () => {
  for (const source of [
    "intro | note\n| A | B |\r\n| --- | --- |\n| 1 | 2 |\r\nAfter | ordinary prose\noutro",
    "intro | note\r\n| A | B |\n| --- | --- |\r\n| 1 | 2 |\nAfter | ordinary prose\r\noutro",
  ]) {
    const cursor = source.indexOf("| 1") + 2;
    const model = inspectMarkdownTable(source, cursor, cursor);
    assert.ok(model);
    assert.equal(model.currentRow, 0);
    assert.equal(model.currentColumn, 0);
    const result = applyMarkdownTableAction(source, cursor, cursor, { type: "normalize" });
    assert.ok(result);
    assert.equal(result.from, source.indexOf("| A"));
    assert.equal(result.to, source.indexOf("| 1") + "| 1 | 2 |".length);
    assert.equal(source.slice(result.to).replace(/^\r?\n/, ""), source.slice(source.indexOf("After")));
    assert.equal(result.insert, "| A | B |\r\n| --- | --- |\r\n| 1 | 2 |");
  }
});

test("normalization is idempotent for escaped pipes, code, links, alignment and Unicode", () => {
  for (const value of [
    "x\\|y", "x\\\\\\|y", "`x|y`", "[x|y](https://example.invalid/a|b)", "中文🙂", "",
  ]) {
    const original = `| A | B |\n| :-- | -: |\n| ${value} | 2 |`;
    const first = applyMarkdownTableAction(original, 0, original.length, { type: "normalize" });
    assert.ok(first, value);
    const second = applyMarkdownTableAction(first.insert, 0, first.insert.length, { type: "normalize" });
    assert.equal(second?.insert, first.insert, value);
  }
});

test("normalizes unambiguous inline math pipes without manufacturing extra columns", () => {
  for (const value of [
    String.raw`\(|x|\)`, String.raw`\(\left|p_k-p_{k-1}\right|\)`,
    String.raw`$|x|$`, String.raw`$$|x|$$`,
    String.raw`[formula \(|x|\)](https://example.invalid)`,
  ]) {
    const source = `| Formula | Note |\n| --- | --- |\n| ${value} | retained |`;
    const result = applyMarkdownTableAction(source, 0, 0, { type: "normalize" });
    assert.equal(result?.model?.headers.length, 2, value);
    assert.equal(result.model.rows[0][0].raw, value);
    const cursor = source.indexOf(value) + value.indexOf("|");
    assert.equal(inspectMarkdownTable(source, cursor, cursor)?.currentColumn, 0, value);
    assert.equal(result.insert, `| Formula | Note |\n| --- | --- |\n| ${value.replaceAll("|", "\\vert ")} | retained |`);
    assert.equal(applyMarkdownTableAction(result.insert, 0, 0, { type: "normalize" })?.insert, result.insert);
  }
});

test("preserves existing TeX norm operators instead of treating them as GFM escapes", () => {
  for (const value of [String.raw`\(\|x\|\)`, String.raw`$\|x\|$`, String.raw`$$\|x\|$$`]) {
    const source = `intro\r\n> | Formula | Note |\r\n> | --- | --- |\r\n> | ${value} | kept |\r\noutro`;
    const start = source.indexOf("> |");
    const result = applyMarkdownTableAction(source, start, start, { type: "normalize" });
    assert.equal(result?.model?.rows[0][0].value, value);
    assert.equal(result.insert, source.slice(start, source.lastIndexOf("\r\n")));
    assert.equal(source.slice(0, result.from), "intro\r\n");
    assert.equal(source.slice(result.to), "\r\noutro");
  }
});

test("currency, code and link destinations do not acquire math pipe rewrites", () => {
  const currency = "| A | B | C |\n| --- | --- | --- |\n| USD $20 | USD $30 | kept |";
  assert.equal(applyMarkdownTableAction(currency, 0, 0, { type: "normalize" })?.insert, currency);
  for (const value of [
    String.raw`[label](https://example.invalid/\(a|b\))`,
    "`" + String.raw`\(|x|\)` + "`",
  ]) {
    const source = `| A | B |\n| --- | --- |\n| ${value} | kept |`;
    const result = applyMarkdownTableAction(source, 0, 0, { type: "normalize" });
    assert.ok(result, value);
    assert.equal(result.model.headers.length, 2);
    assert.ok(!result.insert.includes("\\vert "), value);
    assert.equal(applyMarkdownTableAction(result.insert, 0, 0, { type: "normalize" })?.insert, result.insert);
  }
});

test("math-looking alt text and reference identifiers remain literal while ambiguous shortcuts are declined", () => {
  for (const value of [
    String.raw`![\(|x|\)](https://example.invalid/image.png)`,
    String.raw`[label][\(\|x\|\)]`,
    String.raw`[a\|b]`, String.raw`[^a\|b]`, String.raw`[a\|b][]`, String.raw`[\(\|x\|\)][]`,
    String.raw`![a\|b]`, String.raw`![a\|b][]`,
  ]) {
    const source = `| A | B |\n| --- | --- |\n| ${value} | kept |`;
    const result = applyMarkdownTableAction(source, 0, 0, { type: "normalize" });
    assert.ok(result, value);
    assert.equal(result.model.headers.length, 2);
    assert.ok(!result.insert.includes("\\vert "), value);
  }
  for (const value of [
    String.raw`[\(|x|\)]`, String.raw`[label][\(|x|\)]`, String.raw`[\(|x|\)][]`,
    "[a|b]", "[^a|b]", "[label][a|b]", "[a|b][]", "![a|b][]", "![a|b]",
  ]) {
    const source = `| A | B |\n| --- | --- |\n| ${value} | kept |`;
    assert.equal(applyMarkdownTableAction(source, 0, 0, { type: "normalize" }), null, value);
  }
});

test("does not guess at incomplete math or pipes in TeX text and array arguments", () => {
  for (const value of [
    String.raw`\(|x|`, String.raw`\(\text{a|b}\)`,
    String.raw`$\begin{array}{c|c}x&y\end{array}$`,
    String.raw`\[|x|\]`,
  ]) {
    const source = `| A | B |\n| --- | --- |\n| ${value} | kept |`;
    assert.equal(applyMarkdownTableAction(source, 0, 0, { type: "normalize" }), null, value);
  }
});

test("code pipe repair retains every literal backslash, including even runs", () => {
  for (let slashes = 0; slashes <= 8; slashes++) {
    const value = "`x" + "\\".repeat(slashes) + "|y`";
    const source = `| A | B |\n| --- | --- |\n| ${value} | kept |`;
    const result = applyMarkdownTableAction(source, 0, 0, { type: "normalize" });
    const expectedSlashes = slashes + (slashes % 2 === 0 ? 1 : 0);
    assert.equal(result?.insert, `| A | B |\n| --- | --- |\n| \`x${"\\".repeat(expectedSlashes)}|y\` | kept |`, slashes);
    assert.equal(applyMarkdownTableAction(result.insert, 0, 0, { type: "normalize" })?.insert, result.insert);
  }
});

test("declines TeX character-code and text-box arguments instead of changing literal characters", () => {
  for (const formula of [
    "\\(\\char`|\\)", String.raw`\(\colorbox{red}{|}\)`, String.raw`\(\fcolorbox{red}{blue}{|}\)`,
    String.raw`\(\raisebox{1pt}{|}\)`, String.raw`$$\tag{|}$$`,
  ]) {
    const source = `| A | B |\n| --- | --- |\n| ${formula} | kept |`;
    assert.equal(inspectMarkdownTable(source, 0, 0), null, formula);
    assert.equal(applyMarkdownTableAction(source, 0, 0, { type: "normalize" }), null, formula);
  }
});

test("math pipe encoding cannot grow an accepted candidate beyond the UTF-8 tool limit", () => {
  const source = "| A | B |\n| --- | --- |\n| " + String.raw`\(` + "|".repeat(180_000) + String.raw`\)` + " | kept |";
  assert.ok(Buffer.byteLength(source) < 1_048_576);
  assert.equal(inspectMarkdownTable(source, 0, 0), null);
  assert.equal(applyMarkdownTableAction(source, 0, 0, { type: "normalize" }), null);
});

test("a table replacement is a single undoable CodeMirror edit", () => {
  const { EditorState } = require("@codemirror/state");
  const cmRequire = createRequire(require.resolve("@uiw/react-codemirror"));
  const { history, undo } = cmRequire("@codemirror/commands");
  const initial = "intro\n| A | B |\n| --- | --- |\n| 1 | 2 |\noutro";
  const cursor = initial.indexOf("| 1");
  const result = applyMarkdownTableAction(initial, cursor, cursor, { type: "replace", markdown: "| A | B |\n| --- | --- |\n| changed | 2 |" });
  assert.ok(result);
  let state = EditorState.create({ doc: initial, extensions: [history()] });
  state = state.update({ changes: { from: result.from, to: result.to, insert: result.insert }, selection: result.selection }).state;
  assert.match(state.doc.toString(), /changed/);
  assert.ok(undo({ state, dispatch: transaction => { state = transaction.state; } }));
  assert.equal(state.doc.toString(), initial);
});

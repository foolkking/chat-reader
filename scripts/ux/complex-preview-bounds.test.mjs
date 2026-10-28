import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript"), { zipSync, strToU8 } = require("fflate");
const compiled = ts.transpileModule(readFileSync(new URL("../../apps/web/features/attachments/complex-attachment-worker.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const repeat = (n, item) => Array.from({ length: n }, () => item).join("");

// Actual worker handler + ZIP/XML parsers and installed fflate; self/message
// delivery is a double. Not browser rendering, fidelity or hostile-file proof.
const zipFiles = files => zipSync(Object.fromEntries(Object.entries(files).map(([path, value]) => [path, strToU8(value)])));
async function workerReply(kind, filename, bytes) {
  let reply;
  const self = { postMessage: message => { reply = message; } };
  new Function("require", "exports", "self", compiled)(require, {}, self);
  self.onmessage({ data: { requestId: "synthetic-preview", kind, filename,
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } });
  await setImmediate();
  assert.ok(reply);
  return reply;
}
async function preview(kind, filename, files) {
  const reply = await workerReply(kind, filename, zipFiles(files));
  assert.equal(reply?.ok, true, reply?.error);
  return reply.result;
}

test("document paragraph limits distinguish exactly 2,000 from 2,001", async () => {
  for (const count of [2000, 2001]) {
    const result = await preview("document", "synthetic.docx", {
      "word/document.xml": `<w:document>${repeat(count, "<w:p><w:r><w:t>synthetic</w:t></w:r></w:p>")}</w:document>`,
    });
    assert.equal(result.paragraphs.length, 2000);
    assert.equal(result.preview.truncated, count > 2000);
    if (count > 2000) assert.equal(result.preview.reason, "paragraphs");
  }
});

test("spreadsheet row and column bounds disclose overflow but not an exact cap", async () => {
  for (const count of [2000, 2001]) {
    const result = await preview("spreadsheet", "synthetic.xlsx", {
      "xl/worksheets/sheet1.xml": `<worksheet>${repeat(count, "<row><c><v>1</v></c></row>")}</worksheet>`,
    });
    assert.equal(result.sheets[0].rows.length, 2000);
    assert.equal(result.preview.truncated, count > 2000);
  }
  for (const count of [64, 65]) {
    const result = await preview("spreadsheet", "synthetic.ods", {
      "content.xml": `<table:table table:name="Synthetic"><table:table-row>${repeat(count, "<table:table-cell>1</table:table-cell>")}</table:table-row></table:table>`,
    });
    assert.equal(result.sheets[0].rows[0].cells.length, 64);
    assert.equal(result.preview.truncated, count > 64);
    if (count > 64) assert.equal(result.preview.reason, "columns");
  }
});

test("spreadsheet coordinates and declared Office relationships stay aligned", async () => {
  const sparse = await preview("spreadsheet", "synthetic.xlsx", {
    "xl/workbook.xml": '<workbook><sheets><sheet name="Declared" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet2.xml"/></Relationships>',
    "xl/worksheets/sheet2.xml": '<worksheet><sheetData><row r="5"><c r="A5"><v>first</v></c><c r="C5"><v>third</v></c></row></sheetData></worksheet>',
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1"><v>wrong</v></c></row></sheetData></worksheet>',
  });
  assert.equal(sparse.sheets[0].name, "Declared");
  assert.equal(sparse.sheets[0].rows[0].rowNumber, 5);
  assert.deepEqual(sparse.sheets[0].rows[0].cells, [
    { column: 0, value: "first" }, { column: 2, value: "third" },
  ]);
});

test("shared string positions preserve empty entries and never expose an out-of-range index", async () => {
  const result = await preview("spreadsheet", "synthetic.xlsx", {
    "xl/sharedStrings.xml": "<sst><si></si><si><t>visible</t></si></sst>",
    "xl/worksheets/sheet1.xml": '<worksheet><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>7</v></c></row></worksheet>',
  });
  assert.deepEqual(result.sheets[0].rows[0].cells, [
    { column: 0, value: "" }, { column: 1, value: "visible" }, { column: 2, value: "[shared string unavailable]" },
  ]);
  assert.ok(result.preview.warnings.includes("shared-string-reference"));
});

test("presentation order follows declared relationships instead of slide filenames", async () => {
  const result = await preview("presentation", "synthetic.pptx", {
    "ppt/presentation.xml": '<p:presentation><p:sldIdLst><p:sldId r:id="rIdA"/><p:sldId r:id="rIdB"/></p:sldIdLst></p:presentation>',
    "ppt/_rels/presentation.xml.rels": '<Relationships><Relationship Id="rIdA" Target="slides/slide2.xml"/><Relationship Id="rIdB" Target="slides/slide1.xml"/></Relationships>',
    "ppt/slides/slide1.xml": "<p:sld><a:p><a:t>Second</a:t></a:p></p:sld>",
    "ppt/slides/slide2.xml": "<p:sld><a:p><a:t>First</a:t></a:p></p:sld>",
  });
  assert.deepEqual(result.slides.map((slide) => slide.title), ["First", "Second"]);
});

test("presentation limits distinguish exact slide/line budgets from overflow", async () => {
  for (const count of [500, 501]) {
    const files = Object.fromEntries(Array.from({ length: count }, (_, index) =>
      [`ppt/slides/slide${index + 1}.xml`, "<a:p><a:t>Synthetic slide</a:t></a:p>"]));
    const result = await preview("presentation", "synthetic.pptx", files);
    assert.equal(result.slides.length, 500);
    assert.equal(result.preview.truncated, count > 500);
  }
  const result = await preview("presentation", "synthetic.odp", {
    "content.xml": `<draw:page>${repeat(201, "<text:p>Synthetic line</text:p>")}</draw:page>`,
  });
  assert.equal(result.slides[0].lines.length, 200);
  assert.equal(result.preview.reason, "slide-lines");
});

test("archive per-entry text truncation is explicit and the exact character cap is not flagged", async () => {
  for (const count of [200000, 200001]) {
    const result = await preview("archive", "synthetic.zip", { "synthetic.txt": "x".repeat(count) });
    assert.equal(result.entries[0].preview.text.length, 200000);
    assert.equal(result.entries[0].preview.truncated, count > 200000);
    assert.equal(result.preview.truncated, false);
  }
});

test("self-closing blank cells, empty shared strings and rich runs preserve their positions", async () => {
  const result = await preview("spreadsheet", "synthetic.xlsx", {
    "xl/sharedStrings.xml": '<sst><si/><si><r><t>rich</t></r><r><t xml:space="preserve"> text</t></r><rPh><t>not-visible</t></rPh></si></sst>',
    "xl/worksheets/sheet1.xml": '<worksheet><row r="5"><c r="A5"/><c t="s"><v>0</v></c><c r="D5" t="s"><v>1</v></c><c t="inlineStr"><is><r><t>inline</t></r><r><t>text</t></r></is></c></row><row/><row><c><v>next</v></c></row></worksheet>',
  });
  assert.deepEqual(result.sheets[0].rows, [
    { rowNumber: 5, cells: [{ column: 0, value: "" }, { column: 1, value: "" },
      { column: 3, value: "rich text" }, { column: 4, value: "inlinetext" }] },
    { rowNumber: 6, cells: [] },
    { rowNumber: 7, cells: [{ column: 0, value: "next" }] },
  ]);
  assert.deepEqual(result.preview.warnings, ["office-order-unavailable"]);
});

test("distant sparse coordinates are bounded without allocating intervening rows or moving cells into A", async () => {
  const result = await preview("spreadsheet", "synthetic.xlsx", {
    "xl/worksheets/sheet1.xml": '<worksheet><row><c r="XFD1048576"><v>far</v></c></row></worksheet>',
  });
  assert.deepEqual(result.sheets[0].rows, [{ rowNumber: 1048576, cells: [] }]);
  assert.equal(result.preview.truncated, true);
  assert.equal(result.preview.reason, "columns");
});

for (const xml of [
  '<row r="5"><c r="A6"><v>wrong row</v></c></row>',
  '<row r="2"/><row r="1"/>',
  '<row r="1"><c r="C1"/><c r="A1"/></row>',
  '<row r="1"><c r="XFE1"/></row>',
]) test(`invalid coordinates fail closed: ${xml}`, async () => {
  const reply = await workerReply("spreadsheet", "synthetic.xlsx", zipFiles({
    "xl/worksheets/sheet1.xml": `<worksheet>${xml}</worksheet>`,
  }));
  assert.equal(reply.ok, false);
  assert.equal(reply.errorCode, "office-coordinates");
});

for (const [kind, filename, manifestPath, manifest, relationshipsPath, contentPath, content] of [
  ["spreadsheet", "synthetic.xlsx", "xl/workbook.xml", '<workbook><sheets><sheet name="Declared" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml", "<worksheet><row><c><v>synthetic</v></c></row></worksheet>"],
  ["presentation", "synthetic.pptx", "ppt/presentation.xml", '<p:presentation><p:sldIdLst><p:sldId r:id="rId1"/></p:sldIdLst></p:presentation>',
    "ppt/_rels/presentation.xml.rels", "ppt/slides/slide1.xml", "<a:p><a:t>Synthetic</a:t></a:p>"],
]) {
  const target = contentPath.split("/").slice(1).join("/");
  for (const relationship of [
    "",
    '<Relationship Id="rId1" Target="missing.xml"/>',
    `<Relationship Id="rId1" Target="${target}" TargetMode="External"/>`,
    `<Relationship Id="rId1" Target="https://synthetic.invalid/${target}"/>`,
    `<Relationship Id="rId1" Target="../../${contentPath}"/>`,
    `<Relationship Id="rId1" Target="${target}" Type="synthetic/not-a-sheet-or-slide"/>`,
    `<Relationship Id="rId1" Target="${target}"/><Relationship Id="rId1" Target="${target}"/>`,
  ]) test(`${kind}: an invalid declared relationship never falls back to matching filenames (${relationship || "absent"})`, async () => {
    const reply = await workerReply(kind, filename, zipFiles({
      [manifestPath]: manifest, [relationshipsPath]: `<Relationships>${relationship}</Relationships>`, [contentPath]: content,
    }));
    assert.equal(reply.ok, false);
    assert.equal(reply.errorCode, "office-relationships");
    assert.equal(reply.result, undefined);
  });
  test(`${kind}: a completely missing manifest discloses generic filename-order preview`, async () => {
    const result = await preview(kind, filename, { [contentPath]: content });
    assert.deepEqual(result.preview.warnings, ["office-order-unavailable"]);
  });
}

// Alter only tiny central-directory metadata; do not allocate declared
// uncompressed payloads merely to exercise pre-decompression budgets.
function withZipBudget({ count, entryBytes } = {}) {
  const bytes = zipFiles(Object.fromEntries(Array.from({ length: entryBytes?.length ?? 1 }, (_, index) => [`synthetic-${index}.txt`, "x"])));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), eocd = bytes.length - 22;
  if (count !== undefined) view.setUint16(eocd + 10, count, true);
  let offset = view.getUint32(eocd + 16, true);
  for (const size of entryBytes ?? []) {
    view.setUint32(offset + 24, size, true);
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return bytes;
}
for (const [code, bytes] of [
  ["zip-entry-count", () => withZipBudget({ count: 5001 })],
  ["zip-entry-size", () => withZipBudget({ entryBytes: [16 * 1024 * 1024 + 1] })],
  ["zip-expanded-size", () => withZipBudget({ entryBytes: Array(7).fill(16 * 1024 * 1024) })],
  ["zip-invalid", () => new Uint8Array([0, 1, 2])],
  ["source-size", () => new Uint8Array(50 * 1024 * 1024 + 1)],
]) test(`${code} is returned explicitly instead of misreporting every ZIP failure as source size`, async () => {
  const reply = await workerReply("archive", "synthetic.zip", bytes());
  assert.equal(reply.ok, false);
  assert.equal(reply.errorCode, code);
});

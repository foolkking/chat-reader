import assert from "node:assert/strict";
import test from "node:test";
import { loadTableFixtureModule } from "./markdown-table-source-fixture.mjs";

const tableExport = (await loadTableFixtureModule("../../apps/web/features/conversations/markdown-table-export.ts")).module;
const pastedTranscript = (await loadTableFixtureModule("../../apps/web/features/import/pasted-transcript.ts")).module;
const citation = (await loadTableFixtureModule("../../apps/web/features/conversations/reader-citation.ts")).module;
const versionDiff = (await loadTableFixtureModule("../../apps/web/features/editing/version-diff.ts")).module;

test("table data export reads nested text, preserves empty cells, and escapes TSV/CSV", () => {
  const data = tableExport.readMarkdownTableData({
    type: "element",
    tagName: "table",
    children: [
      { type: "element", tagName: "thead", children: [{ tagName: "tr", children: [
        { tagName: "th", children: [{ type: "text", value: "姓名" }] },
        { tagName: "th", children: [{ type: "text", value: "备注" }] },
      ] }] },
      { type: "element", tagName: "tbody", children: [{ tagName: "tr", children: [
        { tagName: "td", children: [{ type: "text", value: "李, 四" }] },
        { tagName: "td", children: [{ type: "element", tagName: "code", children: [{ type: "text", value: "line 1\n\"line 2\"" }] }] },
      ] }, { tagName: "tr", children: [
        { tagName: "td", children: [{ type: "text", value: "空值" }] },
        { tagName: "td", children: [] },
      ] }] },
    ],
  });
  assert.deepEqual(data, {
    hasHeader: true,
    rows: [["姓名", "备注"], ["李, 四", 'line 1\n"line 2"'], ["空值", ""]],
  });
  assert.equal(
    tableExport.serializeTableData(data.rows, "csv", { hasHeader: true }).text,
    '姓名,备注\r\n"李, 四","line 1\n""line 2"""\r\n空值,',
  );
  assert.equal(
    tableExport.serializeTableData(data.rows, "tsv", { hasHeader: true, includeHeader: false }).text,
    '李, 四\t"line 1\n""line 2"""\r\n空值\t',
  );
});

test("formula-like cells default to safe text while ordinary negative numbers remain intact", () => {
  const result = tableExport.serializeTableData(
    [["=1+1", "  @SUM(A1:A2)", "-name", "-12.5", "plain"]],
    "csv",
  );
  assert.equal(result.protectedCellCount, 3);
  assert.equal(result.text, "'=1+1,'  @SUM(A1:A2),'-name,-12.5,plain");
  assert.equal(tableExport.serializeTableData([["=1+1"]], "tsv", { protectFormulaCells: false }).text, "=1+1");
});

test("table export refuses oversized table data without silently truncating", () => {
  const cells = Array.from({ length: tableExport.MAX_EXPORTED_TABLE_CELLS + 1 }, () => ({ tagName: "td", children: [] }));
  const result = tableExport.readMarkdownTableData({
    tagName: "table",
    children: [{ tagName: "tbody", children: [{ tagName: "tr", children: cells }] }],
  });
  assert.deepEqual(result, { tooLarge: true });
});

test("pasted transcript becomes a named UTF-8 Markdown file only when explicitly requested", async () => {
  const text = "问题：下周复盘？\n\n> 这是粘贴的内容";
  assert.equal(pastedTranscript.pastedTranscriptByteLength(text), Buffer.byteLength(text, "utf8"));
  assert.equal(pastedTranscript.createPastedTranscriptFile(" \n"), null);
  const file = pastedTranscript.createPastedTranscriptFile(text);
  assert.equal(file.name, "pasted-transcript.md");
  assert.equal(file.type, "text/markdown;charset=utf-8");
  assert.equal(await file.text(), text);
});

test("citation uses a private message target and escapes source labels", () => {
  const output = citation.buildReaderCitationMarkdown("第一行\n`code`", {
    conversationId: "conversation/one",
    messageId: "message-id",
    conversationTitle: "研究 [A] (draft)",
    ordinal: 7,
    origin: "https://reader.example.test",
  });
  assert.equal(
    output,
    "> 第一行\n> `code`\n>\n> — [研究 \\[A\\] (draft) · #7](https://reader.example.test/conversations/conversation%2Fone?messageId=message-id)",
  );
  assert.equal(output.includes("shareToken"), false);
  assert.equal(citation.buildReaderCitationMarkdown(" ", {
    conversationId: "c", messageId: "m", conversationTitle: "Title", ordinal: 1, origin: "https://example.test",
  }), null);
});

test("read-only version difference preserves Unicode and orders insertions/deletions", () => {
  const result = versionDiff.buildVersionDiff("标题 😀\nold\nsame", "标题 😀\nnew\nsame");
  assert.equal(result.truncated, false);
  assert.deepEqual(result.lines, [
    { kind: "same", text: "标题 😀" }, { kind: "removed", text: "old" },
    { kind: "added", text: "new" }, { kind: "same", text: "same" },
  ]);
  assert.deepEqual(versionDiff.buildVersionDiff("same", "same").lines, [{ kind: "same", text: "same" }]);
});

test("version comparison discloses text, line and quadratic-work bounds", () => {
  assert.equal(versionDiff.buildVersionDiff("x".repeat(80_001), "").truncated, true);
  assert.equal(versionDiff.buildVersionDiff("line\n".repeat(4_001), "").truncated, true);
  const left = "left\n".repeat(1_300), right = "right\n".repeat(1_300);
  const result = versionDiff.buildVersionDiff(left, right);
  assert.equal(result.truncated, true);
  assert.ok(result.lines.length <= 8_000);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { analyseTableSource, tableSourceAnalysis, loadTableFixtureModule } from "./markdown-table-source-fixture.mjs";

const { projectTableContextMath, createMarkdownTableSourceProbe, TABLE_SOURCE_ANALYSIS_LIMITS: limits } = tableSourceAnalysis;
const { normalizeDisplayMathForRenderer } = (await loadTableFixtureModule(
  "../../apps/web/features/rich-markdown/remark-ai-math-compatibility.ts",
)).module;

test("context math projection is byte-identical to the existing renderer and restores later source offsets", () => {
  const tokens = [
    "text", " ", "\t", "\n", "\r\n", String.raw`\[`, String.raw`\]`,
    String.raw`\left[`, String.raw`\right]`, String.raw`\\[`, String.raw`\\]`, "🙂", "> ", "<div>",
  ];
  let seed = 0x267d17;
  for (let sample = 0; sample < 800; sample++) {
    let source = "";
    for (let token = 0; token < 40; token++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      source += tokens[seed % tokens.length];
    }
    source += "\n\n| UNCHANGED_ANCHOR |";
    const projection = projectTableContextMath(source);
    assert.equal(projection.text, normalizeDisplayMathForRenderer(source), JSON.stringify(source));
    const anchor = projection.text.indexOf("UNCHANGED_ANCHOR");
    assert.equal(projection.sourceOffset(anchor), source.indexOf("UNCHANGED_ANCHOR"));
    assert.equal(projection.sourceOffset(projection.text.length), source.length);
  }
});

test("source ranges compose display math and rich-layout projections without LF or CRLF drift", () => {
  for (const newline of ["\n", "\r\n"]) {
    const source = (
      "🙂 lead\\[\n\\left[x\\right]\n\\]tail\n\n"
      + "<box><text>intro</text></box>\n\n"
      + "<textarea>\n\n| H |\n| --- |\n| literal |\n</textarea>\n\n[kept]: /target"
    ).replaceAll("\n", newline);
    const result = analyseTableSource(source);
    assert.equal(result.complete, true);
    assert.ok(result.literalRanges.some(range => (
      range.start === source.indexOf("<textarea>") && range.end === source.indexOf("</textarea>") + "</textarea>".length
    )));
    assert.deepEqual(result.definitionRanges, [{ start: source.indexOf("[kept]:"), end: source.length }]);
    assert.equal(result.source, source);
  }
});

test("renderer-proven HTML ranges distinguish textarea literals from a real table after a quote blank line", () => {
  const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
  for (const [tag, literal] of [["textarea", true], ["div", false], ["pre", true], ["script", true], ["style", true]]) {
    for (const prefix of ["", "> ", "- "]) {
      const continued = prefix === "- " ? "  " : prefix;
      const source = prefix + `<${tag}>\n` + continued.trimEnd() + "\n"
        + table.split("\n").map(line => continued + line).join("\n") + "\n" + continued + `</${tag}>`;
      const result = analyseTableSource(source), header = source.indexOf("| A");
      assert.equal(result.complete, true);
      assert.equal(result.literalRanges.some(range => range.start <= header && header < range.end), literal, source);
    }
  }
});

test("source probe bounds UTF-8 input instead of truncating an HTML context", () => {
  for (const source of ["<" + "x".repeat(limits.bytes), "<" + "字".repeat(Math.ceil(limits.bytes / 3))]) {
    const probe = createMarkdownTableSourceProbe(source);
    assert.equal(probe.limited, true);
    assert.equal(probe.result().complete, false);
    assert.equal(probe.result().source, source);
    assert.equal(probe.text, "");
  }
});

test("source probe rejects exhausted AST/range budgets and unavailable literal coordinates", () => {
  const nodeProbe = createMarkdownTableSourceProbe("x");
  const nodes = { type: "root", children: Array.from({ length: limits.nodes }, () => ({ type: "text" })) };
  nodeProbe.plugin()(nodes);
  assert.equal(nodeProbe.result().complete, false);
  assert.deepEqual(nodes.children, []);

  const rangeProbe = createMarkdownTableSourceProbe("x".repeat(2 * limits.ranges + 2));
  const ranges = { type: "root", children: Array.from({ length: limits.ranges + 1 }, (_, index) => ({
    type: "html", position: { start: { offset: index * 2 }, end: { offset: index * 2 + 1 } },
  })) };
  rangeProbe.plugin()(ranges);
  assert.equal(rangeProbe.result().complete, false);
  assert.equal(rangeProbe.result().literalRanges.length, limits.ranges);
  assert.deepEqual(ranges.children, []);

  const invalidProbe = createMarkdownTableSourceProbe("<div>");
  const invalid = { type: "root", children: [{ type: "html" }] };
  invalidProbe.plugin()(invalid);
  assert.equal(invalidProbe.result().complete, false);
  assert.deepEqual(invalid.children, []);
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { test } from "node:test";

const webRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const nextRequire = createRequire(webRequire.resolve("next/package.json"));
const entrypoints = [...new Set([webRequire, nextRequire].map((resolveFrom) => {
  const postcssRequire = createRequire(resolveFrom.resolve("postcss/package.json"));
  return postcssRequire.resolve("source-map-js");
}))];

function exercise(body) {
  for (const entrypoint of entrypoints) {
    // Keep a vulnerable dependency from blocking or exhausting the test runner.
    execFileSync(process.execPath, ["--max-old-space-size=128", "-e", `
      const assert = require("node:assert/strict");
      const { SourceMapConsumer, SourceMapGenerator, SourceNode } = require(${JSON.stringify(entrypoint)});
      const leaf = { version: 3, sources: ["input.js"], sourcesContent: ["let x = 1;\\n"], names: [], mappings: "AAAA" };
      const indexed = (line, map = leaf) => ({ version: 3, sections: [{ offset: { line, column: 0 }, map }] });
      ${body}
    `], { timeout: 8000, stdio: "pipe" });
  }
}

test("both application PostCSS paths resolve the fixed source-map dependency", () => {
  for (const resolveFrom of [webRequire, nextRequire]) {
    const postcssRequire = createRequire(resolveFrom.resolve("postcss/package.json"));
    assert.equal(postcssRequire("source-map-js/package.json").version, "1.2.2");
  }
});

test("oversized indexed offsets, including accumulated nested offsets, are rejected", () => {
  exercise(`
    for (const line of [1e12, Number.MAX_SAFE_INTEGER, Infinity]) {
      assert.throws(() => new SourceMapConsumer(indexed(line)));
    }
    assert.throws(() => new SourceMapConsumer(indexed(5e6, indexed(5e6, indexed(5e6)))));
  `);
});

test("a valid large offset beyond generated code does not allocate millions of empty lines", () => {
  exercise(`
    const code = "let x = 1;\\n";
    const node = SourceNode.fromStringWithSourceMap(code, new SourceMapConsumer(indexed(1e7)));
    assert.equal(node.toString(), code);
    assert.ok(node.children.length < 10);
  `);
});

test("deeply nested indexed maps preserve source content without exponential traversal", () => {
  exercise(`
    let map = leaf;
    for (let depth = 0; depth < 40; depth++) map = indexed(0, map);
    const consumer = new SourceMapConsumer(map);
    const node = SourceNode.fromStringWithSourceMap("let x = 1;\\n", consumer);
    assert.equal(node.toString(), "let x = 1;\\n");
    const sources = {};
    node.walkSourceContents((source, content) => { sources[source] = content; });
    assert.deepEqual(sources, { "input.js": "let x = 1;\\n" });
    // Both upstream versions treat an indexed section's column-zero boundary
    // as unmapped; exercise a position inside the section, preserving behavior.
    assert.deepEqual(consumer.originalPositionFor({ line: 1, column: 1 }), {
      source: "input.js", line: 1, column: 0, name: null,
    });
  `);
});

test("ordinary generated mappings retain exact positions and source text", () => {
  exercise(`
    const generator = new SourceMapGenerator({ file: "output.js" });
    generator.addMapping({ generated: { line: 1, column: 0 }, original: { line: 2, column: 4 }, source: "input.js" });
    generator.setSourceContent("input.js", "// header\\n    let x = 1;\\n");
    const consumer = new SourceMapConsumer(generator.toJSON());
    assert.deepEqual(consumer.originalPositionFor({ line: 1, column: 0 }), {
      source: "input.js", line: 2, column: 4, name: null,
    });
    const restored = SourceNode.fromStringWithSourceMap("let x = 1;\\n", consumer).toStringWithSourceMap({ file: "output.js" });
    assert.equal(restored.code, "let x = 1;\\n");
    assert.deepEqual(restored.map.toJSON().sourcesContent, ["// header\\n    let x = 1;\\n"]);
  `);
});

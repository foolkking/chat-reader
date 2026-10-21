import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { analyseTableSource } from "./markdown-table-source-fixture.mjs";

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = appRequire("typescript");
const source = readFileSync(new URL("../../apps/web/features/editing/markdown-table-reference-preview.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", output)(appRequire, module, module.exports);
const { collectMarkdownTableReferenceContext: collectRaw, TABLE_REFERENCE_PREVIEW_LIMITS: limits } = module.exports;
// Match the dialog's conditional, once-per-frozen-source renderer proof.
const collect = source => collectRaw(source, source.includes("<") ? analyseTableSource(source) : undefined);

test("collects literal reference identities in document order, without outside prose or titles", () => {
  const label = String.raw`\(\|x\|\)`;
  const source = `intro\n\n| A | B |\n| --- | --- |\n| [label][${label}] | kept |\n\n[${label}]: https://example.invalid/target "Keep original title"\n\noutro`;
  assert.deepEqual(collect(source), { markdown: `[${label}]: https://example.invalid/target`, limited: false });
  assert.ok(source.includes('"Keep original title"\n\noutro'));
  assert.deepEqual(collect("[same]: https://example.invalid/first\n[same]: https://example.invalid/second"), {
    markdown: "[same]: https://example.invalid/first\n[same]: https://example.invalid/second", limited: false,
  });
});

test("does not promote fenced or indented code examples to actual definitions", () => {
  const source = "```md\n[fenced]: https://example.invalid/fenced\n```\n\n    [indented]: https://example.invalid/indented\n\n[actual]: /actual";
  assert.deepEqual(collect(source), { markdown: "[actual]: /actual", limited: false });
});

test("actual GFM textarea literals cannot supply references, including quoted HTML blank boundaries", () => {
  for (const newline of ["\n", "\r\n"]) {
    for (const input of [
      "<textarea>\n\n[hidden]: /not-a-definition\n</textarea>\n\n[actual]: /actual",
      "> <textarea>\n>\n> [hidden]: /not-a-definition\n> </textarea>\n\n[actual]: /actual",
      "> <div>\n>\n> [actual]: /actual\n> </div>",
    ]) {
      const source = input.replaceAll("\n", newline);
      assert.deepEqual(collect(source), { markdown: "[actual]: /actual", limited: false }, source);
      assert.deepEqual(collectRaw(source), { markdown: "", limited: true }, "unverified HTML must not lend definitions");
      assert.deepEqual(collectRaw(source, analyseTableSource("[actual]: /actual")), { markdown: "", limited: true });
    }
  }
});

test("CRLF HTML boundaries retain real definition offsets and exclude literal HTML definitions", () => {
  for (const newline of ["\n", "\r\n"]) {
    for (const before of ["<div>\n\n", "<!-- hidden -->\n", "> <div>\n"]) {
      const source = (
        before + "[标签]: <https://example.invalid/a%7Cb> \"original title\"\n\n</div>\n\n"
        + "<!--\n[hidden]: /not-a-definition\n-->\n\n[after]: /after"
      ).replaceAll("\n", newline);
      assert.deepEqual(collect(source), {
        markdown: "[标签]: <https://example.invalid/a%7Cb>\n[after]: /after",
        limited: false,
      }, JSON.stringify(source));
    }
  }
});

test("extracts nested and multiline definition destinations without leaking container prefixes", () => {
  const source = '> [quoted]:\n>   <https://example.invalid/quoted>\n>   "title"\n\n- [listed]: https://example.invalid/listed\n    "title"';
  assert.deepEqual(collect(source), {
    markdown: "[quoted]: <https://example.invalid/quoted>\n[listed]: https://example.invalid/listed", limited: false,
  });
});

test("preserves URI source spelling, escapes and Unicode instead of resolving or fetching", () => {
  assert.deepEqual(collect(String.raw`[标签\|id]: <https://example.invalid/a%7Cb?x=1&y=2>`), {
    markdown: String.raw`[标签\|id]: <https://example.invalid/a%7Cb?x=1&y=2>`, limited: false,
  });
  assert.deepEqual(collect("[bad-scheme]: javascript:alert(1)"), {
    markdown: "[bad-scheme]: javascript:alert(1)", limited: false,
  }); // Sanitization belongs to the actual shared renderer, not this projection.
});

test("distinguishes no reference context from source size limits, including UTF-8", () => {
  assert.deepEqual(collect("ordinary source without definitions"), { markdown: "", limited: false });
  assert.deepEqual(collect(`plain ]: text\n${"x".repeat(limits.sourceBytes)}`), { markdown: "", limited: true });
  assert.deepEqual(collect(`[id]: /target\n${"字".repeat(Math.ceil(limits.sourceBytes / 3))}`), { markdown: "", limited: true });
});

test("bounds definition count without returning a truncated definition", () => {
  const definitions = Array.from({ length: limits.definitions + 1 }, (_, index) => `[ref${index}]: /target${index}`);
  const result = collect(definitions.join("\n"));
  assert.equal(result.limited, true);
  assert.equal(result.markdown.split("\n").length, limits.definitions);
  assert.equal(result.markdown, definitions.slice(0, limits.definitions).join("\n"));
  assert.equal(collect(definitions.slice(0, limits.definitions).join("\n")).limited, false);
});

test("bounds UTF-8 projection bytes and rejects an oversized definition intact", () => {
  const definitions = Array.from({ length: 100 }, (_, index) => `[ref${index}]: /${"字".repeat(160)}`);
  const result = collect(definitions.join("\n"));
  assert.equal(result.limited, true);
  assert.ok(Buffer.byteLength(result.markdown) <= limits.definitionBytes);
  assert.ok(definitions.includes(result.markdown.split("\n").at(-1)));
  assert.deepEqual(collect(`[huge]: /${"x".repeat(limits.definitionBytes)}`), { markdown: "", limited: true });
});

test("does not misrepresent footnote bodies or multiline labels as complete link context", () => {
  for (const source of ["[^note]: /url", "[^note]: a whole footnote paragraph", "[multi\nline]: /target"]) {
    assert.deepEqual(collect(source), { markdown: "", limited: true }, source);
  }
  assert.deepEqual(collect("```\n[^example]: a footnote example\n```"), { markdown: "", limited: false });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import Module from "node:module";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const sourcePath = new URL("../../apps/web/lib/annotation-document.ts", import.meta.url);
const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(sourcePath.pathname);
loaded.filename = sourcePath.pathname;
loaded.paths = Module._nodeModulePaths(new URL("../../apps/web", import.meta.url).pathname);
loaded._compile(compiled, loaded.filename);
const { annotationDocumentHeader, annotationDocumentEntry } = loaded.exports;
const fixture = JSON.parse(readFileSync(new URL("./fixtures/annotation-document-v1.json", import.meta.url), "utf8"));

test("offline annotation Markdown serializer follows the shared synthetic v1 fixture", () => {
  const result = annotationDocumentHeader(fixture.title, fixture.exported_at, 1)
    + annotationDocumentEntry(fixture.record, 1);
  assert.match(result, /chat-reader-annotation-export version=1/);
  assert.match(result, /````text\nA `quoted` line\nwith ``` fences\.\n````/);
  assert.match(result, /Synthetic \*\*comment\*\*\./);
  assert.match(result, /批注数：1/);
});

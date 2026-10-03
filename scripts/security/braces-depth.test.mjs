import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const web = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const tailwind = createRequire(web.resolve("tailwindcss/package.json"));
const paths = ["micromatch", "chokidar"].map((name) =>
  createRequire(tailwind.resolve(`${name}/package.json`)).resolve("braces"));
const braces = createRequire(fileURLToPath(import.meta.url))(paths[0]);
const depthFailure = (error) => error instanceof SyntaxError && error.code === "BRACES_MAX_DEPTH";

test("Tailwind watcher and glob matcher resolve the same patched package", () => {
  assert.equal(paths[0], paths[1]);
  for (const path of new Set(paths)) {
    const dependency = createRequire(import.meta.url)(path);
    assert.throws(() => dependency.parse("{".repeat(256) + "a,b" + "}".repeat(256)), depthFailure);
  }
});

test("deep closed, unterminated, parenthesized and mixed patterns fail before stack exhaustion", () => {
  const inputs = ["{".repeat(4000) + "a,b" + "}".repeat(4000), "{".repeat(4000),
    "(".repeat(4000) + "a" + ")".repeat(4000), "({".repeat(1000) + "a,b" + "})".repeat(1000)];
  for (const input of inputs) for (const method of ["parse", "compile", "expand", "stringify"]) {
    assert.throws(() => braces[method](input), depthFailure);
  }
  assert.deepEqual(braces.expand("file-{a,b}.md"), ["file-a.md", "file-b.md"]);
});

test("direct AST callers cannot bypass the depth bound", () => {
  for (const method of ["compile", "expand", "stringify"]) {
    const root = { type: "root", nodes: [] };
    let parent = root;
    for (let index = 0; index < 2000; index++) {
      const child = { type: "brace", nodes: [], open: true, close: true, commas: 1, parent };
      parent.nodes.push(child); parent = child;
    }
    parent.nodes.push({ type: "text", value: "a" });
    assert.throws(() => braces[method](root), depthFailure);
  }
});

test("ordinary nested alternatives, ranges, escaping and repository globs keep their results", () => {
  assert.deepEqual(braces.expand("a/{b,{c,d}}/e"), ["a/b/e", "a/c/e", "a/d/e"]);
  assert.deepEqual(braces.expand("file-{01..03}.md"), ["file-01.md", "file-02.md", "file-03.md"]);
  assert.equal(braces.compile("src/**/*.{ts,tsx}"), "src/**/*.(ts|tsx)");
  assert.equal(braces.stringify(braces.parse("{a,{b,c}}")), "{a,{b,c}}");
  assert.deepEqual(braces.expand("\\{literal\\}"), ["{literal}"]);
  assert.equal(braces.stringify("(".repeat(64) + "a" + ")".repeat(64)), "(".repeat(64) + "a" + ")".repeat(64));
});

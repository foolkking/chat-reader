import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/attachments/image-display-position.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { imageDisplayMenuPosition: place } = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));
const size = { width: 272, height: 106 }, desktop = { width: 1440, height: 900 };
const toc = { left: 1170, right: 1440, top: 80, bottom: 850 };

test("ordinary image menus remain below and right-aligned with the trigger", () => {
  assert.deepEqual(place({ right: 800, bottom: 300 }, size, desktop, [toc]), { left: 528, top: 304 });
});
test("desktop sticky TOC cannot occlude the 100% preset", () => {
  assert.deepEqual(place({ right: 1360, bottom: 300 }, size, desktop, [toc]), { left: 890, top: 304 });
});
test("both sticky rails are avoided without crossing the viewport", () => {
  const index = { left: 0, right: 280, top: 80, bottom: 850 };
  const position = place({ right: 300, bottom: 300 }, size, desktop, [index, toc]);
  assert.deepEqual(position, { left: 288, top: 304 });
});
test("hidden zero-area and vertically separate rails do not move the menu", () => {
  const anchor = { right: 1360, bottom: 300 };
  for (const rail of [{ ...toc, left: toc.right }, { ...toc, top: toc.bottom }, { ...toc, top: 500 }]) {
    assert.deepEqual(place(anchor, size, desktop, [rail]), { left: 1088, top: 304 });
  }
});
test("mobile and bottom-edge menus retain viewport clamping", () => {
  assert.deepEqual(place({ right: 370, bottom: 850 }, size, { width: 375, height: 900 }, []), { left: 87, top: 778 });
});

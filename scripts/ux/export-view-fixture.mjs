import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const web = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = web("typescript");
// These two leaves are part of the list views, not mocks of selection or rendering.
function leaf(path) {
  const mod = { exports: {} };
  const src = readFileSync(new URL("../../apps/web/" + path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(src, { fileName: path, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } });
  new Function("require", "module", "exports", outputText)(name => {
    if (name !== "react/jsx-runtime" && name !== "lucide-react") throw Error("Unexpected export view dependency: " + name);
    return web(name);
  }, mod, mod.exports);
  return mod.exports;
}

export const exportViewDependencies = {
  "../../lib/export-selection": leaf("lib/export-selection.ts"),
  "../../components/export-selected": leaf("components/export-selected.tsx"),
};

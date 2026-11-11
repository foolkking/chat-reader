// Execute the actual pure recovery module, not a classifier/translation stub.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(new URL("../../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const code = ts.transpileModule(readFileSync(new URL("../../../apps/web/lib/context-return-recovery.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
new Function("exports", code)(exports);
export default exports;

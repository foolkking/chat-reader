import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/import/import-workspace-copy.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function formatter(locale) {
  const exports = {};
  new Function("require", "exports", compiled)(name => {
    if (name === "react") return { useCallback: callback => callback };
    if (name === "../../components/preferences-provider") return { usePreferences: () => ({ resolvedLocale: locale }) };
    throw new Error(`Unexpected copy dependency: ${name}`);
  }, exports);
  const tr = exports.useImportCopy();
  return (error, action = "mutation") => exports.importErrorMessage(error, tr, action);
}

const messages = {
  "zh-CN": "导入分析的提交结果尚未确认。请先在任务中心核对是否已有本批分析，再决定是否重新上传。",
  "en-US": "Import analysis submission is not confirmed. Check Tasks for this batch before uploading it again.",
};
for (const locale of Object.keys(messages)) {
  for (const code of ["SESSION_PERSISTENCE_FAILED", "SESSION_ANALYSIS_FAILED"]) {
    for (const shape of ["code", "api"]) {
      test(`${locale} ${code} ${shape}: check Tasks before another upload`, () => {
        const format = formatter(locale);
        const error = shape === "code" ? code : {
          name: "ApiRequestError", status: 500, code, message: "private synthetic database detail",
        };
        for (const action of ["read", "mutation", "commit"]) {
          assert.equal(format(error, action), messages[locale]);
        }
      });
    }
  }
}

test("permission, validation, replacement and ordinary read failures retain their existing recovery", () => {
  const format = formatter("en-US");
  assert.equal(format({ name: "ApiRequestError", status: 403, message: "private detail" }),
    "You do not have permission to complete this import.");
  assert.equal(format({ name: "ApiRequestError", status: 422, code: "JSON_INVALID", message: "Synthetic invalid JSON." }),
    "Synthetic invalid JSON.");
  assert.equal(format("SOURCE_REPLACEMENT_FAILED"),
    "The replacement could not be saved. The original file is retained; please retry shortly.");
  assert.equal(format("CONNECTION_FAILED", "read"),
    "Cannot connect to the server. Check your network and retry; your input is retained.");
  assert.equal(format("CONNECTION_FAILED"),
    "The request result is not confirmed. Check the current import state before deciding whether to retry.");
});

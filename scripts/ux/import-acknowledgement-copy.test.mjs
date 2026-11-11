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

for (const file of ["import-panel.tsx", "adaptive-import-workspace.tsx"]) {
  test(`${file}: every literal import label and instruction has English copy with unchanged placeholders`, () => {
    const exports = {};
    new Function("require", "exports", compiled)(name => name === "react"
      ? { useCallback: callback => callback }
      : { usePreferences: () => ({ resolvedLocale: "en-US" }) }, exports);
    const tr = exports.useImportCopy();
    const content = readFileSync(new URL(`../../apps/web/features/import/${file}`, import.meta.url), "utf8");
    const parsed = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const keys = new Set();
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "tr"
        && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) keys.add(node.arguments[0].text);
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    assert.ok(keys.size > 20, "Read actual production translation calls");
    for (const key of keys) {
      const values = Array.from({ length: 8 }, (_, index) => `VALUE_${index}`);
      const translated = tr(key, ...values);
      assert.doesNotMatch(translated, /[\u4e00-\u9fff]/, `Missing English copy: ${key}`);
      assert.deepEqual([...translated.matchAll(/VALUE_\d+/g)].map(match => match[0]).sort(),
        [...key.matchAll(/\{(\d+)\}/g)].map(match => values[Number(match[1])]).sort(), key);
    }
  });
}

test("unfinished import states explain the next step in both locales without raw internal enums", () => {
  const exports = {};
  new Function("require", "exports", compiled)(() => ({}), exports);
  for (const state of ["COLLECTING", "ANALYZING", "CANCELING", "PAUSED", "NEEDS_GROUPING", "RESOLVING", "READY", "IMPORTING", "COMPLETED", "BLOCKED", "FAILED", "CANCELED"]) {
    for (const zh of [false, true]) assert.notEqual(exports.importStateLabel(state, zh), state);
  }
  assert.match(exports.importStateLabel("READY", false), /review/i);
  assert.match(exports.importStateLabel("PAUSED", true), /来源保留/);
  assert.equal(exports.importStateLabel("FUTURE_STATE", false), "Check status");
});

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

for (const locale of ["zh-CN", "en-US"]) test(`${locale}: missing ZIP warning retains count without claiming an uncommitted import succeeded`, () => {
  const exports = {};
  new Function("require", "exports", compiled)(name => name === "react"
    ? { useCallback: callback => callback }
    : { usePreferences: () => ({ resolvedLocale: locale }) }, exports);
  const tr = exports.useImportCopy();
  assert.equal(exports.importWarningMessage("ZIP missing attachments: 3. Text and missing references are retained.", tr),
    locale === "zh-CN" ? "缺少 3 个附件；正文和缺失引用已保留。" : "3 attachments are missing; text and missing references were retained.");
  assert.equal(tr("已导入，部分附件缺失"), locale === "zh-CN" ? "已导入，部分附件缺失" : "Imported with missing attachments");
  assert.doesNotMatch(exports.importErrorMessage("MARKDOWN_RESOURCE_MISSING", tr), /已导入|Imported with/);
  assert.equal(exports.importWarningMessage("Unrelated preserved warning", tr), "Unrelated preserved warning");
});

for (const locale of ["zh-CN", "en-US"]) test(`${locale}: ZIP body-link warning and member errors explain different recovery paths`, () => {
  const exports = {};
  new Function("require", "exports", compiled)(name => name === "react"
    ? { useCallback: callback => callback }
    : { usePreferences: () => ({ resolvedLocale: locale }) }, exports);
  const tr = exports.useImportCopy(), zh = locale === "zh-CN";
  const warning = exports.importWarningMessage("ZIP blocked references: 2. Link text is retained.", tr);
  assert.match(warning, /2/);
  assert.match(warning, zh ? /可正常导入/ : /can be imported/);
  const failure = exports.importFailureMessage({
    code: "ZIP_PATH_UNSAFE", details: { entry_index: 4, reason: "parent_segment" },
  }, null, "analysis", zh);
  assert.match(failure, /4/);
  assert.match(failure, zh ? /上级目录/ : /parent segment/);
  assert.match(failure, zh ? /修正.*相对路径/ : /Correct.*relative path/);
  assert.doesNotMatch(failure, zh ? /重新导出标准/ : /Export a standard ZIP/);
  assert.match(exports.importFailureMessage({ code: "ZIP_MEMBER_UNSUPPORTED", details: { reason: "encrypted" } }, null, "analysis", zh),
    zh ? /未加密/ : /unencrypted/);
});

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

for (const locale of ["zh-CN", "en-US"]) test(`${locale}: stalled reads explain retained input, not a failed import or a repeated write`, () => {
  const format = formatter(locale), expected = locale === "zh-CN"
    ? "读取结果超时，原文件和当前输入仍保留。可继续核对，没有重新提交。"
    : "Reading the result timed out. Original files and current input are retained. Continue checking; nothing was resubmitted.";
  assert.equal(format(new Error("REQUEST_TIMEOUT"), "read"), expected);
  assert.equal(format("REQUEST_TIMEOUT", "read"), expected);
  assert.notEqual(format(new Error("REQUEST_TIMEOUT"), "mutation"), expected);
});

for (const locale of ["zh-CN", "en-US"]) test(`${locale}: bounded import errors never expose internals or claim success`, () => {
  const format = formatter(locale);
  for (const code of ["IMPORT_OPERATION_UNCONFIRMED", "IMPORT_RESOURCE_WAIT_EXPIRED",
    "IMPORT_STORAGE_FULL", "IMPORT_WORKSPACE_EXCEEDED", "IMPORT_MESSAGE_TOO_LARGE"]) {
    const result = format({ name: "ApiRequestError", status: 409, code, message: "/private/synthetic-source" });
    assert.doesNotMatch(result, /private|synthetic-source/);
    assert.doesNotMatch(result, /successfully|成功导入/);
    if (locale === "en-US") assert.doesNotMatch(result, /[\u4e00-\u9fff]/);
  }
});

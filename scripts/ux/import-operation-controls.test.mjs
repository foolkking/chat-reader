// Actual TSX callbacks with controlled hooks/transport, not DOM acceptance.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const React = require("react"), ts = require("typescript");
const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node)
  : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { resolve, reject, promise }; };
function fixture(kind, locale = "zh-CN") {
  let cursor = 0, mutationCursor = 0, active = null, next = 0, tree, operation;
  const slots = [], mutations = [], calls = [], ended = [], promises = [];
  const state = init => slots[cursor++] ??= init();
  class ApiRequestError extends Error { constructor(message, code) { super(message); this.code = code; } }
  const transport = (...args) => {
    const options = args.at(-1); calls.push({ args, options });
    return operation(options);
  };
  const mocks = {
    react: { ...React, useRef: value => state(() => ({ current: value })),
      useState: init => { const s = state(() => ({ value: typeof init === "function" ? init() : init }));
        return [s.value, next => { s.value = typeof next === "function" ? next(s.value) : next; }]; },
      useCallback: fn => fn, useEffect() {} },
    "@tanstack/react-query": { useQueryClient: () => ({ setQueryData() {} }), useQuery: () => ({}),
      useMutation: options => {
        const m = mutations[mutationCursor++] ??= { isPending: false, isError: false, isSuccess: false, error: null };
        m.mutate = () => {
          m.isPending = true; m.isError = false;
          const pending = Promise.resolve().then(options.mutationFn).then(result => {
            options.onSuccess?.(result); m.isSuccess = true;
          }, error => { m.isError = true; m.error = error; }).finally(() => { m.isPending = false; });
          promises.push(pending);
        };
        return m;
      } },
    "../../lib/api": { ApiRequestError, checkAdaptiveFamilyHealth: transport, previewAdaptiveFamilyMapping: transport },
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: locale }) },
    "../../components/interaction-dialog-provider": { useInteractionDialog: () => ({ confirm: async () => false }) },
    "./format-health-check": { FormatHealthCheck: "FormatHealthCheck" },
    "../conversations/markdown-renderer": { MarkdownRenderer: "MarkdownRenderer" },
    "./adaptive-import-workspace": {
      asObject: value => value && typeof value === "object" && !Array.isArray(value) ? value : {},
      asArray: value => Array.isArray(value) ? value : [],
    },
  };
  const load = file => {
    const source = readFileSync(new URL(`../../apps/web/features/import/${file}`, import.meta.url), "utf8");
    const output = ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, module = { exports: {} };
    new Function("exports", "require", output)(module.exports, name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith(".")) throw Error(`Unexpected dependency ${name}`);
      return require(name);
    });
    return module.exports;
  };
  mocks["./import-workspace-copy"] = load("import-workspace-copy.ts");
  const Component = kind === "health" ? load("format-health-check.tsx").FormatHealthCheck : load("mapping-workspace.tsx").MappingWorkspace;
  const family = { id: "synthetic-family", source_mode: "JSON", resolution_status: "MAPPABLE", group_count: 1,
    mapping_draft: { messages: { locator: "$.messages" } }, matched_profile_key: "synthetic-profile", match_evidence: {} };
  const props = { session: { import_id: "synthetic-import", groups: [] }, family, onBack() {}, sessionActionBusy: false,
    sessionAction: { begin: () => { assert.equal(active, null); return active = ++next; },
      finish: token => { assert.equal(token, active); ended.push(token); active = null; }, background() {}, apply() {} } };
  const render = () => { cursor = 0; mutationCursor = 0; return tree = Component(props); };
  const action = () => nodes(tree).find(node => node.type === "button"
    && /检查已保存格式|继续查看检查结果|正在检查|Check saved format|Continue reading check result|Checking every group|验证映射|继续查看验证结果|正在验证|Validate mapping|Continue reading validation result|Validating/.test(text(node)));
  render();
  return { render, action, calls, ended, promises, ApiRequestError, props, tree: () => tree,
    setOperation: fn => { operation = fn; }, active: () => active };
}
for (const kind of ["health", "mapping"]) for (const locale of ["zh-CN", "en-US"]) {
  test(`${kind}/${locale}: failed known-task read releases busy and continues the same task, preserving mapping`, async () => {
    const f = fixture(kind, locale), held = deferred();
    f.setOperation(options => { options.onQueued("synthetic-original-task"); return held.promise; });
    f.action().props.onClick(); await Promise.resolve(); f.render();
    assert.equal(f.action().props.disabled, true);
    held.reject(Error("REQUEST_TIMEOUT")); await f.promises[0]; f.render();
    assert.equal(f.active(), null); assert.deepEqual(f.ended, [1]);
    assert.equal(f.action().props.disabled, false);
    assert.match(text(f.action()), /继续查看|Continue reading/);
    assert.equal(nodes(f.tree()).filter(node => node.type === "button" && /^(重试|Retry)$/.test(text(node))).length, 0);
    f.setOperation(async options => {
      assert.equal(options.taskId, "synthetic-original-task");
      return kind === "health" ? { valid: true, groups: [] } : { validation: { valid: true }, conversations: [] };
    });
    f.action().props.onClick(); await f.promises[1]; f.render();
    assert.equal(f.calls[0].options.taskId, undefined); assert.equal(f.calls[1].options.taskId, "synthetic-original-task");
    if (kind === "mapping") assert.deepEqual(f.calls[1].args[2], f.calls[0].args[2]);
    assert.deepEqual(f.ended, [1, 2]); assert.equal(f.active(), null);
  });
  test(`${kind}/${locale}: unknown submission does not offer an unsafe repeat`, async () => {
    const f = fixture(kind, locale);
    f.setOperation(async () => { throw new f.ApiRequestError("Unknown", "IMPORT_OPERATION_UNCONFIRMED"); });
    f.action().props.onClick(); await f.promises[0]; f.render();
    assert.equal(f.action().props.disabled, true);
    assert.ok(nodes(f.tree()).some(node => node.type === "button" && /查看后台任务|View background tasks/.test(text(node))));
    assert.equal(f.calls.length, 1);
  });
}

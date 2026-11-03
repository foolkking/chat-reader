import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/import/adaptive-import-workspace.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["editArchiveClassificationDraft", "mergeArchiveCatalogPages"];
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
assert.equal(functions.length, names.length);
const code = ts.transpileModule(functions.map(node => node.getText(ast)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const { edit, merge } = new Function(code + "\nreturn {edit: editArchiveClassificationDraft, merge: mergeArchiveCatalogPages};")();
const page = (version, offset, members, hasMore = false) => ({
  classification_version: version, offset, limit: 1, member_count: 2, members, has_more: hasMore,
});

test("next-page loading preserves selections for already reviewed ZIP members", () => {
  const first = { member_id: "synthetic-a", use: "attachment", owner_document_ids: ["doc"] };
  const second = { member_id: "synthetic-b", use: "excluded", owner_document_ids: [] };
  const draft = edit({ version: null, members: {} }, 1, first.member_id, { use: "excluded", ownerDocumentIds: [] });
  const { catalog, mixedVersions } = merge([page(1, 0, [first], true), page(1, 1, [second])]);
  assert.equal(mixedVersions, false);
  assert.equal(catalog.members.length, 2);
  assert.equal(draft.members[first.member_id].use, "excluded");
  const changed = edit(draft, 1, second.member_id, { use: "attachment", ownerDocumentIds: ["doc"] });
  assert.equal(changed.members[first.member_id].use, "excluded");
  // This is an override-only draft. No catalog/refetch effect may replace it.
  assert.doesNotMatch(source, /setDraft(?:State)?\(Object\.fromEntries/);
});

test("mixed-version pages cannot be presented or saved as one classification", () => {
  const result = merge([page(1, 0, [{ member_id: "old" }], true), page(2, 1, [{ member_id: "new" }])]);
  assert.equal(result.mixedVersions, true);
  assert.deepEqual(result.catalog.members.map(item => item.member_id), ["old"]);
  assert.match(source, /disabled=\{!dirtyChanges\.length \|\| sessionActionBusy \|\| saveMutation\.isPending \|\| mixedVersions \|\| staleDraft\}/);
});

test("a newer classification preserves but cannot silently rebase old edits", () => {
  const draft = edit({ version: null, members: {} }, 1, "synthetic", { use: "excluded", ownerDocumentIds: [] });
  assert.equal(edit(draft, 2, "other", { use: "excluded", ownerDocumentIds: [] }), draft);
  assert.equal(draft.version, 1);
  assert.match(source, /放弃旧选择，使用最新分类/);
});

test("unsaved ZIP classification guards import, overview navigation and outer dialog close", () => {
  assert.match(source, /overviewActionBusy = sessionActionBusy \|\| importing \|\| archiveDirty \|\| archiveBusy/);
  assert.match(source, /data-testid="commit-import-button" disabled=\{!session\.can_import \|\| overviewActionBusy\}/);
  assert.match(source, /disabled=\{overviewActionBusy\} onClick=\{onBack\}/);
  assert.match(source, /onMappingStateChange\?\.\(\{ dirty: mappingState\.dirty \|\| archiveDirty/);
  assert.match(source, /onStateChange\(archive\.artifact_id, \{ dirty, busy: saveMutation\.isPending \}\)/);
  assert.match(source, /放弃 ZIP 分类选择/);
});

// Execute the actual ledger component with deterministic hook/query scheduling.
// These state transitions are not browser layout, focus or native-select tests.
function ledgerFixture(initialPages) {
  const needed = ["ArchiveLedgerRow", ...names, "sameStringArray"];
  const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node) && needed.includes(node.name?.text));
  assert.equal(selected.length, needed.length);
  const compiled = ts.transpileModule(selected.map(node => node.getText(ast)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const slots = [], effects = [], statuses = [], writes = [];
  let cursor = 0, pages = initialPages, tree;
  const useState = initial => {
    const slot = cursor++;
    if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial;
    return [slots[slot], value => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; }];
  };
  const useEffect = (effect, deps) => {
    const slot = cursor++, previous = slots[slot];
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      effects.push(() => { previous?.cleanup?.(); slots[slot] = { deps, cleanup: effect() }; });
    }
  };
  const dependencies = {
    require, exports: {}, useState, useEffect, useMemo: fn => fn(), useImportCopy: () => text => text,
    useInfiniteQuery: () => ({ data: { pages }, refetch() {}, fetchNextPage() {} }),
    useAdaptiveSessionAction: (fn, _controls, onApplied) => ({
      isPending: false, isError: false, run: value => { fn(value); onApplied({}); },
    }),
    getAdaptiveImportArchive() {},
    updateAdaptiveImportArchive: (...args) => writes.push(args),
    formatBytes: String, ArchiveMemberRow: "Member", ErrorLine: "Error", Save: "Save", LoaderCircle: "Loading",
  };
  const component = new Function(...Object.keys(dependencies), compiled + "\nreturn ArchiveLedgerRow;")(...Object.values(dependencies));
  const props = {
    archive: { artifact_id: "zip", filename: "synthetic.zip", byte_size: 1, classification_version: 1, issue_count: 0, blocking_issue_count: 0 },
    session: { import_id: "session" }, sessionAction: {}, sessionActionBusy: false,
    onStateChange: (_id, state) => statuses.push(state),
  };
  const find = (node, predicate) => {
    if (!node || typeof node !== "object") return undefined;
    if (Array.isArray(node)) { for (const child of node) { const hit = find(child, predicate); if (hit) return hit; } return undefined; }
    return predicate(node) ? node : find(node.props?.children, predicate);
  };
  const text = node => Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text(node.props?.children) : typeof node === "string" ? node : "";
  const render = () => {
    cursor = 0; tree = component(props);
    for (const effect of effects.splice(0)) effect();
    return tree;
  };
  render();
  find(tree, node => node.props?.["aria-label"] === "查看 ZIP 内容").props.onClick();
  render();
  return {
    writes, statuses, render,
    setPages: next => { pages = next; render(); },
    member: id => find(tree, node => node.type === "Member" && node.props.member.member_id === id),
    button: label => find(tree, node => node.type === "button" && text(node) === label),
  };
}
const member = (id, use = "attachment") => ({ member_id: id, use, owner_document_ids: ["doc"], kind: "file" });
const catalog = (version, offset, members, hasMore = false) => ({
  ...page(version, offset, members, hasMore), issues: [],
});

test("actual ZIP ledger retains edited rows across pagination, refetch and collapse", () => {
  const first = catalog(1, 0, [member("a")], true);
  const f = ledgerFixture([first]);
  f.member("a").props.onChange({ use: "excluded", ownerDocumentIds: [] });
  f.render();
  assert.equal(f.statuses.at(-1).dirty, true);
  f.setPages([{ ...first }, catalog(1, 1, [member("b")])]);
  assert.equal(f.member("a").props.draft.use, "excluded");
  assert.equal(f.member("b").props.draft.use, "attachment");
  f.button("收起内容").props.onClick(); f.render();
  assert.equal(f.statuses.at(-1).dirty, true);
  f.button("查看内容").props.onClick(); f.render();
  assert.equal(f.member("a").props.draft.use, "excluded");
  const save = f.button("保存 ZIP 分类");
  assert.equal(save.props.disabled, false);
  save.props.onClick(); f.render();
  assert.deepEqual(f.writes, [["session", "zip", 1, [{ memberId: "a", use: "excluded", ownerDocumentIds: [] }]]]);
  assert.equal(f.statuses.at(-1).dirty, false);
});

test("actual ZIP ledger cannot silently save an old draft over a new catalog", () => {
  const f = ledgerFixture([catalog(1, 0, [member("a")])]);
  f.member("a").props.onChange({ use: "excluded", ownerDocumentIds: [] }); f.render();
  f.setPages([catalog(2, 0, [member("a")])]);
  assert.equal(f.member("a").props.draft.use, "excluded");
  assert.equal(f.member("a").props.disabled, true);
  assert.equal(f.button("保存 ZIP 分类").props.disabled, true);
  assert.equal(f.statuses.at(-1).dirty, true);
  assert.equal(f.writes.length, 0);
  f.button("放弃旧选择，使用最新分类").props.onClick(); f.render();
  assert.equal(f.member("a").props.draft.use, "attachment");
  assert.equal(f.member("a").props.disabled, false);
  assert.equal(f.statuses.at(-1).dirty, false);
});

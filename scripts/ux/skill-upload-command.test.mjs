import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const { QueryClient, MutationObserver } = require("@tanstack/react-query");
const source = readFileSync(new URL("../../apps/web/components/skill-settings.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { fileName: "skill-settings.tsx", compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const text = node => node == null || typeof node === "boolean" ? ""
  : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
const noop = () => {};
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(child => nodes(child));
  return [node, ...nodes(node.props?.children)];
}
class ApiRequestError extends Error {
  constructor(message, status, path) { super(message); this.status = status; this.path = path; }
}

// Actual compiled component handlers/JSX and installed MutationObserver.
// Hook scheduling, files, query results and transport are controlled adapters,
// not mounted React/browser evidence. Holding option effects reproduces the
// installed useMutation's passive observer.setOptions boundary deterministically.
function fixture(initialLocale = "en-US") {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: Infinity } } });
  const states = [], refs = [], observers = [], writes = [], dirty = [], reads = [];
  let stateIndex, refIndex, mutationIndex, passive = [], layout = [], tree, pending;
  let outcome = "success", hold = null, resolvedLocale = initialLocale, queryOptions;
  const fileElement = { value: "" };
  const hooks = {
    useState: initial => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useRef: initial => refs[refIndex++] ??= { current: initial },
    useMemo: fn => fn(),
    useEffect: fn => passive.push(fn),
    useLayoutEffect: fn => layout.push(fn),
  };
  const api = { ApiRequestError, getSkills: async (input, signal) => {
    reads.push({ input, signal }); return [];
  }, createSkill: async input => {
    writes.push(input);
    if (hold) await hold;
    if (outcome === "failure") throw new ApiRequestError("Synthetic rejected upload", 503, "/api/skills");
    return { id: "synthetic-upload", name: input.name, bundle_revision: 1 };
  } };
  const modules = {
    react: hooks,
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    "@tanstack/react-query": {
      useQueryClient: () => client,
      useQuery: options => {
        queryOptions = options;
        return { data: [], isPending: false, isLoading: false };
      },
      useMutation: options => {
        const index = mutationIndex++;
        const observer = observers[index] ??= new MutationObserver(client, options);
        passive.push(() => observer.setOptions(options));
        return { ...observer.getCurrentResult(), reset: () => observer.reset(),
          mutate: variables => { pending = observer.mutate(variables); void pending.catch(noop); } };
      },
    },
    "../lib/api": api,
    "./preferences-provider": { usePreferences: () => ({ resolvedLocale }) },
    "./interaction-dialog-provider": { useInteractionDialog: () => ({ confirm: async () => true, prompt: async () => null }) },
    "./skill-bundle-files": { SkillBundleFiles: noop },
  };
  const module = { exports: {} };
  new Function("require", "exports", compiled)(name => {
    if (Object.hasOwn(modules, name)) return modules[name];
    if (name.startsWith(".")) throw new Error(`Unexpected Skill dependency: ${name}`);
    return require(name);
  }, module.exports);
  const render = (flushPassive = true) => {
    stateIndex = refIndex = mutationIndex = 0; passive = []; layout = [];
    tree = module.exports.SkillSettings({ focused: true, onDirtyChange: value => dirty.push(value) });
    for (const node of nodes(tree)) if (node.type === "input" && node.props.type === "file") node.props.ref.current = fileElement;
    for (const effect of layout) effect();
    if (flushPassive) for (const effect of passive) effect();
  };
  const button = label => {
    const node = nodes(tree).find(node => node.type === "button" && text(node) === label);
    assert.ok(node, `Missing Skill button ${label}`); return node.props;
  };
  const nameInput = () => nodes(tree).find(node => node.type === "input" && !node.props.type).props;
  const fileInput = () => nodes(tree).find(node => node.type === "input" && node.props.type === "file").props;
  const setName = (value, flushPassive = true) => {
    nameInput().onChange({ target: { value } }); render(flushPassive);
  };
  const setFile = (file, flushPassive = true) => {
    fileElement.value = file?.name ?? "";
    fileInput().onChange({ target: { files: file ? [file] : [] } }); render(flushPassive);
  };
  render(); button(resolvedLocale === "zh-CN" ? "上传我的 Skill" : "Upload my Skill").onClick(); render();
  return { writes, dirty, reads, render, button, nameInput, fileInput, setName, setFile, fileElement,
    query: () => queryOptions,
    statuses: () => nodes(tree).filter(node => node.props?.role === "status").map(text),
    setLocale: value => { resolvedLocale = value; render(); },
    save: () => {
      const save = button(resolvedLocale === "zh-CN" ? "保存 Skill" : "Save Skill");
      assert.equal(save.disabled, false); save.onClick(); return pending;
    },
    setOutcome: value => { outcome = value; },
    hold: () => { let resolve; hold = new Promise(done => { resolve = done; }); return () => { hold = null; resolve(); }; },
    dispose: () => client.clear(),
  };
}

test("the JSX adapter terminates at absent children and never restarts at the root", () => {
  const leaf = { type: "input", props: { value: "Synthetic" } };
  assert.deepEqual(nodes(undefined), []);
  assert.deepEqual(nodes(null), []);
  assert.deepEqual(nodes(leaf), [leaf]);
});

test("the JSX adapter retains siblings around empty and primitive children", () => {
  const first = { type: "input", props: {} }, second = { type: "button", props: { children: "Save" } };
  const root = { type: "section", props: { children: [first, undefined, false, [null, "text", second]] } };
  assert.deepEqual(nodes(root), [root, first, second]);
});

test("name-first upload carries the visible name and file before mutation option effects", async () => {
  const f = fixture(), file = { name: "browser-skill.zip" };
  try {
    f.setName("Synthetic chosen name");
    f.setFile(file, false);
    assert.equal(f.nameInput().value, "Synthetic chosen name");
    await f.save();
    assert.deepEqual(f.writes, [{ category: "EXPORT_CONTEXT", name: "Synthetic chosen name", file }]);
  } finally { f.dispose(); }
});

test("file-first upload never substitutes the filename from an older name closure", async () => {
  const f = fixture(), file = { name: "browser-skill.zip" };
  try {
    f.setFile(file);
    f.setName("  Synthetic explicit name  ", false);
    await f.save();
    assert.equal(f.writes[0].name, "Synthetic explicit name");
    assert.equal(f.writes[0].file, file);
  } finally { f.dispose(); }
});

test("replacing both fields submits one coherent latest draft, not mixed render fields", async () => {
  const f = fixture(), newer = { name: "newer.md" };
  try {
    f.setFile({ name: "old.zip" }); f.setName("Synthetic old");
    f.setName("Synthetic newer", false); f.setFile(newer, false);
    await f.save();
    assert.deepEqual(f.writes, [{ category: "EXPORT_CONTEXT", name: "Synthetic newer", file: newer }]);
  } finally { f.dispose(); }
});

for (const filename of ["synthetic.zip", "synthetic.MD"]) {
  test(`${filename}: intentionally blank names retain filename fallback`, async () => {
    const f = fixture(), file = { name: filename };
    try {
      f.setName("  "); f.setFile(file, false);
      await f.save();
      assert.equal(f.writes[0].name, "synthetic");
    } finally { f.dispose(); }
  });
}

test("a rejected upload retains both fields; only explicit retry sends the corrected command", async () => {
  const f = fixture(), file = { name: "retained.md" };
  try {
    f.setName("Synthetic retained"); f.setFile(file); f.setOutcome("failure");
    await assert.rejects(f.save(), error => error.status === 503);
    f.render();
    assert.equal(f.nameInput().value, "Synthetic retained");
    assert.equal(f.fileElement.value, "retained.md");
    assert.equal(f.dirty.at(-1), true);
    f.setName("Synthetic corrected", false); f.setOutcome("success");
    assert.equal(f.writes.length, 1);
    await f.save();
    assert.deepEqual(f.writes.map(item => item.name), ["Synthetic retained", "Synthetic corrected"]);
    assert.ok(f.writes.every(item => item.file === file));
    f.render();
    assert.equal(f.nameInput().value, "");
    assert.equal(f.fileElement.value, "");
    assert.equal(f.dirty.at(-1), false);
  } finally { f.dispose(); }
});

test("pending upload disables edits and unrelated renders retain the draft until acknowledgement", async () => {
  const f = fixture();
  try {
    f.setName("Synthetic pending"); f.setFile({ name: "pending.md" });
    const release = f.hold(), saved = f.save();
    f.render();
    assert.equal(f.nameInput().disabled, true);
    assert.equal(f.fileInput().disabled, true);
    f.render();
    assert.equal(f.nameInput().value, "Synthetic pending");
    assert.equal(f.dirty.at(-1), true);
    release(); await saved; f.render();
    assert.equal(f.nameInput().disabled, false);
    assert.equal(f.nameInput().value, "");
    assert.equal(f.button("Save Skill").disabled, true);
    assert.equal(f.dirty.at(-1), false);
  } finally { f.dispose(); }
});

test("invalid file validation rejects before transport without clearing the draft", async () => {
  const f = fixture();
  try {
    f.setName("Synthetic invalid"); f.setFile({ name: "invalid.txt" }, false);
    await assert.rejects(f.save(), error => error.status === 422);
    f.render();
    assert.equal(f.writes.length, 0);
    assert.equal(f.nameInput().value, "Synthetic invalid");
    assert.equal(f.fileElement.value, "invalid.txt");
  } finally { f.dispose(); }
});

for (const [initial, hydrated, hint] of [["en-US", "zh-CN", "en"], ["zh-CN", "en-US", "zh-CN"]]) {
  test(`${initial} to ${hydrated}: interface hydration retains the panel query and unsaved upload`, async () => {
    const f = fixture(initial), file = { name: "retained.md" };
    try {
      f.setName("Synthetic retained"); f.setFile(file);
      const initialKey = f.query().queryKey;
      f.setLocale(hydrated);
      assert.deepEqual(f.query().queryKey, initialKey);
      assert.deepEqual(f.query().queryKey, ["skills", "EXPORT_CONTEXT", hint]);
      assert.equal(f.nameInput().value, "Synthetic retained");
      assert.equal(f.fileElement.value, "retained.md");
      assert.equal(f.dirty.at(-1), true);
      const signal = new AbortController().signal;
      await f.query().queryFn({ signal });
      assert.deepEqual(f.reads, [{ input: { category: "EXPORT_CONTEXT", locale: hint }, signal }]);
      await f.save();
      assert.deepEqual(f.writes, [{ category: "EXPORT_CONTEXT", name: "Synthetic retained", file }]);
    } finally { f.dispose(); }
  });
}

test("reopening captures the current legacy hint instead of sharing an earlier panel's scope", () => {
  const first = fixture(), second = fixture("zh-CN");
  try {
    first.setLocale("zh-CN");
    assert.equal(first.query().queryKey[2], "en");
    assert.equal(second.query().queryKey[2], "zh-CN");
  } finally { first.dispose(); second.dispose(); }
});

test("late preferences do not strand a pending upload's acknowledged notice", async () => {
  const f = fixture();
  try {
    f.setFile({ name: "pending.md" });
    const release = f.hold(), saved = f.save();
    f.setLocale("zh-CN");
    assert.equal(f.fileInput().disabled, true);
    assert.equal(f.query().queryKey[2], "en");
    release(); await saved; f.render();
    // Success belongs to the submitted scope even if its copy uses the
    // mutation's captured language. A display change must not discard it.
    assert.equal(f.nameInput().value, "");
    assert.equal(f.fileElement.value, "");
    assert.equal(f.dirty.at(-1), false);
    f.button("上传我的 Skill").onClick(); f.render();
    assert.equal(f.statuses().length, 1);
    assert.match(f.statuses()[0], /Skill 已保存|Skill saved/);
  } finally { f.dispose(); }
});

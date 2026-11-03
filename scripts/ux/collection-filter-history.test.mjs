import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const compiled = ts.transpileModule(readFileSync(new URL("../../apps/web/components/collection-view.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

// Execute the production hooks with a synchronous URL and a deliberately stale
// render snapshot. Browser routing, focus and scrolling are covered separately.
function fixture(path) {
  let current = new URL(path, "https://reader.invalid"), rendered = new URL(current);
  let pendingNavigation = null;
  const replacements = [], effects = [];
  const window = {
    get location() { return current; },
    history: {
      replaceState: (state, title, href) => {
        replacements.push({ state, title, href });
        current = new URL(href, current);
      },
      pushState: () => assert.fail("Collection edits must not append a history entry"),
    },
  };
  const modules = {
    react: {
      useCallback: operation => operation,
      useRef: current => ({ current }),
      useEffect: operation => { effects.push(operation); },
    },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": {
      usePathname: () => rendered.pathname,
      useSearchParams: () => new URLSearchParams(rendered.search),
      // Model the former RSC path too: only the last queued replacement settles.
      useRouter: () => ({ replace: href => { pendingNavigation = href; } }),
    },
    "@tanstack/react-query": {},
    "../lib/api": {},
    "../lib/offline-access": {},
  };
  const api = {};
  new Function("exports", "require", "window", compiled)(api, name => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`);
    return modules[name];
  }, window);
  return {
    render(pageSize) { rendered = new URL(current); return api.useCollectionView(pageSize); },
    url: () => new URL(current),
    replaceExternally(path) { current = new URL(path, current); },
    replacements,
    flushNavigation() {
      if (pendingNavigation !== null) current = new URL(pendingNavigation, current);
      pendingNavigation = null;
    },
    bounds(view, pageSize, total, ready) {
      return api.useCollectionPageBounds(view.offset, pageSize, total, ready, view.update);
    },
    flushEffects() { for (const effect of effects.splice(0)) effect(); },
  };
}

for (const [path, pageSize, filters, sort] of [
  ["/annotations", 50, { q: "Synthetic note", annotation_type: "comment", anchor_status: "attention" }, "created"],
  ["/reading-list", 20, { q: "Synthetic favorite", state: "unread" }, "added_asc"],
]) {
  test(`${path}: rapid edits compose before any new router render and reset pagination`, () => {
    const f = fixture(`${path}?${new URLSearchParams({ ...filters, offset: "100", extra: "retained" })}`);
    const view = f.render(pageSize);
    view.update({ project_id: "synthetic-project" });
    view.update({ sort });
    f.flushNavigation();
    assert.deepEqual(Object.fromEntries(f.url().searchParams), {
      ...filters, extra: "retained", project_id: "synthetic-project", sort,
    });
    assert.equal(f.replacements.length, 2);
    assert.ok(f.replacements.every(entry => entry.state === null && entry.title === ""));
    const current = f.render(pageSize);
    assert.equal(current.offset, 0);
    assert.equal(current.params.get("limit"), String(pageSize));
    assert.equal(current.params.get("project_id"), "synthetic-project");
  });

  test(`${path}: clearing a filter and explicit paging retain the other current conditions`, () => {
    const f = fixture(`${path}?${new URLSearchParams({ ...filters, project_id: "synthetic-project", sort, offset: "100" })}`);
    const view = f.render(pageSize);
    view.update({ project_id: "" });
    view.update({ offset: String(pageSize) });
    f.flushNavigation();
    assert.deepEqual(Object.fromEntries(f.url().searchParams), { ...filters, sort, offset: String(pageSize) });
    assert.equal(f.render(pageSize).offset, pageSize);
  });

  test(`${path}: a stale handler composes with restored history rather than resurrecting old filters`, () => {
    const f = fixture(`${path}?q=old&project_id=old-project`);
    const view = f.render(pageSize);
    f.replaceExternally(`${path}?q=restored&sort=${sort}&offset=${pageSize}`);
    view.update({ project_id: "new-project" });
    f.flushNavigation();
    assert.deepEqual(Object.fromEntries(f.url().searchParams), {
      q: "restored", sort, project_id: "new-project",
    });
    f.replaceExternally("/recent?q=unrelated");
    view.update({ q: "must-not-return-to-collection" });
    f.flushNavigation();
    assert.equal(f.url().pathname, "/recent");
    assert.equal(f.url().searchParams.get("q"), "unrelated");
    assert.equal(f.replacements.length, 1);
  });
}

test("collection bounds do not clamp failed/pending reads and preserve filters after successful recovery", () => {
  const f = fixture("/annotations?q=Synthetic&annotation_type=comment&offset=100");
  let view = f.render(50);
  assert.equal(f.bounds(view, 50, undefined, false), false);
  f.flushEffects();
  assert.equal(f.bounds(view, 50, 0, false), false);
  f.flushEffects();
  assert.equal(f.replacements.length, 0);
  assert.equal(f.url().searchParams.get("offset"), "100");
  view = f.render(50);
  assert.equal(f.bounds(view, 50, 0, true), true);
  f.flushEffects();
  f.flushNavigation();
  assert.deepEqual(Object.fromEntries(f.url().searchParams), { q: "Synthetic", annotation_type: "comment" });
  assert.equal(f.render(50).offset, 0);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const compiled = ts.transpileModule(
  readFileSync(new URL("../../apps/web/components/use-scoped-sort.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText;

function fixture() {
  const writes = [], invalidations = [], queries = [];
  let generation = 1;
  const projects = { data: undefined, isError: false, refetch: async () => ({ data: projects.data, error: projects.isError }) };
  const order = { data: { version: "synthetic-version", initialized: false }, isError: false, isFetching: false,
    refetch: async () => ({ data: order.data }) };
  const prefs = {
    projectSortMode: "custom", projectSortDirection: "asc",
    navigationSort: { all: { mode: "content_updated", direction: "desc" },
      unclassified: { mode: "imported", direction: "desc" }, project_default: { mode: "imported", direction: "desc" } },
    setNavigationSort: async value => writes.push(["preferences", value]),
  };
  const modules = {
    "@tanstack/react-query": {
      useQuery: options => { queries.push(options); return options.queryKey[0] === "projects" ? projects : order; },
      useQueryClient: () => ({ invalidateQueries: async value => invalidations.push(value) }),
    },
    "../lib/api": {
      getProjects: async () => projects.data, getConversationOrder: async () => order.data,
      changeConversationOrder: async value => writes.push(["order", value]),
      updateProject: async (id, value) => writes.push(["project", id, value]),
    },
    "./preferences-provider": { usePreferences: () => prefs },
    "../lib/offline-access": { authenticationGeneration: () => generation },
  };
  const exports = {};
  new Function("require", "exports", compiled)(name => {
    assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name];
  }, exports);
  return { projects, order, writes, queries, invalidations, prefs,
    switchAccount: () => { generation++; }, render: (scope = "project:synthetic") => exports.useScopedSort(scope) };
}

test("project metadata failure permits fallback reading but never sorting writes", async () => {
  const f = fixture();
  assert.equal(f.render().ready, false, "Wait for metadata while the first request is pending");
  f.projects.isError = true;
  const view = f.render();
  assert.equal(view.ready, true, "List API can enforce access independently during metadata outage");
  assert.equal(view.conversationSortMode, "imported");
  assert.equal(view.conversationSortDirection, "desc");
  for (const operation of [() => view.setSort("custom", "asc"), () => view.inherit(),
    () => view.rebuild(), () => view.place("row", null, null, "synthetic-version")]) {
    await assert.rejects(operation, /Refresh projects/);
    assert.equal(f.writes.length, 0);
  }
});

test("a failed metadata refresh preserves the actual project override and blocks stale writes", async () => {
  const f = fixture();
  f.projects.data = [{ id: "synthetic", sort_revision: 7, conversation_sort: { mode: "title", direction: "asc" } }];
  f.projects.isError = true;
  const view = f.render();
  assert.equal(view.ready, true);
  assert.equal(view.conversationSortMode, "title");
  assert.equal(view.inherited, false);
  await assert.rejects(() => view.setSort("imported", "desc"), /Refresh projects/);
  assert.deepEqual(f.writes, []);
  f.projects.isError = false;
  await f.render().setSort("imported", "desc");
  assert.deepEqual(f.writes, [["project", "synthetic", {
    conversation_sort: { mode: "imported", direction: "desc" }, expected_sort_revision: 7,
  }]]);
});

test("successful metadata cannot enable a missing project; global reading and account fences remain independent", async () => {
  const f = fixture();
  f.projects.data = [];
  assert.equal(f.render().ready, false);
  assert.equal(f.render("all").ready, true);
  const view = f.render("unclassified");
  f.switchAccount();
  await assert.rejects(() => view.setSort("title", "asc"), /Account changed/);
  assert.deepEqual(f.writes, []);
});

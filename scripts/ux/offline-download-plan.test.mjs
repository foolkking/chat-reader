import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/lib/offline-download-plan.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
} }).outputText;
const exports = {};
new Function("require", "exports", compiled)(() => { throw new Error("Unexpected runtime dependency."); }, exports);
const plan = exports.planOfflineConversationDownloads;

const catalog = () => {
  const conversations = Array.from({ length: 47 }, (_, index) => ({
    id: `conversation-${index + 1}`,
    display_title: `Synthetic ${index + 1}`,
    project_id: index < 12 ? "project-a" : "project-b",
    project_name: index < 12 ? "Project A" : "Project B",
    revision: index + 1,
    estimated_bytes: 1024,
    updated_at: null,
  }));
  return {
    revision: "catalog",
    generated_at: "2026-08-15T00:00:00Z",
    estimated_bytes: 47 * 1024,
    conversations,
    projects: [
      { id: "project-a", name: "Project A", conversation_ids: conversations.slice(0, 12).map(item => item.id), revision: "a", estimated_bytes: 12 * 1024 },
      { id: "project-b", name: "Project B", conversation_ids: conversations.slice(12).map(item => item.id), revision: "b", estimated_bytes: 35 * 1024 },
    ],
  };
};

test("all-scope offline work is divided into changed single-conversation inputs", () => {
  const data = catalog();
  const known = Object.fromEntries(data.conversations.slice(0, 3).map(item => [item.id, item.revision]));
  const targets = plan(data, "all", undefined, known);
  assert.equal(targets.length, 44);
  assert.equal(new Set(targets).size, 44);
  assert.deepEqual(targets.slice(0, 2), ["conversation-4", "conversation-5"]);
  assert.equal(targets.includes("conversation-1"), false);
});

test("project and conversation scopes cannot leak unrelated catalog rows", () => {
  const data = catalog();
  assert.deepEqual(plan(data, "project", "project-a", {}), data.projects[0].conversation_ids);
  assert.deepEqual(plan(data, "conversation", "conversation-20", {}), ["conversation-20"]);
  assert.deepEqual(plan(data, "project", "unknown-project", {}), []);
  assert.deepEqual(plan(data, "conversation", "unknown-conversation", {}), []);
});

test("already-current selected conversations do not enqueue package work", () => {
  const data = catalog();
  const known = Object.fromEntries(data.conversations.map(item => [item.id, item.revision]));
  assert.deepEqual(plan(data, "all", undefined, known), []);
});

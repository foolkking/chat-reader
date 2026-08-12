import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("archived projects expose guarded single and batch deletion", () => {
  const source = readFileSync(resolve(process.cwd(), "features/projects/archived-project-list.tsx"), "utf8");
  const api = readFileSync(resolve(process.cwd(), "lib/api.ts"), "utf8");

  expect(api).toContain('fetchJson<void>(`/api/projects/${projectId}`, { method: "DELETE" })');
  expect(source).toContain("永久删除项目");
  expect(source).toContain("永久删除所选");
  expect(source).toContain("其中的对话和消息不会删除，会回到未分类");
  expect(source).toContain("runBatchSelection(ids, deleteProject)");
  expect(source).toContain("await refreshProjects()");
});

// Explicit opt-in against the task-owned, auth-disabled loopback database.
// Never accepts a production URL or an implicit default service.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const base = process.env.UX_LOCAL_BASE_URL;
assert.equal(base, "http://127.0.0.1:65441", "Only the reserved task-owned UX service is allowed");
assert.equal(process.env.UX_SYNTHETIC_DATABASE, "navigation_ux_20261117");
const temp = resolve(process.env.RUNNER_TEMP ?? process.env.TEMP ?? "");
assert.match(temp.replaceAll("\\", "/").toLowerCase(), /^(?:c:\/users\/86182\/desktop\/wkkk|e:\/chat-reader-temp)\/[^/]+/);
const out = join(temp, "navigation-search-import-live");
mkdirSync(out, { recursive: true });
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? "chromium" : "chrome" });
const results = [], errors = [];
async function api(path, data, method = data === undefined ? "GET" : "POST") {
  const response = await fetch(base + path, { method, ...(data === undefined ? {} : {
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  }) });
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
  return response.status === 204 ? null : response.json();
}
async function upload(name, body, projectId) {
  const data = new FormData();
  data.append("files", new Blob([body], { type: "application/json" }), name);
  if (projectId) data.append("target_project_id", projectId);
  const response = await fetch(base + "/api/adaptive-import/sessions", { method: "POST", body: data });
  assert.equal(response.status, 201, await response.clone().text());
  const session = await response.json();
  let value;
  await expect.poll(async () => {
    value = await api(`/api/adaptive-import/sessions/${session.import_id}`);
    return value.state;
  }, { timeout: 120_000 }).not.toBe("ANALYZING");
  assert.ok(["READY", "RESOLVING"].includes(value.state), JSON.stringify(value));
  return value;
}
const source = marker => JSON.stringify({ thread: { title: `本次来源 ${marker}` }, turns: [
  { speaker: "human", body: `仅属于 ${marker} 的测试正文`, id: "m1", timestamp: "2026-11-17T00:00:00Z" },
  { speaker: "ai", body: `独立回复 ${marker}`, id: "m2", timestamp: "2026-11-17T00:01:00Z" },
] });
try {
  const baselineCount = (await api("/api/conversations?limit=5000")).length;
  const query = `中文 alpha ux${Date.now()}`;
  const projects = await Promise.all(["整理 UX 甲", "整理 UX 乙"].map(name => api("/api/projects", { name: `${name} ${Date.now()}` })));
  const recommended = { all: { mode: "content_updated", direction: "desc" }, project_default: { mode: "imported", direction: "desc" }, unclassified: { mode: "imported", direction: "desc" }, blocks: "projects_first" };
  await api("/api/preferences", { locale_mode: "zh-CN", navigation_sort: recommended, project_sort_mode: "custom", project_sort_direction: "asc" }, "PATCH");
  const conversations = [];
  for (const [index, title] of [`${query} 精确`, "较长的对话", "另一个重复内容对话"].entries()) {
    conversations.push((await api("/api/conversations", { title, project_id: index < 2 ? projects[0].id : projects[1].id,
      messages: [{ role: "user", content_markdown: `${query} 100%_path 同一段正文` },
        { role: "assistant", content_markdown: `${query} 另一条命中` }],
    })).conversation);
  }
  const a = await upload("来源 A.json", source("A"), projects[0].id);
  const family = a.families[0];
  await api(`/api/adaptive-import/sessions/${a.import_id}/families/${family.id}/mapping`, {
    profile_name: "过去文件名 A，不是本次文件", mapping_spec: family.mapping_draft,
  });
  const b = await upload("来源 B.json", source("B"), projects[0].id);
  const c = await upload("来源 C.json", source("C"), projects[1].id);
  assert.equal(b.state, "READY"); assert.equal(c.state, "READY");
  const grouped = await api("/api/search/conversations?q=" + encodeURIComponent(query));
  assert.equal(grouped.total, 3);
  assert.equal(new Set(grouped.items.map(item => item.conversation_id)).size, 3);
  assert.ok(grouped.items.every(item => item.hit_count >= 2));
  results.push({ case: "real API / worker A-B-C analysis / grouped search", pass: true });

  for (const width of [1440, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, locale: "zh-CN" });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/projects/${projects[0].id}`);
    await expect(page.getByTestId(`project-conversation-sortable-row-${conversations[1].id}`)).toBeVisible();
    const mainSort = page.locator("main").getByRole("button", { name: "对话排序", exact: true }).filter({ visible: true }).first();
    await mainSort.click();
    await page.getByRole("menuitem", { name: "标题", exact: true }).click();
    await expect.poll(async () => (await api("/api/projects")).find(p => p.id === projects[0].id).conversation_sort?.mode).toBe("title");
    assert.equal((await api("/api/projects")).find(p => p.id === projects[1].id).conversation_sort, null);
    await page.screenshot({ path: join(out, `project-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    results.push({ case: "project-only sort override / responsive layout", width, pass: true });
    if (width === 1440) {
      const sidebar = page.getByTestId("sidebar-global-search").filter({ visible: true }).first();
      await sidebar.fill(query);
      await sidebar.press("Enter");
      await expect(page).toHaveURL(/\/search\?/);
    } else await page.goto(`${base}/search?q=${encodeURIComponent(query)}`);
    await expect(page.locator("[data-search-index]")).toHaveCount(3);
    await page.getByRole("button", { name: /另有.*命中/ }).first().click();
    await expect(page.locator("main")).toContainText("同一段正文");
    await page.screenshot({ path: join(out, `search-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    results.push({ case: "grouped Chinese multi-term / hits / Enter result page", width, pass: true });

    // Reopen exactly the synthetic B/C batch through the existing task center.
    const current = width === 1440 ? b : c;
    await page.evaluate(() => window.dispatchEvent(new Event("chat-reader:open-task-center")));
    const row = page.locator(`[data-import-session-id="${current.import_id}"]`);
    await expect(row).toContainText(width === 1440 ? "来源 B.json" : "来源 C.json");
    await row.getByRole("button", { name: "查看详情", exact: true }).click();
    await page.getByRole("button", { name: "来源与预览", exact: true }).click();
    await expect(page.getByText(`仅属于 ${width === 1440 ? "B" : "C"} 的测试正文`, { exact: true })).toBeVisible();
    await expect(page.getByText("仅属于 A 的测试正文", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: join(out, `import-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const discard = page.getByRole("button", { name: "放弃本次导入", exact: true });
    await discard.click();
    await page.getByRole("button", { name: "放弃本次导入", exact: true }).last().click();
    await expect.poll(async () => (await api(`/api/adaptive-import/sessions/${current.import_id}`)).source_cleanup?.state).toBe("completed");
    assert.equal((await api("/api/conversations?limit=5000")).length, baselineCount + 3);
    results.push({ case: "actual batch / source-bound preview / discard preserves conversations", width, pass: true });
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(out, "result.json"), JSON.stringify({ syntheticOnly: true, api: "FastAPI/PostgreSQL", worker: true, results, errors }, null, 2));
  console.log(`Live navigation/search/import: ${results.length} passed; ${out}`);
} catch (error) {
  writeFileSync(join(out, "failure.json"), JSON.stringify({ results, errors, error: error.stack }, null, 2));
  throw error;
} finally { await browser.close(); }

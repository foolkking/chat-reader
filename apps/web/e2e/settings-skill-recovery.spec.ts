import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 15_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated authenticated PostgreSQL/API");

const file = (text: string) => ({ name: "replacement.md", mimeType: "text/markdown", buffer: Buffer.from(text) });
async function shot(page: Page, name: string) {
  if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/${name}.png` });
}

for (const system of [false, true]) {
  test(`${system ? "system" : "personal"}: lost replacement response retries the retained file without another version`, async ({ page, playwright, baseURL }) => {
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const f = await setup(page, admin, baseURL!, 768, system);
    const updated = "# Synthetic saved before transport failure";
    let writes = 0;
    try {
      await page.route(`**${f.path}/revisions`, async route => {
        writes += 1; const response = await route.fetch(); expect(response.status()).toBe(200);
        if (writes === 1) await route.abort("failed"); else await route.fulfill({ response });
      });
      await f.row.getByLabel("Replace Skill ZIP / Markdown").setInputFiles(file(updated));
      await f.row.getByRole("button", { name: "Replace", exact: true }).click();
      await expect(f.row.getByRole("alert")).toContainText("not confirmed");
      const saved = await (await page.request.get(f.path)).json();
      await assertDownloaded(page, saved.bundle_url, updated);
      const before = await (await page.request.get(`${f.path}/revisions?limit=50`)).json();
      expect(await f.row.getByLabel("Replace Skill ZIP / Markdown").evaluate((el: HTMLInputElement) => el.files?.length)).toBe(1);
      await expect(f.row.getByRole("button", { name: "Retry replacement", exact: true })).toBeFocused();
      await shot(page, `skill-unconfirmed-${system}`);
      await f.row.getByRole("button", { name: "Retry replacement", exact: true }).click();
      await expect(f.row.getByRole("status")).toHaveText("Replaced");
      expect((await (await page.request.get(f.path)).json()).bundle_revision).toBe(saved.bundle_revision);
      expect(await (await page.request.get(`${f.path}/revisions?limit=50`)).json()).toEqual(before);
      expect(writes).toBe(2);
    } finally { await f.cleanup(); await admin.dispose(); }
  });
}

test("invalid Bundle can be replaced by another file without losing the Skill or preference", async ({ page, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const f = await setup(page, admin, baseURL!, 375, false);
  try {
    await f.row.getByLabel(/替换 Skill ZIP/).setInputFiles({ name: "invalid.zip", mimeType: "application/zip", buffer: Buffer.from("Not a ZIP") });
    await f.row.getByRole("button", { name: "确认替换", exact: true }).click();
    await expect(f.row.getByRole("alert")).toContainText("文件大小或格式");
    await expect(f.row.getByRole("button", { name: "替换文件", exact: true })).toBeFocused();
    expect((await (await page.request.get(f.path)).json()).bundle_revision).toBe(f.original);
    await expect(f.row.getByRole("button", { name: "重试替换", exact: true })).toHaveCount(0);
    await shot(page, "skill-invalid-375");
    await f.row.getByLabel(/替换 Skill ZIP/).setInputFiles(file("# Valid replacement"));
    await expect(f.row.getByRole("alert")).toHaveCount(0);
    await f.row.getByRole("button", { name: "确认替换", exact: true }).click();
    await expect(f.row.getByRole("status")).toHaveText("已替换");
    const resolved = await (await page.request.get("/api/skills/resolve?category=EXPORT_CONTEXT&locale=zh-CN")).json();
    expect(resolved.id).toBe(f.id); expect(resolved.name).toBe("Synthetic recovery Skill");
    expect(resolved.content).toBe("# Valid replacement");
    await assertDownloaded(page, resolved.bundle_url, resolved.content);
  } finally { await f.cleanup(); await admin.dispose(); }
});

test("system restore to the original Bundle remains a recoverable version conflict", async ({ page, playwright, baseURL }) => {
  const admin = await settingsAdmin(playwright.request, baseURL!);
  const f = await setup(page, admin, baseURL!, 768, true);
  try {
    await f.row.getByLabel("Replace Skill ZIP / Markdown").setInputFiles(file("# First customized system file"));
    await f.row.getByRole("button", { name: "Replace", exact: true }).click();
    await expect(f.row.getByRole("status")).toHaveText("Replaced");
    await f.row.getByLabel("Replace Skill ZIP / Markdown").setInputFiles(file("# Retained replacement after restore"));
    expect((await admin.post(`${f.path}/restore`)).status()).toBe(200);
    const restored = await (await admin.get(f.path)).json();
    expect(restored.bundle_revision).toBe(0);
    await f.row.getByRole("button", { name: "Replace", exact: true }).click();
    await f.row.getByRole("button", { name: "Read latest version", exact: true }).click();
    await shot(page, "skill-restored-conflict");
    const explicit = f.row.getByRole("button", { name: "Replace this version with my file", exact: true });
    await expect(explicit).toBeVisible({ timeout: 4_000 });
    const download = f.row.getByRole("link", { name: "Download latest version", exact: true });
    await expect(download).toHaveAttribute("href", restored.bundle_url);
    expect((await page.request.get((await download.getAttribute("href"))!)).status()).toBe(200);
    await shot(page, "skill-restored-conflict");
    await explicit.click();
    await expect(f.row.getByRole("status")).toHaveText("Replaced");
    const saved = await (await admin.get(f.path)).json();
    await assertDownloaded(page, saved.bundle_url, "# Retained replacement after restore");
  } finally { await f.cleanup(); await admin.dispose(); }
});
async function setup(page: Page, admin: APIRequestContext, base: string, width: number, system: boolean) {
  await page.setViewportSize({ width, height: 900 });
  if (system) await page.context().addCookies((await admin.storageState()).cookies);
  else expect((await page.request.post(`${base}/api/auth/register`, { headers: { Origin: base }, data: {
    email: `skill-recovery-${Date.now()}@example.test`, password: "synthetic skill recovery passphrase", confirm_password: "synthetic skill recovery passphrase",
  } })).status()).toBe(201);
  await settingsAppearance(page.request, base, width === 768 ? "en-US" : "zh-CN");
  let id: string, original: number;
  if (system) {
    const rows = await (await admin.get("/api/admin/system-skills?effective=true")).json();
    id = rows.find((row: { category: string }) => row.category === "EXPORT_CONTEXT").id;
    expect((await admin.post(`/api/admin/system-skills/${id}/restore`)).status()).toBe(200);
    original = (await (await admin.get(`/api/admin/system-skills/${id}`)).json()).bundle_revision;
  } else {
    const created = await page.request.post(`${base}/api/skills`, { headers: { Origin: base }, multipart: {
      category: "EXPORT_CONTEXT", name: "Synthetic recovery Skill", file: file("# Original synthetic Skill"),
    } });
    expect(created.status()).toBe(201); const item = await created.json(); id = item.id; original = item.bundle_revision;
    expect((await page.request.put(`${base}/api/skills/selections`, { headers: { Origin: base }, data: { category: "EXPORT_CONTEXT", skill_id: id } })).status()).toBe(204);
  }
  await page.goto(base);
  const settings = page.getByRole("button", { name: /^(设置|Settings)$/ });
  const sidebar = page.getByRole("button", { name: /^(打开侧栏|Open sidebar)$/ });
  await expect(settings.or(sidebar).first()).toBeVisible();
  if (!await settings.isVisible()) await sidebar.click();
  await settings.click();
  await page.getByRole("button", { name: system ? /^(系统 Skill|System skills)$/i : /^(Skill 管理|Skill management)$/ }).click();
  const dialog = page.getByRole("dialog", { name: system ? /^(系统 Skill|System skills)$/i : /^(Skill 管理|Skill management)$/ });
  const row = dialog.locator("article").filter({ hasText: system ? /^(接续上下文|Context acquisition)/ : "Synthetic recovery Skill" });
  await expect(row).toBeVisible();
  const path = `${system ? "/api/admin/system-skills" : "/api/skills"}/${id}`;
  const endpoint = system ? "**/api/admin/system-skills?**" : "**/api/skills?**";
  return { id, original, row, dialog, path, endpoint, cleanup: async () => {
    if (system) expect((await admin.post(`${path}/restore`)).status()).toBe(200);
    else expect((await page.request.delete(`${base}${path}`, { headers: { Origin: base } })).status()).toBe(204);
  } };
}
async function assertDownloaded(page: Page, href: string, content: string) {
  const response = await page.request.get(href); expect(response.status()).toBe(200);
  const members = unzipSync(await response.body());
  expect(new TextDecoder().decode(members["personal-skill/references/legacy-instructions.md"])).toBe(content);
}

for (const width of [375, 768, 1440]) for (const system of [false, true]) {
  test(`${width}px ${system ? "system" : "personal"}: confirmed replacement survives delayed and failed list reads`, async ({ page, playwright, baseURL }) => {
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const f = await setup(page, admin, baseURL!, width, system);
    const updated = `# Updated synthetic ${width} ${system}`;
    let release = () => {}, started = false, writes = 0;
    try {
      const held = new Promise<void>(resolve => { release = resolve; });
      await page.route(f.endpoint, async route => { started = true; await held; try { await route.fulfill({ status: 503, json: { detail: "Synthetic list failure" } }); } catch { /* cancelled read */ } });
      await page.route(`**${f.path}/revisions`, async route => { writes += 1; const response = await route.fetch(); expect(response.status()).toBe(200); await route.fulfill({ response }); });
      await f.row.getByLabel(/替换 Skill ZIP|Replace Skill ZIP/).setInputFiles(file(updated));
      await f.row.getByRole("button", { name: /^(确认替换|Replace)$/ }).click();
      await expect.poll(() => started).toBe(true);
      const saved = await (await page.request.get(f.path)).json();
      expect(saved.bundle_revision).toBeGreaterThan(f.original);
      await shot(page, `skill-confirmed-${width}-${system ? "system" : "personal"}`);
      await expect(f.row.getByRole("status")).toHaveText(/^(已替换|Replaced)$/, { timeout: 4_000 });
      const link = f.row.getByRole("link", { name: /^(下载|Download|下载 Skill ZIP|Download Skill ZIP)$/ });
      await expect(link).toHaveAttribute("href", saved.bundle_url);
      await assertDownloaded(page, saved.bundle_url, updated);
      release();
      await expect(f.dialog.getByRole("button", { name: /重新加载|Retry loading|读取失败，重试|Could not load; retry/ })).toBeVisible();
      await expect(f.row.getByRole("status")).toHaveText(/^(已替换|Replaced)$/);
      await page.unroute(f.endpoint);
      await f.dialog.getByRole("button", { name: /重新加载|Retry loading|读取失败，重试|Could not load; retry/ }).click();
      await expect(f.dialog.getByRole("alert")).toHaveCount(0);
      expect(writes).toBe(1);
      if (!system) expect((await (await page.request.get("/api/skills/resolve?category=EXPORT_CONTEXT&locale=en")).json()).id).toBe(f.id);
      await shot(page, `skill-refreshed-${width}-${system ? "system" : "personal"}`);
    } finally { release(); await page.unroute(f.endpoint); await f.cleanup(); await admin.dispose(); }
  });
}

for (const { width, system } of [{ width: 375, system: false }, { width: 768, system: false }, { width: 1440, system: false }, { width: 768, system: true }]) {
  test(`${width}px ${system ? "system" : "personal"}: conflict keeps the file and requires explicit replacement of the latest revision`, async ({ page, playwright, baseURL }) => {
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const f = await setup(page, admin, baseURL!, width, system);
    try {
      await f.row.getByLabel(/替换 Skill ZIP|Replace Skill ZIP/).setInputFiles(file("# Local chosen file"));
      expect((await page.request.post(`${f.path}/revisions`, { headers: { Origin: baseURL! }, multipart: { base_revision: f.original, file: file("# Another device update") } })).status()).toBe(200);
      await f.row.getByRole("button", { name: /^(确认替换|Replace)$/ }).click();
      await expect(f.row.getByRole("alert")).toBeVisible();
      await shot(page, `skill-conflict-${width}-${system}`);
      const latest = f.row.getByRole("button", { name: /^(读取最新版本|Read latest version)$/ });
      await expect(latest).toBeVisible({ timeout: 4_000 });
      await expect(latest).toBeFocused();
      if (width === 375) {
        await page.route(`**${f.path}/revisions?**`, route => route.fulfill({ status: 503, json: { detail: "Synthetic revision read failure" } }));
        await latest.click();
        await expect(f.row.getByRole("alert")).toContainText(/最新版本读取失败|latest version could not load/);
        await expect(latest).toBeFocused();
        await page.unroute(`**${f.path}/revisions?**`);
      }
      await latest.click();
      const replace = f.row.getByRole("button", { name: /^(用所选文件替换此版本|Replace this version with my file)$/ });
      await expect(replace).toBeVisible();
      expect(await f.row.getByLabel(/替换 Skill ZIP|Replace Skill ZIP/).evaluate((el: HTMLInputElement) => el.files?.length)).toBe(1);
      let remote = await (await page.request.get(f.path)).json();
      await assertDownloaded(page, remote.bundle_url, "# Another device update");
      const download = f.row.getByRole("link", { name: /下载最新版本|Download latest version/ });
      await expect(download).toBeFocused();
      await assertDownloaded(page, (await download.getAttribute("href"))!, "# Another device update");
      await shot(page, `skill-compare-${width}-${system}`);
      if (width === 1440) {
        expect((await page.request.post(`${f.path}/revisions`, { headers: { Origin: baseURL! }, multipart: { base_revision: remote.bundle_revision, file: file("# A still newer remote update") } })).status()).toBe(200);
        await replace.click();
        await expect(latest).toBeVisible();
        remote = await (await page.request.get(f.path)).json();
        await assertDownloaded(page, remote.bundle_url, "# A still newer remote update");
        await latest.click();
        await expect(replace).toBeVisible();
      }
      await replace.click();
      await expect(f.row.getByRole("status")).toHaveText(/^(已替换|Replaced)$/);
      const saved = await (await page.request.get(f.path)).json();
      expect(saved.bundle_revision).toBe(remote.bundle_revision + 1);
      await assertDownloaded(page, saved.bundle_url, "# Local chosen file");
      await expect(f.row.getByRole("button", { name: /^(替换文件|Replace file)$/ })).toBeFocused();
    } finally { await f.cleanup(); await admin.dispose(); }
  });
}

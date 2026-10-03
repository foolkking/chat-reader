import { expect, test, type Page } from "@playwright/test";
import { strToU8, unzipSync, zipSync } from "fflate";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 15_000 });
test.skip(process.env.E2E_CONTEXT_BUNDLES !== "1", "Requires an isolated Context fixture API");
test.beforeEach(async ({ page, playwright, baseURL }) => {
  if (process.env.E2E_SETTINGS_MAILBOX !== "1") return;
  const admin = await settingsAdmin(playwright.request, baseURL!);
  await page.context().addCookies((await admin.storageState()).cookies);
  await admin.dispose();
});

const bundle = (script: string) => Buffer.from(zipSync({
  "browser-skill/SKILL.md": strToU8("---\nname: browser-skill\ndescription: Synthetic browser fixture.\n---\nRead references/help.md"),
  "browser-skill/references/help.md": strToU8("Synthetic guidance"),
  "browser-skill/scripts/action.py": strToU8(script),
}));
async function openSkills(page: Page, width: number) {
  await page.goto("/");
  if (width < 768) await page.getByRole("button", { name: /打开侧栏|Open sidebar/, exact: true }).click();
  await page.getByRole("button", { name: /设置|Settings/, exact: true }).click();
  await page.getByRole("region", { name: /设置|Settings/, exact: true }).getByRole("button", { name: /^(Skill 管理|Skill management)/ }).click();
  return page.getByRole("dialog", { name: /Skill 管理|Skill management/, exact: true });
}
for (const width of [375, 768, 1440]) for (const locale of ["zh-CN", "en-US"]) {
  test(`${width}px ${locale}: upload, prefer, rename, replace and reopen`, async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    await settingsAppearance(page.request, baseURL!, locale);
    const name = `Synthetic Bundle ${width} ${locale} ${Date.now()}`;
    const script = `# ${name}`;
    let id: string | undefined;
    try {
      const dialog = await openSkills(page, width);
      await dialog.getByRole("button", { name: "English", exact: true }).click();
      await dialog.getByLabel(/Skill 名称|Skill name/, { exact: true }).fill(name);
      await dialog.getByLabel(/选择 Skill ZIP|Choose a Skill ZIP/).setInputFiles({ name: "browser-skill.zip", mimeType: "application/zip", buffer: bundle(script) });
      await dialog.getByRole("button", { name: /保存 Skill|Save Skill/, exact: true }).click();
      const row = dialog.locator("article").filter({ hasText: name });
      await expect(row).toBeVisible();
      const listing = await (await page.request.get("/api/skills?category=EXPORT_CONTEXT&locale=en")).json();
      id = listing.find((item: { name: string }) => item.name === name).id;
      await row.getByRole("button", { name: /设为首选|Set as preferred/, exact: true }).click();
      await expect.poll(async () => (await (await page.request.get("/api/skills/resolve?category=EXPORT_CONTEXT&locale=en")).json()).id).toBe(id);
      await row.getByRole("button", { name: /改名|Rename/, exact: true }).click();
      const prompt = page.getByRole("dialog").last();
      await prompt.getByRole("textbox").fill(name + " renamed");
      await prompt.getByRole("button", { name: /确认|Confirm/, exact: true }).click();
      await expect(row).toContainText(name + " renamed");
      await row.getByLabel(/替换 Skill ZIP|Replace Skill ZIP/).setInputFiles({ name: "browser-skill.zip", mimeType: "application/zip", buffer: bundle(script + " updated") });
      await row.getByRole("button", { name: /^(确认替换|Replace)$/ }).click();
      await expect(row).toContainText(/已替换|Replaced/);
      const resolved = await (await page.request.get("/api/skills/resolve?category=EXPORT_CONTEXT&locale=en")).json();
      expect(resolved.bundle_revision).toBe(2);
      const bytes = await (await page.request.get(resolved.bundle_url)).body();
      expect(new TextDecoder().decode(unzipSync(bytes)["browser-skill/scripts/action.py"])).toBe(script + " updated");
      const oldBytes = await (await page.request.get(`/api/skills/${id}/bundle?revision=1`)).body();
      expect(new TextDecoder().decode(unzipSync(oldBytes)["browser-skill/scripts/action.py"])).toBe(script);
      await page.reload();
      const reopened = await openSkills(page, width);
      await reopened.getByRole("button", { name: "English", exact: true }).click();
      await expect(reopened.locator("article").filter({ hasText: name + " renamed" })).toContainText(/首选|Preferred/);
      await expect(reopened.getByRole("button", { name: /查看|View/, exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/skill-${width}-${locale}.png` });
    } finally { if (id) await page.request.delete(`/api/skills/${id}`, { headers: { Origin: baseURL! } }); }
  });
}


test("unsaved replacement survives cancelled navigation and a real version conflict", async ({ page, baseURL }) => {
  await settingsAppearance(page.request, baseURL!, "en-US");
  const name = `Synthetic conflict ${Date.now()}`;
  const created = await page.request.post("/api/skills", { headers: { Origin: baseURL! }, multipart: { category: "EXPORT_CONTEXT", locale: "en", name,
    file: { name: "browser-skill.zip", mimeType: "application/zip", buffer: bundle(name) } } });
  expect(created.status()).toBe(201);
  const skill = await created.json();
  try {
    const dialog = await openSkills(page, 1280);
    await dialog.getByRole("button", { name: "English", exact: true }).click();
    const row = dialog.locator("article").filter({ hasText: name });
    await row.getByLabel("Replace Skill ZIP").setInputFiles({ name: "browser-skill.zip", mimeType: "application/zip", buffer: bundle(name + " local draft") });
    await dialog.getByRole("button", { name: "Maintenance", exact: true }).click();
    await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await row.getByLabel("Replace Skill ZIP").evaluate((input: HTMLInputElement) => input.files?.length)).toBe(1);
    const concurrent = await page.request.post(`/api/skills/${skill.id}/revisions`, { headers: { Origin: baseURL! }, multipart: { base_revision: 1,
      file: { name: "browser-skill.zip", mimeType: "application/zip", buffer: bundle(name + " remote update") } } });
    expect(concurrent.status()).toBe(200);
    await row.getByRole("button", { name: "Replace", exact: true }).click();
    await expect(row.getByRole("alert")).toContainText(/changed|reload/i);
    expect(await row.getByLabel("Replace Skill ZIP").evaluate((input: HTMLInputElement) => input.files?.length)).toBe(1);
    const saved = await (await page.request.get(`/api/skills/${skill.id}`)).json();
    expect(saved.bundle_revision).toBe(2);
    await row.getByRole("button", { name: "Discard replacement", exact: true }).click();
    await dialog.getByRole("button", { name: "Maintenance", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Maintenance", exact: true })).toHaveAttribute("aria-pressed", "true");
  } finally { await page.request.delete(`/api/skills/${skill.id}`, { headers: { Origin: baseURL! } }); }
});


test("Markdown upload becomes a same-name ZIP and replacement keeps the name", async ({ page, baseURL }) => {
  await settingsAppearance(page.request, baseURL!, "zh-CN");
  const dialog = await openSkills(page, 1440);
  const name = `我的规则-${Date.now()}`;
  const original = "# Synthetic Markdown\nKeep original wording.\n";
  let id: string | undefined;
  try {
    await dialog.getByLabel(/选择 Skill ZIP/).setInputFiles({ name: `${name}.md`, mimeType: "text/markdown", buffer: Buffer.from(original) });
    await dialog.getByRole("button", { name: "保存 Skill", exact: true }).click();
    const row = dialog.locator("article").filter({ hasText: name });
    await expect(row).toBeVisible();
    const rows = await (await page.request.get("/api/skills?category=EXPORT_CONTEXT&locale=zh-CN")).json();
    id = rows.find((item: { name: string }) => item.name === name).id;
    const downloadPromise = page.waitForEvent("download");
    await row.getByRole("link", { name: "下载", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`${name}.zip`);
    const result = await page.request.get(`/api/skills/${id}/bundle?revision=1`);
    expect(new TextDecoder().decode(unzipSync(await result.body())["personal-skill/references/legacy-instructions.md"])).toBe(original);
    await row.getByLabel(/替换 Skill ZIP/).setInputFiles({ name: "replacement.md", mimeType: "text/markdown", buffer: Buffer.from("# Revised") });
    await row.getByRole("button", { name: "确认替换", exact: true }).click();
    await expect(row).toContainText("已替换");
    const saved = await (await page.request.get(`/api/skills/${id}`)).json();
    expect(saved.name).toBe(name);
    expect(await (await page.request.get(`/api/skills/${id}/content`)).text()).toBe("# Revised");
  } finally {
    if (id) await page.request.delete(`/api/skills/${id}`, { headers: { Origin: baseURL! } });
  }
});

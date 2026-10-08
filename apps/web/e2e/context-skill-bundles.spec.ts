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
      await expect(dialog.getByRole("button", { name: "English", exact: true })).toHaveCount(0);
      await dialog.getByRole("button", { name: /上传我的 Skill|Upload my Skill/, exact: true }).click();
      await dialog.getByLabel(/Skill 名称|Skill name/, { exact: true }).fill(name);
      await dialog.getByLabel(/选择 Skill ZIP|Choose a Skill ZIP/).setInputFiles({ name: "browser-skill.zip", mimeType: "application/zip", buffer: bundle(script) });
      await dialog.getByRole("button", { name: /保存 Skill|Save Skill/, exact: true }).click();
      const row = dialog.locator("article").filter({ hasText: name });
      await expect(row).toBeVisible();
      const listing = await (await page.request.get("/api/skills?category=EXPORT_CONTEXT&locale=en")).json();
      id = listing.find((item: { name: string }) => item.name === name).id;
      await row.getByRole("button", { name: /设为首选|Set as preferred/, exact: true }).click();
      await expect.poll(async () => (await (await page.request.get("/api/skills/resolve?category=EXPORT_CONTEXT&locale=en")).json()).id).toBe(id);
      expect((await (await page.request.get("/api/skills/resolve?category=EXPORT_CONTEXT&locale=zh-CN")).json()).id).toBe(id);
      await expect(dialog.getByRole("button", { name: /克隆|Clone/ })).toHaveCount(0);
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
      const switchedLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
      await settingsAppearance(page.request, baseURL!, switchedLocale);
      await page.reload();
      const reopened = await openSkills(page, width);
      await expect(reopened.getByRole("button", { name: switchedLocale === "zh-CN" ? "上传我的 Skill" : "Upload my Skill", exact: true })).toBeVisible();
      await expect(reopened.getByRole("button", { name: "English", exact: true })).toHaveCount(0);
      await expect(reopened.locator("article").filter({ hasText: name + " renamed" })).toContainText(/首选|Preferred/);
      await expect(reopened.getByRole("button", { name: /查看|View/, exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/skill-${width}-${switchedLocale}.png` });
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
    await expect(dialog.getByRole("button", { name: "English", exact: true })).toHaveCount(0);
    const row = dialog.locator("article").filter({ hasText: name });
    await row.getByLabel("Replace Skill ZIP / Markdown").setInputFiles({ name: "browser-skill.zip", mimeType: "application/zip", buffer: bundle(name + " local draft") });
    await dialog.getByRole("button", { name: "Maintenance", exact: true }).click();
    await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await row.getByLabel("Replace Skill ZIP / Markdown").evaluate((input: HTMLInputElement) => input.files?.length)).toBe(1);
    const concurrent = await page.request.post(`/api/skills/${skill.id}/revisions`, { headers: { Origin: baseURL! }, multipart: { base_revision: 1,
      file: { name: "browser-skill.zip", mimeType: "application/zip", buffer: bundle(name + " remote update") } } });
    expect(concurrent.status()).toBe(200);
    await row.getByRole("button", { name: "Replace", exact: true }).click();
    await expect(row.getByRole("alert")).toContainText(/changed|reload/i);
    expect(await row.getByLabel("Replace Skill ZIP / Markdown").evaluate((input: HTMLInputElement) => input.files?.length)).toBe(1);
    const saved = await (await page.request.get(`/api/skills/${skill.id}`)).json();
    expect(saved.bundle_revision).toBe(2);
    await row.getByRole("button", { name: "Discard replacement", exact: true }).click();
    await dialog.getByRole("button", { name: "Maintenance", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Maintenance", exact: true })).toHaveAttribute("aria-pressed", "true");
  } finally { await page.request.delete(`/api/skills/${skill.id}`, { headers: { Origin: baseURL! } }); }
});

test("format conversion respects the selected Bundle and exposes loading failure without a silent fallback", async ({ page, baseURL }) => {
  await settingsAppearance(page.request, baseURL!, "en-US");
  const original = "# Synthetic personal normalizer\nPreserve this exact file.";
  const created = await page.request.post("/api/skills", { headers: { Origin: baseURL! }, multipart: { category: "CONVERSATION_RESCUE", name: "My selected normalizer", file: { name: "normalizer.md", mimeType: "text/markdown", buffer: Buffer.from(original) } } });
  expect(created.status()).toBe(201);
  const skill = await created.json();
  try {
    expect((await page.request.put("/api/skills/selections", { headers: { Origin: baseURL! }, data: { category: "CONVERSATION_RESCUE", skill_id: skill.id } })).status()).toBe(204);
    await page.goto("/");
    await page.getByRole("button", { name: /Import data|导入数据/, exact: true }).click();
    await page.getByTestId("import-file-input").setInputFiles({ name: "synthetic-broken.json", mimeType: "application/json", buffer: Buffer.from("not-json") });
    await page.getByTestId("preview-import-button").click();
    await expect(page.getByRole("button", { name: /使用格式转换 Skill|Use format conversion Skill/ })).toBeVisible();
    await page.route("**/api/skills/resolve?**", route => route.abort("failed"));
    await page.getByRole("button", { name: /使用格式转换 Skill|Use format conversion Skill/ }).click();
    const dialog = page.getByRole("dialog", { name: /使用格式转换 Skill|Use format conversion Skill/ });
    await expect(dialog.getByRole("alert")).toContainText("could not be loaded");
    await expect(dialog.getByRole("link", { name: /Download skill|下载 Skill/ })).toHaveCount(0);
    await expect(dialog.getByRole("tab")).toHaveCount(0);
    await page.unroute("**/api/skills/resolve?**");
    await dialog.getByRole("button", { name: "Retry", exact: true }).click();
    const link = dialog.getByRole("link", { name: /Download skill|下载 Skill/ });
    await expect(link).toHaveAttribute("href", skill.bundle_url);
    const bytes = unzipSync(await (await page.request.get((await link.getAttribute("href"))!)).body());
    expect(new TextDecoder().decode(bytes["personal-skill/references/legacy-instructions.md"])).toBe(original);
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("Synthetic denied clipboard")) } }));
    await dialog.getByRole("button", { name: /Copy template|复制模板/ }).click();
    await expect(dialog.getByRole("alert")).toContainText("copy it manually");
    await expect(dialog).not.toContainText("Copied.");
    await page.setViewportSize({ width: 375, height: 900 });
    await page.screenshot({ path: `${process.env.TEMP ?? "/tmp"}/normalizer-dialog.png` });
    const last = dialog.getByRole("button", { name: "Do this later" });
    await last.focus();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(last).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Use format conversion Skill", exact: true })).toBeFocused();
    await expect(page.getByRole("dialog", { name: "Import data", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    const skills = await openSkills(page, 375);
    await skills.getByRole("button", { name: "Format conversion", exact: true }).click();
    const personal = skills.locator("article").filter({ hasText: "My selected normalizer" });
    await personal.getByLabel("Replace Skill ZIP / Markdown").setInputFiles({ name: "updated-normalizer.md", mimeType: "text/markdown", buffer: Buffer.from("# Updated synthetic normalizer\nKeep this new instruction.") });
    await personal.getByRole("button", { name: "Replace", exact: true }).click();
    await expect(personal.getByRole("status")).toHaveText("Replaced");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Import data", exact: true }).click();
    // Reopening resumes the existing failed import; it does not need another upload.
    await expect(page.getByRole("button", { name: "Use format conversion Skill", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Use format conversion Skill", exact: true }).click();
    const updatedDialog = page.getByRole("dialog", { name: "Use format conversion Skill", exact: true });
    const updatedLink = updatedDialog.getByRole("link", { name: /Download skill/ });
    await expect(updatedLink).toHaveAttribute("href", `/api/skills/${skill.id}/bundle?revision=2`);
    const updatedBytes = unzipSync(await (await page.request.get((await updatedLink.getAttribute("href"))!)).body());
    expect(new TextDecoder().decode(updatedBytes["personal-skill/references/legacy-instructions.md"])).toBe("# Updated synthetic normalizer\nKeep this new instruction.");
  } finally {
    await page.unroute("**/api/skills/resolve?**");
    await page.request.delete(`/api/skills/${skill.id}`, { headers: { Origin: baseURL! } });
  }
});


test("Markdown upload becomes a same-name ZIP and replacement keeps the name", async ({ page, baseURL }) => {
  await settingsAppearance(page.request, baseURL!, "zh-CN");
  const dialog = await openSkills(page, 1440);
  const name = `我的规则-${Date.now()}`;
  const original = "# Synthetic Markdown\nKeep original wording.\n";
  let id: string | undefined;
  try {
    await dialog.getByRole("button", { name: "上传我的 Skill", exact: true }).click();
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

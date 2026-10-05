import { expect, test } from "@playwright/test";
import { zipSync, strToU8, unzipSync } from "fflate";
import { removeSyntheticAccount, settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 15_000 });
test.skip(process.env.E2E_CONTEXT_ADMIN !== "1", "Requires isolated authenticated Context API");
const zip = (marker: string) => Buffer.from(zipSync({
  "system-example/SKILL.md": strToU8("---\nname: system-example\ndescription: Synthetic system fixture.\n---\nFollow references/example.md"),
  "system-example/references/example.md": strToU8(marker),
}));
for (const width of [375, 768, 1440]) for (const locale of ["zh-CN", "en-US"]) {
  test(`${width}px ${locale}: three ZIP defaults support replacement and preserve personal selection`, async ({ page, browser, playwright, baseURL }) => {
    test.setTimeout(120_000);
    const admin = await settingsAdmin(playwright.request, baseURL!);
    await page.context().addCookies((await admin.storageState()).cookies);
    await page.setViewportSize({ width, height: 900 });
    await settingsAppearance(page.request, baseURL!, locale);
    const marker = `Synthetic system ${Date.now()} ${width}`;
    const user = await browser.newContext({ baseURL });
    let systemId: string | undefined;
    let builtinId: string | undefined;
    let userId: string | undefined;
    try {
      const password = "synthetic personal context passphrase";
      const email = `context-${Date.now()}-${width}@example.test`;
      const registered = await user.request.post("/api/auth/register", { headers: { Origin: baseURL! }, data: { email, password, confirm_password: password } });
      expect(registered.status()).toBe(201);
      userId = (await registered.json()).user_id;
      expect((await user.request.post("/api/auth/login", { headers: { Origin: baseURL! }, data: { email, password } })).status()).toBe(200);
      const own = await user.request.post("/api/skills", { headers: { Origin: baseURL! }, multipart: { name: "Synthetic personal preference", category: "EXPORT_CONTEXT", locale: "en", file: { name: "skill.zip", mimeType: "application/zip", buffer: zip(marker + " personal") } } });
      expect(own.status()).toBe(201);
      const personal = await own.json();
      expect((await user.request.put("/api/skills/selections", { headers: { Origin: baseURL! }, data: { category: "EXPORT_CONTEXT", locale: "en", skill_id: personal.id } })).status()).toBe(204);
      await page.goto("/");
      if (width < 768) await page.getByRole("button", { name: /打开侧栏|Open sidebar/, exact: true }).click();
      await page.getByRole("button", { name: /设置|Settings/, exact: true }).click();
      await page.getByRole("region", { name: /设置|Settings/, exact: true }).getByRole("button", { name: /系统 Skill|System skills/ }).click();
      const dialog = page.getByRole("dialog", { name: /系统 Skill|System skills/, exact: true });
      await expect(dialog.getByRole("button", { name: /^(中文|English)$/ })).toHaveCount(0);
      await expect(dialog.locator("article")).toHaveCount(3);
      if (process.env.E2E_SETTINGS_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SETTINGS_SCREENSHOTS}/system-skills-${width}-${locale}.png` });
      await expect(dialog.getByRole("button", { name: /查看|View/, exact: true })).toHaveCount(0);
      const rows = await (await page.request.get("/api/admin/system-skills?effective=true")).json();
      const builtin = rows.find((item: { category: string; source_kind: string }) => item.category === "EXPORT_CONTEXT" && item.source_kind === "BUNDLED");
      builtinId = builtin.id;
      systemId = builtin.id;
      const row = dialog.locator("article").filter({ has: page.getByRole("heading", { name: /^(接续上下文|Context acquisition)$/ }) });
      await row.getByLabel(/替换 Skill ZIP|Replace Skill ZIP/).setInputFiles({ name: "skill.zip", mimeType: "application/zip", buffer: zip(marker + " replacement") });
      await row.getByRole("button", { name: /^(确认替换|Replace)$/ }).click();
      await expect(row).toContainText(/已替换|Replaced/);
      const resolved = await (await page.request.get("/api/skills/resolve?category=EXPORT_CONTEXT&locale=en")).json();
      expect(resolved.bundle_revision).toBeGreaterThan(0);
      const bytes = await (await page.request.get(resolved.bundle_url)).body();
      expect(new TextDecoder().decode(unzipSync(bytes)["system-example/references/example.md"])).toBe(marker + " replacement");
      expect((await (await page.request.get("/api/skills/resolve?category=EXPORT_CONTEXT&locale=zh-CN")).json()).bundle_url).toBe(resolved.bundle_url);
      const personalNow = await (await user.request.get("/api/skills/resolve?category=EXPORT_CONTEXT&locale=en")).json();
      expect(personalNow.id).toBe(personal.id); expect(personalNow.bundle_revision).toBe(1);
      expect((await (await user.request.get("/api/skills/resolve?category=EXPORT_CONTEXT&locale=zh-CN")).json()).id).toBe(personal.id);
      expect((await user.request.get(`/api/admin/system-skills/${systemId}/revisions`)).status()).toBe(404);
      await row.getByRole("button", { name: /^(恢复内置|Restore built-in)$/ }).click();
      await page.getByRole("dialog").last().getByRole("button", { name: /^(确认|Confirm)$/ }).click();
      await expect(row.getByRole("button", { name: /^(恢复内置|Restore built-in)$/ })).toHaveCount(0);
      expect((await (await page.request.get("/api/skills/resolve?category=EXPORT_CONTEXT&locale=en")).json()).bundle_url).toBe("/skills/context-acquisition.zip");
      expect((await (await user.request.get("/api/skills/resolve?category=EXPORT_CONTEXT&locale=en")).json()).id).toBe(personal.id);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      if (builtinId) await admin.post(`/api/admin/system-skills/${builtinId}/restore`);
      if (userId) await removeSyntheticAccount(admin, userId);
      await user.close(); await admin.dispose();
    }
  });
}

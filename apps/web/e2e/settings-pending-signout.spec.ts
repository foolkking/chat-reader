import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { settingsAdmin } from "./settings-test-helper";
import { readLocal } from "./settings-offline-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL, authentication and worker");

for (const scenario of ["sync", "export", "discard failure", "password"] as const) {
  test(`pending signout: ${scenario}`, async ({ browser, playwright, baseURL }, info) => {
    test.setTimeout(140_000);
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const context = await browser.newContext({ viewport: { width: scenario === "sync" ? 375 : 1440, height: 900 }, locale: "en-US" });
    const page = await context.newPage(), headers = { Origin: baseURL! };
    try {
      const email = `signout-${Date.now()}@example.test`;
      const registered = await context.request.post(`${baseURL}/api/auth/register`, { headers, data: { email, password: "synthetic signout password", confirm_password: "synthetic signout password" } });
      expect(registered.status()).toBe(201);
      const userId = (await registered.json()).user_id;
      const created = await context.request.post(`${baseURL}/api/conversations`, { headers, data: { title: "Synthetic pending signout", messages: [{ role: "user", content_markdown: "Synthetic signout question" }, { role: "assistant", content_markdown: "Synthetic signout answer" }] } });
      expect(created.status()).toBe(201);
      const conversationId = (await created.json()).conversation.id;
      await page.goto(`${baseURL}/library?conversationId=${conversationId}&annotations=open`);
      await page.getByRole("button", { name: "Download offline copy", exact: true }).click();
      await expect.poll(async () => (await readLocal(page, userId)).conversations.length).toBe(1);
      await context.setOffline(true);
      await page.getByRole("button", { name: "Notes", exact: true }).click();
      const title = page.getByRole("textbox", { name: "Notebook title", exact: true });
      await title.fill("Synthetic unsynced signout note"); await title.press("Tab");
      await expect.poll(async () => (await readLocal(page, userId)).outbox.length).toBe(1);
      await context.route("**/api/annotations/sync", (route) => route.abort("failed"));
      await context.setOffline(false);
      await page.goto(`${baseURL}/recent`);
      if (scenario === "sync" && !await page.getByRole("button", { name: "Settings", exact: true }).isVisible()) await page.getByRole("button", { name: /Open sidebar/, exact: true }).click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: /Account & security/ }).click();
      if (scenario === "password") {
        await page.getByRole("button", { name: "Change password", exact: true }).click();
        await page.getByLabel("Current password", { exact: true }).fill("synthetic signout password");
        await page.getByLabel("New password", { exact: true }).fill("synthetic changed password");
        await page.getByLabel("Confirm new password", { exact: true }).fill("synthetic changed password");
        await page.getByRole("button", { name: "Change password and log out all devices", exact: true }).click();
      } else await page.getByRole("button", { name: "Log out current account", exact: true }).click();
      const panel = page.getByRole("region", { name: "Handle local changes before signing out", exact: true });
      await expect(panel).toBeVisible();
      expect((await (await context.request.get(`${baseURL}/api/auth/session`)).json()).authenticated).toBe(true);
      expect((await readLocal(page, userId)).outbox.length).toBe(1);
      if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/pending-signout-${scenario.replace(" ", "-")}.png` });
      if (scenario === "sync" || scenario === "password") {
        await context.unroute("**/api/annotations/sync");
        await panel.getByRole("button", { name: "Sync first", exact: true }).click();
        await expect(panel.getByRole("button", { name: "Continue signing out", exact: true })).toBeVisible();
        const saved = await (await context.request.get(`${baseURL}/api/conversations/${conversationId}/notebook`)).json();
        expect(saved.title).toBe("Synthetic unsynced signout note");
        if (scenario === "password") {
          await page.route("**/api/auth/password", (route) => route.abort("failed"));
          await panel.getByRole("button", { name: "Continue signing out", exact: true }).click();
          await expect(panel.getByRole("alert")).toContainText("Local data is retained");
          expect((await (await context.request.get(`${baseURL}/api/auth/session`)).json()).authenticated).toBe(true);
          await page.unroute("**/api/auth/password");
          // Successful navigation must not be trapped by the password form's
          // beforeunload guard. A real browser would otherwise ask twice.
          page.on("dialog", () => { throw new Error("Unexpected native dialog after confirmed password change"); });
        }
        await panel.getByRole("button", { name: "Continue signing out", exact: true }).click();
      } else {
        if (scenario === "export") {
          const download = page.waitForEvent("download");
          await panel.getByRole("button", { name: "Export local changes", exact: true }).click();
          const artifact = await download, file = info.outputPath("synthetic-unsynced.zip"); await artifact.saveAs(file);
          const files = unzipSync(await readFile(file));
          const changes = JSON.parse(strFromU8(files["changes.json"]));
          expect(changes.operations[0].payload.title).toBe("Synthetic unsynced signout note");
          expect(strFromU8(files["notes.md"])).toContain("Synthetic unsynced signout note");
          expect(JSON.stringify(changes)).not.toContain("synthetic signout password");
          const second = await context.newPage();
          await second.goto(`${baseURL}/library?conversationId=${conversationId}&annotations=open`);
          await second.getByRole("button", { name: "Notes", exact: true }).click();
          const secondTitle = second.getByRole("textbox", { name: "Notebook title", exact: true });
          await secondTitle.fill("Synthetic newer signout note"); await secondTitle.press("Tab");
          await expect.poll(async () => (await readLocal(second, userId)).outbox.length).toBe(2);
          await panel.getByRole("button", { name: "File saved — clear and sign out", exact: true }).click();
          await page.getByRole("button", { name: "Discard and continue", exact: true }).click();
          await expect(panel.getByRole("alert")).toContainText("Local changes changed");
          expect((await (await context.request.get(`${baseURL}/api/auth/session`)).json()).authenticated).toBe(true);
        } else {
          const second = await context.newPage();
          await second.goto(`${baseURL}/library?conversationId=${conversationId}&annotations=open`);
          await second.getByRole("button", { name: "Notes", exact: true }).click();
          let release: (() => void) | undefined, received = false;
          const barrier = new Promise<void>((resolve) => { release = resolve; });
          await page.route("**/api/auth/logout", async (route) => { received = true; await barrier; await route.abort("failed"); });
          await panel.getByRole("button", { name: "Discard local changes and sign out", exact: true }).click();
          await page.getByRole("button", { name: "Discard and continue", exact: true }).click();
          await expect.poll(() => received).toBe(true);
          try {
            await expect(second.getByRole("status").filter({ hasText: "Finishing signout for this account" })).toBeVisible();
            expect(await second.locator('[aria-label="Notebook title"]').evaluate((input) => Boolean(input.closest("[inert]")))).toBe(true);
            expect((await readLocal(second, userId)).outbox).toHaveLength(1);
          } finally { release!(); }
          await expect(panel.getByRole("alert")).toContainText("Local data is retained");
          await expect(second.getByRole("status").filter({ hasText: "Finishing signout for this account" })).toHaveCount(0);
          await second.getByRole("textbox", { name: "Notebook title", exact: true }).click();
          await expect(second.getByRole("textbox", { name: "Notebook title", exact: true })).toBeFocused();
          expect((await readLocal(page, userId)).outbox.length).toBe(1);
          expect((await (await context.request.get(`${baseURL}/api/auth/session`)).json()).authenticated).toBe(true);
          await page.unroute("**/api/auth/logout");
        }
        await panel.getByRole("button", { name: "Discard local changes and sign out", exact: true }).click();
        await page.getByRole("button", { name: "Discard and continue", exact: true }).click();
      }
      await expect(page.locator("#login-password")).toBeVisible();
      expect((await (await context.request.get(`${baseURL}/api/auth/session`)).json()).authenticated).toBe(false);
      expect((await readLocal(page, userId)).conversations).toHaveLength(0);
      expect((await readLocal(page, userId)).outbox).toHaveLength(0);
      if (scenario === "password") {
        expect((await context.request.post(`${baseURL}/api/auth/login`, { headers, data: { email, password: "synthetic signout password" } })).status()).toBe(401);
        expect((await context.request.post(`${baseURL}/api/auth/login`, { headers, data: { email, password: "synthetic changed password" } })).status()).toBe(200);
      }
    } finally { await context.close(); await admin.dispose(); }
  });
}

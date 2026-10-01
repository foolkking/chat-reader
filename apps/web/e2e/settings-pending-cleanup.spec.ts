import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { settingsAdmin } from "./settings-test-helper";
import { readLocal } from "./settings-offline-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL, authentication and worker");

for (const action of ["copy", "files"] as const) {
  test(`scoped offline cleanup: ${action}, export and changed snapshot`, async ({ browser, playwright, baseURL }, info) => {
    test.setTimeout(120_000);
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const context = await browser.newContext({ viewport: { width: action === "copy" ? 375 : 1440, height: 900 }, locale: "en-US" });
    const page = await context.newPage(), headers = { Origin: baseURL! };
    try {
      const registered = await context.request.post(`${baseURL}/api/auth/register`, { headers, data: { email: `clear-${action}-${Date.now()}@example.test`, password: "synthetic cleanup password", confirm_password: "synthetic cleanup password" } });
      expect(registered.status()).toBe(201);
      const userId = (await registered.json()).user_id;
      const ids: string[] = [];
      await context.route("**/api/annotations/sync", (route) => route.abort("failed"));
      for (const name of ["Selected", "Retained"]) {
        const created = await context.request.post(`${baseURL}/api/conversations`, { headers, data: { title: `Synthetic ${name} copy`, messages: [{ role: "user", content_markdown: "Synthetic cleanup question" }, { role: "assistant", content_markdown: "Synthetic cleanup answer" }] } });
        expect(created.status()).toBe(201);
        const id = (await created.json()).conversation.id; ids.push(id);
        if (name === "Selected") {
          const upload = await context.request.post(`${baseURL}/api/conversations/${id}/attachment-upload-sessions`, { headers, data: {} });
          expect(upload.status()).toBe(201);
          const file = await context.request.post(`${baseURL}/api/attachment-upload-sessions/${(await upload.json()).id}/items`, { headers, multipart: { file: { name: "synthetic.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic cleanup attachment bytes") } } });
          expect(file.status()).toBe(201);
          expect((await context.request.post(`${baseURL}/api/conversations/${id}/attachments`, { headers, data: { upload_item_ids: [(await file.json()).id] } })).status()).toBe(201);
        }
        await page.goto(`${baseURL}/library?conversationId=${id}&annotations=open`);
        await page.getByRole("button", { name: "Download offline copy", exact: true }).click();
        await expect.poll(async () => (await readLocal(page, userId)).conversations.length).toBe(ids.length);
        await page.getByRole("button", { name: "Notes", exact: true }).click();
        const title = page.getByRole("textbox", { name: "Notebook title", exact: true });
        await title.fill(`Synthetic ${name} unsynced note`); await title.press("Tab");
        await expect.poll(async () => (await readLocal(page, userId)).outbox.length).toBe(ids.length);
      }
      await page.goto(`${baseURL}/recent`);
      if (action === "copy") await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: /Offline & sync/ }).click();
      const dialog = page.getByRole("dialog", { name: "Offline & sync", exact: true });
      const row = dialog.getByRole("listitem").filter({ has: page.getByRole("link", { name: "Synthetic Selected copy", exact: true }) });
      await row.getByRole("button", { name: action === "copy" ? "Delete copy" : "Clear cached files", exact: true }).click();
      const review = page.getByRole("region", { name: "Handle local changes before clearing data", exact: true });
      await expect(review).toBeVisible();
      if (action === "files") await expect(review.getByRole("button", { name: "Clear cached files only", exact: true })).toBeDisabled();
      const download = page.waitForEvent("download");
      await review.getByRole("button", { name: "Export local changes", exact: true }).click();
      const archive = await download, path = info.outputPath("synthetic-scoped-edits.zip"); await archive.saveAs(path);
      const content = JSON.parse(strFromU8(unzipSync(await readFile(path))["changes.json"]));
      expect(content.operations).toHaveLength(1);
      expect(content.operations[0].payload.title).toBe("Synthetic Selected unsynced note");
      expect(JSON.stringify(content)).not.toContain("Synthetic Retained unsynced note");
      const second = await context.newPage();
      await second.goto(`${baseURL}/library?conversationId=${ids[0]}&annotations=open`);
      await second.getByRole("button", { name: "Notes", exact: true }).click();
      const title = second.getByRole("textbox", { name: "Notebook title", exact: true });
      await title.fill("Synthetic newer selected note"); await title.press("Tab");
      await expect.poll(async () => (await readLocal(second, userId)).outbox.length).toBe(3);
      const proceed = action === "copy" ? "Discard local changes and delete copy" : "Clear cached files only";
      await review.getByRole("button", { name: proceed, exact: true }).click();
      await page.getByRole("dialog", { name: action === "copy" ? "Discard these local changes and delete the copy?" : "Export saved — clear cached files only?", exact: true }).getByRole("button", { name: action === "copy" ? "Discard and continue" : "Clear cached files only", exact: true }).click();
      await expect(review.getByRole("alert")).toContainText("Local changes changed");
      expect((await readLocal(page, userId)).conversations).toHaveLength(2);
      if (action === "files") {
        await expect(review.getByRole("button", { name: proceed, exact: true })).toBeDisabled();
        const nextDownload = page.waitForEvent("download");
        await review.getByRole("button", { name: "Export local changes", exact: true }).click(); await nextDownload;
      }
      if (process.env.SETTINGS_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SETTINGS_SCREENSHOT_DIR}/pending-cleanup-${action}.png` });
      await review.getByRole("button", { name: proceed, exact: true }).click();
      await page.getByRole("dialog", { name: action === "copy" ? "Discard these local changes and delete the copy?" : "Export saved — clear cached files only?", exact: true }).getByRole("button", { name: action === "copy" ? "Discard and continue" : "Clear cached files only", exact: true }).click();
      await expect(review).toHaveCount(0);
      const local = await readLocal(page, userId);
      expect(local.conversations).toHaveLength(action === "copy" ? 1 : 2);
      expect(local.outbox).toHaveLength(action === "copy" ? 1 : 3);
      expect(local.notebooks.some((note) => note.title === "Synthetic Retained unsynced note")).toBe(true);
      if (action === "files") {
        await expect(row.getByText(/Cached files 0\/1/)).toBeVisible();
        expect(local.notebooks.some((note) => note.title === "Synthetic newer selected note")).toBe(true);
      }
      expect((await context.request.get(`${baseURL}/api/conversations/${ids[0]}`)).status()).toBe(200);
      expect((await (await context.request.get(`${baseURL}/api/conversations/${ids[0]}/notebook`)).json()).title).toBe(null);
    } finally { await context.close(); await admin.dispose(); }
  });
}

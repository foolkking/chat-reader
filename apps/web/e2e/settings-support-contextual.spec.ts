import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { removeSyntheticAccount, settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000 });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated authenticated PostgreSQL and worker");

async function sendRequest(page: Page, title: string) {
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByRole("textbox", { name: "Request body", exact: true }).fill("Synthetic explanation; no source content included.");
  await expect(page.getByText("Draft saved on this device", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Submit request", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
}

async function approve(admin: APIRequestContext, user: APIRequestContext) {
  const requests = await (await user.get("/api/me/requests")).json();
  expect(requests.total).toBe(1);
  const request = requests.items[0];
  const result = await admin.post(`/api/admin/requests/${request.id}/decision`, {
    headers: { "Idempotency-Key": crypto.randomUUID() },
    data: { action: "APPROVE", base_revision: request.revision, body: "Synthetic reviewed approval", limits: request.requested_limits },
  });
  expect(result.status()).toBe(200);
  return request;
}

test("import limit request preserves selected bytes and never uploads until the user continues", async ({ browser, playwright, baseURL }) => {
  test.setTimeout(180_000);
  const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
  const policy = await (await admin.get("/api/admin/features")).json();
  const context = await browser.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base }, viewport: { width: 375, height: 900 } });
  let userId = "";
  try {
    expect((await admin.put("/api/admin/features", { data: { maximum_import_size_mb: 1 } })).status()).toBe(200);
    const registered = await context.request.post("/api/auth/register", { data: { email: `contextual-import-${Date.now()}@example.test`, password: "synthetic import passphrase", confirm_password: "synthetic import passphrase" } });
    expect(registered.status()).toBe(201); userId = (await registered.json()).user_id;
    await settingsAppearance(context.request, base, "en-US");
    const page = await context.newPage(); await page.goto(base);
    await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
    await page.getByRole("button", { name: /^(Import data|Import)$/ }).filter({ visible: true }).first().click();
    const source = Buffer.from(JSON.stringify({ metadata: { powered_by: "ChatGPT Exporter" }, messages: [{ role: "Prompt", say: "Synthetic input" }, { role: "Response", say: "Synthetic answer" }] }) + " ".repeat(1024 * 1024));
    const input = page.getByTestId("import-file-input");
    await input.setInputFiles({ name: "synthetic-private-selection.json", mimeType: "application/json", buffer: source });
    await expect(page.getByTestId("preview-import-button")).toBeDisabled();
    await page.getByRole("button", { name: "Request a higher limit", exact: true }).click();
    await expect(page.getByLabel("Import per file (MiB)", { exact: false })).toHaveValue("2");
    await expect(page.getByLabel("Merged messages", { exact: false })).toHaveValue("");
    await page.getByLabel("Import per file (MiB)", { exact: false }).fill("4");
    await page.getByLabel("Title", { exact: true }).fill("Earlier saved request");
    await expect(page.getByText("Draft saved on this device", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Request a higher limit", exact: true }).click();
    await expect(page.getByLabel("Import per file (MiB)", { exact: false })).toHaveValue("4");
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Earlier saved request");
    await expect(page.getByText("Your previous draft was restored. Review its requested limits before submitting.", { exact: true })).toBeVisible();
    await page.getByLabel("Import per file (MiB)", { exact: false }).fill("2");
    await sendRequest(page, "Synthetic import limit request");
    const request = await approve(admin, context.request);
    const detail = await (await context.request.get(`/api/me/requests/${request.id}`)).json();
    expect(JSON.stringify(detail)).not.toContain("synthetic-private-selection.json");
    expect(detail.requested_limits).toEqual({ import_size_mb: 2 });
    const refresh = page.waitForResponse(response => response.url().endsWith("/api/auth/capabilities"));
    await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); window.dispatchEvent(new Event("visibilitychange")); Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); window.dispatchEvent(new Event("visibilitychange")); delete (document as unknown as { visibilityState?: string }).visibilityState; });
    expect((await refresh).ok()).toBe(true);
    await expect(page.getByRole("dialog", { name: "Import data", exact: true }).getByText(/Current limit per file: ?2 MiB/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Synthetic import limit request", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Import data", exact: true })).toBeVisible();
    expect(await input.evaluate((element: HTMLInputElement) => Array.from(element.files ?? [], file => ({ name: file.name, size: file.size })))).toEqual([{ name: "synthetic-private-selection.json", size: source.length }]);
    await expect(page.getByTestId("preview-import-button")).toBeEnabled();
    await expect(page.getByTestId("preview-import-button")).toBeFocused();
    expect((await (await context.request.get("/api/conversations")).json())).toHaveLength(0);
    if (process.env.E2E_SETTINGS_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SETTINGS_SCREENSHOTS}/support-return-import-375.png` });
    const preview = page.waitForResponse(response => response.url().includes("/api/adaptive-import/sessions") && response.request().method() === "POST");
    await page.getByTestId("preview-import-button").click();
    expect((await preview).ok()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); if (userId) await removeSyntheticAccount(admin, userId); await admin.put("/api/admin/features", { data: policy }); await admin.dispose(); }
});

for (const project of [false, true]) {
  test(`merge limit request retains keyboard order and title in ${project ? "project" : "global"} list`, async ({ browser, playwright, baseURL }) => {
    test.setTimeout(180_000);
    const base = baseURL!, admin = await settingsAdmin(playwright.request, base);
    const policy = await (await admin.get("/api/admin/features")).json();
    const context = await browser.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base }, viewport: { width: project ? 768 : 1440, height: 900 } });
    let userId = "";
    try {
      expect((await admin.put("/api/admin/features", { data: { maximum_merge_message_count: 2 } })).status()).toBe(200);
      const registered = await context.request.post("/api/auth/register", { data: { email: `contextual-merge-${project}-${Date.now()}@example.test`, password: "synthetic merge passphrase", confirm_password: "synthetic merge passphrase" } });
      expect(registered.status()).toBe(201); userId = (await registered.json()).user_id;
      await settingsAppearance(context.request, base, "en-US");
      const projectId = project ? (await (await context.request.post("/api/projects", { data: { name: "Synthetic merge project" } })).json()).id : undefined;
      const sources: { id: string; title: string }[] = [];
      for (const title of ["Synthetic Alpha", "Synthetic Beta"]) {
        const response = await context.request.post("/api/conversations", { data: { title, project_id: projectId, messages: [{ role: "user", content_markdown: `${title} question` }, { role: "assistant", content_markdown: `${title} answer` }] } });
        expect(response.status()).toBe(201); sources.push({ id: (await response.json()).conversation.id, title });
      }
      const page = await context.newPage(); await page.goto(project ? `${base}/projects/${projectId}` : base);
      await page.getByRole("button", { name: "Manage conversations", exact: true }).click();
      for (const title of sources.map(row => row.title)) await page.getByRole("article").filter({ hasText: title }).locator("input[type=checkbox]").check();
      await page.getByRole("toolbar").getByRole("button", { name: "Merge", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Merge conversations", exact: true });
      await dialog.getByLabel("Merge title", { exact: true }).fill("Synthetic retained merge title");
      const rows = dialog.locator(".reader-interactive-row");
      const before = await rows.allTextContents();
      await rows.first().getByRole("button", { name: /^Move down:/ }).focus(); await page.keyboard.press("Enter");
      await expect.poll(async () => (await rows.allTextContents()).map(text => text.replace(/^\d+/, ""))).toEqual(before.map(text => text.replace(/^\d+/, "")).reverse());
      const orderedTitles = (await rows.allTextContents()).map(text => text.replace(/^\d+/, ""));
      await expect(dialog.getByRole("button", { name: "Merge 2 conversations", exact: true })).toBeDisabled();
      if (process.env.E2E_SETTINGS_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SETTINGS_SCREENSHOTS}/support-merge-${project ? 768 : 1440}.png` });
      await dialog.getByRole("button", { name: "Request a higher limit", exact: true }).click();
      await expect(page.getByLabel("Merged messages", { exact: false })).toHaveValue("4");
      await sendRequest(page, "Synthetic merge limit request"); await approve(admin, context.request);
      await page.keyboard.press("Escape");
      await expect(dialog.getByLabel("Merge title", { exact: true })).toHaveValue("Synthetic retained merge title");
      expect((await rows.allTextContents()).map(text => text.replace(/^\d+/, ""))).toEqual(orderedTitles);
      await expect(dialog.getByRole("button", { name: "Merge 2 conversations", exact: true })).toBeEnabled();
      expect((await (await context.request.get("/api/conversations")).json())).toHaveLength(2);
      if (!project) {
        const reset = await admin.put(`/api/admin/users/${userId}/limit-overrides`, { headers: { "Idempotency-Key": crypto.randomUUID() }, data: { base_revision: 1, limits: {}, reason: "Synthetic concurrent limit reset" } });
        expect(reset.status()).toBe(200);
        const rejection = page.waitForResponse(response => response.url().endsWith("/api/conversations/merge") && response.request().method() === "POST");
        await dialog.getByRole("button", { name: "Merge 2 conversations", exact: true }).click();
        const response = await rejection; expect(response.status()).toBe(422);
        expect((await response.json()).detail.code).toBe("MERGE_MESSAGE_LIMIT");
        await expect(dialog.getByText("The merge limit or source conversations changed. Review the latest counts and limits, then retry.", { exact: true })).toBeVisible();
        await expect(dialog.getByLabel("Merge title", { exact: true })).toHaveValue("Synthetic retained merge title");
        expect((await rows.allTextContents()).map(text => text.replace(/^\d+/, ""))).toEqual(orderedTitles);
        const grant = await admin.put(`/api/admin/users/${userId}/limit-overrides`, { headers: { "Idempotency-Key": crypto.randomUUID() }, data: { base_revision: 2, limits: { merge_message_count: 4 }, reason: "Synthetic reviewed restoration" } });
        expect(grant.status()).toBe(200);
        await dialog.getByRole("button", { name: "Refresh limits", exact: true }).click();
        await expect(dialog.getByRole("button", { name: "Merge 2 conversations", exact: true })).toBeEnabled();
      }
      const merging = page.waitForResponse(response => response.url().endsWith("/api/conversations/merge") && response.request().method() === "POST");
      await dialog.getByRole("button", { name: "Merge 2 conversations", exact: true }).click();
      const response = await merging; expect(response.status()).toBe(202);
      expect(response.request().postDataJSON()).toMatchObject({ title: "Synthetic retained merge title", conversation_ids: orderedTitles.map(title => sources.find(row => row.title === title)!.id) });
      const task = await response.json();
      await expect.poll(async () => (await (await context.request.get(`/api/tasks/${task.job_id}`)).json()).status).toBe("committed");
      const all = await (await context.request.get("/api/conversations")).json();
      expect(all.find((row: { title: string }) => row.title === "Synthetic retained merge title").message_count).toBe(4);
    } finally { await context.close(); if (userId) await removeSyntheticAccount(admin, userId); await admin.put("/api/admin/features", { data: policy }); await admin.dispose(); }
  });
}

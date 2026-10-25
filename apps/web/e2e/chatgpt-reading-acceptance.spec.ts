import { expect, test, type Page } from "@playwright/test";

const email = process.env.E2E_AUTH_EMAIL;
const password = process.env.E2E_AUTH_PASSWORD;

test.use({
  trace: "off",
  actionTimeout: 15_000,
  viewport: { width: 1440, height: 1000 },
  extraHTTPHeaders: { Origin: "http://127.0.0.1:3107" },
});

test.skip(
  process.env.E2E_CHATGPT_READING !== "1" || !email || !password,
  "Requires the task-local authenticated API/worker and an in-memory synthetic test account.",
);

async function signIn(page: Page, origin: string) {
  await page.goto("/login");
  await page.locator("#login-email").fill(email!);
  await page.locator("#login-password").fill(password!);
  await page.getByRole("button", { name: /Sign in|登录/ }).click();
  await expect(page).toHaveURL(`${origin}/`);
  await expect.poll(async () => (
    await page.evaluate(() => fetch("/api/auth/session", { cache: "no-store" }).then(response => response.json()))
  ).authenticated).toBe(true);
}

test("complete-turn Reader, guest Share and downloaded Offline Reader retain message anchors, with a bounded mapping preview", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const origin = baseURL!;
  const mutationHeaders = { Origin: origin };
  let conversationId: string | undefined;
  let shareId: string | undefined;
  let adaptiveImportId: string | undefined;
  let guest: Awaited<ReturnType<typeof browser.newContext>> | undefined;

  try {
    await signIn(page, origin);

    const readerSource = [
      "A synthetic user question.",
      "",
      "## Compatibility fixture",
      "",
      "Unsupported source: <fixture-widget data-kind=\"literal\">Visible source</fixture-widget>",
      "",
      "```mermaid",
      "graph TD",
      "accTitle: Synthetic compatibility diagram",
      "accDescr: Synthetic compatibility description.",
      "A-->B",
      "```",
    ].join("\n");
    const created = await page.request.post("/api/conversations", {
      headers: mutationHeaders,
      data: {
        title: "Synthetic compatibility conversation",
        messages: [
          { role: "user", content_markdown: "Synthetic complete-turn question." },
          { role: "assistant", content_markdown: readerSource },
        ],
      },
    });
    expect(created.status()).toBe(201);
    const createdPayload = await created.json() as {
      conversation: { id: string };
      messages: Array<{ id: string }>;
    };
    conversationId = createdPayload.conversation.id;
    const userMessageId = createdPayload.messages[0]!.id;
    const assistantMessageId = createdPayload.messages[1]!.id;

    const publicShare = await page.request.post(`/api/conversations/${conversationId}/shares`, {
      headers: mutationHeaders,
      data: {},
    });
    expect(publicShare.status()).toBe(200);
    const share = await publicShare.json() as { id: string; token: string };
    shareId = share.id;

    const assertCommonTurn = async (consumer: typeof page) => {
      const userArticle = consumer.locator(`article[data-message-id="${userMessageId}"]`);
      const article = consumer.locator(`article[data-message-id="${assistantMessageId}"]`);
      await expect(userArticle).toBeVisible();
      await expect(userArticle).toContainText("Synthetic complete-turn question.");
      await expect(article).toBeVisible();
      await expect(article).toContainText("Synthetic compatibility diagram");
      await expect(article).toContainText("Visible source");
      await expect(article.locator("fixture-widget")).toHaveCount(0);
      await expect(article.getByRole("img", { name: "Synthetic compatibility diagram" })).toBeVisible();
      await expect(article.getByText("Synthetic compatibility description.", { exact: true })).toBeVisible();
      await expect(article.getByText("Diagram source", { exact: true })).toBeVisible();
    };

    await page.goto(`/conversations/${conversationId}`);
    await assertCommonTurn(page);

    guest = await browser.newContext();
    const guestPage = await guest.newPage();
    await guestPage.goto(`/share/${share.token}`);
    await assertCommonTurn(guestPage);
    expect((await guest.cookies()).find(cookie => cookie.name === "chat_reader_session")).toBeUndefined();

    await page.goto(`/library?conversationId=${conversationId}`);
    await page.getByRole("button", { name: "Download offline copy", exact: true }).click();
    const offlineArticle = page.locator(`article[data-message-id="${assistantMessageId}"]`);
    await expect(offlineArticle).toBeVisible();
    await expect(page.locator("p:visible, span:visible", {
      hasText: /^(Offline ready|Existing offline version is available)/,
    }).first()).toBeVisible();
    await assertCommonTurn(page);

    await page.context().setOffline(true);
    await page.reload();
    await assertCommonTurn(page);
    await page.context().setOffline(false);

    const preferenceResponse = await page.request.patch("/api/preferences", {
      headers: mutationHeaders,
      data: { locale_mode: "en-US", theme_mode: "light" },
    });
    expect(preferenceResponse.status()).toBe(200);
    await page.goto("/");
    await page.getByRole("button", { name: /Import data|导入数据/ }).click();

    const longBody = "### Synthetic mapping heading\n\n" + "Synthetic bounded detail. ".repeat(120);
    const source = JSON.stringify({
      name: "Synthetic mapping sample",
      format_marker: "chatgpt-reading-acceptance",
      archive: {
        entries: Array.from({ length: 13 }, (_, index) => ({
          speaker: index % 2 === 0 ? "human" : "ai",
          body: index === 0 ? longBody : `Synthetic mapping message ${index + 1}.`,
          created_at: `2026-08-22T08:${String(index).padStart(2, "0")}:00Z`,
        })),
      },
    });
    const sessionResponsePromise = page.waitForResponse(response => (
      response.url().includes("/api/adaptive-import/sessions")
      && response.request().method() === "POST"
    ));
    await page.getByTestId("import-file-input").setInputFiles({
      name: "synthetic-mapping-sample.json",
      mimeType: "application/json",
      buffer: Buffer.from(source),
    });
    await page.getByTestId("preview-import-button").click();
    const sessionResponse = await sessionResponsePromise;
    expect(sessionResponse.status()).toBe(201);
    adaptiveImportId = (await sessionResponse.json() as { import_id: string }).import_id;
    await expect(page.getByText(/Found 1 conversations in 1 formats/)).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Map format", exact: true }).click();
    await page.getByLabel("Format name", { exact: true }).fill("Synthetic mapping display");
    const previewRequestCount = { value: 0 };
    const mappingSaveRequestCount = { value: 0 };
    page.on("request", request => {
      if (!request.url().includes(`/api/adaptive-import/sessions/${adaptiveImportId}/families/`)) return;
      if (request.url().endsWith("/mapping/preview") && request.method() === "POST") previewRequestCount.value += 1;
      if (request.url().endsWith("/mapping") && request.method() === "POST") mappingSaveRequestCount.value += 1;
    });
    await page.getByRole("button", { name: "Validate mapping", exact: true }).click();
    const preview = page.getByTestId("mapping-canonical-preview");
    await expect(preview).toBeVisible({ timeout: 60_000 });
    await expect(preview).toContainText("13 messages");
    await expect(preview).toContainText("Only the first 2000 characters of this message are shown.");
    await expect(preview).toContainText("The remaining 1 messages are not shown in this sample.");
    const displayModes = preview.getByRole("group", { name: "Preview display" });
    const renderedMode = displayModes.getByRole("button", { name: "Rendered", exact: true });
    const sourceMode = displayModes.getByRole("button", { name: "Source", exact: true });
    await expect(renderedMode).toHaveAttribute("aria-pressed", "true");
    await expect(preview.getByRole("heading", { name: "Synthetic mapping heading" })).toBeVisible();
    await preview.locator("h5").scrollIntoViewIfNeeded();
    await expect(displayModes).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("mapping-rendered-1440.png") });
    const sessionBeforeToggle = await page.request.get(`/api/adaptive-import/sessions/${adaptiveImportId}`);
    expect(sessionBeforeToggle.status()).toBe(200);
    const persistedBefore = await sessionBeforeToggle.json() as { families: Array<{ mapping_draft: unknown }> };
    await sourceMode.click();
    await expect(sourceMode).toHaveAttribute("aria-pressed", "true");
    await expect(preview.getByText(/### Synthetic mapping heading/)).toBeVisible();
    await renderedMode.click();
    await expect(renderedMode).toHaveAttribute("aria-pressed", "true");
    const sessionAfterToggle = await page.request.get(`/api/adaptive-import/sessions/${adaptiveImportId}`);
    expect(sessionAfterToggle.status()).toBe(200);
    const persistedAfter = await sessionAfterToggle.json() as { families: Array<{ mapping_draft: unknown }> };
    expect(persistedAfter.families[0]?.mapping_draft).toEqual(persistedBefore.families[0]?.mapping_draft);
    expect(previewRequestCount.value).toBe(1);
    expect(mappingSaveRequestCount.value).toBe(0);
    await page.setViewportSize({ width: 375, height: 900 });
    await preview.locator("h5").scrollIntoViewIfNeeded();
    await expect(displayModes).toBeInViewport();
    const mobileBounds = await preview.boundingBox();
    expect(mobileBounds).not.toBeNull();
    expect(mobileBounds!.width).toBeLessThanOrEqual(375);
    expect(mobileBounds!.x).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath("mapping-rendered-375.png") });
  } finally {
    await guest?.close();
    await page.context().setOffline(false).catch(() => undefined);
    if (adaptiveImportId) {
      await page.request.delete(`/api/adaptive-import/sessions/${adaptiveImportId}`, { headers: mutationHeaders }).catch(() => undefined);
    }
    if (shareId) {
      await page.request.post(`/api/shares/${shareId}/revoke`, { headers: mutationHeaders }).catch(() => undefined);
    }
    if (conversationId) {
      await page.request.delete(`/api/conversations/${conversationId}`, { headers: mutationHeaders }).catch(() => undefined);
    }
  }
});

test("import completion exposes every warning through a native disclosure (preview/commit adapters)", async ({ page, baseURL }, testInfo) => {
    test.setTimeout(60_000);
    await signIn(page, baseURL!);
    const preferenceResponse = await page.request.patch("/api/preferences", {
      headers: { Origin: baseURL! },
      data: { locale_mode: "en-US", theme_mode: "light" },
    });
    expect(preferenceResponse.status()).toBe(200);
    const warningImportId = "synthetic-warning-import";
    const completion = {
      import_id: warningImportId,
      status: "committed",
      conversation_ids: [],
      conversation_count: 0,
      message_count: 0,
      warnings: Array.from({ length: 6 }, (_, index) => `Synthetic completion warning ${index + 1}`),
      phase: "committed",
      progress: 100,
      processed_messages: 0,
      total_messages: 0,
    };
    await page.route("**/api/imports/preview", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        import_id: warningImportId,
        status: "previewed",
        files: [],
        can_commit: true,
        warnings: [],
        archive_summary: {},
      }),
    }));
    await page.route(`**/api/imports/${warningImportId}/commit`, route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(completion),
    }));
    await page.route(`**/api/imports/${warningImportId}/content-cleanup`, route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "NOT_REQUESTED" }),
    }));
    await page.route(`**/api/content-cleanup/scans/pending?import_id=${warningImportId}`, route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    }));
    await page.goto("/");
    const settingsMenu = page.getByRole("region", { name: /^(Settings|设置)$/ }).and(page.locator("div"));
    if (!await settingsMenu.isVisible()) {
      const settingsButton = page.getByRole("button", { name: /^(Settings|设置)$/ });
      await expect(settingsButton).toBeVisible();
      await settingsButton.click();
    }
    await settingsMenu.getByRole("button", { name: /Data.*backup|数据与备份|Data archive|数据归档/ }).click();
    const backupDialog = page.getByRole("dialog", { name: /Data.*backup|数据与备份|Data archive|数据归档/ });
    await backupDialog.getByRole("button", { name: /^(Restore archive|恢复归档)$/ }).click();
    await backupDialog.getByRole("button", { name: /Restore a conversation archive|恢复单个对话归档/ }).click();
    const archiveDialog = page.getByRole("dialog", { name: /Restore conversation archive|恢复对话归档/ });
    await archiveDialog.getByTestId("import-file-input").setInputFiles({
      name: "synthetic-warning-sample.cr",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("synthetic archive placeholder"),
    });
    await archiveDialog.getByTestId("preview-import-button").click();
    await expect(archiveDialog.getByTestId("commit-import-button")).toBeEnabled();
    await archiveDialog.getByTestId("commit-import-button").click();
    const completionSummary = archiveDialog.getByTestId("import-completion-summary");
    await expect(completionSummary.getByText("Synthetic completion warning 1", { exact: true })).toBeVisible();
    await expect(completionSummary.getByText("Synthetic completion warning 4", { exact: true })).toBeVisible();
    const remainingWarnings = completionSummary.getByTestId("import-remaining-warnings");
    await expect(remainingWarnings).toBeVisible();
    await expect.poll(() => remainingWarnings.evaluate(element => (element as HTMLDetailsElement).open)).toBe(false);
    await expect(completionSummary.getByText("Synthetic completion warning 5", { exact: true })).toBeHidden();
    await remainingWarnings.locator("summary").click();
    await expect(completionSummary.getByText("Synthetic completion warning 5", { exact: true })).toBeVisible();
    await expect(completionSummary.getByText("Synthetic completion warning 6", { exact: true })).toBeVisible();
    await completionSummary.screenshot({ path: testInfo.outputPath("warnings-expanded-1440.png") });
    await page.setViewportSize({ width: 375, height: 900 });
    await completionSummary.screenshot({ path: testInfo.outputPath("warnings-expanded-375.png") });
});

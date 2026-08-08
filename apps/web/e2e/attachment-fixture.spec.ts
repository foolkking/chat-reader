import { expect, test } from "@playwright/test";

const fixtureZip = process.env.CHAT_READER_E2E_FIXTURE_ZIP;
const runFixtureFlow = process.env.E2E_ATTACHMENT_FIXTURE === "1" && Boolean(fixtureZip);

test.skip(!runFixtureFlow, "E2E_ATTACHMENT_FIXTURE=1 and CHAT_READER_E2E_FIXTURE_ZIP are required");

test("imports the real attachment fixture through the product UI", async ({ page, request }) => {
  test.setTimeout(300_000);
  await page.goto("/");
  await page.getByRole("button", { name: /Import data|导入数据/ }).click();
  await page.getByRole("button", { name: /附件对话包|Attachment bundle/ }).click();
  await page.getByTestId("import-file-input").setInputFiles(fixtureZip!);
  await page.getByTestId("preview-import-button").click();

  await expect(page.getByTestId("bundle-preview-stats")).toBeVisible();
  await expect(page.getByTestId("bundle-attachment-count")).toHaveText("20");
  await expect(page.getByTestId("bundle-resolved-count")).toHaveText("19");
  await expect(page.getByTestId("bundle-missing-count")).toHaveText("1");
  await expect(page.getByTestId("bundle-object-count")).toHaveText("18");
  await expect(page.getByTestId("bundle-occurrence-count")).toHaveText("21");
  await expect(page.getByTestId("bundle-unplaced-count")).toHaveText("1");

  await page.getByTestId("commit-import-button").click();
  await expect(page).toHaveURL(/\/conversations\/[0-9a-f-]+$/);
  const conversationId = page.url().split("/").at(-1)!;

  try {
    await expect(page.getByTestId("attachment-block").first()).toBeVisible();
    const inlineImage = page.getByTestId("attachment-block").locator("img").first();
    await expect(inlineImage).toBeVisible();
    await inlineImage.click();
    const previewDialog = page.locator('body > [role="dialog"]');
    await expect(previewDialog).toBeVisible();
    const previewBounds = await previewDialog.boundingBox();
    const viewport = page.viewportSize();
    expect(previewBounds?.width).toBeGreaterThan((viewport?.width ?? 0) * 0.95);
    expect(previewBounds?.height).toBeGreaterThan((viewport?.height ?? 0) * 0.95);
    await expect(previewDialog).toHaveAttribute("data-preview-kind", "image");
    const previewPanel = previewDialog.getByTestId("attachment-preview-panel");
    const panelBounds = await previewPanel.boundingBox();
    expect(panelBounds?.width).toBeLessThan((viewport?.width ?? 0) * 0.96);
    expect(panelBounds?.height).toBeLessThan((viewport?.height ?? 0) * 0.9);
    expect(await previewPanel.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgb(255, 255, 255)");
    await previewDialog.getByRole("button", { name: /Close preview|关闭预览/ }).click();
    await expect(previewDialog).toHaveCount(0);
    await expect(page.getByTestId("attachment-block").locator("pre").first()).toBeVisible();

    const attachmentsResponse = await page.request.get(`/api/conversations/${conversationId}/attachments`);
    expect(attachmentsResponse.ok()).toBeTruthy();
    const attachmentPayload = await attachmentsResponse.json() as { items: Array<{
      id: string;
      display_name: string;
      scan_status: string;
      resolution_status: string;
      occurrence_count: number;
      is_used: boolean;
      detected_mime_type?: string | null;
      asset_object: { id: string; detected_mime_type?: string | null } | null;
    }> };
    const attachments = attachmentPayload.items;
    expect(attachments).toHaveLength(20);
    expect(attachments.reduce((total, item) => total + item.occurrence_count, 0)).toBe(21);
    expect(attachments.filter((item) => item.scan_status === "scanner_disabled")).toHaveLength(19);
    expect(attachments.filter((item) => item.scan_status === "not_available")).toHaveLength(1);
    expect(attachments.filter((item) => item.resolution_status === "missing")).toHaveLength(1);
    expect(attachments.filter((item) => !item.is_used)).toHaveLength(1);
    expect(new Set(attachments.flatMap((item) => item.asset_object ? [item.asset_object.id] : [])).size).toBe(18);

    const markdownAttachment = attachments.find((item) => item.is_used && item.display_name.endsWith(".md"));
    expect(markdownAttachment).toBeTruthy();
    const markdownBlock = page.locator(`[data-testid="attachment-block"][data-attachment-id="${markdownAttachment!.id}"]`);
    if (!(await markdownBlock.isVisible())) {
      const expandFiles = page.locator('[data-testid="attachment-group"][data-attachment-group="files"]').getByRole("button", { name: /展开其余|Expand/ });
      if (await expandFiles.count()) await expandFiles.first().click();
    }
    await expect(markdownBlock).toBeVisible();
    await expect(markdownBlock.locator("h1, h2, h3, h4").first()).toBeVisible();

    const svgAttachment = attachments.find((item) =>
      (item.detected_mime_type ?? item.asset_object?.detected_mime_type) === "image/svg+xml");
    expect(svgAttachment).toBeTruthy();
    const svgBlock = page.locator(`[data-testid="attachment-block"][data-attachment-id="${svgAttachment!.id}"]`);
    if (!(await svgBlock.isVisible())) {
      await page.locator('[data-testid="attachment-group"][data-attachment-group="images"]').getByRole("button", { name: /展开其余|Expand/ }).click();
    }
    await expect(svgBlock).toBeVisible();
    await expect(svgBlock.locator("img")).toHaveCount(1);
    await expect(svgBlock.locator("svg, script, object, embed, iframe")).toHaveCount(0);

    const pageCountBeforeSvgPreview = page.context().pages().length;
    const scrollPositionBeforeSvgPreview = await page.evaluate(() => window.scrollY);
    const svgTrigger = svgBlock.getByRole("button", { name: /Preview/ }).first();
    await svgTrigger.click();
    const svgDialog = page.locator('body > [role="dialog"]');
    await expect(svgDialog).toBeVisible();
    const svgPreviewContent = svgDialog.getByTestId("attachment-preview-content");
    await expect(svgPreviewContent.locator("img")).toHaveCount(1);
    await expect(svgPreviewContent.locator("svg, script, object, embed")).toHaveCount(0);
    await expect(svgDialog.getByRole("button", { name: /Close preview|\u5173\u95ed\u9884\u89c8/ })).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    await page.keyboard.press("Tab");
    await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('body > [role="dialog"]')?.contains(document.activeElement)))).toBeTruthy();
    await page.keyboard.press("Escape");
    await expect(svgDialog).toHaveCount(0);
    await expect(svgTrigger).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollPositionBeforeSvgPreview);
    expect(page.context().pages()).toHaveLength(pageCountBeforeSvgPreview);

    await svgTrigger.click();
    await expect(svgDialog).toBeVisible();
    await svgDialog.click({ position: { x: 2, y: 2 } });
    await expect(svgDialog).toHaveCount(0);
    await expect(svgTrigger).toBeFocused();
    expect(page.context().pages()).toHaveLength(pageCountBeforeSvgPreview);

    await page.getByRole("button", { name: /Message actions|消息操作/ }).click();
    await page.getByRole("button", { name: /Conversation files|当前对话文件/ }).click();
    await expect(page.getByTestId("conversation-files-panel")).toBeVisible();
    await expect(page.getByTestId("conversation-files-group-used")).toContainText(/(?:已在正文使用|已放入正文|Used in messages) [·-] 18/);
    await expect(page.getByTestId("conversation-files-group-unused")).toContainText(/(?:尚未放入正文|Not placed) [·-] 1/);
    await expect(page.getByTestId("conversation-files-group-missing")).toContainText(/(?:缺失或不可用|Missing or unavailable) [·-] 1/);
    await expect(page.getByTestId("conversation-file-row")).toHaveCount(20);
    await expect(page.locator('[data-testid="conversation-file-row"][data-scan-status="scanner_disabled"]')).toHaveCount(19);
    await expect(page.locator('[data-testid="conversation-file-row"][data-resolution-status="missing"]')).toHaveCount(1);

    const shareResponse = await page.request.post(`/api/conversations/${conversationId}/shares`, {
      data: { scope: "conversation", include_toc: true, include_metadata: true },
    });
    expect(shareResponse.ok()).toBeTruthy();
    const share = await shareResponse.json() as { id: string; token: string };
    // Owner rendering is covered above. Keep the large fixture's Share check
    // focused on authorization instead of loading every preview a second time.
    const sharedContent = await request.get(`/api/shared/${share.token}/attachments/${svgAttachment!.id}/content`);
    expect(sharedContent.ok()).toBeTruthy();
    const revokeShare = await request.post(`/api/shares/${share.id}/revoke`);
    expect(revokeShare.ok()).toBeTruthy();
    const revokedContent = await request.get(`/api/shared/${share.token}/attachments/${svgAttachment!.id}/content`);
    expect(revokedContent.ok()).toBeFalsy();
  } finally {
    const cleanup = await request.delete(`/api/conversations/${conversationId}`);
    expect(cleanup.ok()).toBeTruthy();
  }
});

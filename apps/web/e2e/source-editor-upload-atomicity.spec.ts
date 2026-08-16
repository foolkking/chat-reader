import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const runUploadAtomicity = process.env.E2E_ATTACHMENT_UPLOAD === "1";

test.skip(
  !runUploadAtomicity,
  "Set E2E_ATTACHMENT_UPLOAD=1 to run the Release I upload-token atomicity matrix.",
);

type CreatedFixture = {
  conversationId: string;
  messageId: string;
};

type MessagePatchPayload = {
  content_markdown?: string;
};

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function createConversation(
  request: APIRequestContext,
  source = "Upload atomicity baseline.",
): Promise<CreatedFixture> {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const create = await request.post("/api/conversations", {
    data: {
      title: `Release I upload ${suffix}`,
      messages: [
        { role: "user", content_markdown: source },
        { role: "assistant", content_markdown: "Release I paired response." },
      ],
    },
  });
  expect(create.status()).toBe(201);
  const body = (await create.json()) as {
    conversation: { id: string };
    messages: Array<{ id: string }>;
  };
  return { conversationId: body.conversation.id, messageId: body.messages[0].id };
}

async function openSourceEditor(page: Page, conversationId: string, messageId: string) {
  await page.goto(`/conversations/${conversationId}`);
  const message = page.locator(`#message-${messageId}`);
  await expect(message).toBeVisible();
  await message.scrollIntoViewIfNeeded();
  await message.getByRole("button", { name: /Edit Markdown source|编辑 Markdown 源码/ }).click();
  await expect(page.getByTestId("source-editor-codemirror")).toBeVisible();
}

function captureMessagePatches(page: Page) {
  const payloads: MessagePatchPayload[] = [];
  page.on("request", (request) => {
    if (request.method() !== "PATCH" || !/\/api\/messages\/[^/]+$/.test(request.url())) {
      return;
    }
    try {
      payloads.push(request.postDataJSON() as MessagePatchPayload);
    } catch {
      payloads.push({});
    }
  });
  return payloads;
}

async function installFinalizeBarrier(page: Page, conversationId: string) {
  const seen = createDeferred();
  const release = createDeferred();
  let holding = false;

  await page.route(`**/api/conversations/${conversationId}/attachments`, async (route) => {
    if (route.request().method() === "POST" && !holding) {
      holding = true;
      seen.resolve();
      await release.promise;
    }
    await route.continue();
  });

  return { seen: seen.promise, release: release.resolve };
}

async function installLazyEditorChunkBarrier(page: Page) {
  const seen = createDeferred();
  const release = createDeferred();
  let holding = false;

  await page.route("**/_next/static/chunks/*.js", async (route) => {
    if (!holding) {
      holding = true;
      seen.resolve();
      await release.promise;
    }
    await route.continue();
  });

  return { seen: seen.promise, release: release.resolve };
}

async function failFirstFinalize(page: Page, conversationId: string) {
  let failed = false;
  await page.route(`**/api/conversations/${conversationId}/attachments`, async (route) => {
    if (route.request().method() === "POST" && !failed) {
      failed = true;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Deterministic Release I upload failure." }),
      });
      return;
    }
    await route.continue();
  });
}

async function readEditorDocument(page: Page) {
  return (await page.getByTestId("source-editor-codemirror").locator(".cm-line").allTextContents()).join("\n");
}

async function readCursorOffset(page: Page) {
  return Number(
    (await page.getByTestId("source-editor-codemirror").getAttribute("data-cursor-offset")) ?? "0",
  );
}

function sourceEditorAlert(page: Page) {
  return page.getByTestId("floating-source-workspace").getByRole("alert");
}

async function replaceEditorDocument(page: Page, value: string) {
  const editor = page.getByTestId("source-editor-codemirror").locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(value);
}

async function appendToEditor(page: Page, value: string) {
  const editor = page.getByTestId("source-editor-codemirror").locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(value);
}

async function submitEditorProgrammatically(page: Page) {
  await page.locator("#reader-source-editor-form").evaluate((form) => {
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  });
}

async function saveAndReadPatch(page: Page, payloads: MessagePatchPayload[]) {
  const saveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" && /\/api\/messages\/[^/]+$/.test(response.url()),
  );
  await page.getByTestId("source-editor-create-version").click();
  expect((await saveResponse).ok()).toBeTruthy();
  expect(payloads).toHaveLength(1);
  return payloads[0].content_markdown ?? "";
}

async function deleteConversation(page: Page, conversationId: string | undefined) {
  if (!conversationId) {
    return;
  }
  const request = page.request;
  await page.close();
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await request.delete(`/api/conversations/${conversationId}`);
    lastStatus = response.status();
    if (response.ok()) {
      expect((await request.get(`/api/conversations/${conversationId}`)).status()).toBe(404);
      return;
    }
    if (lastStatus !== 500) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Conversation cleanup failed with HTTP ${lastStatus}`);
}

test.describe("Release I source editor upload-token atomicity", () => {
  test.describe.configure({ timeout: 120_000 });

  test("I-RACE-001 blocks even a programmatic submit while the authoritative document is transient", async ({
    page,
  }) => {
    let fixture: CreatedFixture | undefined;
    try {
      fixture = await createConversation(page.request);
      await openSourceEditor(page, fixture.conversationId, fixture.messageId);
      const payloads = captureMessagePatches(page);

      await replaceEditorDocument(
        page,
        "Blocked upload reference:\n\n[Uploading: pending.txt](cr-upload://draft-00000000-0000-4000-8000-000000000001)",
      );
      await expect(page.getByTestId("source-editor-create-version")).toBeDisabled();

      await submitEditorProgrammatically(page);
      await expect(sourceEditorAlert(page)).toContainText(/attachment|附件/i);
      expect(payloads).toHaveLength(0);
    } finally {
      await deleteConversation(page, fixture?.conversationId);
    }
  });

  test("I-RACE-002 chooser fast completion saves only canonical source and preserves typing", async ({
    page,
  }) => {
    let fixture: CreatedFixture | undefined;
    try {
      fixture = await createConversation(page.request);
      await openSourceEditor(page, fixture.conversationId, fixture.messageId);
      const payloads = captureMessagePatches(page);

      await page.getByTestId("source-editor-attachment-input").setInputFiles({
        name: "fast-upload.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("fast upload payload"),
      });
      await appendToEditor(page, "\n\nTyped during fast upload.");

      await expect(page.getByTestId("source-editor-create-version")).toBeEnabled();
      const source = await saveAndReadPatch(page, payloads);
      expect(source).toContain("Typed during fast upload.");
      expect(source).toContain("cr-asset://");
      expect(source).not.toContain("cr-upload://");

      const versionsResponse = await page.request.get(`/api/messages/${fixture.messageId}/versions`);
      expect(versionsResponse.ok()).toBeTruthy();
      const versions = (await versionsResponse.json()) as {
        items: Array<{ display_text: string; is_current: boolean }>;
      };
      const persistedSource = versions.items.find((item) => item.is_current)?.display_text ?? "";
      expect(persistedSource).toContain("cr-asset://");
      expect(persistedSource).not.toContain("cr-upload://");

      const attachmentsResponse = await page.request.get(
        `/api/conversations/${fixture.conversationId}/attachments`,
      );
      expect(attachmentsResponse.ok()).toBeTruthy();
      const attachments = (await attachmentsResponse.json()) as {
        items: Array<{ occurrence_count: number; current_occurrence_count: number }>;
      };
      expect(attachments.items).toHaveLength(1);
      expect(attachments.items[0]).toMatchObject({ occurrence_count: 1, current_occurrence_count: 1 });
    } finally {
      await deleteConversation(page, fixture?.conversationId);
    }
  });

  test("I-RACE-002A queued chooser survives the lazy CodeMirror controlled-value handoff", async ({
    page,
  }) => {
    let fixture: CreatedFixture | undefined;
    try {
      fixture = await createConversation(page.request);
      await page.goto(`/conversations/${fixture.conversationId}`);
      const message = page.locator(`#message-${fixture.messageId}`);
      await expect(message).toBeVisible();
      const chunkBarrier = await installLazyEditorChunkBarrier(page);
      await message.getByRole("button", { name: /Edit Markdown source|编辑 Markdown 源码/ }).click();
      await chunkBarrier.seen;
      await expect(page.getByTestId("source-editor-attachment-input")).toBeAttached();
      await expect(page.getByTestId("source-editor-codemirror").locator(".cm-content")).toHaveCount(0);

      const finalizeBarrier = await installFinalizeBarrier(page, fixture.conversationId);
      const payloads = captureMessagePatches(page);
      await page.getByTestId("source-editor-attachment-input").setInputFiles({
        name: "queued-before-codemirror.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# Queued attachment\n"),
      });

      chunkBarrier.release();
      await expect(page.getByTestId("source-editor-codemirror").locator(".cm-content")).toBeVisible();
      await finalizeBarrier.seen;
      const pendingSource = await readEditorDocument(page);
      expect(pendingSource).toContain("cr-upload://");
      expect(pendingSource).not.toContain("cr-asset://");
      await expect(page.getByTestId("source-editor-create-version")).toBeDisabled();

      finalizeBarrier.release();
      await expect(page.getByTestId("source-editor-create-version")).toBeEnabled();
      const source = await saveAndReadPatch(page, payloads);
      expect(source).toContain("cr-asset://");
      expect(source).not.toContain("cr-upload://");

      const versionsResponse = await page.request.get(`/api/messages/${fixture.messageId}/versions`);
      expect(versionsResponse.ok()).toBeTruthy();
      const versions = (await versionsResponse.json()) as {
        items: Array<{ display_text: string; is_current: boolean }>;
      };
      const persistedSource = versions.items.find((item) => item.is_current)?.display_text ?? "";
      expect(persistedSource).toContain("cr-asset://");
      expect(persistedSource).not.toContain("cr-upload://");

      const attachmentsResponse = await page.request.get(
        `/api/conversations/${fixture.conversationId}/attachments`,
      );
      expect(attachmentsResponse.ok()).toBeTruthy();
      const attachments = (await attachmentsResponse.json()) as {
        items: Array<{ occurrence_count: number; current_occurrence_count: number }>;
      };
      expect(attachments.items).toHaveLength(1);
      expect(attachments.items[0]).toMatchObject({ occurrence_count: 1, current_occurrence_count: 1 });
    } finally {
      await deleteConversation(page, fixture?.conversationId);
    }
  });

  test("I-RACE-003 slow finalize blocks save, preserves newer typing, cursor, and scroll", async ({
    page,
  }) => {
    let fixture: CreatedFixture | undefined;
    try {
      const longSource = Array.from(
        { length: 160 },
        (_, index) => `Paragraph ${index + 1}: deterministic editor scroll content.`,
      ).join("\n\n");
      fixture = await createConversation(page.request, longSource);
      await openSourceEditor(page, fixture.conversationId, fixture.messageId);
      const payloads = captureMessagePatches(page);
      const barrier = await installFinalizeBarrier(page, fixture.conversationId);

      const scroller = page.getByTestId("source-editor-codemirror").locator(".cm-scroller");
      await scroller.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      const scrollBefore = await scroller.evaluate((element) => element.scrollTop);

      await page.getByTestId("source-editor-attachment-input").setInputFiles({
        name: "slow-upload.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("slow upload payload"),
      });
      await barrier.seen;
      await appendToEditor(page, "\n\nTyped while finalize is held.");
      const cursorBeforeRelease = Number(
        (await page.getByTestId("source-editor-codemirror").getAttribute("data-cursor-offset")) ?? "0",
      );

      await expect(page.getByTestId("source-editor-create-version")).toBeDisabled();
      await submitEditorProgrammatically(page);
      expect(payloads).toHaveLength(0);

      barrier.release();
      await expect(page.getByTestId("source-editor-create-version")).toBeEnabled();
      const cursorAfterRelease = Number(
        (await page.getByTestId("source-editor-codemirror").getAttribute("data-cursor-offset")) ?? "0",
      );
      const scrollAfter = await scroller.evaluate((element) => element.scrollTop);
      expect(cursorBeforeRelease).toBeGreaterThan(0);
      expect(cursorAfterRelease).toBeGreaterThan(0);
      expect(scrollAfter).toBeGreaterThanOrEqual(scrollBefore - 8);

      const source = await saveAndReadPatch(page, payloads);
      expect(source).toContain("Typed while finalize is held.");
      expect(source).toContain("cr-asset://");
      expect(source).not.toContain("cr-upload://");
    } finally {
      await deleteConversation(page, fixture?.conversationId);
    }
  });

  test("I-RACE-004 out-of-order completion keeps save blocked until both uploads resolve", async ({
    page,
  }) => {
    let fixture: CreatedFixture | undefined;
    try {
      fixture = await createConversation(page.request);
      await openSourceEditor(page, fixture.conversationId, fixture.messageId);
      const payloads = captureMessagePatches(page);
      const barrier = await installFinalizeBarrier(page, fixture.conversationId);

      await page.getByTestId("source-editor-attachment-input").setInputFiles([
        {
          name: "ordered-a.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("first upload held at finalize"),
        },
        {
          name: "ordered-b.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("second upload allowed to finish first"),
        },
      ]);
      await barrier.seen;
      await expect(
        page.getByTestId("source-editor-attachment-drafts")
          .locator("[data-testid^='source-editor-upload-']")
          .filter({ hasText: /Uploading:|\u6b63\u5728\u4e0a\u4f20/ }),
      ).toHaveCount(1);
      await expect(page.getByTestId("source-editor-create-version")).toBeDisabled();
      await submitEditorProgrammatically(page);
      expect(payloads).toHaveLength(0);

      barrier.release();
      await expect(page.getByTestId("source-editor-create-version")).toBeEnabled();
      const source = await saveAndReadPatch(page, payloads);
      expect(source.match(/cr-asset:\/\//g) ?? []).toHaveLength(2);
      expect(source).not.toContain("cr-upload://");
    } finally {
      await deleteConversation(page, fixture?.conversationId);
    }
  });

  test("I-RACE-005 partial failure retains the successful canonical reference and blocks the failed token", async ({
    page,
  }) => {
    let fixture: CreatedFixture | undefined;
    try {
      fixture = await createConversation(page.request);
      await openSourceEditor(page, fixture.conversationId, fixture.messageId);
      const payloads = captureMessagePatches(page);
      await failFirstFinalize(page, fixture.conversationId);

      await page.getByTestId("source-editor-attachment-input").setInputFiles([
        {
          name: "partial-a.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("one upload will fail"),
        },
        {
          name: "partial-b.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("one upload will succeed"),
        },
      ]);
      await expect(
        page.getByTestId("source-editor-attachment-drafts")
          .locator("[data-testid^='source-editor-upload-']")
          .filter({ hasText: /Upload failed:|\u4e0a\u4f20\u5931\u8d25/ }),
      ).toHaveCount(1);
      await expect(
        page.getByTestId("source-editor-attachment-drafts")
          .locator("[data-testid^='source-editor-upload-']")
          .filter({ hasText: /Uploading:|\u6b63\u5728\u4e0a\u4f20/ }),
      ).toHaveCount(0);
      const source = await readEditorDocument(page);
      expect(source.match(/cr-asset:\/\//g) ?? []).toHaveLength(1);
      expect(source.match(/cr-upload:\/\//g) ?? []).toHaveLength(1);
      await expect(page.getByTestId("source-editor-create-version")).toBeDisabled();

      await submitEditorProgrammatically(page);
      await expect(sourceEditorAlert(page)).toContainText(/not ready|\u5c1a\u672a\u5b8c\u6210/i);
      expect(payloads).toHaveLength(0);
    } finally {
      await deleteConversation(page, fixture?.conversationId);
    }
  });

  test("I-RACE-006 retry is idempotent even when the Retry control is activated twice rapidly", async ({
    page,
  }) => {
    let fixture: CreatedFixture | undefined;
    try {
      fixture = await createConversation(page.request);
      await openSourceEditor(page, fixture.conversationId, fixture.messageId);
      const payloads = captureMessagePatches(page);
      let finalizeRequests = 0;
      page.on("request", (request) => {
        if (
          request.method() === "POST"
          && request.url().endsWith(`/api/conversations/${fixture?.conversationId}/attachments`)
        ) {
          finalizeRequests += 1;
        }
      });
      await failFirstFinalize(page, fixture.conversationId);

      await page.getByTestId("source-editor-attachment-input").setInputFiles({
        name: "retry-once.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("retry upload payload"),
      });
      const retry = page.getByRole("button", { name: /Retry|\u91cd\u8bd5/ });
      await expect(retry).toBeVisible();
      await retry.evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });

      await expect(page.getByTestId("source-editor-create-version")).toBeEnabled();
      await expect.poll(() => finalizeRequests).toBe(2);
      const source = await saveAndReadPatch(page, payloads);
      expect(source.match(/cr-asset:\/\//g) ?? []).toHaveLength(1);
      expect(source).not.toContain("cr-upload://");

      const attachments = await page.request.get(`/api/conversations/${fixture.conversationId}/attachments`);
      expect(attachments.ok()).toBeTruthy();
      expect(((await attachments.json()) as { items: unknown[] }).items).toHaveLength(1);
    } finally {
      await deleteConversation(page, fixture?.conversationId);
    }
  });

  test("I-RACE-007 canonical replacement maps cursor and selection to the same logical text", async ({
    page,
  }) => {
    let fixture: CreatedFixture | undefined;
    try {
      fixture = await createConversation(page.request, "PREFIX-0123456789\n\nTAIL-abcdefghij");
      await openSourceEditor(page, fixture.conversationId, fixture.messageId);
      const barrier = await installFinalizeBarrier(page, fixture.conversationId);
      const editor = page.getByTestId("source-editor-codemirror").locator(".cm-content");
      await editor.click();
      await page.keyboard.press("Control+Home");

      await page.getByTestId("source-editor-attachment-input").setInputFiles({
        name: "selection-map.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("selection mapping payload"),
      });
      await barrier.seen;
      await editor.click();
      await page.keyboard.press("Control+End");
      for (let index = 0; index < 4; index += 1) {
        await page.keyboard.press("Shift+ArrowLeft");
      }
      expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("ghij");
      const sourceBefore = await readEditorDocument(page);
      const cursorBefore = await readCursorOffset(page);

      barrier.release();
      await expect(page.getByTestId("source-editor-create-version")).toBeEnabled();
      const sourceAfter = await readEditorDocument(page);
      const cursorAfter = await readCursorOffset(page);
      expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("ghij");
      expect(cursorAfter).toBe(cursorBefore + sourceAfter.length - sourceBefore.length);
      expect(sourceAfter).not.toContain("cr-upload://");
    } finally {
      await deleteConversation(page, fixture?.conversationId);
    }
  });

  test("I-RACE-008 canonical replacement preserves the long-document scroll anchor", async ({ page }) => {
    let fixture: CreatedFixture | undefined;
    try {
      const longSource = Array.from(
        { length: 240 },
        (_, index) => `Scroll paragraph ${index + 1}: stable source editor viewport.`,
      ).join("\n\n");
      fixture = await createConversation(page.request, longSource);
      await openSourceEditor(page, fixture.conversationId, fixture.messageId);
      const barrier = await installFinalizeBarrier(page, fixture.conversationId);
      const editor = page.getByTestId("source-editor-codemirror").locator(".cm-content");
      const scroller = page.getByTestId("source-editor-codemirror").locator(".cm-scroller");
      await editor.click();
      await page.keyboard.press("Control+End");

      await page.getByTestId("source-editor-attachment-input").setInputFiles({
        name: "scroll-anchor.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("scroll anchor payload"),
      });
      await barrier.seen;
      const before = await scroller.evaluate((element) => ({
        top: element.scrollTop,
        distanceFromBottom: element.scrollHeight - element.clientHeight - element.scrollTop,
      }));

      barrier.release();
      await expect(page.getByTestId("source-editor-create-version")).toBeEnabled();
      const after = await scroller.evaluate((element) => ({
        top: element.scrollTop,
        distanceFromBottom: element.scrollHeight - element.clientHeight - element.scrollTop,
      }));
      expect(before.top).toBeGreaterThan(0);
      expect(after.top).toBeGreaterThan(0);
      expect(Math.abs(after.distanceFromBottom - before.distanceFromBottom)).toBeLessThanOrEqual(8);
    } finally {
      await deleteConversation(page, fixture?.conversationId);
    }
  });

  test("I-RACE-009/I-RACE-010 drag and clipboard uploads converge on canonical save", async ({
    page,
  }) => {
    let fixture: CreatedFixture | undefined;
    try {
      fixture = await createConversation(page.request);
      await openSourceEditor(page, fixture.conversationId, fixture.messageId);
      const payloads = captureMessagePatches(page);

      await page.getByTestId("source-editor-codemirror").locator(".cm-content").evaluate((element) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(["drop upload payload"], "drop-upload.txt", { type: "text/plain" }));
        element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      });
      await expect(page.getByTestId("source-editor-attachment-drafts")).toContainText("drop-upload.txt");
      await page.getByTestId("source-editor-codemirror").locator(".cm-content").evaluate((element) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(["paste upload payload"], "paste-upload.txt", { type: "text/plain" }));
        element.dispatchEvent(
          new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }),
        );
      });
      await expect(page.getByTestId("source-editor-attachment-drafts")).toContainText("paste-upload.txt");

      await expect(page.getByTestId("source-editor-create-version")).toBeEnabled();
      const source = await saveAndReadPatch(page, payloads);
      expect(source.match(/cr-asset:\/\//g) ?? []).toHaveLength(2);
      expect(source).not.toContain("cr-upload://");
    } finally {
      await deleteConversation(page, fixture?.conversationId);
    }
  });

  test("I-RACE-011 deleting a placeholder before completion never reinserts its attachment reference", async ({
    page,
  }) => {
    let fixture: CreatedFixture | undefined;
    try {
      fixture = await createConversation(page.request);
      await openSourceEditor(page, fixture.conversationId, fixture.messageId);
      const payloads = captureMessagePatches(page);
      const barrier = await installFinalizeBarrier(page, fixture.conversationId);

      await page.getByTestId("source-editor-attachment-input").setInputFiles({
        name: "deleted-before-complete.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("unreferenced upload payload"),
      });
      await barrier.seen;
      await replaceEditorDocument(page, "The user deliberately removed the pending placeholder.");
      barrier.release();

      await expect(page.getByTestId("source-editor-create-version")).toBeEnabled();
      const source = await saveAndReadPatch(page, payloads);
      expect(source).toBe("The user deliberately removed the pending placeholder.");
      expect(source).not.toContain("cr-upload://");
      expect(source).not.toContain("cr-asset://");
    } finally {
      await deleteConversation(page, fixture?.conversationId);
    }
  });

  test("I-RACE-012 undo after canonicalization cannot restore a persistable transient token", async ({
    page,
  }) => {
    let fixture: CreatedFixture | undefined;
    try {
      fixture = await createConversation(page.request);
      await openSourceEditor(page, fixture.conversationId, fixture.messageId);
      const payloads = captureMessagePatches(page);

      await page.getByTestId("source-editor-attachment-input").setInputFiles({
        name: "undo-canonicalization.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("undo safety payload"),
      });
      await expect(page.getByTestId("source-editor-create-version")).toBeEnabled();

      const editor = page.getByTestId("source-editor-codemirror").locator(".cm-content");
      await editor.click();
      await page.keyboard.press("Control+z");
      await expect(editor).not.toContainText("cr-upload://");
      await page.keyboard.press("Control+y");
      await expect(editor).not.toContainText("cr-upload://");
      expect(await readEditorDocument(page)).toContain("cr-asset://");
      await appendToEditor(page, "\n\nSaved after undo safety check.");
      await expect(page.getByTestId("source-editor-create-version")).toBeEnabled();

      const source = await saveAndReadPatch(page, payloads);
      expect(source).toContain("Saved after undo safety check.");
      expect(source).not.toContain("cr-upload://");
    } finally {
      await deleteConversation(page, fixture?.conversationId);
    }
  });

  test("canonical draft survives deterministic 409 and 500 save failures before retry", async ({ page }) => {
    let fixture: CreatedFixture | undefined;
    try {
      fixture = await createConversation(page.request);
      await openSourceEditor(page, fixture.conversationId, fixture.messageId);
      const payloads = captureMessagePatches(page);

      await page.getByTestId("source-editor-attachment-input").setInputFiles({
        name: "canonical-retry.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("canonical save retry payload"),
      });
      await expect(page.getByTestId("source-editor-create-version")).toBeEnabled();

      let saveAttempt = 0;
      await page.route("**/api/messages/*", async (route) => {
        if (route.request().method() !== "PATCH") {
          await route.continue();
          return;
        }
        saveAttempt += 1;
        if (saveAttempt === 1) {
          await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ detail: "Conversation changed since it was loaded." }),
          });
          return;
        }
        if (saveAttempt === 2) {
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ detail: "Deterministic save transport failure." }),
          });
          return;
        }
        await route.continue();
      });

      await page.getByTestId("source-editor-create-version").click();
      await expect(sourceEditorAlert(page)).toBeVisible();
      expect(await readEditorDocument(page)).toContain("cr-asset://");
      expect(await readEditorDocument(page)).not.toContain("cr-upload://");

      await page.getByTestId("source-editor-create-version").click();
      await expect(sourceEditorAlert(page)).toContainText(
        /transport failure|temporarily unavailable|\u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528/i,
      );
      expect(await readEditorDocument(page)).toContain("cr-asset://");
      expect(await readEditorDocument(page)).not.toContain("cr-upload://");

      const response = page.waitForResponse(
        (candidate) => candidate.request().method() === "PATCH" && /\/api\/messages\/[^/]+$/.test(candidate.url()),
      );
      await page.getByTestId("source-editor-create-version").click();
      expect((await response).ok()).toBeTruthy();
      expect(payloads).toHaveLength(3);
      for (const payload of payloads) {
        expect(payload.content_markdown).toContain("cr-asset://");
        expect(payload.content_markdown).not.toContain("cr-upload://");
      }
    } finally {
      await deleteConversation(page, fixture?.conversationId);
    }
  });
});

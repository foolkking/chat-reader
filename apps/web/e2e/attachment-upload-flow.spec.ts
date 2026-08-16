import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const runUploadFlow = process.env.E2E_ATTACHMENT_UPLOAD === "1";

test.skip(!runUploadFlow, "E2E_ATTACHMENT_UPLOAD=1 is required");

async function createConversation(request: APIRequestContext): Promise<{ conversationId: string; messageId: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const preview = await request.post("/api/imports/preview", {
    multipart: {
      files: {
        name: `attachment-upload-${suffix}.json`,
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({
          metadata: { title: `Attachment upload ${suffix}`, powered_by: "ChatGPT Exporter" },
          messages: [{ role: "Prompt", say: "Attachment upload browser fixture." }],
        })),
      },
    },
  });
  expect(preview.ok()).toBeTruthy();
  const importId = (await preview.json()).import_id as string;
  const commit = await request.post(`/api/imports/${importId}/commit`);
  expect(commit.ok()).toBeTruthy();
  const commitBody = (await commit.json()) as { conversation_ids: string[] };
  let conversationId = commitBody.conversation_ids[0];
  const deadline = Date.now() + 180_000;
  while (!conversationId && Date.now() < deadline) {
    const statusResponse = await request.get(`/api/imports/${importId}/status`);
    expect(statusResponse.ok()).toBeTruthy();
    const importStatus = (await statusResponse.json()) as {
      status: string;
      conversation_ids: string[];
      error_message?: string;
    };
    if (importStatus.status === "committed") {
      conversationId = importStatus.conversation_ids[0];
      break;
    }
    if (importStatus.status === "failed") {
      throw new Error(importStatus.error_message ?? "Attachment upload fixture import failed");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!conversationId) {
    throw new Error("Attachment upload fixture import timed out");
  }
  const window = await request.get(`/api/conversations/${conversationId}/message-window?limit=10&include_blocks=true`);
  expect(window.ok()).toBeTruthy();
  return { conversationId, messageId: (await window.json()).items[0].id as string };
}

async function openSourceEditor(page: Page, messageId: string): Promise<void> {
  const message = page.locator(`#message-${messageId}`);
  await expect(message).toBeVisible();
  await message.getByRole("button", { name: /Edit Markdown source|编辑 Markdown 源码/ }).click();
  await expect(page.getByTestId("source-editor-codemirror")).toBeVisible();
}

async function replaceSourceText(page: Page, text: string): Promise<void> {
  const editor = page.getByTestId("source-editor-codemirror").locator(".cm-content");
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(text);
  await expect(editor).toContainText(text);
  await expect(editor).not.toContainText("cr-asset://");
}

function waitForMessagePatch(page: Page, messageId: string) {
  return page.waitForResponse((response) =>
    response.request().method() === "PATCH"
    && new URL(response.url()).pathname === `/api/messages/${messageId}`,
  );
}

async function expectSaveSettled(page: Page, saved: ReturnType<typeof waitForMessagePatch>): Promise<void> {
  expect((await saved).ok()).toBeTruthy();
  await expect(page.getByTestId("source-editor-create-version")).not.toContainText(/Saving|保存中/);
}

async function saveNewVersion(page: Page, messageId: string): Promise<void> {
  const saveButton = page.getByTestId("source-editor-create-version");
  await expect(saveButton).toBeEnabled();
  const saved = waitForMessagePatch(page, messageId);
  await saveButton.click();
  await expectSaveSettled(page, saved);
}

async function deleteConversation(request: APIRequestContext, conversationId: string): Promise<void> {
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

test("uploads, inserts, versions, and reuses conversation attachments", async ({ page }) => {
  const { conversationId, messageId } = await createConversation(page.request);
  const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

  try {
    await page.goto(`/conversations/${conversationId}`);
    await openSourceEditor(page, messageId);
    await page.getByTestId("source-editor-attachment-input").setInputFiles({
      name: "inline-image.png",
      mimeType: "image/png",
      buffer: tinyPng,
    });
    await expect(page.getByTestId("source-editor-attachment-drafts").getByText(/待保存附件 1 个|1 attachment\(s\) pending save/)).toBeVisible();
    await saveNewVersion(page, messageId);
    await expect(page.getByTestId("source-editor-create-version")).toContainText(/v3/);
    await page.getByRole("button", { name: /Reading mode|阅读模式/ }).click();

    const message = page.locator(`#message-${messageId}`);
    await expect(message.getByTestId("attachment-block")).toHaveCount(1);

    await page.getByRole("button", { name: /Message actions|消息操作/ }).click();
    await page.getByRole("button", { name: /Conversation files|当前对话文件/ }).click();
    await expect(page.getByTestId("conversation-files-panel")).toBeVisible();
    await page.getByTestId("conversation-files-upload-input").setInputFiles({
      name: "later-file.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Added later and inserted from the conversation file picker.\n"),
    });
    await expect.poll(async () => {
      const response = await page.request.get(`/api/conversations/${conversationId}/attachments`);
      return ((await response.json()) as { items: unknown[] }).items.length;
    }).toBe(2);
    await page.getByTestId("conversation-files-workspace").getByRole("button", { name: /Close|关闭/ }).click();
    await expect(page.getByTestId("conversation-files-workspace")).toHaveCount(0);

    await openSourceEditor(page, messageId);
    await page.getByRole("button", { name: /Choose conversation file|选择当前对话文件/ }).click();
    await expect(page.getByTestId("source-editor-attachment-picker")).toBeVisible();
    await page.getByRole("button", { name: /Insert later-file\.txt at cursor|在光标处插入 later-file\.txt/ }).click();
    await saveNewVersion(page, messageId);
    await expect(page.getByTestId("source-editor-create-version")).toContainText(/v4/);
    await page.getByRole("button", { name: /Reading mode|阅读模式/ }).click();
    await expect(message.getByTestId("attachment-block")).toHaveCount(2);

    const attachmentResponse = await page.request.get(`/api/conversations/${conversationId}/attachments`);
    const attachments = ((await attachmentResponse.json()) as { items: Array<{ occurrence_count: number; scan_status: string }> }).items;
    expect(attachments).toHaveLength(2);
    expect(attachments.reduce((sum, item) => sum + item.occurrence_count, 0)).toBe(3);
    expect(attachments.every((item) => item.scan_status === "scanner_disabled")).toBeTruthy();

    await message.getByRole("button", { name: /Previous version|上一版/ }).click();
    await expect(message.getByTestId("attachment-block")).toHaveCount(1);
    await message.getByRole("button", { name: /Next version|下一版/ }).click();
    await expect(message.getByTestId("attachment-block")).toHaveCount(2);
  } finally {
    await deleteConversation(page.request, conversationId);
  }
});

test("drops and pastes files at the source cursor with independent upload drafts", async ({ page }) => {
  const { conversationId, messageId } = await createConversation(page.request);
  try {
    await page.goto(`/conversations/${conversationId}`);
    await openSourceEditor(page, messageId);
    const editor = page.getByTestId("source-editor-codemirror").locator(".cm-content");
    await editor.click({ position: { x: 48, y: 20 } });

    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["dropped attachment\n"], "dropped.txt", { type: "text/plain" }));
      const content = document.querySelector("[data-testid='source-editor-codemirror'] .cm-content");
      if (!content) throw new Error("CodeMirror content not found");
      content.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 48, clientY: 20 }));
    });
    await expect(page.getByTestId("source-editor-attachment-drafts").getByText(/正在上传：dropped\.txt|Uploading: dropped\.txt/).first()).toBeVisible();
    await expect(page.getByTestId("source-editor-attachment-drafts").getByText(/待保存附件 1 个|1 attachment\(s\) pending save/)).toBeVisible();

    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["pasted attachment\n"], "pasted.txt", { type: "text/plain" }));
      const content = document.querySelector("[data-testid='source-editor-codemirror'] .cm-content");
      if (!content) throw new Error("CodeMirror content not found");
      content.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
    });
    await expect(page.getByTestId("source-editor-attachment-drafts").getByText(/待保存附件 2 个|2 attachment\(s\) pending save/)).toBeVisible();
    await saveNewVersion(page, messageId);
    await expect(page.getByTestId("source-editor-create-version")).toContainText(/v3/);
    const attachments = await page.request.get(`/api/conversations/${conversationId}/attachments`);
    expect((await attachments.json()).items).toHaveLength(2);
    await page.getByRole("button", { name: /Reading mode|阅读模式/ }).click();
    await expect(page.locator(`#message-${messageId}`).getByTestId("attachment-block")).toHaveCount(2);
  } finally {
    await deleteConversation(page.request, conversationId);
  }
});

test("asks before placing a dropped attachment inside a fenced code block", async ({ page }) => {
  const { conversationId, messageId } = await createConversation(page.request);
  try {
    await page.goto(`/conversations/${conversationId}`);
    await openSourceEditor(page, messageId);
    const editor = page.getByTestId("source-editor-codemirror").locator(".cm-content");
    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.insertText("Before\n\n```ts\nconst value = 1;\n```\n\nAfter");
    const codeLine = page.getByTestId("source-editor-codemirror").locator(".cm-line").filter({ hasText: "const value = 1;" });
    const box = await codeLine.boundingBox();
    expect(box).not.toBeNull();
    await page.evaluate(({ x, y }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["code evidence\n"], "code-evidence.txt", { type: "text/plain" }));
      const content = document.querySelector("[data-testid='source-editor-codemirror'] .cm-content");
      if (!content) throw new Error("CodeMirror content not found");
      content.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
    }, { x: box!.x + 20, y: box!.y + box!.height / 2 });

    await expect(page.getByTestId("source-editor-code-drop-choice")).toBeVisible();
    await page.getByRole("button", { name: /Insert after code block|插入到代码块之后/ }).click();
    await expect(page.getByTestId("source-editor-code-drop-choice")).toHaveCount(0);
    await expect(page.getByTestId("source-editor-attachment-drafts").getByText(/code-evidence\.txt/).first()).toBeVisible();
    await saveNewVersion(page, messageId);
    await page.getByRole("button", { name: /Reading mode|阅读模式/ }).click();
    await expect(page.locator(`#message-${messageId}`).getByTestId("attachment-block")).toHaveCount(1);
  } finally {
    await deleteConversation(page.request, conversationId);
  }
});

test("keeps completed unsaved uploads as unplaced conversation files on close", async ({ page }) => {
  const { conversationId, messageId } = await createConversation(page.request);
  try {
    await page.goto(`/conversations/${conversationId}`);
    await openSourceEditor(page, messageId);
    await page.getByTestId("source-editor-attachment-input").setInputFiles({
      name: "keep-unplaced.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("keep this file in the conversation\n"),
    });
    await expect(page.getByTestId("source-editor-create-version")).toBeEnabled();
    await page.getByRole("button", { name: /Reading mode|阅读模式/ }).click();
    await page.getByRole("button", { name: /Keep files and close|保留文件并关闭/ }).click();
    await expect(page.getByTestId("source-editor-codemirror")).toHaveCount(0);

    await expect.poll(async () => {
      const response = await page.request.get(`/api/conversations/${conversationId}/attachments`);
      const items = (await response.json()).items as Array<{ is_used: boolean }>;
      return { count: items.length, used: items[0]?.is_used };
    }).toEqual({ count: 1, used: false });
    await expect(page.locator(`#message-${messageId}`).getByTestId("attachment-block")).toHaveCount(0);
  } finally {
    await deleteConversation(page.request, conversationId);
  }
});

test("drags an existing conversation file into source and confirms removed references", async ({ page }) => {
  const { conversationId, messageId } = await createConversation(page.request);
  try {
    await page.goto(`/conversations/${conversationId}`);
    await page.getByRole("button", { name: /Message actions|消息操作/ }).click();
    await page.getByRole("button", { name: /Conversation files|当前对话文件/ }).click();
    await expect(page.getByTestId("conversation-files-workspace")).toBeVisible();
    await page.getByTestId("conversation-files-upload-input").setInputFiles({
      name: "existing-file.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("existing conversation attachment\n"),
    });
    await expect.poll(async () => {
      const response = await page.request.get(`/api/conversations/${conversationId}/attachments`);
      const items = (await response.json()).items as Array<{ id: string; display_name: string }>;
      return items.find((item) => item.display_name === "existing-file.txt") ?? null;
    }).not.toBeNull();
    const attachmentResponse = await page.request.get(`/api/conversations/${conversationId}/attachments`);
    const attachment = ((await attachmentResponse.json()).items as Array<{ id: string; display_name: string }>).find((item) => item.display_name === "existing-file.txt")!;

    await openSourceEditor(page, messageId);
    await expect(page.getByTestId("conversation-files-workspace")).toBeVisible();
    await expect(page.getByTestId("source-editor-codemirror")).toBeVisible();
    const dragHandle = page.getByRole("button", { name: /Drag into source editor to insert|拖到源码编辑器中插入/ });
    await expect(dragHandle).toHaveAttribute("draggable", "true");
    const editorBox = await page.getByTestId("source-editor-codemirror").locator(".cm-content").boundingBox();
    expect(editorBox).not.toBeNull();
    await page.evaluate(({ attachmentId, x, y }) => {
      const transfer = new DataTransfer();
      transfer.setData("application/x-chat-reader-attachment", JSON.stringify({
        attachmentId,
        displayName: "existing-file.txt",
        mimeType: "text/plain",
      }));
      const content = document.querySelector("[data-testid='source-editor-codemirror'] .cm-content");
      if (!content) throw new Error("CodeMirror content not found");
      content.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
      content.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
    }, { attachmentId: attachment.id, x: editorBox!.x + 48, y: editorBox!.y + 22 });
    await expect(page.getByTestId("source-editor-codemirror")).toContainText("existing-file.txt");
    await saveNewVersion(page, messageId);
    await expect(page.locator(`#message-${messageId}`).getByTestId("attachment-block")).toHaveCount(1);
    const afterInsert = await page.request.get(`/api/conversations/${conversationId}/attachments`);
    expect((await afterInsert.json()).items).toHaveLength(1);
    await page.getByTestId("conversation-files-workspace").getByRole("button", { name: /Close|关闭/ }).click();

    await replaceSourceText(page, "Attachment reference removed but file retained.");
    await expect(page.getByTestId("source-editor-create-version")).toBeEnabled();
    await page.getByTestId("source-editor-create-version").click();
    const removalDialog = page.getByRole("dialog", { name: /Attachment references were removed|已从正文移除附件引用/ });
    await expect(removalDialog).toBeVisible();
    await expect(removalDialog.getByLabel(/Keep in conversation|保留在当前对话文件/)).toBeChecked();
    const removalSaved = waitForMessagePatch(page, messageId);
    await removalDialog.getByRole("button", { name: /Confirm and save|确认并保存/ }).click();
    await expectSaveSettled(page, removalSaved);
    await expect.poll(async () => {
      const response = await page.request.get(`/api/conversations/${conversationId}/attachments`);
      return ((await response.json()).items as Array<{ is_used: boolean }>).map((item) => item.is_used);
    }).toEqual([false]);

    await page.getByRole("button", { name: /Choose conversation file|选择当前对话文件/ }).click();
    await page.getByRole("button", { name: /Insert existing-file\.txt at cursor|在光标处插入 existing-file\.txt/ }).click();
    await saveNewVersion(page, messageId);
    await replaceSourceText(page, "Attachment detached from active conversation files.");
    await expect(page.getByTestId("source-editor-create-version")).toBeEnabled();
    await page.getByTestId("source-editor-create-version").click();
    const detachDialog = page.getByRole("dialog", { name: /Attachment references were removed|已从正文移除附件引用/ });
    await detachDialog.getByLabel(/Detach from conversation|同时从当前对话文件移除/).check();
    const detachSaved = waitForMessagePatch(page, messageId);
    await detachDialog.getByRole("button", { name: /Confirm and save|确认并保存/ }).click();
    await expectSaveSettled(page, detachSaved);
    await expect.poll(async () => {
      const response = await page.request.get(`/api/conversations/${conversationId}/attachments`);
      return ((await response.json()).items as unknown[]).length;
    }).toBe(0);
    expect((await page.request.get(`/api/attachments/${attachment.id}/content`)).ok()).toBeTruthy();
  } finally {
    await deleteConversation(page.request, conversationId);
  }
});

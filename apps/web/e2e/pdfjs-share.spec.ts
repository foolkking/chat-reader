import { expect, test, type APIRequestContext, type Locator } from "@playwright/test";

const enabled = process.env.E2E_PDFJS_MIGRATION === "1";
test.skip(!enabled, "E2E_PDFJS_MIGRATION=1 is required");

type ConversationFixture = {
  conversationId: string;
  includedMessageId: string;
  excludedMessageId: string;
  includedBaseVersionId: string;
  includedSource: string;
};

type Attachment = { id: string };
type Share = { id: string; token: string };

test("Share PDF stays scope-bound while the unified Viewer uses authenticated Range and a real worker", async ({ page, request }) => {
  test.setTimeout(180_000);
  const fixture = await createConversation(request);
  let includedShare: Share | null = null;
  let excludedShare: Share | null = null;
  const workerUrls: string[] = [];
  const sharedPdfResponses: Array<{ status: number; contentRange?: string; requestRange?: string }> = [];
  const runtimeErrors: string[] = [];

  page.on("worker", (worker) => workerUrls.push(worker.url()));
  page.on("console", (message) => {
    if (/fake worker|version .* does not match|worker load|content security policy|wasm/i.test(message.text())) {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  try {
    const attachment = await uploadAttachment(request, fixture.conversationId, createPdf(1, 180_000));
    await attachToMessage(request, fixture, attachment.id);
    includedShare = await createShare(request, fixture.conversationId, fixture.includedMessageId);
    excludedShare = await createShare(request, fixture.conversationId, fixture.excludedMessageId);

    const deniedMetadata = await request.get(`/api/shared/${excludedShare.token}/attachments/${attachment.id}`);
    const deniedContent = await request.get(`/api/shared/${excludedShare.token}/attachments/${attachment.id}/content`, {
      headers: { Range: "bytes=0-1023" },
    });
    expect(deniedMetadata.status()).toBe(404);
    expect(deniedContent.status()).toBe(404);

    page.on("response", (response) => {
      if (response.url().includes(`/api/shared/${includedShare!.token}/attachments/${attachment.id}/content`)) {
        sharedPdfResponses.push({
          status: response.status(),
          contentRange: response.headers()["content-range"],
          requestRange: response.request().headers()["range"],
        });
      }
    });

    await page.goto(`/share/${includedShare.token}`);
    const attachmentBlock = page.locator(`[data-testid="attachment-block"][data-attachment-id="${attachment.id}"]`);
    await expect(attachmentBlock).toBeVisible();
    const openButton = attachmentBlock.getByRole("button", { name: /shared-range\.pdf/ });
    await openButton.click();

    const viewer = page.getByTestId("attachment-viewer-shell");
    await expect(viewer).toHaveCount(1);
    await expect(viewer).toBeVisible();
    await expect(viewer.getByTestId("pdf-viewer")).toHaveAttribute("data-pdfjs-version", "6.2.108");
    await expectCanvasRendered(viewer.locator("canvas").first());
    await expect.poll(() => sharedPdfResponses.some((response) => (
      response.status === 206
      && response.requestRange?.startsWith("bytes=")
      && response.contentRange?.startsWith("bytes ")
    ))).toBe(true);
    await expect.poll(() => workerUrls.some((url) => /pdf\.worker\.min\..*\.mjs/.test(url))).toBe(true);

    const workerUrl = workerUrls.find((url) => /pdf\.worker\.min\..*\.mjs/.test(url));
    if (!workerUrl) throw new Error("PDF worker URL was not observed.");
    expect(new URL(workerUrl).origin).toBe(new URL(page.url()).origin);
    const workerResponse = await request.get(workerUrl);
    expect(workerResponse.status()).toBe(200);
    expect(workerResponse.headers()["content-type"] ?? "").toMatch(/javascript|ecmascript/);
    expect(await workerResponse.text()).toContain('"6.2.108"');

    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    await expect(openButton).toBeFocused();
    expect(runtimeErrors).toEqual([]);

    await page.goto(`/share/${excludedShare.token}`);
    await expect(page.locator(`[data-testid="attachment-block"][data-attachment-id="${attachment.id}"]`)).toHaveCount(0);
  } finally {
    if (includedShare) expect((await request.post(`/api/shares/${includedShare.id}/revoke`)).ok()).toBe(true);
    if (excludedShare) expect((await request.post(`/api/shares/${excludedShare.id}/revoke`)).ok()).toBe(true);
    expect((await request.delete(`/api/conversations/${fixture.conversationId}`)).ok()).toBe(true);
  }
});

async function createConversation(request: APIRequestContext): Promise<ConversationFixture> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const preview = await request.post("/api/imports/preview", {
    multipart: {
      files: {
        name: `pdfjs-share-${suffix}.json`,
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({
          metadata: { title: `PDF.js Share ${suffix}`, powered_by: "ChatGPT Exporter" },
          messages: [
            { role: "Prompt", say: "Shared PDF scope fixture." },
            { role: "Response", say: "Excluded share scope fixture." },
          ],
        })),
      },
    },
  });
  expect(preview.ok()).toBe(true);
  const importId = (await preview.json()).import_id as string;
  const commit = await request.post(`/api/imports/${importId}/commit`);
  expect(commit.ok(), `Import commit failed with ${commit.status()}: ${await commit.text()}`).toBe(true);
  const deadline = Date.now() + 180_000;
  let conversationId = "";
  while (Date.now() < deadline) {
    const response = await request.get(`/api/imports/${importId}/status`);
    expect(response.ok()).toBe(true);
    const status = await response.json() as { status: string; conversation_ids: string[]; error_message?: string };
    if (status.status === "committed") {
      conversationId = status.conversation_ids[0]!;
      break;
    }
    if (status.status === "failed") throw new Error(status.error_message ?? "Share PDF fixture import failed");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!conversationId) throw new Error("Share PDF fixture import timed out");

  const windowResponse = await request.get(`/api/conversations/${conversationId}/message-window?limit=10&include_blocks=true`);
  expect(windowResponse.ok()).toBe(true);
  const items = (await windowResponse.json()).items as Array<{
    id: string;
    current_version: { id: string; display_text: string };
  }>;
  expect(items).toHaveLength(2);
  return {
    conversationId,
    includedMessageId: items[0]!.id,
    excludedMessageId: items[1]!.id,
    includedBaseVersionId: items[0]!.current_version.id,
    includedSource: items[0]!.current_version.display_text,
  };
}

async function uploadAttachment(request: APIRequestContext, conversationId: string, buffer: Buffer): Promise<Attachment> {
  const session = await request.post(`/api/conversations/${conversationId}/attachment-upload-sessions`, { data: {} });
  expect(session.status()).toBe(201);
  const item = await request.post(`/api/attachment-upload-sessions/${(await session.json()).id}/items`, {
    multipart: { file: { name: "shared-range.pdf", mimeType: "application/pdf", buffer } },
  });
  expect(item.status()).toBe(201);
  const finalized = await request.post(`/api/conversations/${conversationId}/attachments`, {
    data: { upload_item_ids: [(await item.json()).id] },
  });
  expect(finalized.status()).toBe(201);
  return (await finalized.json()).items[0] as Attachment;
}

async function attachToMessage(request: APIRequestContext, fixture: ConversationFixture, attachmentId: string): Promise<void> {
  const saved = await request.patch(`/api/messages/${fixture.includedMessageId}`, {
    data: {
      content_markdown: `${fixture.includedSource}\n\n[shared-range.pdf](cr-asset://${attachmentId})`,
      base_version_id: fixture.includedBaseVersionId,
    },
  });
  expect(saved.status()).toBe(200);
  expect(((await saved.json()).attachment_occurrences as unknown[])).toHaveLength(1);
}

async function createShare(request: APIRequestContext, conversationId: string, messageId: string): Promise<Share> {
  const response = await request.post(`/api/conversations/${conversationId}/shares`, {
    data: { scope: "selected_messages", selected_message_ids: [messageId], include_toc: true, include_metadata: true },
  });
  expect(response.status()).toBe(200);
  return await response.json() as Share;
}

async function expectCanvasRendered(canvas: Locator): Promise<void> {
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate((element) => {
    const node = element as HTMLCanvasElement;
    if (!node.width || !node.height) return false;
    const context = node.getContext("2d");
    if (!context) return false;
    const pixels = context.getImageData(0, 0, node.width, node.height).data;
    const stride = Math.max(4, Math.floor(pixels.length / 20_000 / 4) * 4);
    for (let index = 0; index < pixels.length; index += stride) {
      if (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245) return true;
    }
    return false;
  })).toBe(true);
}

function createPdf(pageCount: number, paddingBytes = 0): Buffer {
  const objects: string[] = [];
  const pageIds = Array.from({ length: pageCount }, (_, index) => 3 + index * 2);
  const fontId = 3 + pageCount * 2;
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;
  for (let index = 0; index < pageCount; index += 1) {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const padding = index === 0 && paddingBytes ? `%${"x".repeat(paddingBytes)}\n` : "";
    const stream = `${padding}BT /F1 24 Tf 72 720 Td (Shared synthetic page ${index + 1}) Tj ET`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  }
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  const chunks = ["%PDF-1.7\n% synthetic\n"];
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(chunks.join(""));
    chunks.push(`${id} 0 obj\n${objects[id]}\nendobj\n`);
  }
  const xref = Buffer.byteLength(chunks.join(""));
  chunks.push(`xref\n0 ${objects.length}\n0000000000 65535 f \n`);
  for (let id = 1; id < objects.length; id += 1) chunks.push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  chunks.push(`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.from(chunks.join(""), "ascii");
}

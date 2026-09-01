import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const enabled = process.env.E2E_PDFJS_MIGRATION === "1";
test.skip(!enabled, "E2E_PDFJS_MIGRATION=1 is required");

type Attachment = { id: string; display_name: string; content_url: string };

test("PDF.js 6 uses a real version-matched worker and renders single and multi-page PDFs", async ({ page }) => {
  test.setTimeout(180_000);
  const conversationId = await createConversation(page.request);
  const attachments = [
    await uploadAttachment(page.request, conversationId, "single.pdf", createPdf(1, { paddingBytes: 160_000 })),
    await uploadAttachment(page.request, conversationId, "multi.pdf", createPdf(2)),
  ];
  const workerUrls: string[] = [];
  const pdfChunkFiles = getPdfChunkFiles();
  const requestedPdfChunks: string[] = [];
  const pdfResponses: Array<{ status: number; range: string | undefined }> = [];
  const consoleErrors: string[] = [];
  page.on("worker", (worker) => workerUrls.push(worker.url()));
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pdfChunkFiles.some((file) => pathname.endsWith(`/${file}`))) requestedPdfChunks.push(pathname);
  });
  page.on("response", (response) => {
    if (response.url().includes(`/api/attachments/${attachments[0].id}/content`)) {
      pdfResponses.push({ status: response.status(), range: response.request().headers()["range"] });
    }
  });
  page.on("console", (message) => {
    if (/fake worker|version .* does not match|worker load|content security policy|wasm/i.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  try {
    await openConversationFiles(page, conversationId);
    expect(pdfChunkFiles.length).toBeGreaterThan(0);
    expect(requestedPdfChunks).toEqual([]);
    expect(workerUrls).toEqual([]);
    const singleTrigger = previewButton(page, attachments[0].id);
    await singleTrigger.click();
    const viewer = page.getByTestId("attachment-viewer-shell");
    await expect(viewer).toBeVisible();
    await expect(viewer.getByTestId("pdf-viewer")).toHaveAttribute("data-pdfjs-version", "6.2.108");
    await expectCanvasRendered(viewer.locator("canvas").first());
    await expect(viewer.getByTestId("pdf-viewer-pages")).toHaveAttribute("data-pdf-fit", "page");
    await expect.poll(() => requestedPdfChunks.length).toBeGreaterThan(0);
    await expect.poll(() => pdfResponses.some((response) => response.status === 206 && response.range?.startsWith("bytes="))).toBe(true);
    await expect.poll(() => workerUrls.some((url) => /pdf\.worker\.min\..*\.mjs/.test(url))).toBe(true);
    const workerUrl = workerUrls.find((url) => /pdf\.worker\.min\..*\.mjs/.test(url));
    if (!workerUrl) throw new Error("PDF worker URL was not observed.");
    const workerResponse = await page.request.get(workerUrl);
    expect(workerResponse.status()).toBe(200);
    expect(workerResponse.headers()["content-type"] ?? "").toMatch(/javascript|ecmascript/);
    expect(await workerResponse.text()).toContain('"6.2.108"');

    await page.getByRole("button", { name: /Maximize Viewer|Viewer/ }).click();
    await page.keyboard.press("Escape");
    await expect(viewer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
    await expect(singleTrigger).toBeFocused();

    const multiTrigger = previewButton(page, attachments[1].id);
    await multiTrigger.click();
    await expect(viewer).toBeVisible();
    await expect(viewer).toContainText("1 / 2");
    await viewer.getByRole("button", { name: /Fit width/i }).click();
    await expect(viewer.getByTestId("pdf-viewer-pages")).toHaveAttribute("data-pdf-fit", "width");
    await viewer.getByTestId("pdf-next-page").click();
    await expect(viewer).toContainText("2 / 2");
    await expectCanvasRendered(viewer.locator("canvas").first());
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
    await expect(multiTrigger).toBeFocused();
    expect(consoleErrors).toEqual([]);
  } finally {
    expect((await page.request.delete(`/api/conversations/${conversationId}`)).ok()).toBe(true);
  }
});

test("malicious and corrupted PDFs fail safely without escaping the unified Viewer", async ({ page }) => {
  test.setTimeout(180_000);
  const conversationId = await createConversation(page.request);
  const malicious = await uploadAttachment(page.request, conversationId, "script.pdf", createPdf(1, { javascript: true }));
  const corrupted = await uploadAttachment(page.request, conversationId, "truncated.pdf", createPdf(1).subarray(0, 96));
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  try {
    await page.addInitScript(() => {
      Object.defineProperty(globalThis, "__pdfJsMaliciousExecuted", { configurable: true, writable: true, value: false });
    });
    await openConversationFiles(page, conversationId);
    await previewButton(page, malicious.id).click();
    const viewer = page.getByTestId("attachment-viewer-shell");
    await expectCanvasRendered(viewer.locator("canvas").first());
    expect(await page.evaluate(() => Boolean((globalThis as typeof globalThis & { __pdfJsMaliciousExecuted?: boolean }).__pdfJsMaliciousExecuted))).toBe(false);
    await page.keyboard.press("Escape");

    const corruptedTrigger = previewButton(page, corrupted.id);
    await corruptedTrigger.click();
    await expect(viewer).toBeVisible();
    await expect(viewer).toContainText(/unable to load PDF|PDF.*download|PDF.*preview|PDF/i);
    await expect(viewer.getByRole("button", { name: /Retry|重试/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
    await expect(corruptedTrigger).toBeFocused();
    expect(runtimeErrors).toEqual([]);
  } finally {
    expect((await page.request.delete(`/api/conversations/${conversationId}`)).ok()).toBe(true);
  }
});

async function createConversation(request: APIRequestContext): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const preview = await request.post("/api/imports/preview", {
    multipart: {
      files: {
        name: `pdfjs-${suffix}.json`,
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({
          metadata: { title: `PDF.js ${suffix}`, powered_by: "ChatGPT Exporter" },
          messages: [{ role: "Prompt", say: "Synthetic PDF.js migration fixture." }],
        })),
      },
    },
  });
  expect(preview.ok()).toBe(true);
  const importId = (await preview.json()).import_id as string;
  const commit = await request.post(`/api/imports/${importId}/commit`);
  expect(commit.ok()).toBe(true);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const response = await request.get(`/api/imports/${importId}/status`);
    expect(response.ok()).toBe(true);
    const status = await response.json() as { status: string; conversation_ids: string[]; error_message?: string };
    if (status.status === "committed") return status.conversation_ids[0]!;
    if (status.status === "failed") throw new Error(status.error_message ?? "PDF.js fixture import failed");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("PDF.js fixture import timed out");
}

function getPdfChunkFiles(): string[] {
  const distDir = process.env.NEXT_DIST_DIR?.trim() || ".next";
  const manifestPath = path.join(process.cwd(), distDir, "react-loadable-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, { files?: string[] }>;
  const candidates = Object.entries(manifest)
    .filter(([key]) => key.includes("pdfjs-runtime") && key.includes("pdfjs-dist"))
    .flatMap(([, value]) => value.files ?? []);
  return candidates.filter((file) => {
    const chunkPath = path.join(process.cwd(), distDir, file);
    return fs.existsSync(chunkPath) && fs.readFileSync(chunkPath, "utf8").includes("GlobalWorkerOptions");
  });
}

async function uploadAttachment(request: APIRequestContext, conversationId: string, name: string, buffer: Buffer): Promise<Attachment> {
  const session = await request.post(`/api/conversations/${conversationId}/attachment-upload-sessions`, { data: {} });
  expect(session.status()).toBe(201);
  const item = await request.post(`/api/attachment-upload-sessions/${(await session.json()).id}/items`, {
    multipart: { file: { name, mimeType: "application/pdf", buffer } },
  });
  expect(item.status()).toBe(201);
  const finalized = await request.post(`/api/conversations/${conversationId}/attachments`, {
    data: { upload_item_ids: [(await item.json()).id] },
  });
  expect(finalized.status()).toBe(201);
  return (await finalized.json()).items[0] as Attachment;
}

async function openConversationFiles(page: Page, conversationId: string): Promise<void> {
  await page.goto(`/conversations/${conversationId}`);
  await page.getByRole("button", { name: /Message actions|More|更多/ }).first().click();
  await page.getByRole("button", { name: /Conversation files|当前对话文件/ }).click();
  await expect(page.getByTestId("conversation-files-panel")).toBeVisible();
}

function previewButton(page: Page, attachmentId: string) {
  return page.locator(`[data-testid="conversation-file-row"][data-attachment-id="${attachmentId}"]`).getByRole("button", { name: /Preview|预览/ });
}

async function expectCanvasRendered(canvas: ReturnType<Page["locator"]>): Promise<void> {
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate((element) => {
    const node = element as HTMLCanvasElement;
    if (!node.width || !node.height) return false;
    const context = node.getContext("2d");
    if (!context) return false;
    const pixels = context.getImageData(0, 0, node.width, node.height).data;
    for (let index = 0; index < pixels.length; index += Math.max(4, Math.floor(pixels.length / 20_000 / 4) * 4)) {
      if (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245) return true;
    }
    return false;
  })).toBe(true);
}

function createPdf(pageCount: number, options: { paddingBytes?: number; javascript?: boolean } = {}): Buffer {
  const objects: string[] = [];
  const pageIds = Array.from({ length: pageCount }, (_, index) => 3 + index * 2);
  const fontId = 3 + pageCount * 2;
  const actionId = options.javascript ? fontId + 1 : null;
  objects[1] = `<< /Type /Catalog /Pages 2 0 R${actionId ? ` /OpenAction ${actionId} 0 R` : ""} >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;
  for (let index = 0; index < pageCount; index += 1) {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const padding = index === 0 && options.paddingBytes ? `%${"x".repeat(options.paddingBytes)}\n` : "";
    const stream = `${padding}BT /F1 24 Tf 72 720 Td (Synthetic page ${index + 1}) Tj ET`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  }
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  if (actionId) objects[actionId] = "<< /Type /Action /S /JavaScript /JS (globalThis.__pdfJsMaliciousExecuted = true) >>";

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

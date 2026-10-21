import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { settingsAppearance } from "./settings-test-helper";

const test = base.extend<{ attachmentConversation: Awaited<ReturnType<typeof conversation>> }>({
  attachmentConversation: [async ({ page }, use) => {
    const made = await conversation(page.request);
    await use(made);
    // Separate bounded teardown preserves the primary UI failure and still
    // cleans synthetic data when the case itself has exhausted its budget.
    expect((await page.request.delete(`/api/conversations/${made.conversation.id}`, { timeout: 15_000 })).ok()).toBe(true);
  }, { timeout: 30_000 }],
});

test.skip(process.env.E2E_RICH_MARKDOWN_ATTACHMENT !== "1", "Requires the isolated attachment API");
test.use({ serviceWorkers: "block" });

type Attachment = { id: string; display_name: string; content_url: string };

async function conversation(request: APIRequestContext) {
  const response = await request.post("/api/conversations", { data: { title: "Synthetic attachment reading", messages: [
    { role: "user", content_markdown: "Synthetic attachment question" },
    { role: "assistant", content_markdown: "Synthetic attachment answer" },
  ] } });
  expect(response.status()).toBe(201);
  return await response.json() as { conversation: { id: string }; messages: Array<{ id: string; current_version: { id: string } }> };
}

async function upload(request: APIRequestContext, conversationId: string, name: string, mimeType: string, buffer: Buffer): Promise<Attachment> {
  const session = await request.post(`/api/conversations/${conversationId}/attachment-upload-sessions`, { data: {} });
  expect(session.status()).toBe(201);
  const item = await request.post(`/api/attachment-upload-sessions/${(await session.json()).id}/items`, { multipart: { file: { name, mimeType, buffer } } });
  expect(item.status()).toBe(201);
  const finalized = await request.post(`/api/conversations/${conversationId}/attachments`, { data: { upload_item_ids: [(await item.json()).id] } });
  expect(finalized.status()).toBe(201);
  return (await finalized.json()).items[0];
}

async function openFiles(page: Page, conversationId: string) {
  await page.goto(`/conversations/${conversationId}`);
  await page.getByRole("button", { name: (page.viewportSize()?.width ?? 1280) < 768 ? /^(More|更多)$/ : /^(Message actions|消息操作)$/ }).click();
  await page.getByRole("button", { name: /^(Conversation files|当前对话文件)$/ }).click();
  await expect(page.getByTestId("conversation-files-panel")).toBeVisible();
}

async function openFile(page: Page, attachment: Attachment, locale: string) {
  await page.locator(`[data-testid="conversation-file-row"][data-attachment-id="${attachment.id}"]`).getByRole("button", { name: /^(Preview|预览)$/ }).click();
  const viewer = page.getByTestId("attachment-viewer-shell");
  await expect(viewer).toHaveAttribute("aria-label", attachment.display_name);
  await expect(viewer.getByRole("button", { name: locale === "zh-CN" ? "关闭附件查看器" : "Close attachment viewer", exact: true })).toBeFocused();
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    const drawer = page.locator("[data-vaul-drawer]").filter({ has: page.getByTestId("conversation-files-panel") });
    await expect(drawer).toHaveAttribute("inert", "");
    await expect(drawer).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("[data-vaul-overlay]")).toHaveCount(0);
  }
  return viewer;
}

async function closeFile(page: Page, attachment: Attachment) {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("attachment-viewer-shell")).toHaveCount(0);
  const preview = page.locator(`[data-testid="conversation-file-row"][data-attachment-id="${attachment.id}"]`).getByRole("button", { name: /^(Preview|预览)$/ });
  await expect(preview).toBeFocused();
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    const drawer = page.locator("[data-vaul-drawer]").filter({ has: page.getByTestId("conversation-files-panel") });
    await expect(drawer).toHaveJSProperty("inert", false);
    const overlay = page.locator("[data-vaul-overlay]");
    await expect(overlay).toHaveCount(1);
    const overlayLayer = await overlay.evaluate(node => Number(getComputedStyle(node).zIndex));
    expect(await drawer.evaluate(node => Number(getComputedStyle(node).zIndex))).toBeGreaterThan(overlayLayer);
    // The remounted scrim must still block the exposed page, but never the
    // retained sheet. Opacity alone does not establish pointer ownership.
    await expect.poll(() => overlay.evaluate(node => node.contains(document.elementFromPoint(window.innerWidth / 2, 1)))).toBe(true);
  }
  // Read-only hit testing does not scroll the list or manufacture a click.
  // Subsequent openFile calls below still exercise real pointer actions.
  await expect.poll(() => preview.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(true);
}

for (const width of [375, 1440]) for (const locale of ["zh-CN", "en-US"]) test.describe(`${width}px ${locale}`, () => {
  const zh = locale === "zh-CN";
  test.beforeEach(async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height: 900 });
    await settingsAppearance(page.request, baseURL!, locale);
  });

  test("CSV pages keep row order and truncated previews preserve the true header and original source", async ({ page, attachmentConversation }, info) => {
    const id = attachmentConversation.conversation.id;
    const csv = Array.from({ length: 101 }, (_, row) => Array.from({ length: 64 }, (_, col) => `r${row}c${col}`).join(",")).join("\n");
    const wide = Array.from({ length: 257 }, (_, col) => `original-header-${col}`).join(",") + "\nshort,value";
    const long = "original-header\n" + "x".repeat(66_560) + "\nlater";
    const paged = await upload(page.request, id, "paged.csv", "text/csv", Buffer.from(csv));
    const wideFile = await upload(page.request, id, "wide.csv", "text/csv", Buffer.from(wide));
    const longFile = await upload(page.request, id, "long.csv", "text/csv", Buffer.from(long));
    await openFiles(page, id);
    const viewer = await openFile(page, paged, locale), table = viewer.getByTestId("attachment-table-viewer");
    await expect(table.locator("td")).toHaveCount(1_984);
    await expect(table.getByRole("rowheader", { name: "1", exact: true })).toBeVisible();
    await table.getByRole("button", { name: /^(Next page|下一页)$/ }).click();
    await expect(table.getByRole("rowheader", { name: "32", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "r32c0", exact: true })).toBeVisible();
    await table.getByRole("button", { name: /^(Next page|下一页)$/ }).click();
    await table.getByRole("button", { name: /^(Next page|下一页)$/ }).click();
    await expect(table.locator("td")).toHaveCount(448);
    await expect(table.getByRole("button", { name: /^(Next page|下一页)$/ })).toBeDisabled();
    await table.getByRole("button", { name: /^(Previous page|上一页)$/ }).focus();
    await page.keyboard.press("Enter");
    await expect(table.getByRole("rowheader", { name: "63", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("csv-bounded-page.png") });
    await closeFile(page, paged);
    for (const [file, original, reason] of [[wideFile, wide, /Column limit reached|列数较多/], [longFile, long, /A field is too long|单个字段较长/]] as const) {
      await openFile(page, file, locale);
      await expect(table.getByRole("status")).toContainText(reason);
      await expect(table.getByRole("columnheader", { name: file === wideFile ? "original-header-0" : "original-header", exact: true })).toBeVisible();
      await expect(table.getByRole("columnheader", { name: "short", exact: true })).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`csv-limited-${file === wideFile ? "columns" : "field"}.png`) });
      await table.getByRole("button", { name: /^(View source|查看原文)$/ }).click();
      expect(await viewer.locator("pre").textContent()).toBe(original);
      await closeFile(page, file);
    }
  });

  test("JSON recovers from a read failure, and source/table modes preserve their original text", async ({ page, attachmentConversation }, info) => {
    const made = attachmentConversation, id = made.conversation.id;
    const raw = ' \n' + JSON.stringify({ synthetic: "保留原文", nested: { count: 2 }, lines: Array.from({ length: 80 }, (_, index) => `Synthetic scrollable attachment line ${index + 1}`) }) + '\n\n';
    const csv = 'name,note,value\n"synthetic, row","two\nlines",42\n';
    const code = '  <script>globalThis.__attachmentCodeExecuted = true</script>\n';
    const json = await upload(page.request, id, "reading.json", "application/json", Buffer.from(raw));
    const table = await upload(page.request, id, "reading.csv", "text/csv", Buffer.from(csv));
    const source = await upload(page.request, id, "reading-inert.html", "text/html", Buffer.from(code));
    for (let index = 1; index <= 2; index += 1) await upload(page.request, id, `reading-extra-${index}.txt`, "text/plain", Buffer.from("Synthetic file list overflow"));
    await openFiles(page, id);
    const files = page.getByTestId("conversation-files-panel");
    const originalPanel = await files.evaluateHandle(node => node);
    const search = files.getByPlaceholder(/^(Search files|搜索文件)$/);
    await search.fill("reading");
    await expect(files.getByTestId("conversation-file-row")).toHaveCount(5);
    const selected = files.getByRole("checkbox", { name: /^(Select|选择) reading.json$/ });
    await selected.check();
    let failed = true;
    await page.route(`**/api/attachments/${json.id}/content*`, async route => {
      if (failed) { failed = false; await route.fulfill({ status: 503, body: "Synthetic unavailable" }); }
      else await route.continue();
    });
    const viewer = await openFile(page, json, locale);
    const fileList = files.locator(":scope > div.overflow-y-auto");
    const listTop = await fileList.evaluate(node => node.scrollTop);
    if (width < 768) expect(listTop).toBeGreaterThan(0);
    await expect(viewer).toContainText(zh ? "JSON 读取失败。请重试读取。" : "The JSON could not be read. Please retry.");
    await expect(viewer).not.toContainText(zh ? "JSON 结构超出" : "The JSON structure exceeds");
    // Start from the actual initial close control; both directions must stay
    // in the foreground dialog, never in the still-mounted file drawer.
    await page.keyboard.press("Shift+Tab");
    expect(await viewer.evaluate(node => node.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Tab");
    const closeControl = viewer.getByRole("button", { name: zh ? "关闭附件查看器" : "Close attachment viewer", exact: true });
    await expect(closeControl).toBeFocused();
    for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
      await closeControl.dispatchEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...composition });
      await expect(viewer).toBeVisible();
    }
    await closeControl.evaluate(node => node.addEventListener("keydown", event => {
      if (event instanceof KeyboardEvent && event.key === "Escape") event.preventDefault();
    }, { once: true }));
    await page.keyboard.press("Escape");
    await expect(viewer).toBeVisible();
    await expect(files).toHaveCount(1);
    await viewer.getByRole("button", { name: zh ? "重试" : "Retry", exact: true }).click();
    await expect(viewer.getByTestId("json-viewer")).toBeVisible();
    await viewer.getByRole("button", { name: "Raw", exact: true }).click();
    expect(await viewer.locator("pre").textContent()).toBe(raw);
    await viewer.getByRole("button", { name: zh ? "格式化" : "Formatted", exact: true }).click();
    expect(await viewer.locator("pre").textContent()).toBe(JSON.stringify(JSON.parse(raw), null, 2));
    const textViewport = viewer.locator("pre").locator("..");
    await expect.poll(() => textViewport.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    await textViewport.hover();
    await page.mouse.wheel(0, 480);
    await expect.poll(() => textViewport.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    expect(await fileList.evaluate(node => node.scrollTop)).toBe(listTop);
    await page.screenshot({ path: info.outputPath("json-recovered.png") });
    await closeFile(page, json);
    expect(await files.evaluate((node, original) => node === original, originalPanel)).toBe(true);
    await originalPanel.dispose();
    await expect(search).toHaveValue("reading");
    await expect(selected).toBeChecked();
    expect(await fileList.evaluate(node => node.scrollTop)).toBe(listTop);
    await page.screenshot({ path: info.outputPath("file-panel-returned.png") });

    await openFile(page, table, locale);
    await expect(viewer.getByTestId("attachment-table-viewer")).toContainText("synthetic, row");
    await viewer.getByRole("button", { name: zh ? "原文" : "Raw", exact: true }).click();
    expect(await viewer.locator("pre").textContent()).toBe(csv);
    await viewer.getByRole("button", { name: zh ? "表格" : "Table", exact: true }).click();
    await expect(viewer.getByTestId("attachment-table-viewer")).toBeVisible();
    await page.screenshot({ path: info.outputPath("csv-table.png") });
    await closeFile(page, table);

    await openFile(page, source, locale);
    await expect(viewer.locator("pre")).toBeVisible();
    expect(await viewer.locator("pre").textContent()).toBe(code);
    expect(await page.evaluate(() => Boolean((globalThis as typeof globalThis & { __attachmentCodeExecuted?: boolean }).__attachmentCodeExecuted))).toBe(false);
    await closeFile(page, source);
  });

  test("gallery supports repeated keys after zoom and resets the next image transform", async ({ page, attachmentConversation }, info) => {
    const made = attachmentConversation, id = made.conversation.id;
    const images: Attachment[] = [];
    for (let index = 1; index <= 3; index += 1) images.push(await upload(page.request, id, `synthetic-${index}.svg`, "image/svg+xml", Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#d7e6de"/><text x="40" y="120" font-size="24">Synthetic ${index}</text></svg>`,
    )));
    const message = await page.request.get(`/api/messages/${made.messages[0].id}`);
    expect(message.status()).toBe(200);
    const saved = await page.request.patch(`/api/messages/${made.messages[0].id}`, { data: {
      base_version_id: (await message.json()).current_version.id,
      content_markdown: images.map(item => `![${item.display_name}](cr-asset://${item.id})`).join("\n\n"),
    } });
    expect(saved.status()).toBe(200);
    await page.goto(`/conversations/${id}`);
    await page.locator(`[data-testid="attachment-block"][data-attachment-id="${images[0].id}"] img`).click();
    const viewer = page.getByTestId("attachment-viewer-shell");
    const focusImage = viewer.getByTestId("image-focus").locator("img");
    const scale = () => focusImage.evaluate(image => new DOMMatrix(getComputedStyle(image.parentElement!).transform).a);
    await expect(viewer).toHaveAttribute("aria-label", images[0].display_name);
    await viewer.getByRole("button", { name: zh ? "放大" : "Zoom in", exact: true }).click();
    await expect.poll(scale).toBeGreaterThan(1.05);
    await page.keyboard.press("ArrowRight");
    await expect(viewer).toHaveAttribute("aria-label", images[1].display_name);
    await expect.poll(scale).toBe(1);
    await page.keyboard.press("ArrowRight");
    await expect(viewer).toHaveAttribute("aria-label", images[2].display_name);
    await page.keyboard.press("ArrowLeft");
    await expect(viewer).toHaveAttribute("aria-label", images[1].display_name);
    await expect(viewer.locator('[role="listitem"][aria-current="true"]')).toHaveAttribute("aria-label", zh ? "第 2 张" : "Image 2");
    await page.screenshot({ path: info.outputPath("gallery-current-image.png") });
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
  });

  test("Office and ZIP recover from a worker startup failure without reading ahead", async ({ page, attachmentConversation }, info) => {
    const made = attachmentConversation, id = made.conversation.id;
    const document = await upload(page.request, id, "reading.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Buffer.from(zipSync({
      "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
      "word/document.xml": strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic document paragraph</w:t></w:r></w:p></w:body></w:document>'),
    })));
    const archive = await upload(page.request, id, "reading.zip", "application/zip", Buffer.from(zipSync({
      "notes.txt": strToU8("Synthetic archive text"), "opaque.bin": new Uint8Array([0, 255, 0, 255]),
    })));
    await page.addInitScript(() => {
      const OriginalWorker = Worker;
      let failed = false;
      window.Worker = class extends OriginalWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          if (!failed && options?.name === "chat-reader-attachment-preview") { failed = true; throw new Error("Synthetic unavailable worker"); }
          super(url, options);
        }
      };
    });
    await openFiles(page, id);
    let documentReads = 0;
    page.on("request", request => { if (new URL(request.url()).pathname === `/api/attachments/${document.id}/content`) documentReads += 1; });
    const viewer = await openFile(page, document, locale);
    await expect(viewer).toContainText(zh ? "预览组件未能启动。请重试加载。" : "The preview component could not start. Please retry.");
    expect(documentReads).toBe(0);
    await viewer.getByRole("button", { name: zh ? "重试" : "Retry", exact: true }).click();
    await expect(viewer.getByTestId("document-viewer")).toContainText("Synthetic document paragraph");
    expect(documentReads).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath("document-recovered.png") });
    await closeFile(page, document);
    await openFile(page, archive, locale);
    await expect(viewer.getByTestId("archive-viewer")).toContainText("Synthetic archive text");
    await viewer.getByRole("button", { name: /opaque.bin/ }).click();
    await expect(viewer).toContainText(zh ? "此条目不支持浏览器内预览；请下载原压缩包。" : "This entry cannot be previewed in the browser; download the original archive.");
    await page.screenshot({ path: info.outputPath("archive-unsupported-entry.png") });
    await closeFile(page, archive);
  });

  test("a cached Blob can be retried without changing its resource URL", async ({ page, attachmentConversation }, info) => {
    const made = attachmentConversation, id = made.conversation.id;
    const raw = '{"synthetic":"cached Blob retry"}\n';
    const attachment = await upload(page.request, id, "cached.json", "application/json", Buffer.from(raw));
    await openFiles(page, id);
    // Exercise the real browser Blob fetch path in the unified renderer. This
    // is not a substitute for the existing Dexie/offline-package E2E matrix.
    const blobUrl = await page.evaluate(text => {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const original = window.fetch;
      let failed = false;
      window.fetch = (input, init) => {
        const requested = input instanceof Request ? input.url : String(input);
        if (!failed && requested === url) { failed = true; return Promise.reject(new TypeError("Synthetic Blob read failure")); }
        return original(input, init);
      };
      return url;
    }, raw);
    await page.route(`**/api/attachments/${attachment.id}`, async route => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...await response.json(), content_url: blobUrl, download_url: null } });
    });
    const viewer = await openFile(page, attachment, locale);
    await expect(viewer).toContainText(zh ? "JSON 读取失败。请重试读取。" : "The JSON could not be read. Please retry.");
    await expect(viewer.getByRole("link", { name: /下载|Download/ })).toHaveCount(0);
    await viewer.getByRole("button", { name: zh ? "重试" : "Retry", exact: true }).click();
    await expect(viewer.getByTestId("json-viewer")).toBeVisible();
    await viewer.getByRole("button", { name: "Raw", exact: true }).click();
    expect(await viewer.locator("pre").textContent()).toBe(raw);
    await page.screenshot({ path: info.outputPath("blob-read-recovered.png") });
    await closeFile(page, attachment);
    await page.evaluate(url => URL.revokeObjectURL(url), blobUrl);
  });

  test("empty and unsupported files end truthfully, and native audio stays paused", async ({ page, attachmentConversation }, info) => {
    const made = attachmentConversation, id = made.conversation.id;
    const empty = await upload(page.request, id, "empty.txt", "text/plain", Buffer.alloc(0));
    const binary = await upload(page.request, id, "opaque.bin", "application/octet-stream", Buffer.from([0, 255, 0, 255]));
    const audio = await upload(page.request, id, "quiet.wav", "audio/wav", syntheticWav());
    await openFiles(page, id);
    const viewer = await openFile(page, empty, locale);
    await expect(viewer).toContainText(zh ? "这是空文件，没有可预览的内容。" : "This file is empty and has no previewable content.");
    await expect(viewer.locator("pre,canvas,audio,video")).toHaveCount(0);
    await closeFile(page, empty);
    await openFile(page, binary, locale);
    await expect(viewer).toContainText(zh ? "此格式暂不支持浏览器内预览。可下载后使用相应应用打开。" : "This format cannot be previewed in the browser. Download it and open it with a suitable application.");
    await expect(viewer.locator("pre,canvas,audio,video")).toHaveCount(0);
    await expect(viewer.getByRole("link", { name: zh ? "下载" : "Download", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("unsupported-file.png") });
    await closeFile(page, binary);
    await openFile(page, audio, locale);
    const player = viewer.locator("audio");
    await expect(player).toHaveAttribute("controls", "");
    await expect(player).toHaveAttribute("preload", "metadata");
    await expect.poll(() => player.evaluate(node => (node as HTMLAudioElement).readyState)).toBeGreaterThan(0);
    expect(await player.evaluate(node => (node as HTMLAudioElement).paused && !(node as HTMLAudioElement).autoplay)).toBe(true);
    await page.screenshot({ path: info.outputPath("native-audio.png") });
    await closeFile(page, audio);
  });
});

function syntheticWav(): Buffer {
  const samples = 2000, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(samples * 2, 40);
  return bytes;
}

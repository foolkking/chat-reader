import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { settingsAppearance } from "./settings-test-helper";
import { syntheticImage } from "./synthetic-image";
import { legacyImageMetadata } from "./image-legacy-test-helper";

test.skip(process.env.E2E_READING_STABILITY !== "1", "Isolated synthetic image-flow gate");
test.use({ serviceWorkers: "block", extraHTTPHeaders: { Origin: "http://127.0.0.1:3107" } });
type Asset = { id: string; asset_object: { sha256: string }; metadata: Record<string, unknown> };
let conversation = "", message = "";
const assets: Asset[] = [];

async function setSize(request: APIRequestContext, asset: Asset, percent: number) {
  const current = await (await request.get(`/api/attachments/${asset.id}/image-display`)).json();
  const saved = await request.put(`/api/attachments/${asset.id}/image-display`, { data: {
    source_sha256: asset.asset_object.sha256, expected_scale_percent: current.scale_percent, scale_percent: percent,
  } });
  expect(saved.ok()).toBe(true);
}
test.beforeAll(async ({ request, baseURL }) => {
  test.setTimeout(180_000);
  await settingsAppearance(request, baseURL!, "en-US");
  const made = await request.post("/api/conversations", { data: { title: "Synthetic image flow", messages: [
    { role: "user", content_markdown: "Synthetic image question" }, { role: "assistant", content_markdown: "Synthetic answer" },
  ] } });
  expect(made.status()).toBe(201);
  const data = await made.json(); conversation = data.conversation.id; message = data.messages[1].id;
  for (const [index, [width, height]] of [[1000, 600], [1000, 600], [240, 4000], [32, 24], [80, 60], [1000, 600]].entries()) {
    const session = await request.post(`/api/conversations/${conversation}/attachment-upload-sessions`, { data: {} });
    const item = await request.post(`/api/attachment-upload-sessions/${(await session.json()).id}/items`, {
      multipart: { file: { name: `synthetic-flow-${index}.png`, mimeType: "image/png", buffer: syntheticImage(width, height, index === 4) } },
    });
    expect(item.status()).toBe(201);
    const finalized = await request.post(`/api/conversations/${conversation}/attachments`, { data: { upload_item_ids: [(await item.json()).id] } });
    expect(finalized.status()).toBe(201);
    assets.push((await finalized.json()).items[0]);
  }
  expect(legacyImageMetadata(conversation, assets[5].id, "prepare")).toEqual({});
  const image = (index: number) => `![Synthetic ${index}](cr-asset://${assets[index].id})`;
  const content = ["# Synthetic natural image flow", image(0), image(1), "## Never configured legacy image", image(5),
    "## Long image", image(2),
    "## Tiny and transparent", image(3), image(4), "## Markdown semantics",
    `Prose before ${image(0)} prose after.`, `[${image(4)}](https://example.test/)`,
    `| Image | Description |\n| --- | --- |\n| ${image(4)} | Synthetic alpha |`,
    ...Array.from({ length: 180 }, (_, i) => `Synthetic paragraph ${i}. ${"Reading text. ".repeat(20)}`),
  ].join("\n\n");
  const edited = await request.patch(`/api/messages/${message}`, { data: { base_version_id: data.messages[1].current_version.id, content_markdown: content } });
  expect(edited.ok()).toBe(true);
});
test.afterAll(async ({ request }) => {
  if (conversation) expect((await request.delete(`/api/conversations/${conversation}`)).ok()).toBe(true);
});
async function open(page: Page) {
  await page.goto(`/conversations/${conversation}`);
  await expect(page.getByTestId("reader-scroll-root")).toHaveAttribute("data-reader-geometry-owner", "viewport");
  return page.locator(`#message-${message}`);
}
async function reveal(page: Page, target: Locator) {
  // A virtual block may not exist yet. Traverse the real scroll owner instead
  // of forcing a placeholder/duplicate occurrence into the DOM.
  const root = page.getByTestId("reader-scroll-root");
  if (!await target.count()) {
    await root.evaluate(node => { node.scrollTop = 0; });
    await root.hover();
    for (let step = 0; step < 100 && !await target.count(); step++) {
      await page.mouse.wheel(0, 500);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
  }
  await target.scrollIntoViewIfNeeded();
}

test("300px pairs fit, 500px pairs wrap, and the exact 608px boundary preserves actual pixels", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const percent of [30, 50]) {
    for (const asset of assets.slice(0, 2)) await setSize(page.request, asset, percent);
    const article = await open(page), group = article.locator(".attachment-image-gallery").first();
    await group.evaluate(node => { (node.parentElement as HTMLElement).style.width = "720px"; (node.parentElement as HTMLElement).style.maxWidth = "none"; });
    const pictures = group.locator(".attachment-gallery-image");
    await expect.poll(() => pictures.first().evaluate(node => node.getBoundingClientRect().width)).toBe(percent * 10);
    const boxes = await pictures.evaluateAll(nodes => nodes.map(node => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width }; }));
    expect(boxes).toHaveLength(2);
    for (const box of boxes) expect(box.width).toBe(percent * 10);
    if (percent === 30) {
      expect(boxes[0].y).toBe(boxes[1].y);
      for (const lane of [607, 608]) {
        await group.evaluate((node, width) => { (node.parentElement as HTMLElement).style.width = `${width}px`; }, lane);
        await expect.poll(() => pictures.evaluateAll(nodes => Math.abs(nodes[0].getBoundingClientRect().top - nodes[1].getBoundingClientRect().top) < 1)).toBe(lane === 608);
      }
    } else expect(boxes[1].y).toBeGreaterThan(boxes[0].y);
  }
});

test("never-configured legacy image reads geometry without writing; first explicit 100 preserves layout", async ({ page }) => {
  const asset = assets[5];
  expect(legacyImageMetadata(conversation, asset.id, "read")).toEqual({});
  const read = await page.request.get(`/api/attachments/${asset.id}/image-display`);
  expect(read.ok()).toBe(true);
  expect((await read.json()).configured).toBe(false);
  expect(legacyImageMetadata(conversation, asset.id, "read")).toEqual({});
  let writes = 0;
  page.on("request", request => { if (request.method() === "PUT" && request.url().endsWith(`/${asset.id}/image-display`)) writes++; });
  await page.setViewportSize({ width: 1440, height: 900 });
  const article = await open(page), figure = article.locator(`[data-attachment-id="${asset.id}"]`).first();
  await reveal(page, figure);
  const picture = figure.locator("img");
  await expect(picture).toHaveAttribute("width", "1000");
  await expect.poll(() => picture.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(1000);
  const before = await picture.boundingBox();
  expect(before!.width).toBeGreaterThan(320);
  expect(before!.height / before!.width).toBeCloseTo(.6, 3);
  expect(writes).toBe(0);
  expect(legacyImageMetadata(conversation, asset.id, "read")).toEqual({});
  await figure.getByRole("button", { name: /Image display scale:/ }).click();
  const menu = page.getByRole("dialog", { name: "Image size", exact: true });
  await expect(menu.getByRole("slider")).toBeEnabled();
  expect(writes).toBe(0);
  await menu.getByRole("button", { name: "100%", exact: true }).click();
  await expect(menu.getByRole("status")).toHaveText("Saved");
  expect(writes).toBe(1);
  const after = await picture.boundingBox();
  expect(Math.abs(after!.width - before!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(1);
  const metadata = legacyImageMetadata(conversation, asset.id, "read");
  expect(metadata.image_display_v1).toMatchObject({ scale_percent: 100, width: 1000, height: 600 });
  expect(metadata.image_geometry_v1).toBeUndefined();
});

test("configured detail fallback and shared references retain the same saved layout", async ({ page }) => {
  await setSize(page.request, assets[0], 100);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(`**/api/conversations/${conversation}/reader-turn*`, async route => {
    const response = await route.fetch(), data = await response.json();
    const strip = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (key === "image_geometry_v1" || key === "imageGeometry" || key === "image_display_v1" || key === "imageDisplay") delete (value as Record<string, unknown>)[key];
        else strip(child);
      }
    };
    strip(data); await route.fulfill({ response, json: data });
  });
  const article = await open(page), figure = article.locator(`[data-attachment-id="${assets[0].id}"]`).first();
  const picture = figure.locator("img");
  await expect(picture).toHaveAttribute("width", "1000");
  const before = await picture.boundingBox();
  await figure.getByRole("button", { name: /Image display scale:/ }).click();
  const menu = page.getByRole("dialog", { name: "Image size", exact: true });
  await menu.getByRole("button", { name: "100%", exact: true }).click();
  await expect(menu.getByRole("status")).toHaveText("Saved");
  const after = await picture.boundingBox();
  expect(after!.width).toBe(before!.width); expect(after!.height).toBe(before!.height);
  const input = menu.getByRole("spinbutton", { name: "Image size percentage" });
  let writes = 0;
  page.on("request", request => { if (request.method() === "PUT" && request.url().includes("/image-display")) writes++; });
  await input.fill("50"); await input.press("Enter");
  await expect(menu.getByRole("status")).toHaveText("Saved");
  await input.press("Tab");
  expect(writes).toBe(1);
  await menu.getByRole("button", { name: "Close image size" }).click();
  await expect(picture).toHaveAttribute("width", "500");
  const inline = article.locator(`.reader-rich-image[data-attachment-id="${assets[0].id}"]`);
  await reveal(page, inline);
  await expect(inline).toHaveAttribute("width", "500");
});

test("long fold survives virtual remounts, tiny images stay tiny, and Viewer modes measure intrinsic pixels", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const article = await open(page);
  const long = article.locator(`[data-attachment-id="${assets[2].id}"]`).first();
  await reveal(page, long);
  await expect.poll(() => long.locator("img").evaluate(node => node.getBoundingClientRect().width)).toBe(240);
  await long.getByRole("button", { name: /Image display scale:/ }).click();
  const size = page.getByRole("dialog", { name: "Image size", exact: true });
  await expect(size.getByText("Full body image", { exact: true })).toBeVisible();
  await expect(size.locator("dd").nth(2)).toHaveText("240 × 4000");
  await expect(size.getByText("Visible area (collapsed)", { exact: true })).toBeVisible();
  await expect(size.locator("dd").nth(3)).toHaveText("240 × 630");
  await size.getByRole("button", { name: "Close image size" }).click();
  await long.getByRole("button", { name: "Expand full image" }).click();
  await expect(long).toHaveAttribute("data-image-expanded", "true");
  expect((await long.locator("img").boundingBox())!.height).toBe(4000);
  const root = page.getByTestId("reader-scroll-root");
  await expect(article.locator('[data-virtualized-block-list="true"]')).toHaveCount(1);
  const original = await long.elementHandle();
  // Traverse with real reading intent. A one-shot scrollTop jump does not
  // establish user ownership while virtual rows are still being measured.
  await root.hover();
  const nextFrames = () => page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (let step = 0; step < 60 && await long.count(); step++) {
    await page.mouse.wheel(0, 1200);
    await nextFrames();
  }
  await expect(long).toHaveCount(0);
  expect(await original!.evaluate(node => node.isConnected)).toBe(false);
  for (let step = 0; step < 60 && !await long.count(); step++) {
    await page.mouse.wheel(0, -1200);
    await nextFrames();
  }
  await expect(long).toHaveAttribute("data-image-expanded", "true");
  await original!.dispose();
  await long.getByRole("button", { name: "Collapse image" }).click();
  await long.locator(".attachment-gallery-trigger").click();
  const viewer = page.getByTestId("attachment-viewer-shell"), image = viewer.locator(".image-viewer-original");
  await viewer.getByRole("button", { name: "Original 1:1", exact: true }).click();
  await expect.poll(() => image.evaluate(node => node.getBoundingClientRect().width)).toBe(240);
  expect((await image.boundingBox())!.height).toBe(4000);
  await viewer.getByRole("button", { name: "Fit to window", exact: true }).click();
  const canvas = await viewer.getByTestId("image-viewer-canvas").boundingBox();
  await expect.poll(() => image.evaluate(node => node.getBoundingClientRect().height)).toBeLessThanOrEqual(canvas!.height + 1);
  await viewer.getByRole("button", { name: "Fit to width", exact: true }).click();
  await expect.poll(() => image.evaluate(node => node.getBoundingClientRect().top)).toBeCloseTo(canvas!.y, 0);
  await viewer.getByRole("combobox", { name: "Transparency background" }).selectOption("checker");
  await page.screenshot({ path: info.outputPath("viewer-canvas-tools.png") });
  await viewer.getByRole("button", { name: "Close attachment viewer" }).click();
  for (const [index, width] of [[3, 32], [4, 80]]) {
    const tiny = article.locator(`[data-attachment-id="${assets[index].id}"]`).first();
    await reveal(page, tiny);
    await expect.poll(() => tiny.locator("img").evaluate(node => node.getBoundingClientRect().width)).toBe(width);
    expect((await tiny.boundingBox())!.width).toBe(Math.max(44, width));
    await expect(tiny.getByRole("button", { name: "Image options", exact: true })).toBeVisible();
  }
});

test("375/800/1440 surfaces retain captions and controls; linked and table images have no nested controls", async ({ page }, info) => {
  for (const width of [375, 800, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const article = await open(page);
    const link = article.locator('a[href="https://example.test/"]');
    await reveal(page, link);
    await expect(link.locator("img")).toHaveCount(1);
    await expect(link.locator("button,figure")).toHaveCount(0);
    await expect(article.locator("p figure,p div,table figure")).toHaveCount(0);
    await expect(article.locator("td img")).toHaveCount(1);
    const first = article.locator(".attachment-gallery-item").first();
    await reveal(page, first);
    await first.locator(".image-display-trigger").click();
    const menu = page.locator(".image-display-menu");
    await expect(menu.getByRole("slider")).toBeVisible();
    const box = await menu.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(901);
    expect(await menu.evaluate(node => node.parentElement === document.body)).toBe(true);
    await page.screenshot({ path: info.outputPath(`natural-flow-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  }
});

test("native prose, linked and table images keep real aspect ratios and inline line boxes", async ({ page }) => {
  const create = await page.request.post("/api/conversations", { data: {
    title: "Synthetic native image semantics", messages: [
      { role: "user", content_markdown: "Synthetic image question" },
      { role: "assistant", content_markdown: "Synthetic placeholder" },
    ],
  } });
  expect(create.status()).toBe(201);
  const made = await create.json(), id = made.conversation.id, target = made.messages[1];
  try {
    const uploaded: string[] = [];
    for (const [width, height] of [[80, 60], [240, 4000]]) {
      const session = await page.request.post(`/api/conversations/${id}/attachment-upload-sessions`, { data: {} });
      const item = await page.request.post(`/api/attachment-upload-sessions/${(await session.json()).id}/items`, {
        multipart: { file: { name: `synthetic-${width}.png`, mimeType: "image/png", buffer: syntheticImage(width, height) } },
      });
      expect(item.status()).toBe(201);
      const finalized = await page.request.post(`/api/conversations/${id}/attachments`, { data: { upload_item_ids: [(await item.json()).id] } });
      expect(finalized.status()).toBe(201);
      uploaded.push((await finalized.json()).items[0].id);
    }
    const native = (index: number) => `![Native ${index}](cr-asset://${uploaded[index]})`;
    expect((await page.request.patch(`/api/messages/${target.id}`, { data: {
      base_version_id: target.current_version.id,
      content_markdown: `Before ${native(0)} after.\n\nLong ${native(1)} end.\n\n[${native(1)}](https://example.test/)\n\n| Image |\n| --- |\n| ${native(1)} |`,
    } })).ok()).toBe(true);
    await page.goto(`/conversations/${id}`);
    const article = page.locator(`#message-${target.id}`);
    for (const width of [375, 800, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const small = article.locator(`img[data-attachment-id="${uploaded[0]}"]`);
      await expect(small).toHaveAttribute("width", "80");
      const line = await small.evaluate(node => {
        const image = node.getBoundingClientRect(), paragraph = node.closest("p")!;
        const text = Array.from(paragraph.childNodes).filter(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
        const boxes = text.map(node => { const range = document.createRange(); range.selectNodeContents(node); const b = range.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; });
        return { display: getComputedStyle(node).display, width: image.width, height: image.height, left: image.left, right: image.right, top: image.top, bottom: image.bottom, boxes };
      });
      expect(line.display).toBe("inline-block"); expect(line.width).toBe(80); expect(line.height).toBe(60);
      expect(line.boxes).toHaveLength(2);
      expect(line.boxes[0].right).toBeLessThanOrEqual(line.left + 1);
      expect(line.boxes[1].left).toBeGreaterThanOrEqual(line.right - 1);
      for (const text of line.boxes) { expect(text.bottom).toBeGreaterThan(line.top); expect(text.top).toBeLessThan(line.bottom); }
      const longs = article.locator(`img[data-attachment-id="${uploaded[1]}"]`);
      await expect(longs).toHaveCount(3);
      for (const image of await longs.all()) {
        await image.locator("xpath=..").scrollIntoViewIfNeeded();
        await expect.poll(() => image.getAttribute("width")).toBe("240");
        const box = await image.boundingBox();
        expect(box!.width).toBeGreaterThan(80);
        expect(box!.height / box!.width).toBeCloseTo(4000 / 240, 2);
        expect(box!.height).toBeGreaterThan(640);
      }
      await expect(article.locator("a button,a figure,p figure,td button,td figure")).toHaveCount(0);
    }
  } finally { expect((await page.request.delete(`/api/conversations/${id}`)).ok()).toBe(true); }
});

test("cold image metadata and next-image decode retain the same Viewer shell frame by frame", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const article = await open(page);
  const trigger = article.locator(".attachment-gallery-trigger").first();
  await reveal(page, trigger);
  const releases: { id: string; done: () => void }[] = [];
  const held = new Set<string>(), waiting = new Set(assets.slice(0, 2).map(asset => asset.id));
  const release = (id: string) => {
    waiting.delete(id);
    releases.filter(entry => entry.id === id).forEach(entry => entry.done());
  };
  for (const asset of assets.slice(0, 2)) await page.route(`**/api/attachments/${asset.id}`, async route => {
    if (waiting.has(asset.id)) {
      held.add(asset.id);
      await new Promise<void>(done => releases.push({ id: asset.id, done }));
    }
    await route.continue();
  });
  try {
    await page.evaluate(() => {
      const host = window as unknown as { viewerBoxes: number[][]; stopViewerBoxes: boolean };
      host.viewerBoxes = []; host.stopViewerBoxes = false;
      const tick = () => {
        if (host.stopViewerBoxes) return;
        const box = document.querySelector('[data-testid="attachment-viewer-panel"]')?.getBoundingClientRect();
        if (box) host.viewerBoxes.push([box.x, box.y, box.width, box.height]);
        requestAnimationFrame(tick);
      }; tick();
    });
    await trigger.click();
    const shell = page.getByTestId("attachment-viewer-shell");
    await expect(shell).toBeVisible();
    await expect.poll(() => held.size).toBe(1);
    const waitFrames = () => page.evaluate(() => new Promise<void>(resolve => {
      let count = 12; const tick = () => --count ? requestAnimationFrame(tick) : resolve(); requestAnimationFrame(tick);
    }));
    await waitFrames();
    release(assets[0].id);
    await expect(shell.locator(".image-viewer-original")).toBeVisible();
    await expect.poll(() => shell.locator(".image-viewer-original").evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(1000);
    await waitFrames();
    await shell.getByRole("button", { name: "Next image", exact: true }).click();
    await expect.poll(() => held.size).toBe(2);
    await waitFrames();
    release(assets[1].id);
    await expect.poll(() => shell.locator(".image-viewer-original").evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(1000);
    await waitFrames();
    const boxes = await page.evaluate(() => {
      const host = window as unknown as { viewerBoxes: number[][]; stopViewerBoxes: boolean };
      host.stopViewerBoxes = true; return host.viewerBoxes;
    });
    await writeFile(info.outputPath("viewer-cold-shell.json"), JSON.stringify({ frames: boxes }));
    expect(boxes.length).toBeGreaterThan(30);
    expect(boxes[0][2]).toBe(1100); expect(boxes[0][3]).toBe(810);
    for (const box of boxes) for (let axis = 0; axis < 4; axis++) expect(Math.abs(box[axis] - boxes[0][axis])).toBeLessThanOrEqual(1);
  } finally { waiting.clear(); releases.forEach(entry => entry.done()); await page.unrouteAll({ behavior: "wait" }); }
});

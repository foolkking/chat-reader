import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { settingsAppearance } from "./settings-test-helper";
import { syntheticImage } from "./synthetic-image";

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
  for (const [index, [width, height]] of [[1000, 600], [1000, 600], [240, 4000], [32, 24], [80, 60]].entries()) {
    const session = await request.post(`/api/conversations/${conversation}/attachment-upload-sessions`, { data: {} });
    const item = await request.post(`/api/attachment-upload-sessions/${(await session.json()).id}/items`, {
      multipart: { file: { name: `synthetic-flow-${index}.png`, mimeType: "image/png", buffer: syntheticImage(width, height, index === 4) } },
    });
    expect(item.status()).toBe(201);
    const finalized = await request.post(`/api/conversations/${conversation}/attachments`, { data: { upload_item_ids: [(await item.json()).id] } });
    expect(finalized.status()).toBe(201);
    assets.push((await finalized.json()).items[0]);
  }
  const image = (index: number) => `![Synthetic ${index}](cr-asset://${assets[index].id})`;
  const content = ["# Synthetic natural image flow", image(0), image(1), "## Long image", image(2),
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

test("legacy detail read normalizes once; unchanged 100 and shared references have identical layout", async ({ page }) => {
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
  await expect(article.locator(`.reader-rich-image[data-attachment-id="${assets[0].id}"]`)).toHaveAttribute("width", "500");
});

test("long fold survives virtual remounts, tiny images stay tiny, and Viewer modes measure intrinsic pixels", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const article = await open(page);
  const long = article.locator(`[data-attachment-id="${assets[2].id}"]`).first();
  await long.scrollIntoViewIfNeeded();
  await expect.poll(() => long.locator("img").evaluate(node => node.getBoundingClientRect().width)).toBe(240);
  await long.getByRole("button", { name: "Expand full image" }).click();
  await expect(long).toHaveAttribute("data-image-expanded", "true");
  expect((await long.locator("img").boundingBox())!.height).toBe(4000);
  const root = page.getByTestId("reader-scroll-root");
  const top = await root.evaluate(node => node.scrollTop);
  await root.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect(long).toHaveCount(0);
  await root.evaluate((node, value) => { node.scrollTop = value; }, top);
  await expect(long).toHaveAttribute("data-image-expanded", "true");
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
    await tiny.scrollIntoViewIfNeeded();
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
    await link.scrollIntoViewIfNeeded();
    await expect(link.locator("img")).toHaveCount(1);
    await expect(link.locator("button,figure")).toHaveCount(0);
    await expect(article.locator("p figure,p div,table figure")).toHaveCount(0);
    await expect(article.locator("td img")).toHaveCount(1);
    const first = article.locator(".attachment-gallery-item").first();
    await first.scrollIntoViewIfNeeded();
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

import { expect, test, type APIRequestContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { syntheticImage as png } from "./synthetic-image";
import { writeFile } from "node:fs/promises";
import { settingsAppearance } from "./settings-test-helper";

test.skip(process.env.E2E_READING_STABILITY !== "1", "Isolated synthetic reading-stability gate");
test.use({ trace: "off", serviceWorkers: "allow", extraHTTPHeaders: { Origin: "http://127.0.0.1:3107" } });

// Real upload, canonical parse, package generation, Reader and browser layout.
// Only image transport timing/failure is controlled; no component/test-only route.
type Fixture = { id: string; messageId: string; assets: string[]; shareId: string; token: string };
const fixtures: Fixture[] = [];
let normal: Fixture, heavy: Fixture, other: Fixture;

async function seed(request: APIRequestContext, long: boolean, label: string): Promise<Fixture> {
  const created = await request.post("/api/conversations", { data: {
    title: `Synthetic geometry ${label}`, messages: [
      { role: "user", content_markdown: "Synthetic reading question" },
      { role: "assistant", content_markdown: "Synthetic placeholder" },
    ],
  } });
  expect(created.status()).toBe(201);
  const made = await created.json(), id = made.conversation.id, message = made.messages[1];
  const fixture: Fixture = { id, messageId: message.id, assets: [], shareId: "", token: "" };
  fixtures.push(fixture);
  for (const [index, [width, height]] of [[32, 24], [1600, 1200], [240, 4000], [2000, 120], [400, 800], [640, 1600]].entries()) {
    const session = await request.post(`/api/conversations/${id}/attachment-upload-sessions`, { data: {} });
    expect(session.status()).toBe(201);
    const uploaded = await request.post(`/api/attachment-upload-sessions/${(await session.json()).id}/items`,
      { multipart: { file: { name: `synthetic-${index}.png`, mimeType: "image/png", buffer: png(width, height) } } });
    expect(uploaded.status()).toBe(201);
    const finalized = await request.post(`/api/conversations/${id}/attachments`, { data: { upload_item_ids: [(await uploaded.json()).id] } });
    expect(finalized.status()).toBe(201);
    const asset = (await finalized.json()).items[0];
    fixture.assets.push(asset.id);
    // Both saved sizes and unsaved source geometry occur in each group.
    if (index % 2) {
      const display = await (await request.get(`/api/attachments/${asset.id}/image-display`)).json();
      const save = await request.put(`/api/attachments/${asset.id}/image-display`, { data: {
        source_sha256: display.source_sha256, scale_percent: index === 1 ? 25 : 50, expected_scale_percent: 100,
      } });
      expect(save.ok()).toBe(true);
    }
  }
  const group = (count: number) => Array.from({ length: count }, (_, i) => `![Synthetic ${i}](cr-asset://${fixture.assets[i % 6]})`).join("\n\n");
  const body = [
    "# Synthetic geometry", group(7),
    "```typescript\nconst synthetic = 1;\n\nconsole.log(synthetic);\n```",
    "```mermaid\nflowchart LR\n  A[Start] --> B[Finish]\n```",
    "Reading stability anchor. This real paragraph must stay at its reading position.",
    ...[1, 2, 3, 6, 20].flatMap(count => [`## Group of ${count}`, group(count), "Synthetic interleaved prose."]),
    ...Array.from({ length: long ? 220 : 22 }, (_, i) =>
      `${i === 190 ? "## Deep synthetic target\n\n" : ""}Synthetic paragraph ${i}. ${"Reading text without private content. ".repeat(8)}`),
  ].join("\n\n");
  const patched = await request.patch(`/api/messages/${message.id}`, { data: { base_version_id: message.current_version.id, content_markdown: body } });
  expect(patched.ok()).toBe(true);
  const share = await request.post(`/api/conversations/${id}/shares`, { data: { scope: "conversation", include_toc: true, include_metadata: true } });
  expect(share.ok()).toBe(true);
  const shared = await share.json();
  fixture.shareId = shared.id; fixture.token = shared.token;
  return fixture;
}

test.beforeAll(async ({ request, baseURL }) => {
  test.setTimeout(180_000);
  await settingsAppearance(request, baseURL!, "en-US");
  normal = await seed(request, false, "normal");
  heavy = await seed(request, true, "virtual");
  other = await seed(request, false, "independent");
});
test.afterAll(async ({ request }) => {
  for (const fixture of fixtures) {
    if (fixture.shareId) expect((await request.post(`/api/shares/${fixture.shareId}/revoke`)).ok()).toBe(true);
    expect((await request.delete(`/api/conversations/${fixture.id}`)).ok()).toBe(true);
  }
});

async function frames(page: Page, count = 2) {
  await page.evaluate(count => new Promise<void>(resolve => {
    const tick = () => --count <= 0 ? resolve() : requestAnimationFrame(tick);
    requestAnimationFrame(tick);
  }), count);
}

async function expectReaderReady(root: Locator) {
  await expect(root).toHaveAttribute("data-reader-geometry-owner", "viewport");
  // Fresh reading has no navigation transaction. Only an explicit target or a
  // saved-position restore publishes navigationStage; never wait for a stage
  // that that entry path cannot produce.
  await expect.poll(async () => await root.getAttribute("data-navigation-stage") ?? "fresh")
    .toMatch(/^(fresh|settled)$/);
}

async function expectOfflineCopyReady(page: Page, fixture: Fixture) {
  // Shell readiness is not package readiness. Wait for the actual canonical
  // message and all six source-bound cache entries before cutting the network.
  await expect(page.locator(`#message-${fixture.messageId}`)).toBeVisible();
  await expect.poll(() => page.evaluate(async ({ id, assets }) => {
    const rows = await new Promise<{ id: string; sha256: string; byte_size: number }[]>((resolve, reject) => {
      const opening = indexedDB.open("chat-reader-offline-library");
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result, tx = db.transaction("attachments");
        const request = tx.objectStore("attachments").index("conversation_id").getAll(id);
        tx.oncomplete = () => { db.close(); resolve(request.result); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
    const cache = await caches.open("chat-reader-offline-assets-v1");
    const available = await Promise.all(assets.map(async id => {
      const row = rows.find(row => row.id === id);
      if (!row) return false;
      const response = await cache.match(`https://offline.chat-reader.local/assets/${id}/${row.sha256}`);
      return Boolean(response && (await response.blob()).size === row.byte_size);
    }));
    return available.filter(Boolean).length;
  }, { id: fixture.id, assets: fixture.assets })).toBe(fixture.assets.length);
  // The indicator lives in the library sidebar, which is closed on mobile.
  // Open it explicitly, then close it before the reading measurement begins.
  const status = page.locator("p:visible, span:visible", { hasText: /^(Offline ready|Existing offline version is available)/ }).first();
  const open = page.getByRole("button", { name: "Open sidebar", exact: true }).filter({ visible: true });
  const mobile = (page.viewportSize()?.width ?? 1440) < 768;
  if (mobile || await open.isVisible()) await open.click();
  await expect(status).toBeVisible();
  if (mobile) await page.locator("aside:visible").getByRole("button", { name: "Close", exact: true }).click();
}

type Sample = { time: number; top: number; scroll: number; height: number; cells: number[][]; writer: string; mounted: number; measuredRows: number[][]; viewerLocked: boolean; viewerVisible: boolean; otherScroll: number[] };
type Probe = { frames: Sample[]; corrections: { time: number; delta: number; applied: number }[]; preDefaultWheel: boolean;
  events: { time: number; type: string; top: number; scroll: number; viewerLocked: boolean; targetsAnchor: boolean; cancelable: boolean; trusted: boolean }[] };
async function startProbe(anchor: Locator, preDefaultWheel = false) {
  await anchor.evaluate((node, preDefaultWheel) => {
    const target = node as HTMLElement;
    const root = target.closest<HTMLElement>('[data-reader-scroll-root="true"]') ?? document.documentElement;
    const state = { frames: [] as Sample[], corrections: [] as Probe["corrections"], events: [] as Probe["events"], preDefaultWheel, stop: false };
    const host = window as unknown as { readingProbe: typeof state; stopReadingProbe: () => void };
    host.readingProbe = state;
    const onCorrection = (event: Event) => state.corrections.push({ time: performance.now(), ...(event as CustomEvent).detail });
    const onInput = (event: Event) => {
      if (state.events.length >= 2048) return;
      state.events.push({ time: performance.now(), type: event.type,
        top: target.getBoundingClientRect().top - (root === document.documentElement ? 0 : root.getBoundingClientRect().top),
        scroll: root === document.documentElement ? scrollY : root.scrollTop,
        viewerLocked: root.dataset.readerViewerLocked === "true",
        cancelable: event.cancelable, trusted: event.isTrusted,
        targetsAnchor: event.target instanceof Node && target.contains(event.target) });
    };
    const eventTypes = ["pointerdown", "click", "keydown", "focusin", "scroll", "wheel"];
    // Only the immediate-wheel branch needs a pre-default baseline. Passive
    // wheel delivery can occur AFTER the compositor has already scrolled.
    // Never preventDefault or write scroll here; the original 64 traces retain
    // their normal listener behavior.
    eventTypes.forEach(type => document.addEventListener(type, onInput,
      type === "wheel" && preDefaultWheel ? { capture: true, passive: false } : true));
    root.addEventListener("chat-reader:geometry-correction", onCorrection);
    host.stopReadingProbe = () => {
      state.stop = true; root.removeEventListener("chat-reader:geometry-correction", onCorrection);
      eventTypes.forEach(type => document.removeEventListener(type, onInput, true));
    };
    const tick = () => {
      if (state.stop) return;
      state.frames.push({
        time: performance.now(), top: target.getBoundingClientRect().top - (root === document.documentElement ? 0 : root.getBoundingClientRect().top),
        scroll: root === document.documentElement ? scrollY : root.scrollTop,
        height: root.scrollHeight, writer: root.dataset.readerLastScrollWriter ?? "none",
        viewerLocked: root.dataset.readerViewerLocked === "true",
        viewerVisible: Boolean(document.querySelector('[data-testid="attachment-viewer-shell"]')),
        otherScroll: Array.from(document.querySelectorAll<HTMLElement>('[data-reader-scroll-root="true"]')).filter(other => other !== root).map(other => other.scrollTop),
        mounted: root.querySelectorAll("[data-block-index]").length,
        measuredRows: Array.from(root.querySelectorAll<HTMLElement>('[data-virtualized-block-list="true"] [data-reader-virtual-slot] > [data-index]'))
          .map(row => [Number(row.dataset.index), row.getBoundingClientRect().height]),
        cells: Array.from(root.querySelectorAll(".attachment-gallery-media")).map(cell => {
          const rect = cell.getBoundingClientRect(); return [rect.width, rect.height];
        }),
      });
      requestAnimationFrame(tick);
    };
    tick();
  }, preDefaultWheel);
}
async function endProbe(page: Page, info: TestInfo, label: string): Promise<Probe> {
  const evidence = await page.evaluate(() => {
    const host = window as unknown as { readingProbe: Probe; stopReadingProbe: () => void };
    host.stopReadingProbe(); return host.readingProbe;
  });
  await writeFile(info.outputPath(`${label}-frames.json`), JSON.stringify(evidence));
  expect(evidence.frames.length, "The gate must observe intermediate frames, not only the final screenshot").toBeGreaterThan(10);
  return evidence;
}

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus || page.isClosed()) return;
  // A failing readiness/retry/Viewer assertion must not discard the partial
  // frame history. Store only scalar geometry, never URLs or Share tokens.
  const partial = await page.evaluate(() => {
    const host = window as unknown as { readingProbe?: Probe; stopReadingProbe?: () => void };
    host.stopReadingProbe?.(); return host.readingProbe ?? null;
  }).catch(() => null);
  if (partial) await writeFile(info.outputPath("failure-partial-frames.json"), JSON.stringify(partial));
  const images = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLImageElement>(".attachment-gallery-image"))
    .slice(0, 12).map(image => ({
      complete: image.complete, decodedWidth: image.naturalWidth, decodedHeight: image.naturalHeight,
      loading: image.loading, retried: image.currentSrc.includes("viewer_retry="),
      top: image.getBoundingClientRect().top, width: image.getBoundingClientRect().width,
    }))).catch(() => []);
  await writeFile(info.outputPath("failure-image-states.json"), JSON.stringify(images));
});

for (const width of [375, 1440]) for (const long of [false, true]) for (const surface of ["reader", "share", "offline", "compare"] as const) {
  test(`${width}px ${long ? "virtual" : "normal"} ${surface}: stable frames, reading motion and Viewer return`, async ({ page, context }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    const fixture = long ? heavy : normal;
    const release: (() => void)[] = [];
    let hold = surface !== "offline", failed = false, imageRequests = 0, retryReads = 0, writes = 0;
    const controlledReads = new Set<number>();
    page.on("request", request => { if (request.url().includes("/image-display") && request.method() === "PUT") writes++; });
    if (hold) await page.route(/\/api\/.*attachments\/[^/]+\/content(?:\?|$)/, async route => {
      imageRequests++;
      const url = new URL(route.request().url());
      const index = fixture.assets.findIndex(id => url.pathname.includes(id));
      if (index >= 0 && index < 5) controlledReads.add(index);
      if (index === 0 && url.searchParams.get("viewer_retry") === "1") retryReads++;
      if (hold) await new Promise<void>(resolve => release.push(resolve));
      if (!failed && route.request().url().includes(fixture.assets[0])) {
        failed = true; await route.fulfill({ status: 503, body: "Synthetic image failure" });
      } else await route.continue();
    });
    try {
      const url = surface === "reader" ? `/conversations/${fixture.id}`
        : surface === "share" ? `/share/${fixture.token}`
          : surface === "compare" ? `/compare?left=${fixture.id}&right=${other.id}` : `/library?conversationId=${fixture.id}`;
      await page.goto(url, { waitUntil: "domcontentloaded" });
      if (surface === "offline") {
        await page.getByRole("button", { name: "Download offline copy", exact: true }).click();
        await expectOfflineCopyReady(page, fixture);
        // Offline attachment reads must not borrow the owner's online query cache.
        await page.route("**/api/attachments/**", route => route.abort());
        await context.setOffline(true);
      }
      const article = page.locator(`#message-${fixture.messageId}`).filter({ visible: true });
      const anchor = article.locator('[data-block-type="paragraph"]').filter({ hasText: /^Reading stability anchor\./ }).first();
      await expect(anchor).toBeAttached();
      if (long) await expect(article.locator('[data-virtualized-block-list="true"]')).toHaveCount(1);
      const root = surface === "share" ? page.locator("html") : article.locator('xpath=ancestor::*[@data-reader-scroll-root="true"][1]');
      if (surface === "reader" || surface === "offline") await expectReaderReady(root);
      // A real reading action establishes the anchor; no old scrollTop restore.
      const loadingGroup = article.locator(".attachment-image-gallery").first();
      if (surface !== "offline") {
        // Natural rows can span several viewports. Start only the five controlled
        // fixture reads before moving below them; unrelated images stay lazy.
        await expect(loadingGroup.locator(".attachment-gallery-image")).toHaveCount(5);
        await loadingGroup.locator(".attachment-gallery-image").evaluateAll(images =>
          images.forEach(image => { (image as HTMLImageElement).loading = "eager"; }));
        await expect.poll(() => controlledReads.size).toBe(5);
      }
      await anchor.scrollIntoViewIfNeeded();
      await frames(page, 4);
      await startProbe(anchor);
      hold = false;
      for (const done of release.reverse()) { done(); await frames(page, 2); }
      if (surface !== "offline") {
        expect(imageRequests).toBeGreaterThan(0);
        const failedImage = loadingGroup.locator(`[data-attachment-id="${fixture.assets[0]}"]`).first();
        await expect(failedImage.getByText("Image preview unavailable.")).toBeAttached();
        // Invoke without scrolling the page: failure recovery must not itself
        // move the anchor to the failed image above the reading line.
        await failedImage.getByRole("button", { name: "Retry preview", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
        await expect(failedImage.locator("img")).toHaveAttribute("loading", "eager");
        await expect.poll(() => retryReads).toBe(1);
      }
      await expect(loadingGroup.locator(".attachment-gallery-image")).toHaveCount(5);
      // All controlled reads, including the explicit offscreen retry, must
      // actually decode (complete alone also accepts a broken image).
      await expect.poll(() => loadingGroup.locator(".attachment-gallery-image").evaluateAll(images =>
        images.length === 5 && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
      await frames(page, 20);
      const stopped = await endProbe(page, info, "stopped");
      const first = stopped.frames[0];
      expect(Math.max(...stopped.frames.map(frame => Math.abs(frame.top - first.top))), "Peak shift, including transient up-and-back movement").toBeLessThanOrEqual(2);
      expect(Math.abs(stopped.frames.at(-1)!.top - first.top)).toBeLessThanOrEqual(1);
      for (const frame of stopped.frames) {
        if (frame.cells.length !== first.cells.length) continue; // virtual mount count is separately recorded
        for (let index = 0; index < frame.cells.length; index++) for (let axis = 0; axis < 2; axis++)
          expect(Math.abs(frame.cells[index][axis] - first.cells[index][axis])).toBeLessThanOrEqual(1);
      }
      expect(writes, "Reading/decoding does not save a size").toBe(0);
      if (surface !== "reader") await expect(article.getByRole("button", { name: /Image display scale:/ })).toHaveCount(0);

      for (const direction of [1, -1]) {
        await startProbe(anchor);
        if (surface === "share") await page.mouse.move(width / 2, 450);
        else await root.hover();
        for (let step = 0; step < 8; step++) { await page.mouse.wheel(0, 45 * direction); await frames(page, 3); }
        await frames(page, 8);
        const moving = await endProbe(page, info, direction > 0 ? "down" : "up");
        for (let i = 1; i < moving.frames.length; i++) {
          const before = moving.frames[i - 1], after = moving.frames[i];
          // Inspect the actual DOM anchor as well as scrollTop: a legitimate
          // window trim changes both scroll coordinates and virtual geometry.
          if (after.height === before.height && after.mounted === before.mounted)
            expect((after.scroll - before.scroll) * direction).toBeGreaterThanOrEqual(-1);
          expect((after.top - before.top) * direction).toBeLessThanOrEqual(2);
        }
      }
      const more = article.locator(".attachment-gallery-more").first();
      // Establish a genuinely clickable reading position before measuring.
      // Nearest-edge scrolling can leave this tile's centre behind Share's
      // sticky header. Locator.click then retries with end alignment, which
      // scrolls the page before the Viewer even opens.
      await more.evaluate(node => node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
      await frames(page, 4);
      const clickPoint = await more.evaluate(node => {
        const box = node.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
        return { x, y, receivesPointer: node.contains(document.elementFromPoint(x, y)) };
      });
      expect(clickPoint.receivesPointer, "The real trigger must be unobscured before the stationary Viewer probe").toBe(true);
      await startProbe(more);
      const beforeViewer = await more.boundingBox();
      // A real pointer action, without a hidden framework scroll/retry in the
      // measured interval. A blocked/moved trigger fails instead of bypassing
      // hit testing with force or DOM click.
      await page.mouse.click(clickPoint.x, clickPoint.y);
      await expect(page.getByTestId("attachment-viewer-shell")).toBeVisible();
      await frames(page, 6);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("attachment-viewer-shell")).toHaveCount(0);
      await frames(page, 6);
      const viewerFrames = await endProbe(page, info, "viewer");
      expect(viewerFrames.events.some(event => event.type === "pointerdown" && event.targetsAnchor)).toBe(true);
      expect(viewerFrames.frames.some(frame => frame.viewerLocked && frame.viewerVisible)).toBe(true);
      expect(viewerFrames.frames.at(-1)!.viewerLocked).toBe(false);
      const afterViewer = await more.boundingBox();
      expect(Math.max(...viewerFrames.frames.map(frame => Math.abs(frame.top - viewerFrames.frames[0].top)))).toBeLessThanOrEqual(2);
      expect(Math.abs(afterViewer!.y - beforeViewer!.y)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: info.outputPath("reading-return.png") });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(writes).toBe(0);
    } finally {
      hold = false; release.forEach(done => done());
      await context.setOffline(false);
      await page.unrouteAll({ behavior: "wait" });
    }
  });
}

for (const surface of ["reader", "share", "offline", "compare"] as const) {
  test(`${surface}: collapsing preserves a surviving anchor, locates a hidden reading point and respects user wheel`, async ({ page, context }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const fixture = normal;
    const url = surface === "reader" ? `/conversations/${fixture.id}`
      : surface === "share" ? `/share/${fixture.token}`
        : surface === "compare" ? `/compare?left=${fixture.id}&right=${other.id}` : `/library?conversationId=${fixture.id}`;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      if (surface === "offline") {
        await page.getByRole("button", { name: "Download offline copy", exact: true }).click();
        await expectOfflineCopyReady(page, fixture);
        await page.route("**/api/attachments/**", route => route.abort());
        await context.setOffline(true);
      }
      const article = page.locator(`#message-${fixture.messageId}`).filter({ visible: true });
      const root = surface === "share" ? page.locator("html") : article.locator('xpath=ancestor::*[@data-reader-scroll-root="true"][1]');
      if (surface === "reader" || surface === "offline") await expectReaderReady(root);
      if (surface === "compare") {
        const right = page.locator(`[data-together-pane="${other.id}"] [data-reader-scroll-root="true"]`);
        await right.evaluate(node => { node.scrollTop = 240; });
      }
      const long = article.locator(`[data-attachment-id="${fixture.assets[2]}"]`).first();
      const anchor = article.locator('[data-block-type="paragraph"]').filter({ hasText: /^Reading stability anchor\./ }).first();
      await long.getByRole("button", { name: "Expand full image", exact: true }).click();
      await expect(long).toHaveAttribute("data-image-expanded", "true");
      await anchor.evaluate(node => {
        const root = node.closest<HTMLElement>('[data-reader-scroll-root="true"]');
        const delta = node.getBoundingClientRect().top - (root?.getBoundingClientRect().top ?? 0) - 120;
        if (root) root.scrollTop += delta; else window.scrollBy(0, delta);
      });
      await frames(page, 8);
      const collapse = long.getByRole("button", { name: "Collapse image", exact: true });
      // Keyboard activation can reach a surviving reading point without the
      // test framework scrolling the long image back into view first.
      await collapse.evaluate(node => node.focus({ preventScroll: true }));
      await startProbe(anchor);
      await page.keyboard.press("Space");
      await expect(long).toHaveAttribute("data-image-expanded", "false");
      await frames(page, 24);
      const preserved = await endProbe(page, info, "fold-preserved");
      expect(preserved.events.some(event => event.type === "keydown")).toBe(true);
      expect(Math.max(...preserved.frames.map(frame => Math.abs(frame.top - preserved.frames[0].top)))).toBeLessThanOrEqual(2);
      expect(Math.abs(preserved.frames.at(-1)!.top - preserved.frames[0].top)).toBeLessThanOrEqual(1);

      const prepareHiddenPoint = async () => {
        await long.getByRole("button", { name: "Expand full image", exact: true }).click();
        await expect(long).toHaveAttribute("data-image-expanded", "true");
        await collapse.evaluate(node => node.scrollIntoView({ block: "center", behavior: "instant" }));
        await frames(page, 6);
        const point = await collapse.evaluate(node => {
          const box = node.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
          return { x, y, hit: node.contains(document.elementFromPoint(x, y)) };
        });
        expect(point.hit).toBe(true);
        const relativeTop = await long.evaluate(node => node.getBoundingClientRect().top - (node.closest('[data-reader-scroll-root="true"]')?.getBoundingClientRect().top ?? 0));
        expect(relativeTop + 630).toBeLessThan(120);
        expect(relativeTop + 4000).toBeGreaterThan(120);
        return point;
      };
      let point = await prepareHiddenPoint();
      await startProbe(long);
      await page.mouse.click(point.x, point.y);
      await expect(long).toHaveAttribute("data-image-expanded", "false");
      await expect.poll(() => long.evaluate(node => Math.abs(node.getBoundingClientRect().top
        - (node.closest('[data-reader-scroll-root="true"]')?.getBoundingClientRect().top ?? 0) - 120))).toBeLessThanOrEqual(1);
      await frames(page, 24);
      const hidden = await endProbe(page, info, "fold-hidden");
      expect(hidden.events.some(event => event.type === "pointerdown" && event.targetsAnchor)).toBe(true);
      const aligned = hidden.frames.findIndex(frame => Math.abs(frame.top - 120) <= 1);
      expect(aligned).toBeGreaterThanOrEqual(0);
      for (const frame of hidden.frames.slice(aligned)) expect(Math.abs(frame.top - 120)).toBeLessThanOrEqual(2);
      expect(Math.abs(hidden.frames.at(-1)!.top - 120)).toBeLessThanOrEqual(1);

      point = await prepareHiddenPoint();
      await startProbe(long, true);
      await page.mouse.click(point.x, point.y);
      // Send real wheel immediately, not after waiting for the navigator to
      // settle. Every subsequent frame is retained to expose stale restoration.
      await page.mouse.wheel(0, 180);
      await frames(page, 30);
      const cancelled = await endProbe(page, info, "fold-cancelled");
      const wheel = cancelled.events.find(event => event.type === "wheel");
      expect(wheel).toBeTruthy();
      expect(wheel!.cancelable).toBe(true);
      expect(wheel!.trusted).toBe(true);
      const afterWheel = cancelled.frames.filter(frame => frame.time >= wheel!.time);
      expect(afterWheel.length).toBeGreaterThan(10);
      for (let i = 1; i < afterWheel.length; i++) expect(afterWheel[i].top - afterWheel[i - 1].top).toBeLessThanOrEqual(2);
      expect(afterWheel.at(-1)!.top).toBeLessThan(wheel!.top - 20);

      // Also retain the production-like passive delivery path. Its event can
      // already include compositor motion, so it checks no subsequent pullback;
      // the preceding pre-default probe independently requires real movement.
      point = await prepareHiddenPoint();
      await startProbe(long);
      await page.mouse.click(point.x, point.y);
      await page.mouse.wheel(0, 180);
      await frames(page, 30);
      const passive = await endProbe(page, info, "fold-passive");
      const passiveWheel = passive.events.find(event => event.type === "wheel");
      expect(passiveWheel?.trusted).toBe(true);
      const afterPassive = passive.frames.filter(frame => frame.time >= passiveWheel!.time);
      expect(afterPassive.length).toBeGreaterThan(10);
      for (const frame of afterPassive) expect(frame.top - passiveWheel!.top).toBeLessThanOrEqual(2);
      for (let i = 1; i < afterPassive.length; i++) expect(afterPassive[i].top - afterPassive[i - 1].top).toBeLessThanOrEqual(2);
      expect(afterPassive.at(-1)!.top - passiveWheel!.top).toBeLessThanOrEqual(1);
      for (const evidence of [preserved, hidden, cancelled, passive]) {
        for (const frame of evidence.frames) expect(frame.otherScroll).toEqual(evidence.frames[0].otherScroll);
      }
      await page.screenshot({ path: info.outputPath("long-image-collapse.png") });
    } finally { await context.setOffline(false); await page.unrouteAll({ behavior: "wait" }); }
  });
}

test("collapsed long image publishes complete pixels and its existing public URL follows saved size", async ({ page, browser }) => {
  const fixture = normal, asset = fixture.assets[2];
  await page.goto(`/conversations/${fixture.id}`);
  const long = page.locator(`#message-${fixture.messageId} [data-attachment-id="${asset}"]`).first();
  await long.scrollIntoViewIfNeeded();
  await expect(long).toHaveAttribute("data-image-expanded", "false");
  const plan = await (await page.request.get(`/api/messages/${fixture.messageId}/markdown-copy`)).json();
  const published = await page.request.post(`/api/messages/${fixture.messageId}/markdown-copy`, { data: {
    base_version_id: plan.version_id, attachment_ids: [asset],
  } });
  expect(published.ok()).toBe(true);
  const url = (await published.json()).urls[asset];
  const guest = await browser.newContext();
  try {
    const dimensions = async () => {
      const response = await guest.request.get(url);
      expect(response.status()).toBe(200); expect(response.headers()["content-type"]).toBe("image/png");
      const bytes = await response.body();
      expect(bytes.subarray(1, 4).toString()).toBe("PNG");
      return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    };
    expect(await dimensions()).toEqual([240, 4000]);
    const original = await (await page.request.get(`/api/attachments/${asset}/content`)).body();
    const current = await (await page.request.get(`/api/attachments/${asset}/image-display`)).json();
    expect((await page.request.put(`/api/attachments/${asset}/image-display`, { data: {
      source_sha256: current.source_sha256, expected_scale_percent: current.scale_percent, scale_percent: 50,
    } })).ok()).toBe(true);
    expect(await dimensions()).toEqual([120, 2000]);
    expect(await (await page.request.get(`/api/attachments/${asset}/content`)).body()).toEqual(original);
  } finally {
    const current = await (await page.request.get(`/api/attachments/${asset}/image-display`)).json();
    expect((await page.request.put(`/api/attachments/${asset}/image-display`, { data: {
      source_sha256: current.source_sha256, expected_scale_percent: current.scale_percent, scale_percent: 100,
    } })).ok()).toBe(true);
    await guest.close();
  }
});

test("Compare deep navigation leases a real virtual block; URL and opposite scroller remain independent", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/compare?left=${heavy.id}&right=${other.id}`);
  const left = page.locator(`[data-together-pane="${heavy.id}"]`);
  const right = page.locator(`[data-together-pane="${other.id}"]`);
  await expect(left.locator("article").first()).toBeVisible();
  const rightRoot = right.locator('[data-reader-scroll-root="true"]');
  await rightRoot.evaluate(node => { node.scrollTop = 240; });
  const rightTop = await rightRoot.evaluate(node => node.scrollTop);
  // Sections belong to the selected message, not implicitly to the assistant
  // when the current turn starts with a user message.
  const dialogue = left.locator("summary").filter({ hasText: "Dialogue index" });
  await dialogue.click();
  await left.getByRole("button").filter({ hasText: /Synthetic geometry/ }).click();
  await dialogue.click();
  await left.locator("summary").filter({ hasText: "Sections" }).click();
  await left.getByRole("button", { name: /Deep synthetic target/ }).click();
  const heading = left.locator('[data-block-type="heading"]').filter({ hasText: "Deep synthetic target" });
  await expect(heading).toBeVisible();
  await expect.poll(() => heading.evaluate(node => node.getBoundingClientRect().top
    - node.closest('[data-reader-scroll-root="true"]')!.getBoundingClientRect().top)).toBeLessThanOrEqual(122);
  await expect.poll(() => heading.evaluate(node => Math.abs(node.getBoundingClientRect().top
    - node.closest('[data-reader-scroll-root="true"]')!.getBoundingClientRect().top - 120))).toBeLessThanOrEqual(2);
  expect(await rightRoot.evaluate(node => node.scrollTop)).toBe(rightTop);
  await expect(page).toHaveURL(/\/read-together\?/);
  await page.getByRole("button", { name: "Open another", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Open another conversation to read together", exact: true });
  await picker.getByRole("textbox").fill("Synthetic geometry normal");
  await picker.getByRole("button", { name: /Synthetic geometry normal.*Resume/ }).click();
  await expect(page.locator(`[data-together-pane="${normal.id}"]`)).toBeVisible();
  await expect(left.locator("article").first()).toBeAttached();
  await expect(page.locator("[data-together-pane]")).toHaveCount(2);
  // A third named tab does not mount a third body; returning restores the
  // previous right pane's own captured position, not the left pane's.
  await page.getByRole("navigation", { name: "Open conversations" }).getByRole("button", { name: "Synthetic geometry independent", exact: true }).click();
  await expect(right).toBeVisible();
  await expect.poll(() => rightRoot.evaluate((node, expectedTop) => Math.abs(node.scrollTop - expectedTop), rightTop)).toBeLessThanOrEqual(1);
});

test("all group sizes preserve image pixels with natural source-order wrapping", async ({ page }, info) => {
  await page.goto(`/conversations/${normal.id}`);
  await expectReaderReady(page.getByTestId("reader-scroll-root"));
  const article = page.locator(`#message-${normal.messageId}`);
  const groups = article.locator('.attachment-image-gallery');
  await expect(groups).toHaveCount(6);
  const counts = [7, 1, 2, 3, 6, 20];
  for (const width of [375, 800, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await frames(page, 4);
    for (let index = 0; index < counts.length; index++) {
      const group = groups.nth(index);
      await group.scrollIntoViewIfNeeded();
      await expect(group.locator(".attachment-gallery-cell")).toHaveCount(counts[index] > 6 ? 5 : counts[index]);
      // Visit each real lazy image before inspecting decode, including groups
      // now taller than the viewport. Geometry is measured on img, not cells.
      for (const image of await group.locator("img").all()) {
        await image.locator('xpath=..').scrollIntoViewIfNeeded();
        await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        const measured = await image.evaluate(node => {
          const image = node as HTMLImageElement, box = image.getBoundingClientRect();
          const lane = image.closest(".attachment-image-gallery")!.getBoundingClientRect().width;
          const media = image.closest(".attachment-gallery-media")!.getBoundingClientRect();
          const savedWidth = Number(image.getAttribute("width")), savedHeight = Number(image.getAttribute("height"));
          return { width: box.width, height: box.height, expectedWidth: Math.min(savedWidth, lane),
            expectedHeight: Math.min(savedWidth, lane) * savedHeight / savedWidth, mediaHeight: media.height,
            naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
        });
        expect(Math.abs(measured.width - measured.expectedWidth)).toBeLessThanOrEqual(1);
        expect(Math.abs(measured.height - measured.expectedHeight)).toBeLessThanOrEqual(1);
        expect(measured.width).toBeLessThanOrEqual(measured.naturalWidth + 1);
        if (measured.naturalWidth === 240) { expect(measured.width).toBe(240); expect(measured.mediaHeight).toBeLessThanOrEqual(640); }
        if (measured.naturalWidth === 32) expect(measured.width).toBe(32);
      }
      const boxes = await group.locator(".attachment-gallery-cell").evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, right: box.right };
      }));
      for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i - 1].y - 1);
        if (Math.abs(boxes[i].y - boxes[i - 1].y) < 1) expect(boxes[i].x - boxes[i - 1].right).toBeCloseTo(8, 0);
      }
    }
    await groups.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`groups-${width}.png`) });
  }
});

test("removed baseline UI never creates snapshots during reading; compatibility reads remain available", async ({ page }) => {
  let writes = 0;
  page.on("request", request => { if (request.method() === "POST" && request.url().includes("/new-messages/baseline")) writes++; });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/conversations/${other.id}`);
  await expectReaderReady(page.getByTestId("reader-scroll-root"));
  await page.locator('[data-reader-header-more-actions="true"]').click();
  await expect(page.getByRole("menuitem", { name: "New messages", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Conversation lineage", exact: true })).toHaveCount(0);
  const read = await page.request.get(`/api/conversations/${other.id}/new-messages`);
  expect(read.ok()).toBe(true);
  expect(writes).toBe(0);
});

test("a hidden image target occupies a real preview slot without expanding the group", async ({ page }) => {
  const response = await page.request.get(`/api/messages/${heavy.messageId}/blocks?offset=0&limit=200`);
  expect(response.ok()).toBe(true);
  const images = (await response.json() as { block_index: number; block_type: string }[]).filter(block => block.block_type === "image");
  expect(images.length).toBeGreaterThan(7);
  const target = images[6].block_index;
  await page.goto(`/conversations/${heavy.id}?messageId=${heavy.messageId}&blockIndex=${target}`);
  const block = page.locator(`#block-${heavy.messageId}-${target}`);
  await expect(block).toBeVisible();
  await expect(page.getByTestId("reader-scroll-root")).toHaveAttribute("data-navigation-stage", "settled");
  const group = block.locator('xpath=ancestor::*[contains(@class,"attachment-image-gallery")][1]');
  await expect(group.locator(".attachment-gallery-cell")).toHaveCount(5);
  await expect(group.locator(".attachment-gallery-more")).toHaveCount(1);
});

test("explicit reading size updates online references but not an existing offline snapshot", async ({ page, context }, info) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/library?conversationId=${normal.id}`);
  await page.getByRole("button", { name: "Download offline copy", exact: true }).click();
  await expectOfflineCopyReady(page, normal);
  const snapshot = () => page.evaluate(async id => {
    const opening = indexedDB.open("chat-reader-offline-library");
    return new Promise<number>((resolve, reject) => {
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result, tx = db.transaction("attachments"), row = tx.objectStore("attachments").get(id);
        tx.oncomplete = () => { db.close(); resolve(row.result.image_display_v1.scale_percent); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, normal.assets[1]);
  expect(await snapshot()).toBe(25);
  await page.goto(`/conversations/${normal.id}`);
  await expectReaderReady(page.getByTestId("reader-scroll-root"));
  const image = page.locator(`#message-${normal.messageId} [data-attachment-id="${normal.assets[1]}"]`).first();
  await image.getByRole("button", { name: /Image display scale:/ }).click();
  await expect(page.getByRole("slider", { name: "Image display scale", exact: true })).toBeEnabled();
  await image.getByRole("button", { name: "Fit column", exact: true }).click();
  await expect(image.getByRole("status")).toHaveText("Saved");
  const selected = await (await page.request.get(`/api/attachments/${normal.assets[1]}/image-display`)).json();
  const lane = await image.evaluate(node => node.closest(".attachment-lane")!.clientWidth);
  expect(selected.width).toBeLessThanOrEqual(lane);
  expect(Math.max(1, Math.floor((1600 * (selected.scale_percent + 1) + 50) / 100))).toBeGreaterThan(lane);
  await page.goto(`/library?conversationId=${normal.id}`);
  await expect(page.locator(`#message-${normal.messageId}`)).toBeVisible();
  await expectReaderReady(page.getByTestId("reader-scroll-root"));
  expect(await snapshot(), "No silent offline mutation from an online save").toBe(25);
  await expect(page.locator(`#message-${normal.messageId} [data-attachment-id="${normal.assets[1]}"] img`).first()).toHaveAttribute("width", "400");
  // The regular revision-aware update is the only way to replace that snapshot.
  const update = page.getByRole("button", { name: "Update conversation", exact: true }).filter({ visible: true }).first();
  const expandSidebar = page.getByRole("button", { name: "Open sidebar", exact: true }).filter({ visible: true });
  await expect(update.or(expandSidebar)).toBeVisible();
  if (await expandSidebar.isVisible()) await expandSidebar.click();
  await update.click();
  await expect.poll(snapshot).toBe(selected.scale_percent);
  await expectOfflineCopyReady(page, normal);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(`#message-${normal.messageId} [data-attachment-id="${normal.assets[1]}"] img`).first()).toHaveAttribute("width", String(selected.width));
  await page.screenshot({ path: info.outputPath("updated-offline-snapshot.png") });
  await context.setOffline(false);
  // Restore only this synthetic fixture for later cases.
  expect((await page.request.put(`/api/attachments/${normal.assets[1]}/image-display`, { data: {
    source_sha256: selected.source_sha256, scale_percent: 25, expected_scale_percent: selected.scale_percent,
  } })).ok()).toBe(true);
});

test("NX-PERF-01 browser measurement: actual IndexedDB projection and worker rebuild on a small local edit", async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const measurements: { request: string; type: string; count: number; bytes: number; sent: number; completed?: number }[] = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", event => {
          const row = measurements.findLast(row => row.request === event.data.requestId);
          if (row) row.completed = performance.now();
        });
      }
      postMessage(message: { requestId: string; type: string; documents?: unknown[] }, options?: StructuredSerializeOptions | Transferable[]) {
        if (message.type === "init") measurements.push({ request: message.requestId, type: message.type,
          count: message.documents?.length ?? 0, bytes: new TextEncoder().encode(JSON.stringify(message.documents)).byteLength, sent: performance.now() });
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
    const tasks: number[] = [];
    new PerformanceObserver(list => tasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: "longtask", buffered: true });
    Object.assign(window, { searchMeasurements: measurements, searchLongTasks: tasks });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/library?conversationId=${heavy.id}&annotations=open`);
  await page.getByRole("button", { name: "Download offline copy", exact: true }).click();
  await expect(page.locator(`#message-${heavy.messageId}`)).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { searchMeasurements: { completed?: number }[] }).searchMeasurements.filter(row => row.completed).length)).toBeGreaterThan(0);
  const before = await page.evaluate(() => (window as unknown as { searchMeasurements: unknown[] }).searchMeasurements.length);
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("textbox", { name: "Notebook title", exact: true }).fill("syntheticlocaleditneedle");
  await page.getByRole("textbox", { name: "Notebook title", exact: true }).press("Tab");
  await expect.poll(() => page.evaluate(() => (window as unknown as { searchMeasurements: { completed?: number }[] }).searchMeasurements.filter(row => row.completed).length)).toBeGreaterThan(before);
  const measured = await page.evaluate(() => {
    const state = window as unknown as { searchMeasurements: { count: number; bytes: number; sent: number; completed?: number }[]; searchLongTasks: number[]; performance: Performance & { memory?: { usedJSHeapSize: number } } };
    return { rebuilds: state.searchMeasurements.map(({ count, bytes, sent, completed }) => ({ count, bytes, duration: completed ? completed - sent : null })),
      longTasks: state.searchLongTasks, heapUsed: state.performance.memory?.usedJSHeapSize ?? null };
  });
  await writeFile(info.outputPath("browser-search-resource-baseline.json"), JSON.stringify({ schema: 1, synthetic: true, fullRebuildRetained: true, ...measured }));
  for (const row of measured.rebuilds) if (row.duration !== null) expect(row.duration).toBeLessThan(10_000);
  expect(measured.rebuilds.at(-1)!.count).toBeGreaterThan(0);
});

test("scrollbar and keyboard intent retire restoration; subsequent font/lane changes keep a real text anchor", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/conversations/${normal.id}`);
  const root = page.getByTestId("reader-scroll-root");
  const article = page.locator(`#message-${normal.messageId}`);
  const anchor = article.locator('[data-block-type="paragraph"]').filter({ hasText: /^Reading stability anchor\./ }).first();
  await expectReaderReady(root);
  await anchor.scrollIntoViewIfNeeded();
  await root.evaluate(node => {
    const rect = node.getBoundingClientRect();
    node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: rect.right - 1, clientY: rect.top + 40, pointerId: 1, pointerType: "mouse" }));
    node.scrollTop += 160;
  });
  await frames(page, 4);
  const duringDrag = await root.evaluate(node => node.scrollTop);
  await root.evaluate(node => node.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, pointerType: "mouse" })));
  await frames(page, 4);
  expect(Math.abs((await root.evaluate(node => node.scrollTop)) - duringDrag)).toBeLessThanOrEqual(1);
  await root.focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => root.evaluate(node => node.scrollTop)).toBeGreaterThan(duringDrag);
  // Explicit layout changes are allowed to reflow, but cannot revive an older
  // scrollTop restoration after the new reading position is established.
  const frame = page.locator(".reader-frame").first();
  await frame.evaluate(node => node.style.setProperty("--reader-font-size", "19px"));
  await page.setViewportSize({ width: 1000, height: 900 });
  await frames(page, 8);
  await anchor.scrollIntoViewIfNeeded();
  await frames(page, 4);
  await startProbe(anchor);
  await frames(page, 20);
  const evidence = await endProbe(page, info, "post-layout");
  const first = evidence.frames[0].top;
  expect(Math.max(...evidence.frames.map(frame => Math.abs(frame.top - first)))).toBeLessThanOrEqual(2);
  expect(Math.abs(evidence.frames.at(-1)!.top - first)).toBeLessThanOrEqual(1);
});

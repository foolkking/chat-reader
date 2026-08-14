import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const enabled = process.env.E2E_READER_CAPACITY === "1";
test.skip(!enabled, "E2E_READER_CAPACITY=1 is required");
test.setTimeout(900_000);

type Tier = 398 | 1000 | 10000;
type Profile = "plain" | "math" | "mixed" | "attachment_metadata";

const tiers: Tier[] = [398, 1000, 10000];
const profiles: Profile[] = ["plain", "math", "mixed", "attachment_metadata"];

for (const profile of profiles) {
  for (const messages of tiers) {
    test(`${profile} ${messages} messages: three cold runs and warm revisit`, async ({ page, request }, testInfo) => {
      const conversationId = await seedConversation(request, messages, profile);
      await page.addInitScript(() => {
        (window as typeof window & { __chatReaderPerfProbe?: Record<string, number> }).__chatReaderPerfProbe = {};
      });
      const runs = [];
      for (let run = 0; run < 3; run += 1) {
        runs.push(await measureReader(page, conversationId, run));
      }
      const warm = await measureWarmRevisit(page, conversationId);
      const payload = { fixture: { version: "release-d-reader-capacity-v1", seed: 20260814, profile, messages }, runs, warm };
      await testInfo.attach(`reader-capacity-${profile}-${messages}.json`, {
        body: Buffer.from(JSON.stringify(payload, null, 2)),
        contentType: "application/json",
      });
      console.info(`[reader-capacity] ${JSON.stringify(payload)}`);

      for (const run of runs) {
        expect(run.scrollMonotonic).toBe(true);
        expect(run.pageHorizontalOverflow).toBe(false);
        expect(run.mountedMessagesMax, "virtualized message working set grew with the fixture").toBeLessThanOrEqual(8);
      }
      expect(warm.scrollMonotonic).toBe(true);
    });
  }
}

async function seedConversation(request: APIRequestContext, messages: number, profile: Profile): Promise<string> {
  const source = JSON.stringify({
    metadata: { title: `Release D ${profile} ${messages}`, powered_by: "ChatGPT Exporter" },
    messages: Array.from({ length: messages }, (_, index) => ({
      role: index % 2 === 0 ? "Prompt" : "Response",
      say: buildMessage(index, messages, profile),
    })),
  });
  const preview = await request.post("/api/imports/preview", {
    multipart: {
      files: {
        name: `release-d-${profile}-${messages}.json`,
        mimeType: "application/json",
        buffer: Buffer.from(source),
      },
    },
  });
  expect(preview.ok()).toBe(true);
  const importId = (await preview.json()).import_id as string;
  const commit = await request.post(`/api/imports/${importId}/commit`);
  expect(commit.ok()).toBe(true);
  const deadline = Date.now() + 900_000;
  while (Date.now() < deadline) {
    const response = await request.get(`/api/imports/${importId}/status`);
    expect(response.ok()).toBe(true);
    const status = await response.json() as { status: string; conversation_ids: string[]; error_message?: string };
    if (status.status === "committed") return status.conversation_ids[0]!;
    if (status.status === "failed") throw new Error(status.error_message ?? "capacity fixture import failed");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("capacity fixture import timed out");
}

function buildMessage(index: number, messages: number, profile: Profile): string {
  if (index % 2 === 0) return `Synthetic capacity prompt ${index} seed 20260814.`;
  if (profile === "plain") return `Synthetic capacity response ${index}.\n\nBounded paragraph for tier ${messages}.`;
  if (profile === "math") {
    return [
      `Formula ${index}: \\(x_{${index}}^2+y^2=z^2\\).`,
      String.raw`\[\begin{aligned}`,
      String.raw`a &= b+c \\`,
      String.raw`d &= \frac{\sqrt{n^6+n}}{n^3} \\`,
      String.raw`e &= \sum_{k=1}^{n} k^2`,
      String.raw`\end{aligned}\]`,
    ].join("\n\n");
  }
  if (profile === "mixed") {
    return `## Mixed section ${index}\n\nA paragraph with \\(x_{${index}}\\).\n\n| key | value |\n| --- | ---: |\n| row | 1 |\n\n\`\`\`typescript\nconst value = 1;\n\`\`\`\n\n* [ ] pending\n* [x] complete\n\nText[^1]\n\n[^1]: Synthetic footnote.`;
  }
  return `Attachment metadata row ${index}.\n\n![synthetic-${index}](attachment://synthetic-${index})\n\nThe binary payload is intentionally absent.`;
}

async function measureReader(page: Page, conversationId: string, run: number) {
  const requests = { total: 0, conversation: 0, bytes: 0 };
  const onResponse = async (response: import("@playwright/test").Response) => {
    if (!response.url().includes("/api/")) return;
    requests.total += 1;
    if (response.url().includes("/api/conversations/")) requests.conversation += 1;
    const length = Number(response.headers()["content-length"] ?? 0);
    if (Number.isFinite(length)) requests.bytes += length;
  };
  page.on("response", onResponse);
  await page.goto(`/conversations/${conversationId}`);
  const root = page.locator("[data-reader-scroll-root='true']");
  await expect(root).toBeVisible();
  await expect.poll(() => root.locator("article[data-message-id]").count(), { timeout: 120_000 }).toBeGreaterThan(0);
  const telemetry = await runWheelTelemetry(page, root);
  const probe = await page.evaluate(() => (window as typeof window & { __chatReaderPerfProbe?: Record<string, number> }).__chatReaderPerfProbe ?? {});
  page.off("response", onResponse);
  return { run, ...telemetry, ...requests, probe };
}

async function measureWarmRevisit(page: Page, conversationId: string) {
  const root = page.locator("[data-reader-scroll-root='true']");
  await root.evaluate((element) => { element.scrollTop = Math.min(element.scrollHeight, 1200); });
  await page.waitForTimeout(300);
  await root.evaluate((element) => { element.scrollTop = 0; });
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => (window as typeof window & { __chatReaderPerfProbe?: Record<string, number> }).__chatReaderPerfProbe ?? {});
  const telemetry = await runWheelTelemetry(page, root);
  const after = await page.evaluate(() => (window as typeof window & { __chatReaderPerfProbe?: Record<string, number> }).__chatReaderPerfProbe ?? {});
  return { ...telemetry, parseDelta: (after.markdownRenderTotal ?? 0) - (before.markdownRenderTotal ?? 0), probe: after, conversationId };
}

async function runWheelTelemetry(page: Page, root: ReturnType<Page["locator"]>) {
  await page.evaluate(() => {
    const state = { frames: [] as number[], longTasks: [] as number[], lastFrame: 0, startedAt: performance.now() };
    (window as typeof window & { __capacityTelemetry?: typeof state }).__capacityTelemetry = state;
    const frame = (time: number) => {
      if (state.lastFrame) state.frames.push(time - state.lastFrame);
      state.lastFrame = time;
      if (state.frames.length < 420) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (entry.startTime >= state.startedAt) state.longTasks.push(entry.duration);
      });
      observer.observe({ type: "longtask" });
    }
  });
  const samples: number[] = [];
  let mountedMessagesMax = 0;
  let mountedBlocksMax = 0;
  for (let step = 0; step < 30; step += 1) {
    await root.hover();
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(34);
    const sample = await root.evaluate((element) => ({
      scrollTop: element.scrollTop,
      messages: element.querySelectorAll("article[data-message-id]").length,
      blocks: element.querySelectorAll("[data-block-index]").length,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    }));
    samples.push(sample.scrollTop);
    mountedMessagesMax = Math.max(mountedMessagesMax, sample.messages);
    mountedBlocksMax = Math.max(mountedBlocksMax, sample.blocks);
    if (sample.horizontalOverflow) throw new Error("page-level horizontal overflow during capacity run");
  }
  const value = await page.evaluate(() => (window as typeof window & { __capacityTelemetry?: { frames: number[]; longTasks: number[] } }).__capacityTelemetry ?? { frames: [], longTasks: [] });
  const frames = value.frames.filter((item) => item < 1000).sort((left, right) => left - right);
  return {
    mountedMessagesMax,
    mountedBlocksMax,
    scrollMonotonic: samples.every((value, index) => index === 0 || value + 2 >= samples[index - 1]!),
    scrollSamples: samples,
    pageHorizontalOverflow: false,
    p95FrameInterval: frames[Math.max(0, Math.ceil(frames.length * 0.95) - 1)] ?? null,
    longestTask: value.longTasks.length ? Math.max(...value.longTasks) : 0,
    longTaskTotal: value.longTasks.reduce((sum, item) => sum + item, 0),
  };
}

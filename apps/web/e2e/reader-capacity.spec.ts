import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const enabled = process.env.E2E_READER_CAPACITY === "1";
// Explicit diagnostic workflow only. Profiling changes scheduling; these
// measurements never replace the unchanged unprofiled release gate.
const diagnostic = process.env.E2E_READER_CAPACITY_PROFILE === "1";
test.skip(!enabled, "E2E_READER_CAPACITY=1 is required");
test.setTimeout(900_000);
// DOM snapshots/screencasts at every Playwright action are a diagnostic
// workload, not Reader frame timing. Correctness gates retain their traces.
test.use({ trace: "off" });

type Tier = 398 | 1000 | 10000;
type Profile = "plain" | "math" | "mixed";

type CapacityScrollSample = {
  at: number;
  scrollTop: number;
  scrollHeight: number;
  mountedMessages: number;
  mountedBlocks: number;
  visibleAnchors: Array<{ key: string; top: number; bottom: number }>;
  anchorKey: string | null;
  anchorBeforeTop: number | null;
  anchorAfterTop: number | null;
  forwardPx: number | null;
  status: "initial" | "measured" | "unknown";
  unknownReason: "invalid-root" | "no-visible-anchor" | "no-shared-real-anchor" | null;
};

type CapacityTelemetryState = {
  frames: number[];
  longTasks: number[];
  longTaskSpans: Array<{ startTime: number; duration: number }>;
  longTaskObserverSupported: boolean;
  longAnimationFrameObserverSupported: boolean;
  longAnimationFrames: Array<{
    startTime: number;
    duration: number;
    blockingDuration: number | null;
    renderStart: number | null;
    styleAndLayoutStart: number | null;
    scripts: Array<{
      startTime: number;
      duration: number;
      executionStart: number | null;
      forcedStyleAndLayoutDuration: number | null;
      pauseDuration: number | null;
      invokerType: string | null;
      sourcePath: string | null;
      sourceFunctionName: string | null;
      sourceCharPosition: number | null;
    }>;
  }>;
  includeTiming: boolean;
  startedAt: number;
  frameId: number;
  observer: PerformanceObserver | null;
  animationFrameObserver: PerformanceObserver | null;
  collectAnimationFrames: (entries: PerformanceEntry[]) => void;
  initialScroll: CapacityScrollSample;
  scrollFrames: CapacityScrollSample[];
  scrollWheelSamples: CapacityScrollSample[];
  captureWheel: () => CapacityScrollSample;
};

const tiers: Tier[] = [398, 1000, 10000];
const profiles: Profile[] = ["plain", "math", "mixed"];

for (const profile of profiles) {
  for (const messages of tiers) {
    test(`${profile} ${messages} messages: three cold runs and warm revisit`, async ({ page, request }, testInfo) => {
      const conversationId = await seedConversation(request, messages, profile);
      await page.addInitScript(() => {
        (window as typeof window & { __chatReaderPerfProbe?: Record<string, number> }).__chatReaderPerfProbe = {};
      });
      const runs = [];
      for (let run = 0; run < 3; run += 1) {
        runs.push(await measureReader(page, conversationId, run, diagnostic
          ? testInfo.outputPath(`reader-cpu-${profile}-${messages}-${run}.json`) : undefined));
      }
      const warm = await measureWarmRevisit(page, conversationId);
      const payload = {
        fixture: { version: "release-d-reader-capacity-v1", seed: 20260814, profile, messages },
        measurement: { version: 4, trace: false, wheelSteps: 30, wheelDelta: 120, sampleDelayMs: 34,
          scrollDirection: "shared-real-dom-anchor", reverseTolerancePx: 2, diagnosticOnly: diagnostic },
        runs, warm,
      };
      // The list/gate reporters do not materialize body-only attachments.
      // Persist the unfiltered runs in the uploaded output directory too.
      const measurementName = `reader-capacity-${profile}-${messages}.json`;
      const measurementPath = testInfo.outputPath(measurementName);
      await mkdir(dirname(measurementPath), { recursive: true });
      await writeFile(measurementPath, JSON.stringify(payload, null, 2));
      await testInfo.attach(measurementName, {
        path: measurementPath,
        contentType: "application/json",
      });
      console.info(`[reader-capacity] ${JSON.stringify(payload)}`);

      for (const run of runs) {
        expect(run.scrollMonotonic).toBe(true);
        expect(run.pageHorizontalOverflow).toBe(false);
        expect(run.longTaskObserverSupported, `cold run ${run.run}: missing long-task evidence`).toBe(true);
        // The historical far-target fixture retains its stricter <=6 settled
        // budget. Default first-window capacity is a separate bounded workload.
        expect(run.mountedMessagesMax, "virtualized message working set grew with the fixture").toBeLessThanOrEqual(40);
        expect(run.mountedBlocksMax, "virtual block working set grew without bound").toBeLessThanOrEqual(120);
        expect(run.p95FrameInterval).not.toBeNull();
        expect(run.p95FrameInterval!).toBeLessThanOrEqual(34);
        expect(run.longestTask, `cold run ${run.run}: longest task, spans=${JSON.stringify(run.longTaskSpans)}`).toBeLessThanOrEqual(150);
        expect(run.longTaskTotal, `cold run ${run.run}: total long tasks`).toBeLessThanOrEqual(250);
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
  return commitImport(request, importId);
}

async function commitImport(request: APIRequestContext, importId: string): Promise<string> {
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
  return `Synthetic capacity response ${index}.`;
}

async function measureReader(page: Page, conversationId: string, run: number, profilePath?: string) {
  const requests = { total: 0, conversation: 0, dialogueIndex: 0, bytes: 0 };
  const onResponse = async (response: import("@playwright/test").Response) => {
    if (!response.url().includes("/api/")) return;
    requests.total += 1;
    if (response.url().includes("/api/conversations/")) requests.conversation += 1;
    if (response.url().includes("/dialogue-index?")) requests.dialogueIndex += 1;
    const length = Number(response.headers()["content-length"] ?? 0);
    if (Number.isFinite(length)) requests.bytes += length;
  };
  page.on("response", onResponse);
  const readingPositionRead = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/conversations/${conversationId}/reading-position`
      && response.request().method() === "GET";
  }, { timeout: 120_000 });
  const navigationStartedAt = Date.now();
  await page.goto(`/conversations/${conversationId}`);
  const root = page.locator("[data-reader-scroll-root='true']");
  await expect(root).toBeVisible();
  await expect.poll(() => root.locator("article[data-message-id]").count(), { timeout: 120_000 }).toBeGreaterThan(0);
  const navigationElapsedMs = Date.now() - navigationStartedAt;
  const positionPayload = await (await readingPositionRead).json() as { position?: unknown | null };
  const restoredReadingPosition = positionPayload.position != null;
  if (restoredReadingPosition) {
    // Each cold pass uses the same synthetic conversation. Real wheel input
    // persists its last position, so the next page load must finish restoring
    // that saved anchor before the benchmark deliberately resets to the top.
    // Otherwise a late, legitimate restore is miscounted as the user's wheel
    // moving backwards.
    await expect(root).toHaveAttribute("data-navigation-stage", /^(settled|settled:fallback)$/, { timeout: 120_000 });
  }
  await root.evaluate((element) => { element.scrollTop = 0; });
  await page.waitForTimeout(150);
  const cdp = profilePath ? await page.context().newCDPSession(page) : null;
  if (cdp) {
    await cdp.send("Profiler.enable");
    await cdp.send("Performance.enable");
    await cdp.send("Profiler.start");
  }
  const metricsBefore = cdp ? await cdp.send("Performance.getMetrics") : null;
  const pageClockBefore = cdp ? await page.evaluate(() => performance.now()) : null;
  let telemetry: Awaited<ReturnType<typeof runWheelTelemetry>>;
  try {
    telemetry = await runWheelTelemetry(page, root, 30, Boolean(cdp));
  } finally {
    if (cdp && profilePath) {
      const metricsAfter = await cdp.send("Performance.getMetrics");
      const profile = await cdp.send("Profiler.stop");
      await mkdir(dirname(profilePath), { recursive: true });
      await writeFile(profilePath, JSON.stringify({ diagnosticOnly: true, pageClockBefore, metricsBefore, metricsAfter, profile: profile.profile }));
      await cdp.detach();
    }
  }
  const probe = await page.evaluate(() => (window as typeof window & { __chatReaderPerfProbe?: Record<string, number> }).__chatReaderPerfProbe ?? {});
  page.off("response", onResponse);
  return { run, navigationElapsedMs, restoredReadingPosition, ...telemetry, ...requests, probe };
}

async function measureWarmRevisit(page: Page, conversationId: string) {
  const root = page.locator("[data-reader-scroll-root='true']");
  await root.evaluate((element) => { element.scrollTop = Math.min(element.scrollHeight, 1200); });
  await page.waitForTimeout(300);
  await waitForReaderEdgeIdle(root);
  await root.evaluate((element) => { element.scrollTop = 0; });
  await page.waitForTimeout(300);
  await waitForReaderEdgeIdle(root);
  const before = await page.evaluate(() => (window as typeof window & { __chatReaderPerfProbe?: Record<string, number> }).__chatReaderPerfProbe ?? {});
  const telemetry = await runWheelTelemetry(page, root, 12);
  const after = await page.evaluate(() => (window as typeof window & { __chatReaderPerfProbe?: Record<string, number> }).__chatReaderPerfProbe ?? {});
  // Older baselines have render probes only. Missing actual parser evidence
  // is unknown, not zero and not interchangeable with component renders.
  const parseDelta = typeof before.markdownParseTotal === "number" && typeof after.markdownParseTotal === "number"
    ? after.markdownParseTotal - before.markdownParseTotal : null;
  const renderDelta = typeof before.markdownRenderTotal === "number" && typeof after.markdownRenderTotal === "number"
    ? after.markdownRenderTotal - before.markdownRenderTotal : null;
  return { ...telemetry, parseDelta, renderDelta, probe: after, conversationId };
}

async function runWheelTelemetry(page: Page, root: ReturnType<Page["locator"]>, steps = 30, includeTiming = false) {
  // Move once, before the timed window. Repeated hover actions wait for
  // stability and capture diagnostic snapshots between every wheel event.
  await root.hover();
  await root.evaluate((element, includeTiming) => {
    const startedAt = performance.now();
    type Anchor = { node: HTMLElement; key: string; top: number; bottom: number; block: boolean };
    type Snapshot = { sample: CapacityScrollSample; anchors: Anchor[] };
    const keyFor = (node: HTMLElement) => {
      const article = node.closest<HTMLElement>("article[data-message-id]");
      if (!article?.dataset.messageId) return null;
      const message = `${article.dataset.messageId}:${article.dataset.messageVersionId ?? ""}`;
      return node.dataset.blockIndex !== undefined
        ? `block:${message}:${node.dataset.blockIndex}:${node.dataset.blockId ?? node.id}`
        : `message:${message}`;
    };
    const readScroll = (previous: Snapshot | null): Snapshot => {
      const bounds = element.getBoundingClientRect();
      const anchors: Anchor[] = [];
      let mountedMessages = 0, mountedBlocks = 0;
      for (const node of element.querySelectorAll<HTMLElement>("article[data-message-id], [data-block-index]")) {
        if (node.dataset.blockIndex !== undefined) mountedBlocks++;
        else mountedMessages++;
        const key = keyFor(node), rect = node.getBoundingClientRect();
        if (key && node.isConnected && Number.isFinite(rect.top) && Number.isFinite(rect.bottom)
          && rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom) {
          anchors.push({ node, key, top: rect.top - bounds.top, bottom: rect.bottom - bounds.top,
            block: node.dataset.blockIndex !== undefined });
        }
      }
      // Rank by the previous reading line, never by a favourable current delta.
      // Retain only actual DOM references; looking up the same ID after remount
      // or using scrollHeight/edge flags to invent an offset is not evidence.
      const distance = (anchor: Anchor) => anchor.top <= 120 && anchor.bottom >= 120
        ? 0 : Math.min(Math.abs(anchor.top - 120), Math.abs(anchor.bottom - 120));
      const candidates = [...(previous?.anchors ?? [])].sort((left, right) =>
        distance(left) - distance(right) || Number(right.block) - Number(left.block));
      let shared: Anchor | null = null, afterTop: number | null = null;
      for (const candidate of candidates) {
        if (!candidate.node.isConnected || !element.contains(candidate.node) || keyFor(candidate.node) !== candidate.key) continue;
        const rect = candidate.node.getBoundingClientRect();
        if (rect.height <= 0 || !Number.isFinite(rect.top)) continue;
        shared = candidate;
        afterTop = rect.top - bounds.top;
        break;
      }
      const validRoot = element.isConnected && bounds.height > 0 && Number.isFinite(element.scrollTop)
        && Number.isFinite(element.scrollHeight);
      const measured = Boolean(validRoot && anchors.length && shared && afterTop !== null);
      return {
        anchors,
        sample: {
          at: performance.now(), scrollTop: element.scrollTop, scrollHeight: element.scrollHeight,
          mountedMessages, mountedBlocks,
          visibleAnchors: anchors.map(({ key, top, bottom }) => ({ key, top, bottom })),
          anchorKey: shared?.key ?? null, anchorBeforeTop: shared?.top ?? null, anchorAfterTop: afterTop,
          forwardPx: measured ? shared!.top - afterTop! : null,
          status: !previous && validRoot && anchors.length ? "initial" : measured ? "measured" : "unknown",
          unknownReason: !validRoot ? "invalid-root" : !anchors.length ? "no-visible-anchor"
            : previous && !measured ? "no-shared-real-anchor" : null,
        },
      };
    };
    const initial = readScroll(null);
    let framePrevious = initial, wheelPrevious = initial;
    const supported = PerformanceObserver.supportedEntryTypes;
    const state: CapacityTelemetryState & { lastFrame: number } = {
      frames: [] as number[], longTasks: [] as number[], lastFrame: 0,
      longTaskSpans: [] as Array<{ startTime: number; duration: number }>, includeTiming,
      longTaskObserverSupported: supported.includes("longtask"),
      longAnimationFrameObserverSupported: supported.includes("long-animation-frame"),
      longAnimationFrames: [],
      startedAt, frameId: 0, observer: null as PerformanceObserver | null,
      animationFrameObserver: null as PerformanceObserver | null,
      collectAnimationFrames: () => {},
      initialScroll: initial.sample, scrollFrames: [] as CapacityScrollSample[], scrollWheelSamples: [] as CapacityScrollSample[],
      captureWheel: () => {
        const next = readScroll(wheelPrevious);
        wheelPrevious = next;
        state.scrollWheelSamples.push(next.sample);
        return next.sample;
      },
    };
    (window as typeof window & { __capacityTelemetry?: CapacityTelemetryState }).__capacityTelemetry = state;
    const frame = (time: number) => {
      if (state.lastFrame) state.frames.push(time - state.lastFrame);
      state.lastFrame = time;
      const next = readScroll(framePrevious);
      framePrevious = next;
      state.scrollFrames.push(next.sample);
      state.frameId = requestAnimationFrame(frame);
    };
    state.frameId = requestAnimationFrame(frame);
    if (state.longTaskObserverSupported) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (entry.startTime >= state.startedAt) {
          state.longTasks.push(entry.duration);
          // Native timestamps are cheap evidence, not a CPU profiler. Retain
          // them in ordinary failures too; a max duration alone cannot locate
          // the frame or tell application work from native/browser scheduling.
          state.longTaskSpans.push({ startTime: entry.startTime, duration: entry.duration });
        }
      });
      observer.observe({ type: "longtask" });
      state.observer = observer;
    }
    if (state.longAnimationFrameObserverSupported) {
      const numberOrUnknown = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
      const projectFrame = (entry: PerformanceEntry) => {
        const frame = entry as PerformanceEntry & {
          blockingDuration?: number; renderStart?: number; styleAndLayoutStart?: number;
          scripts?: Array<PerformanceEntry & {
            executionStart?: number; forcedStyleAndLayoutDuration?: number; pauseDuration?: number;
            invokerType?: string; sourceURL?: string; sourceFunctionName?: string; sourceCharPosition?: number;
          }>;
        };
        return {
          startTime: frame.startTime, duration: frame.duration,
          blockingDuration: numberOrUnknown(frame.blockingDuration),
          renderStart: numberOrUnknown(frame.renderStart),
          styleAndLayoutStart: numberOrUnknown(frame.styleAndLayoutStart),
          scripts: (frame.scripts ?? []).map((script) => {
            // Never persist arbitrary URLs, query strings, inline script text
            // or event/container identifiers. Only our static script path and
            // an identifier-shaped function name can identify the code.
            let sourcePath: string | null = null;
            try {
              const source = new URL(script.sourceURL ?? "", window.location.href);
              if (source.origin === window.location.origin && /^\/_next\/static\/[A-Za-z0-9_./-]+\.js$/.test(source.pathname)) {
                sourcePath = source.pathname;
              }
            } catch { /* Missing or opaque native attribution stays unknown. */ }
            const functionName = script.sourceFunctionName ?? "";
            return {
              startTime: script.startTime, duration: script.duration,
              executionStart: numberOrUnknown(script.executionStart),
              forcedStyleAndLayoutDuration: numberOrUnknown(script.forcedStyleAndLayoutDuration),
              pauseDuration: numberOrUnknown(script.pauseDuration),
              invokerType: ["user-callback", "event-listener", "resolve-promise", "reject-promise", "classic-script", "module-script"]
                .includes(script.invokerType ?? "") ? script.invokerType! : null,
              sourcePath,
              sourceFunctionName: functionName.length <= 120 && /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(functionName) ? functionName : null,
              sourceCharPosition: numberOrUnknown(script.sourceCharPosition),
            };
          }),
        };
      };
      state.collectAnimationFrames = (entries) => {
        for (const entry of entries) if (entry.startTime >= state.startedAt) {
          state.longAnimationFrames.push(projectFrame(entry));
        }
      };
      const observer = new PerformanceObserver((list) => state.collectAnimationFrames(list.getEntries()));
      observer.observe({ type: "long-animation-frame" });
      state.animationFrameObserver = observer;
    }
  }, includeTiming);
  const samples: number[] = [];
  const scrollReversals: Array<{
    step: number;
    from: number;
    to: number;
    scrollHeight: number;
    edgeStage: string | null;
    navigationStage: string | null;
    layoutCompensating: boolean;
    surfaceCompensating: boolean;
    visibleMessageId: string | null;
    visibleMessageTop: number | null;
  }> = [];
  let mountedMessagesMax = 0;
  let mountedBlocksMax = 0;
  for (let step = 0; step < steps; step += 1) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(34);
    const sample = await root.evaluate((element) => {
      const state = (window as typeof window & { __capacityTelemetry?: CapacityTelemetryState }).__capacityTelemetry;
      if (!state) throw new Error("Capacity telemetry was not installed");
      const scroll = state.captureWheel();
      return {
        scrollTop: scroll.scrollTop,
        scrollHeight: scroll.scrollHeight,
        messages: element.querySelectorAll("article[data-message-id]").length,
        blocks: element.querySelectorAll("[data-block-index]").length,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        edgeStage: element.dataset.readerEdgeStage ?? null,
        navigationStage: element.dataset.navigationStage ?? null,
        layoutCompensating: element.dataset.readerLayoutCompensating === "true",
        surfaceCompensating: element.dataset.readerSurfaceCompensating === "true",
        visibleMessage: (() => {
          const rootRect = element.getBoundingClientRect();
          const article = Array.from(element.querySelectorAll<HTMLElement>("article[data-message-id]")).find((candidate) => {
            const rect = candidate.getBoundingClientRect();
            return rect.bottom > rootRect.top && rect.top < rootRect.bottom;
          });
          return {
            id: article?.dataset.messageId ?? null,
            top: article ? Math.round(article.getBoundingClientRect().top - rootRect.top) : null,
          };
        })(),
      };
    });
    if (samples.length && sample.scrollTop + 2 < samples[samples.length - 1]!) {
      scrollReversals.push({
        step,
        from: samples[samples.length - 1]!,
        to: sample.scrollTop,
        scrollHeight: sample.scrollHeight,
        edgeStage: sample.edgeStage,
        navigationStage: sample.navigationStage,
        layoutCompensating: sample.layoutCompensating,
        surfaceCompensating: sample.surfaceCompensating,
        visibleMessageId: sample.visibleMessage.id,
        visibleMessageTop: sample.visibleMessage.top,
      });
    }
    samples.push(sample.scrollTop);
    mountedMessagesMax = Math.max(mountedMessagesMax, sample.messages);
    mountedBlocksMax = Math.max(mountedBlocksMax, sample.blocks);
    if (sample.horizontalOverflow) throw new Error("page-level horizontal overflow during capacity run");
  }
  const value = await page.evaluate(() => {
    const state = (window as typeof window & { __capacityTelemetry?: CapacityTelemetryState }).__capacityTelemetry;
    if (!state) throw new Error("Capacity telemetry was not installed");
    cancelAnimationFrame(state.frameId);
    for (const entry of state.observer?.takeRecords() ?? []) {
      if (entry.startTime >= state.startedAt) {
        state.longTasks.push(entry.duration);
        state.longTaskSpans.push({ startTime: entry.startTime, duration: entry.duration });
      }
    }
    state.observer?.disconnect();
    state.collectAnimationFrames(state.animationFrameObserver?.takeRecords() ?? []);
    state.animationFrameObserver?.disconnect();
    return { frames: state.frames, longTasks: state.longTasks, durationMs: performance.now() - state.startedAt,
      longTaskSpans: state.longTaskSpans, longTaskObserverSupported: state.longTaskObserverSupported,
      longAnimationFrameDiagnostics: { supported: state.longAnimationFrameObserverSupported, frames: state.longAnimationFrames },
      initialScroll: state.initialScroll, scrollFrames: state.scrollFrames, scrollWheelSamples: state.scrollWheelSamples,
      ...(state.includeTiming ? { diagnosticTiming: { startedAt: state.startedAt, longTaskSpans: state.longTaskSpans } } : {}) };
  });
  const memory = await page.evaluate(() => {
    const performanceWithMemory = performance as Performance & { memory?: { usedJSHeapSize?: number } };
    return {
      domNodeCount: document.getElementsByTagName("*").length,
      usedJSHeapBytes: performanceWithMemory.memory?.usedJSHeapSize ?? null,
    };
  });
  // A >=1s freeze is a failure, not a frame to silently discard.
  const frames = [...value.frames].sort((left, right) => left - right);
  const directionTrace = [
    { phase: "initial", index: 0, sample: value.initialScroll },
    ...value.scrollFrames.map((sample, index) => ({ phase: "frame", index, sample })),
    ...value.scrollWheelSamples.map((sample, index) => ({ phase: "wheel", index, sample })),
  ];
  const scrollUnknowns = directionTrace.flatMap(({ phase, index, sample }) =>
    sample.status === "unknown" ? [{ phase, index, ...sample }] : []);
  const physicalScrollReversals = directionTrace.flatMap(({ phase, index, sample }) =>
    sample.forwardPx !== null && sample.forwardPx < -2 ? [{ phase, index, ...sample }] : []);
  const scrollEvidenceComplete = scrollUnknowns.length === 0 && value.scrollFrames.length > 0
    && value.scrollWheelSamples.length === steps;
  return {
    durationMs: value.durationMs,
    frameCount: frames.length,
    mountedMessagesMax,
    mountedBlocksMax,
    scrollMonotonic: scrollEvidenceComplete && physicalScrollReversals.length === 0,
    scrollEvidenceComplete,
    rawScrollMonotonic: samples.every((value, index) => index === 0 || value + 2 >= samples[index - 1]!),
    scrollSamples: samples,
    scrollReversals,
    initialScroll: value.initialScroll,
    scrollFrames: value.scrollFrames,
    scrollWheelSamples: value.scrollWheelSamples,
    physicalScrollReversals,
    scrollUnknowns,
    pageHorizontalOverflow: false,
    frameIntervals: value.frames,
    longTasks: value.longTasks,
    longTaskSpans: value.longTaskSpans,
    longTaskObserverSupported: value.longTaskObserverSupported,
    longAnimationFrameDiagnostics: value.longAnimationFrameDiagnostics,
    p95FrameInterval: frames[Math.max(0, Math.ceil(frames.length * 0.95) - 1)] ?? null,
    longestTask: value.longTasks.length ? Math.max(...value.longTasks) : 0,
    longTaskTotal: value.longTasks.reduce((sum, item) => sum + item, 0),
    ...(value.diagnosticTiming ? { diagnosticTiming: value.diagnosticTiming } : {}),
    ...memory,
  };
}

async function waitForReaderEdgeIdle(root: ReturnType<Page["locator"]>): Promise<void> {
  await expect.poll(async () => {
    const stage = await root.getAttribute("data-reader-edge-stage");
    return stage === null || /:(settled|failed|cancelled|mount-cancelled)(?::|$)/.test(stage);
  }, { timeout: 120_000 }).toBe(true);
}

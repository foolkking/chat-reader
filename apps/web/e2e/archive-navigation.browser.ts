import { expect, test, type Page } from "@playwright/test";
import type { ConversationCreateResponse, ProjectRead, UserPreferenceRead } from "../lib/types";

// Separate inventory/report: do not change the fixed reading-stability or
// recovery matrices. Only synthetic records on the isolated mutation fixture.
if (process.env.E2E_ARCHIVE_NAVIGATION !== "1") {
  throw new Error("Archive navigation requires its explicit isolated fixture");
}
test.use({ serviceWorkers: "block", extraHTTPHeaders: {
  Origin: new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3107").origin,
} });

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function createArchivedConversation(page: Page, title: string) {
  const response = await page.request.post("/api/conversations", { data: {
    title, messages: [
      { role: "user", content_markdown: `${title}: synthetic navigation question` },
      { role: "assistant", content_markdown: "Synthetic navigation answer.\n\nThe native link must open this real Reader." },
    ],
  } });
  expect(response.status()).toBe(201);
  const created = await response.json() as ConversationCreateResponse;
  expect((await page.request.patch(`/api/conversations/${created.conversation.id}`, { data: { status: "archived" } })).status()).toBe(200);
  return created;
}

async function controlPreferences(page: Page, held = gate(), late = false) {
  let received = false;
  if (!late) held.release();
  await page.route(url => url.pathname === "/api/preferences", async route => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const prefs = await response.json() as UserPreferenceRead;
    received = true;
    await held.promise;
    // Deliver real server data with controlled preferences, without altering
    // the account. Dark is an observable marker of the same late sort update.
    await route.fulfill({ response, json: { ...prefs, locale_mode: "en-US",
      theme_mode: late ? "dark" : "light",
      project_sort_mode: "custom", project_sort_direction: "asc",
      navigation_sort: { ...prefs.navigation_sort,
        all: { mode: late ? "recent_read" : "content_updated", direction: "desc" },
      },
    } });
  });
  return { received: () => received, release: held.release };
}

async function observeNativePress(page: Page, path: string) {
  return page.evaluate(path => {
    const anchor = document.querySelector<HTMLAnchorElement>(`a[href="${path}"]`);
    if (!anchor) throw new Error("Synthetic conversation link not mounted");
    const events: { type: string; trusted: boolean; targetIsLink: boolean }[] = [];
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      document.addEventListener(type, event => {
        const target = event.target as Element | null;
        events.push({ type, trusted: event.isTrusted, targetIsLink: target?.closest("a") === anchor });
      }, true);
    }
    const w = window as typeof window & { archiveNavigationProbe?: () => unknown };
    w.archiveNavigationProbe = () => ({ events,
      connected: anchor.isConnected, sameNode: anchor === document.querySelector(`a[href="${path}"]`),
      rect: anchor.getBoundingClientRect().toJSON(), path: location.pathname,
    });
    return { rect: anchor.getBoundingClientRect().toJSON(), timeOrigin: performance.timeOrigin };
  }, path);
}

async function readProbe(page: Page) {
  return page.evaluate(() => (window as typeof window & { archiveNavigationProbe: () => {
    events: { type: string; trusted: boolean; targetIsLink: boolean }[];
    connected: boolean; sameNode: boolean; rect: { x: number; y: number; width: number; height: number }; path: string;
  } }).archiveNavigationProbe());
}

async function twoFrames(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

for (const width of [375, 1280]) test.describe(`${width}px archive navigation`, () => {
  test.use({ viewport: { width, height: 820 }, isMobile: width === 375, hasTouch: width === 375 });

  for (const outcome of ["empty", "nonempty", "error"] as const) test(`late ${outcome} projects cannot move an active conversation press`, async ({ page }, info) => {
    const created = await createArchivedConversation(page, `Synthetic late ${outcome} projects ${width}`);
    const apiPath = `/api/conversations/${created.conversation.id}`, path = apiPath.replace("/api", "");
    const projectGate = gate();
    let project: ProjectRead | null = null, projectReceived = false;
    try {
      if (outcome === "nonempty") {
        const response = await page.request.post("/api/projects", { data: { name: `Synthetic late archived project ${width}` } });
        expect(response.status()).toBe(201);
        project = await response.json() as ProjectRead;
        expect((await page.request.patch(`/api/projects/${project.id}`, { data: { is_archived: true } })).ok()).toBe(true);
      }
      const prefs = await controlPreferences(page);
      await page.route(url => url.pathname === "/api/projects" && url.searchParams.get("include_archived") === "true", async route => {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        const rows = await response.json() as ProjectRead[];
        projectReceived = true;
        await projectGate.promise;
        if (outcome === "error") return route.fulfill({ status: 503, json: { detail: "Synthetic archived project outage" } });
        const selected = project ? rows.filter(row => row.id === project!.id) : [];
        if (project) expect(selected).toHaveLength(1);
        await route.fulfill({ response, json: selected });
      });
      await page.goto("/archived");
      const link = page.locator(`a[href="${path}"]:visible`).first();
      await expect(link).toBeVisible();
      await expect.poll(prefs.received).toBe(true);
      await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
      await expect.poll(() => projectReceived).toBe(true);
      await link.hover();
      const before = await observeNativePress(page, path);
      await page.mouse.down();
      projectGate.release();
      if (outcome === "empty") await expect(page.locator("#archived-projects-heading")).toHaveCount(0);
      else if (outcome === "nonempty") await expect(page.locator("section[aria-labelledby='archived-projects-heading']").getByText(project!.name, { exact: true })).toBeVisible();
      else await expect(page.getByRole("alert").filter({ hasText: "Could not load archived projects" })).toBeVisible();
      await twoFrames(page);
      const after = await readProbe(page);
      await info.attach("project-read-during-native-press", { body: JSON.stringify({ width, outcome, before, after }), contentType: "application/json" });
      await page.screenshot({ path: info.outputPath(`${outcome}-projects-during-press.png`) });
      expect(after.connected).toBe(true); expect(after.sameNode).toBe(true);
      expect(Math.abs(after.rect.y - before.rect.y)).toBeLessThanOrEqual(1);
      await page.mouse.up();
      await expect(page.getByTestId("reader-scroll-root").locator("article[data-message-id]").first()).toBeVisible();
      await expect(page).toHaveURL(url => url.pathname === path);
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(before.timeOrigin);
      expect((await readProbe(page)).events.filter(event => event.type === "click" && event.trusted && event.targetIsLink)).toHaveLength(1);
    } finally {
      projectGate.release(); await page.mouse.up(); await page.unrouteAll({ behavior: "wait" });
      expect((await page.request.delete(apiPath)).status()).toBe(204);
      if (project) expect((await page.request.delete(`/api/projects/${project.id}`)).ok()).toBe(true);
    }
  });

  for (const action of ["pointer", "keyboard", "outside-release"] as const) test(`late preferences preserve the native link for ${action}`, async ({ page }, info) => {
    const created = await createArchivedConversation(page, `Synthetic late preference ${action} ${width}`);
    const apiPath = `/api/conversations/${created.conversation.id}`, path = apiPath.replace("/api", "");
    const held = gate();
    let lateLists = 0;
    try {
      await page.emulateMedia({ colorScheme: "light" });
      const prefs = await controlPreferences(page, held, true);
      await page.route(url => url.pathname === "/api/projects" && url.searchParams.get("include_archived") === "true",
        route => route.fulfill({ status: 200, json: [] }));
      page.on("request", request => {
        const url = new URL(request.url());
        if (url.pathname === "/api/conversations" && url.searchParams.get("scope") === "all"
          && url.searchParams.get("status_scope") === "archived" && url.searchParams.get("sort") === "recent_read") lateLists++;
      });
      await page.goto("/archived");
      const link = page.locator(`a[href="${path}"]:visible`).first();
      await expect(link).toBeVisible();
      await expect(page.locator("#archived-projects-heading")).toHaveCount(0);
      await expect.poll(prefs.received).toBe(true);
      await link.hover();
      const before = await observeNativePress(page, path);
      if (action === "keyboard") await link.focus();
      else await page.mouse.down();
      expect(lateLists).toBe(0);
      held.release();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await twoFrames(page);
      const after = await readProbe(page);
      await info.attach("preferences-during-native-interaction", { body: JSON.stringify({ width, action, before, after, lateLists }), contentType: "application/json" });
      expect(after.connected).toBe(true); expect(after.sameNode).toBe(true);
      expect(Math.abs(after.rect.y - before.rect.y)).toBeLessThanOrEqual(1);
      expect(lateLists).toBe(0);
      if (action === "outside-release") {
        await page.mouse.move(width - 3, 3); await page.mouse.up();
        await expect.poll(() => lateLists).toBeGreaterThan(0);
        await expect(page).toHaveURL(/\/archived$/);
        await expect(link).toBeVisible();
        // A cancelled press is not activation. Its later explicit click is
        // separate; the pointer and keyboard cases never click a second time.
        await link.click();
      } else if (action === "keyboard") await page.keyboard.press("Enter");
      else await page.mouse.up();
      await expect(page.getByTestId("reader-scroll-root").locator("article[data-message-id]").first()).toBeVisible();
      await expect(page).toHaveURL(url => url.pathname === path);
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(before.timeOrigin);
      if (action !== "outside-release") {
        expect((await readProbe(page)).events.filter(event => event.type === "click" && event.trusted && event.targetIsLink)).toHaveLength(1);
      }
    } finally {
      held.release(); await page.mouse.up(); await page.unrouteAll({ behavior: "wait" });
      expect((await page.request.delete(apiPath)).status()).toBe(204);
    }
  });
});

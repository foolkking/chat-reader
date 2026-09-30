import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block", locale: "en-US" });
test.skip(process.env.AUTH_ENABLED !== "true", "Run with an auth-enabled Web build.");

const userId = "00000000-0000-4000-8000-00000000000a";
const session = {
  authenticated: true, principal_id: `user:${userId}`, user_id: userId,
  inactivity_expires_at: "2099-01-01T00:00:00Z", auth_mode: "multi_account",
  email: "reader@example.test", display_name: "Test reader", role: "USER",
  registration_mode: "CLOSED", password_reset_available: false,
};
const checking = /Checking your session|正在验证登录状态/;
const unavailable = /Unable to verify your session|暂时无法验证登录状态/;
const ready = /There are no conversations here yet|这里还没有对话/;

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([
    { name: "chat_reader_session", value: "synthetic-auth-recovery-session", url: baseURL!, httpOnly: true },
    { name: "chat_reader_session_present", value: "1", url: baseURL! },
  ]);
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/auth/session") return route.fulfill({ json: session });
    if (pathname === "/api/auth/setup/status") return route.fulfill({ json: { setup_required: false, registration_mode: "CLOSED" } });
    if (pathname === "/api/preferences") return route.fulfill({ json: {
      theme_mode: "light", locale_mode: "en-US", reader_width_mode: "standard",
      reader_density_mode: "comfortable", reader_font_size_px: 17, section_toc_mode: "visible",
      conversation_sort_mode: "recent_read", conversation_sort_direction: "desc",
      project_sort_mode: "custom", project_sort_direction: "asc",
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    } });
    if (["/api/conversations", "/api/projects", "/api/recent-items", "/api/tasks/active", "/api/content-cleanup/scans/pending"].includes(pathname)) return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
});

test("a failed post-login check is recoverable without another password submission", async ({ page }) => {
  let loggedIn = false;
  let broken = false;
  let logins = 0;
  await page.route("**/api/auth/session", (route) => broken
    ? route.fulfill({ status: 503, json: { detail: "Unavailable" } })
    : route.fulfill({ json: { ...session, authenticated: loggedIn } }));
  await page.route("**/api/auth/login", (route) => {
    loggedIn = true;
    broken = true;
    logins += 1;
    return route.fulfill({ json: session });
  });
  await page.goto("/login");
  await page.locator("#login-email").fill("reader@example.test");
  await page.locator("#login-password").fill("synthetic test passphrase");
  await page.getByRole("button", { name: /Sign in|登录/, exact: true }).click();
  await expect(page.getByRole("heading", { name: unavailable })).toBeVisible();
  await expect(page.getByText(ready)).toHaveCount(0);
  broken = false;
  await page.getByRole("button", { name: /Try again|重试/ }).click();
  await expect(page.getByText(ready)).toBeVisible();
  expect(logins).toBe(1);
});

test("a stalled session request times out and can be retried", async ({ page }) => {
  await page.route("**/api/auth/session", () => undefined);
  await page.goto("/");
  await expect(page.getByText(checking)).toBeVisible();
  await expect(page.getByRole("heading", { name: unavailable })).toBeVisible({ timeout: 15_000 });
  await page.unroute("**/api/auth/session");
  await page.getByRole("button", { name: /Try again|重试/ }).click();
  await expect(page.getByText(ready)).toBeVisible();
});

test("invalid session JSON fails closed with an explicit recovery state", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: "yes" } }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: unavailable })).toBeVisible();
  await expect(page.getByText(ready)).toHaveCount(0);
});

test("unavailable IndexedDB does not prevent an authenticated online workspace", async ({ page }) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => { throw new DOMException("Storage disabled", "SecurityError"); };
  });
  await page.goto("/");
  await expect(page.getByText(ready)).toBeVisible();
});

test("a regular account cannot claim the previous owner's legacy offline storage", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("chat-reader:offline-legacy-owner-v1", "local:default");
    localStorage.setItem("chat-reader:offline-active-user-v1", "local:default");
  });
  await page.goto("/");
  await expect(page.getByText(ready)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("chat-reader:offline-legacy-owner-v1"))).toBe("local:default");
  expect(await page.evaluate(() => localStorage.getItem("chat-reader:offline-active-user-v1"))).toBe(userId);
  const identity = await page.evaluate(async () => {
    const response = await (await caches.open("chat-reader-library-meta-v1")).match("/__chat_reader_library_identity__");
    return response?.json();
  });
  expect(identity.namespace).toMatch(/^user-/);
});

test("unavailable localStorage does not prevent online login or logout", async ({ page }) => {
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem", "removeItem"] as const) {
      Storage.prototype[method] = () => { throw new DOMException("Storage disabled", "SecurityError"); };
    }
  });
  await page.goto("/");
  await expect(page.getByText(ready)).toBeVisible();
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { ...session, authenticated: false } }));
  await page.evaluate(() => window.dispatchEvent(new Event("chat-reader:auth-unauthorized")));
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
});

test("a stuck cache initialization has a bounded error and a working sign-in escape", async ({ page }) => {
  await page.addInitScript(() => {
    CacheStorage.prototype.open = () => new Promise<Cache>(() => undefined);
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Unable to open browser storage|无法打开浏览器存储/ })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: /Go to sign in|前往登录/ }).click();
  await expect(page).toHaveURL(/\/login\?reauth=1$/);
  await expect(page.locator("#login-password")).toBeVisible();
});

test("an offline lease locks immediately on expiry", async ({ page, context }) => {
  const expiry = Date.now() + 20_000;
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { ...session, inactivity_expires_at: new Date(expiry).toISOString() } }));
  await page.goto("/");
  await expect(page.getByText(ready)).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByRole("heading", { name: /Sign in required|需要重新登录/ })).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(ready)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("chat-reader:authenticated-offline-until"))).toBeNull();
});

test("logout in another tab hides an offline workspace", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByText(ready)).toBeVisible();
  const other = await context.newPage();
  await other.goto("/login?reauth=1");
  await context.setOffline(true);
  await other.evaluate(() => {
    localStorage.removeItem("chat-reader:authenticated-offline-until");
    localStorage.removeItem("chat-reader:authenticated-offline-user");
  });
  await expect(page.getByRole("heading", { name: /Sign in required|需要重新登录/ })).toBeVisible();
  await expect(page.getByText(ready)).toHaveCount(0);
});

test("leaving a pending private check cannot redirect a public page", async ({ page }) => {
  let release: (() => Promise<void>) | undefined;
  await page.route("**/api/auth/session", (route) => { release = () => route.fulfill({ json: { ...session, authenticated: false } }); });
  await page.goto("/");
  await expect(page.getByText(checking)).toBeVisible();
  await page.evaluate(() => window.history.pushState(null, "", "/share/synthetic-public-share"));
  await release?.().catch(() => undefined);
  await expect(page).toHaveURL(/\/share\/synthetic-public-share$/);
  await expect(page.getByText(checking)).toHaveCount(0);
});

for (const width of [375, 1440]) {
  test(`recovery actions are visible and keyboard accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/auth/session", (route) => route.fulfill({ status: 503, json: {} }));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: unavailable })).toBeVisible();
    const retry = page.getByRole("button", { name: /Try again|重试/ });
    await page.keyboard.press("Tab");
    await expect(retry).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/auth-recovery-${width}.png` });
  });
}

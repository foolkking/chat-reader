import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });
test.skip(process.env.AUTH_ENABLED !== "true", "Run with an auth-enabled Web build.");

const client = "gihbiofiiflkckcmomddkkjkoifkddfi";
const challenge = "A".repeat(43);
const state = "B".repeat(43);
const userId = "00000000-0000-4000-8000-00000000000a";
const session = {
  authenticated: true,
  principal_id: `user:${userId}`,
  user_id: userId,
  inactivity_expires_at: "2099-01-01T00:00:00Z",
  auth_mode: "multi_account" as const,
  email: "extension-test@example.test",
  display_name: "Synthetic reader",
  role: "USER" as const,
  registration_mode: "CLOSED" as const,
  password_reset_available: false,
};

async function openConsent(
  page: Page,
  context: BrowserContext,
  baseURL: string,
  locale: "en-US" | "zh-CN",
  authorizeStatus: number,
) {
  await context.addCookies([
    { name: "chat_reader_session", value: "synthetic-extension-session", url: baseURL, httpOnly: true },
    { name: "chat_reader_session_present", value: "1", url: baseURL },
  ]);
  await page.setExtraHTTPHeaders({ "Accept-Language": locale });
  await page.setViewportSize({ width: 375, height: 820 });
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/auth/session") return route.fulfill({ json: session });
    if (pathname === "/api/auth/setup/status") {
      return route.fulfill({ json: { setup_required: false, registration_mode: "CLOSED" } });
    }
    if (pathname === "/api/preferences") {
      return route.fulfill({ json: {
        theme_mode: "light",
        locale_mode: locale,
        reader_width_mode: "standard",
        reader_density_mode: "comfortable",
        reader_font_size_px: 17,
        section_toc_mode: "visible",
        conversation_sort_mode: "recent_read",
        conversation_sort_direction: "desc",
        project_sort_mode: "custom",
        project_sort_direction: "asc",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      } });
    }
    if (pathname === "/api/extension-devices/authorize") {
      return route.fulfill({ status: authorizeStatus, json: { detail: "Disconnect an older browser first." } });
    }
    if (pathname === "/api/offline/catalog" || pathname === "/api/tasks/active"
      || pathname === "/api/content-cleanup/scans/pending" || pathname === "/api/conversations"
      || pathname === "/api/projects" || pathname === "/api/recent-items") {
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(`${baseURL}/extension/connect/${client}/${challenge}/${state}`);
}

for (const locale of ["en-US", "zh-CN"] as const) {
  test(`${locale}: a device-limit 409 gives the user an actionable recovery path`, async ({ page, context, baseURL }) => {
    await openConsent(page, context, baseURL!, locale, 409);
    const zh = locale === "zh-CN";
    await page.getByRole("button", { name: zh ? "授权此设备" : "Authorize this device" }).click();
    const alert = page.locator("main p[role='alert']");
    await expect(alert).toContainText(zh ? "浏览器插件授权已达上限" : "The browser extension limit has been reached");
    await expect(alert).not.toContainText("Disconnect an older browser first.");

    const recovery = page.getByRole("link", { name: zh ? "打开 Reader" : "Open Reader" });
    await expect(recovery).toHaveAttribute("href", "/");
    await expect(recovery).toHaveAttribute("target", "_blank");
    const layout = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      recoveryHeight: document.querySelector<HTMLAnchorElement>('a[href="/"]')?.getBoundingClientRect().height ?? 0,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.recoveryHeight).toBeGreaterThanOrEqual(44);
  });
}

test("an unrelated authorization error keeps the existing generic message", async ({ page, context, baseURL }) => {
  await openConsent(page, context, baseURL!, "en-US", 403);
  await page.getByRole("button", { name: "Authorize this device" }).click();
  const alert = page.locator("main p[role='alert']");
  await expect(alert).toContainText("Not authorized. Verify this extension is registered");
  await expect(alert).not.toContainText(/limit|Disconnect an older browser/i);
  await expect(page.getByRole("link", { name: "Open Reader" })).toHaveCount(0);
});

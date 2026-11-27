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

for (const locale of ["en-US", "zh-CN"] as const) {
  test(`${locale}: short code requires explicit review and approval; a changed account cannot approve`, async ({ page, context, baseURL }) => {
    await openConsent(page, context, baseURL!, locale, 403);
    const zh = locale === "zh-CN";
    let approvals = 0, previews = 0, changedAccount = false;
    await page.route("**/api/auth/session", route => route.fulfill({ json: changedAccount
      ? { ...session, user_id: "00000000-0000-4000-8000-00000000000b" } : session }));
    await page.route("**/api/extension-devices", route => route.fulfill({ json: { enabled: true, items: [] } }));
    await page.route("**/api/extension-devices/pair/preview", async route => {
      previews++;
      expect(route.request().postDataJSON()).toEqual({ code: "ABCD-EFGH", expected_user_id: userId });
      await route.fulfill({ json: { device_name: "Synthetic Edge" } });
    });
    await page.route("**/api/extension-devices/pair/approve", async route => {
      approvals++;
      await route.fulfill({ json: { approved: true } });
    });
    await page.goto(`${baseURL}/extension/devices`);
    const input = page.getByLabel(zh ? "插件配对短码" : "Extension pairing code");
    await input.fill("ABCD-EFGH");
    await page.getByRole("button", { name: zh ? "核对设备" : "Review device" }).click();
    await expect(page.getByText(/Synthetic Edge/)).toBeVisible();
    await expect(page.getByText(/Synthetic reader/)).toBeVisible();
    expect(approvals).toBe(0);
    changedAccount = true;
    await page.getByRole("button", { name: zh ? "批准此设备" : "Approve this device" }).click();
    await expect(page.getByRole("status")).toContainText(zh ? "未确认授权" : "Authorization unconfirmed");
    expect(approvals).toBe(0);
    expect(previews).toBe(1);
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
      inputHeight: document.querySelector<HTMLInputElement>("#reader-device-code")!.getBoundingClientRect().height,
    }));
    expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.inputHeight).toBeGreaterThanOrEqual(44);
  });
}

test("short-code approval refreshes the device list and revocation has an explicit recovery", async ({ page, context, baseURL }) => {
  await openConsent(page, context, baseURL!, "en-US", 403);
  let granted = false, revoked = false;
  const deviceId = "00000000-0000-4000-8000-0000000000cd";
  await page.route("**/api/extension-devices", route => route.fulfill({ json: { enabled: true, items: granted && !revoked
    ? [{ id: deviceId, name: "Synthetic Edge", created_at: "2026-11-25T00:00:00Z", expires_at: "2026-12-25T00:00:00Z" }] : [] } }));
  await page.route("**/api/extension-devices/pair/preview", route => route.fulfill({ json: { device_name: "Synthetic Edge" } }));
  await page.route("**/api/extension-devices/pair/approve", async route => {
    granted = true;
    await route.fulfill({ json: { approved: true } });
  });
  await page.route(`**/api/extension-devices/${deviceId}`, async route => {
    expect(route.request().method()).toBe("DELETE");
    revoked = true;
    await route.fulfill({ status: 204 });
  });
  await page.goto(`${baseURL}/extension/devices`);
  await page.getByLabel("Extension pairing code").fill("ABCD-EFGH");
  await page.getByRole("button", { name: "Review device" }).click();
  await page.getByRole("button", { name: "Approve this device" }).click();
  await expect(page.getByRole("status")).toContainText("Approved");
  await expect(page.getByText("Synthetic Edge", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Revoke access" }).click();
  await expect(page.getByText("No authorized extensions.")).toBeVisible();
  expect(revoked).toBe(true);
});

for (const locale of ["en-US", "zh-CN"] as const) {
  test(`${locale}: creating a mapped project needs explicit same-account confirmation and returns the project to that request`, async ({ page, context, baseURL }) => {
    const zh = locale === "zh-CN";
    await openConsent(page, context, baseURL!, locale, 403);
    const device = "00000000-0000-4000-8000-00000000000d", attempt = "00000000-0000-4000-8000-0000000000aa";
    const project = "00000000-0000-4000-8000-00000000000c", name = "海洋 / Ocean & Ice";
    const path = `${baseURL}/extension/import-project#` + new URLSearchParams({ device, owner: userId, name, state: attempt });
    let requests = 0, replyStatus = 409, correctAccount = false;
    await page.route("**/api/auth/session", route => route.fulfill({ json: correctAccount ? session : { ...session, user_id: device } }));
    await page.route("**/api/extension-devices/import-project", async route => {
      requests++;
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({ name, device_id: device, expected_user_id: userId });
      await route.fulfill({ status: replyStatus, json: replyStatus === 200 ? { id: project, client } : {} });
    });
    // Don't contact the real browser identity redirect host from this synthetic Web test.
    await page.route(`https://${client}.chromiumapp.org/reader-project**`, route => route.fulfill({ contentType: "text/html", body: "<p>Callback</p>" }));
    await page.goto(path);
    await expect(page.getByText(zh ? /请在 Reader 登录插件连接的账号/ : /Sign in to Reader with the account connected/)).toBeVisible();
    const action = page.getByRole("button", { name: zh ? "确认并返回导入" : "Confirm and return to import" });
    await expect(action).toHaveCount(0);
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    correctAccount = true;
    await page.reload(); await expect(action).toBeEnabled();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    expect(requests).toBe(0);
    await action.click(); await expect(page.getByText(zh ? /名称已用于归档项目/ : /archived or default project uses this name/)).toBeVisible();
    expect(requests).toBe(1);
    replyStatus = 503; await page.reload(); await action.click();
    await expect(page.getByText(zh ? /项目可能已创建/ : /project may already exist/)).toBeVisible();
    await expect(action).toHaveCount(0);
    await expect(page.getByRole("button", { name: zh ? "关闭窗口" : "Close window" })).toBeEnabled();
    expect(requests).toBe(2);
    replyStatus = 200; await page.reload(); await action.click();
    await expect(page).toHaveURL(`https://${client}.chromiumapp.org/reader-project#state=${attempt}&project=${project}`);
    expect(requests).toBe(3);
  });
}

import { expect, type APIRequest, type APIRequestContext, type Page } from "@playwright/test";

// Only a synthetic fixture session, held in this test worker's memory. Reuse it
// across viewport cases rather than repeatedly exercising the login rate limit.
let adminState: Awaited<ReturnType<APIRequestContext["storageState"]>> | undefined;

export async function openSettingsNoiseReview(page: Page, scanId: string): Promise<void> {
  const center = page.getByTestId("task-center-panel");
  // Closing a nested review returns to its still-open Task Center.
  if (!(await center.isVisible())) {
    if ((page.viewportSize()?.width ?? 1280) < 768) {
      const header = page.getByTestId("mobile-page-header").filter({ visible: true }).last();
      const mobileSidebar = header.getByTestId("mobile-sidebar-button").filter({ visible: true });
      await expect(mobileSidebar).toBeVisible({ timeout: 15_000 });
      await mobileSidebar.click();
    }

    // The settings scenarios enter through `/`, where the desktop sidebar is
    // already expanded. Wait for hydration instead of treating its initially
    // absent Tasks button as evidence that the collapsed rail must be opened.
    const sidebar = page.locator("[data-reader-primary-sidebar]:visible").last();
    const tasks = sidebar.getByTestId("sidebar-tasks-button");
    await expect(tasks).toBeVisible({ timeout: 15_000 });
    await tasks.click();
  }
  await expect(center).toBeVisible();
  await center.locator(`[data-cleanup-scan-id="${scanId}"]`)
    .getByRole("button", { name: /^(Open review|打开审查)$/ }).click();
  await expect(page.getByTestId("content-cleanup-dialog")).toBeVisible();
}

export async function settingsAppearance(request: APIRequestContext, baseURL: string, locale: string): Promise<void> {
  const expected = { theme_mode: locale === "en-US" ? "dark" : "light", locale_mode: locale };
  const saved = await request.patch(`${baseURL}/api/preferences`, { headers: { Origin: baseURL }, data: expected });
  expect(saved.status()).toBe(200);
  expect(await (await request.get(`${baseURL}/api/preferences`)).json()).toMatchObject(expected);
}

export async function settingsAdmin(request: APIRequest, baseURL: string): Promise<APIRequestContext> {
  const context = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL }, storageState: adminState });
  if (!adminState) {
    const response = await context.post("/api/auth/login", { data: { email: process.env.E2E_AUTH_EMAIL, password: process.env.E2E_AUTH_PASSWORD } });
    expect(response.status(), "Synthetic settings administrator login").toBe(200);
    adminState = await context.storageState();
  }
  expect((await context.put("/api/admin/access/registration", { data: { mode: "OPEN", require_admin_approval: false, email_verification_enabled: false } })).status()).toBe(200);
  return context;
}

export async function removeSyntheticAccount(admin: APIRequestContext, userId: string): Promise<void> {
  const queued = await admin.post(`/api/admin/access/users/${userId}/delete`, {
    headers: { "Idempotency-Key": `context-fixture-cleanup-${userId}` },
    data: { confirm_user_id: userId },
  });
  expect(queued.status(), "Queue synthetic test account removal").toBe(202);
  const { job_id: jobId } = await queued.json();
  await expect.poll(async () => (await (await admin.get(`/api/tasks/${jobId}`)).json()).status,
    { message: "Synthetic test account deletion must commit", timeout: 30_000 }).toBe("committed");
  expect((await admin.get(`/api/admin/access/users/${userId}`)).status()).toBe(404);
}

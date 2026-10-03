import { expect, type APIRequest, type APIRequestContext } from "@playwright/test";

// Only a synthetic fixture session, held in this test worker's memory. Reuse it
// across viewport cases rather than repeatedly exercising the login rate limit.
let adminState: Awaited<ReturnType<APIRequestContext["storageState"]>> | undefined;

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

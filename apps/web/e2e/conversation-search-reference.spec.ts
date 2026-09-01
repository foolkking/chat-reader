import { expect, test } from "@playwright/test";

const password = process.env.E2E_AUTH_PASSWORD;
const email = process.env.E2E_AUTH_EMAIL;
const conversationId = process.env.E2E_SEARCH_CONVERSATION_ID;
const query = process.env.E2E_SEARCH_QUERY ?? "alpha";

test.skip(!password || !email || !conversationId, "Reference-search E2E requires an auth-enabled account and a disposable QA conversation.");

test("current conversation search keeps exact occurrence navigation context", async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/login`);
  await page.locator("#login-email").fill(email!);
  await page.locator("#login-password").fill(password!);
  await page.getByRole("button", { name: /Sign in|登录/ }).click();
  await expect(page).toHaveURL(`${baseURL}/`);
  await page.goto(`${baseURL}/conversations/${conversationId}`);
  await page.getByRole("button", { name: /^(Search|搜索)$/ }).click();
  const search = page.getByPlaceholder(/Search this conversation|搜索当前对话/);
  await search.fill(query);
  await expect(page.locator("mark").first()).toBeVisible();
  const result = page.locator("button").filter({ has: page.locator("mark") }).first();
  await result.click();
  await expect(page.getByRole("status").filter({ hasText: query }).last()).toContainText("1 /");
  const returnToSearch = page.getByRole("button", { name: /Return to search|返回搜索/ });
  await returnToSearch.click();
  await expect(search).toHaveValue(query);
  await expect(page.locator("mark").first()).toBeVisible();
});

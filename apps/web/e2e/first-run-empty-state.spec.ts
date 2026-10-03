import { expect, test, type Route } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test.describe("first-run empty conversation state", () => {
  test("offers transcript import without an archive entry", async ({ page }) => {
    test.skip(!process.env.E2E_EMPTY_STATE_AUTH, "Requires an authenticated workspace browser fixture; real settings restore is tested separately.");
    // The production proxy requires a session cookie before serving the
    // workspace. The API is still fixture-backed below, so this only models
    // the authenticated shell boundary.
    await page.context().addCookies([
      { name: "chat_reader_session", value: "empty-state-fixture", domain: "127.0.0.1", path: "/" },
      { name: "chat_reader_session", value: "empty-state-fixture", domain: "localhost", path: "/" },
    ]);
    await page.route("**/api/**", (route) => mockEmptyWorkspaceApi(route));
    await page.goto("/");

    await expect(page.getByText(/There are no conversations here yet|这里还没有对话/)).toBeVisible();
    const importButton = page.getByRole("button", { name: /Import conversations|导入对话/ });
    const restoreButton = page.getByRole("button", { name: /Restore \.cr archive|恢复 \.cr 归档/ });
    await expect(importButton).toBeVisible();
    await expect(restoreButton).toHaveCount(0);

    await importButton.click();
    const importDialog = page.getByRole("dialog", { name: /Import data|导入数据/ });
    await expect(importDialog).toBeVisible();
    await expect(importDialog.getByTestId("import-file-input")).toHaveAttribute("accept", /\.json/);
    await page.getByTestId("import-dialog-close").click();
    await expect(importDialog).toHaveCount(0);


  });


});

async function mockEmptyWorkspaceApi(route: Route): Promise<void> {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  if (path === "/api/auth/session") {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        principal_id: "empty-state-fixture",
        user_id: "empty-state-fixture",
        inactivity_expires_at: "2026-09-01T00:00:00Z",
        auth_mode: "multi_account",
        email: "empty-state@example.test",
        display_name: "Empty state fixture",
        role: "USER",
        registration_mode: "CLOSED",
        password_reset_available: false,
      }),
    });
    return;
  }
  if (path === "/api/preferences") {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        theme_mode: "light",
        locale_mode: "en-US",
        reader_width_mode: "standard",
        reader_density_mode: "comfortable",
        reader_font_size_px: 17,
        section_toc_mode: "visible",
        conversation_sort_mode: "recent_read",
        conversation_sort_direction: "desc",
        project_sort_mode: "custom",
        project_sort_direction: "asc",
        created_at: "2026-08-31T00:00:00Z",
        updated_at: "2026-08-31T00:00:00Z",
      }),
    });
    return;
  }
  if (path === "/api/conversations" || path === "/api/projects" || path === "/api/recent" || path === "/api/tasks/active" || path === "/api/content-cleanup/scans/pending") {
    await route.fulfill({ contentType: "application/json", body: "[]" });
    return;
  }
  await route.fulfill({ contentType: "application/json", body: "{}" });
}

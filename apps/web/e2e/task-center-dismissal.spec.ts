import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

test.use({ serviceWorkers: "block" });

const taskId = "11111111-1111-4111-8111-111111111111";

const activeTask = {
  job_id: taskId,
  job_type: "conversation_merge",
  status: "processing",
  phase: "messages",
  progress: 40,
  processed_items: 2,
  total_items: 5,
  label: "Merge conversations",
  result: {},
  error_message: null,
  queued_at: "2026-08-31T00:00:00Z",
  started_at: "2026-08-31T00:00:01Z",
  heartbeat_at: "2026-08-31T00:00:02Z",
  completed_at: null,
  cancellable: true,
  attempt_count: 1,
};

test("closing the Task Center never cancels its background task", async ({ page }) => {
  const cancelRequests: string[] = [];
  await page.route("**/api/**", async (route) => mockOwnerApi(route, cancelRequests, [activeTask]));
  await page.goto("/");

  const launcher = page.getByTestId("sidebar-tasks-button");
  await expect(launcher).toBeVisible();
  await launcher.click();
  await expect(page.getByTestId("task-center-panel")).toBeVisible();

  await page.getByTestId("task-center-panel").click({ position: { x: 24, y: 24 } });
  await expect(page.getByTestId("task-center-panel")).toBeVisible();

  await clickBackdrop(page);
  await expect(page.getByTestId("task-center-panel")).toHaveCount(0);
  expect(cancelRequests).toEqual([]);

  await launcher.click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("task-center-panel")).toHaveCount(0);
  expect(cancelRequests).toEqual([]);

  await launcher.click();
  await page.getByTestId("task-center-panel").getByTestId("task-conversation_merge-processing").getByRole("button").click();
  await expect.poll(() => cancelRequests).toEqual([`/api/tasks/${taskId}/cancel`]);
});

test("global Tasks reopens the same active task after route change and refresh", async ({ page }) => {
  await page.route("**/api/**", async (route) => mockOwnerApi(route, [], [activeTask]));
  await page.goto("/");
  await page.getByTestId("sidebar-tasks-button").click();
  await expect(page.getByTestId("task-center-panel").getByTestId("task-conversation_merge-processing")).toBeVisible();
  await clickBackdrop(page);

  await page.goto("/search");
  const launcher = page.getByTestId("sidebar-tasks-button");
  await expect(launcher).toBeVisible();
  await launcher.click();
  await expect(page.getByTestId("task-center-panel").getByTestId("task-conversation_merge-processing")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.reload();
  await page.getByTestId("sidebar-tasks-button").click();
  await expect(page.getByTestId("task-center-panel").getByTestId("task-conversation_merge-processing")).toBeVisible();
});

test("mobile Tasks is a full-height global surface and closing it does not stop work", async ({ page }) => {
  const cancelRequests: string[] = [];
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/api/**", async (route) => mockOwnerApi(route, cancelRequests, [activeTask]));
  await page.goto("/");

  await page.getByTestId("mobile-sidebar-button").click();
  await page.getByTestId("sidebar-tasks-button").filter({ visible: true }).click();

  const panel = page.getByTestId("task-center-panel");
  await expect(panel.getByTestId("task-conversation_merge-processing")).toBeVisible();
  const viewport = page.viewportSize();
  const panelBox = await panel.boundingBox();
  expect(viewport).not.toBeNull();
  expect(panelBox).not.toBeNull();
  expect(panelBox!.y).toBeLessThanOrEqual(1);
  expect(Math.abs(panelBox!.height - viewport!.height)).toBeLessThanOrEqual(1);

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  expect(cancelRequests).toEqual([]);

  await page.getByTestId("mobile-sidebar-button").click();
  await page.getByTestId("sidebar-tasks-button").filter({ visible: true }).click();
  await expect(page.getByTestId("task-center-panel").getByTestId("task-conversation_merge-processing")).toBeVisible();
  expect(cancelRequests).toEqual([]);
});

test("Task Center reports partial results and task-specific result actions truthfully", async ({ page }) => {
  const partialDelete = {
    ...activeTask,
    job_id: "22222222-2222-4222-8222-222222222222",
    job_type: "conversation_batch_delete",
    status: "committed",
    phase: "committed",
    progress: 100,
    processed_items: 2,
    total_items: 2,
    result: { deleted_ids: ["conversation-a"], failed: [{ id: "conversation-b", error: "conflict" }] },
    completed_at: "2026-08-31T00:00:10Z",
    cancellable: false,
  };
  const completedExport = {
    ...activeTask,
    job_id: "33333333-3333-4333-8333-333333333333",
    job_type: "conversation_export",
    status: "committed",
    phase: "committed",
    progress: 100,
    processed_items: 1,
    total_items: 1,
    result: { download_url: "/api/exports/result/download" },
    completed_at: "2026-08-31T00:00:10Z",
    cancellable: false,
  };
  await page.route("**/api/**", async (route) => mockOwnerApi(route, [], [partialDelete, completedExport]));
  await page.goto("/");
  await page.getByTestId("sidebar-tasks-button").click();

  await expect(page.getByTestId("task-center-panel")).toContainText("Partially completed");
  await expect(page.getByTestId("task-center-panel")).toContainText("1 completed \u00b7 1 failed");
  await expect(page.getByTestId("task-result-download")).toHaveAttribute("href", "/api/exports/result/download");
});

test("batch import completion reports the full scope and waits for an explicit destination", async ({ page }) => {
  await page.context().addCookies([{
    name: "chat_reader_session",
    value: "batch-import-completion-test-session",
    domain: "127.0.0.1",
    path: "/",
  }]);
  const importId = "44444444-4444-4444-8444-444444444440";
  const conversationIds = [
    "44444444-4444-4444-8444-444444444441",
    "44444444-4444-4444-8444-444444444442",
  ];
  const session = {
    import_id: importId,
    state: "READY",
    status: "previewed",
    file_count: 2,
    total_bytes: 32,
    group_count: 2,
    family_count: 1,
    conversation_count: 2,
    message_count: 4,
    can_import: true,
    groups: [],
    families: [{
      id: "44444444-4444-4444-8444-444444444443",
      source_mode: "JSON",
      display_name: "Built-in fixture",
      resolution_status: "EXACT_MATCH",
      group_count: 2,
      group_ids: [],
      matched_profile_key: "builtin:test",
      matched_profile_id: null,
      matched_revision_id: null,
      mapping_draft: {},
      validation_result: { valid: true },
      match_evidence: {},
      diagnostics: [],
      handling_class: "SUPPORTED",
      handling_reason: { recovery_action: "DIRECT_IMPORT" },
    }],
    warnings: [],
    analysis_summary: {},
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/adaptive-import/sessions" && request.method() === "POST") {
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(session) });
      return;
    }
    if (path === `/api/imports/${importId}/commit` && request.method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          import_id: importId,
          status: "committed",
          conversation_ids: conversationIds,
          conversation_count: 2,
          message_count: 4,
          warnings: ["One duplicate was skipped."],
          phase: "committed",
          progress: 100,
          processed_messages: 4,
          total_messages: 4,
        }),
      });
      return;
    }
    await mockOwnerApi(route, [], []);
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Import data|导入数据/ }).click();
  await page.getByTestId("import-file-input").setInputFiles([
    { name: "batch-a.json", mimeType: "application/json", buffer: Buffer.from("{}") },
    { name: "batch-b.json", mimeType: "application/json", buffer: Buffer.from("{}") },
  ]);
  await page.getByTestId("preview-import-button").click();
  await page.getByTestId("commit-import-button").click();

  const summary = page.getByTestId("import-completion-summary");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("已提交 2 个对话，共 4 条消息");
  await expect(summary).toContainText("One duplicate was skipped.");
  await expect(summary.getByRole("link", { name: "查看导入的对话" })).toHaveAttribute("href", "/");
  await expect(summary.getByRole("button", { name: "打开第一条" })).toBeVisible();
  await expect(summary.getByRole("button", { name: "打开第 2 条" })).toBeVisible();
  await expect(summary.getByRole("button", { name: "关闭" })).toBeVisible();
  await expect(page).toHaveURL("/");

  await summary.getByRole("button", { name: "打开第一条" }).click();
  await expect(page).toHaveURL(`/conversations/${conversationIds[0]}`);
});

test("Task Center exposes the current offline packaging store and progress", async ({ page }) => {
  const offlinePackage = {
    ...activeTask,
    job_id: "66666666-6666-4666-8666-666666666666",
    job_type: "offline_package",
    phase: "packaging_search",
    progress: 64,
    processed_items: 2,
    total_items: 5,
  };
  await page.route("**/api/**", async (route) => mockOwnerApi(route, [], [offlinePackage]));
  await page.goto("/");
  await page.getByTestId("sidebar-tasks-button").click();

  const task = page.getByTestId("task-center-panel").getByTestId("task-offline_package-processing");
  await expect(task).toContainText("整理离线搜索索引");
  await expect(task).toContainText("2 / 5");
  await expect(task).toContainText("64%");
});

test("recent terminal task results survive refresh and presentation dismissal stays local", async ({ page }) => {
  const mutationRequests: string[] = [];
  const completedMerge = {
    ...activeTask,
    job_id: "77777777-7777-4777-8777-777777777777",
    status: "committed",
    phase: "committed",
    progress: 100,
    processed_items: 5,
    result: { conversation_id: "88888888-8888-4888-8888-888888888888" },
    completed_at: "2026-08-31T00:00:10Z",
    cancellable: false,
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET" && path.startsWith("/api/tasks/")) mutationRequests.push(path);
    await mockOwnerApi(route, [], [completedMerge]);
  });
  await page.goto("/");
  await page.getByTestId("sidebar-tasks-button").click();
  let panel = page.getByTestId("task-center-panel");
  await expect(panel.getByTestId("task-conversation_merge-committed")).toBeVisible();
  await expect(panel.getByTestId("task-result-conversation")).toHaveAttribute("href", "/conversations/88888888-8888-4888-8888-888888888888");

  await page.reload();
  await page.getByTestId("sidebar-tasks-button").click();
  panel = page.getByTestId("task-center-panel");
  await expect(panel.getByTestId("task-conversation_merge-committed")).toBeVisible();
  await panel.getByTestId("task-dismiss-77777777-7777-4777-8777-777777777777").click();
  await expect(panel.getByTestId("task-conversation_merge-committed")).toHaveCount(0);
  expect(mutationRequests).toEqual([]);
});

test("sort menu closes on outside click and Escape and restores trigger focus", async ({ page }) => {
  await page.route("**/api/**", async (route) => mockOwnerApi(route, [], []));
  await page.goto("/");
  const trigger = page.getByTestId("sort-menu-trigger").filter({ visible: true }).last();

  await trigger.click();
  await expect(page.getByTestId("sort-menu-panel").filter({ visible: true })).toBeVisible();
  await page.mouse.click(900, 700);
  await expect(page.getByTestId("sort-menu-panel").filter({ visible: true })).toHaveCount(0);
  await expect.poll(() => trigger.evaluate((element) => document.activeElement === element)).toBe(true);

  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("sort-menu-panel").filter({ visible: true })).toHaveCount(0);
  await expect.poll(() => trigger.evaluate((element) => document.activeElement === element)).toBe(true);
});

test("batch mode keeps its trigger width and exposes an explicit Done state", async ({ page }) => {
  const conversation = conversationFixture("44444444-4444-4444-8444-444444444444", "Batch fixture");
  await page.route("**/api/**", async (route) => mockOwnerApi(route, [], [], [conversation]));
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Manage conversations" });
  const before = await trigger.boundingBox();
  expect(before).not.toBeNull();

  await trigger.click();
  const done = page.getByRole("button", { name: "Done", exact: true }).first();
  await expect(done).toHaveAttribute("aria-pressed", "true");
  const after = await done.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.width - before!.width)).toBeLessThanOrEqual(1);
});

test("merge workflow opens in a body-level dialog outside the list frame", async ({ page }) => {
  const conversations = [
    conversationFixture("55555555-5555-4555-8555-555555555555", "Merge first"),
    conversationFixture("66666666-6666-4666-8666-666666666666", "Merge second"),
  ];
  await page.route("**/api/**", async (route) => mockOwnerApi(route, [], [], conversations));
  await page.goto("/");
  await page.getByRole("button", { name: "Manage conversations" }).click();
  for (const title of ["Merge first", "Merge second"]) {
    await page.getByRole("article").filter({ hasText: title }).locator("button").first().click();
  }
  await page.getByRole("toolbar").getByRole("button", { name: "Merge", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Merge conversations" });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((element) => element.parentElement === document.body)).toBe(true);
});

test("conversation rows remain visibly actionable when custom sorting is disabled", async ({ page }) => {
  await page.context().addCookies([{
    name: "chat_reader_session",
    value: "actionable-row-test-session",
    domain: "127.0.0.1",
    path: "/",
  }]);
  const projectId = "77777777-7777-4777-8777-777777777778";
  const projectConversationId = "88888888-8888-4888-8888-888888888882";
  const allConversation = conversationFixture("88888888-8888-4888-8888-888888888881", "Actionable library row");
  const projectConversation = {
    ...conversationFixture(projectConversationId, "Actionable project row"),
    project_id: projectId,
    project_name: "Actionable project",
    project_relation: {
      is_pinned: false,
      pinned_at: null,
      added_at: "2026-08-31T00:00:00Z",
      sort_order: 0,
    },
  };
  const project = {
    id: projectId,
    name: "Actionable project",
    description: null,
    color: null,
    icon: null,
    sort_order: 0,
    is_default: false,
    is_archived: false,
    archived_at: null,
    created_at: "2026-08-31T00:00:00Z",
    updated_at: "2026-08-31T00:00:00Z",
    last_read_at: null,
    conversation_count: 1,
    pinned_count: 0,
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/projects") return json(route, [project]);
    if (path === `/api/projects/${projectId}/conversations`) return json(route, [projectConversation]);
    await mockOwnerApi(route, [], [], [allConversation]);
  });

  await page.goto("/");
  await assertActionableConversationRow(page, "Actionable library row");
  await page.getByRole("article").filter({ hasText: "Actionable library row" }).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/conversations/${allConversation.id}$`));

  await page.goto(`/projects/${projectId}`);
  await assertActionableConversationRow(page, "Actionable project row");
  await page.getByRole("article").filter({ hasText: "Actionable project row" }).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/conversations/${projectConversationId}\\?projectId=${projectId}$`));
});

test("workspace soft navigation preserves the same Sidebar DOM instance", async ({ page }) => {
  await page.context().addCookies([{
    name: "chat_reader_session",
    value: "persistent-workspace-shell-test-session",
    domain: "127.0.0.1",
    path: "/",
  }]);
  const conversation = conversationFixture("89898989-8989-4989-8989-898989898989", "Persistent shell conversation");
  const project = projectFixture("79797979-7979-4979-8979-797979797979", "Persistent shell project", 0);
  const documentRequests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") documentRequests.push(request.url());
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/projects") return json(route, [project]);
    if (path === `/api/projects/${project.id}`) return json(route, project);
    if (path === `/api/projects/${project.id}/conversations`) return json(route, []);
    if (path === `/api/conversations/${conversation.id}`) return json(route, conversation);
    await mockOwnerApi(route, [], [], [conversation]);
  });

  await page.goto("/");
  const sidebar = page.locator("aside[data-reader-primary-sidebar]").filter({ visible: true }).last();
  await expect(sidebar).toBeVisible();
  await sidebar.evaluate((element) => {
    (element as HTMLElement & { __workspacePersistenceProbe?: object }).__workspacePersistenceProbe = {};
  });
  const expectSameSidebar = async () => {
    await expect.poll(() => page.locator("aside[data-reader-primary-sidebar]").filter({ visible: true }).last().evaluate(
      (element) => Boolean((element as HTMLElement & { __workspacePersistenceProbe?: object }).__workspacePersistenceProbe),
    )).toBe(true);
  };

  await sidebar.getByRole("link", { name: /Persistent shell conversation/ }).click();
  await expect(page).toHaveURL(`/conversations/${conversation.id}`);
  await expectSameSidebar();

  await sidebar.locator(`a[href="/projects/${project.id}"]`).evaluate((element) => (element as HTMLAnchorElement).click());
  await expect(page).toHaveURL(`/projects/${project.id}`);
  await expectSameSidebar();

  await page.locator('a[href="/recent"]').first().evaluate((element) => (element as HTMLAnchorElement).click());
  await expect(page).toHaveURL("/recent");
  await expectSameSidebar();

  const search = page.getByTestId("sidebar-global-search");
  await search.fill("persistent shell query");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=persistent(?:%20|\+)shell(?:%20|\+)query$/);
  await expectSameSidebar();
  expect(documentRequests).toHaveLength(1);
});

test("project and conversation drag overlays preserve their source row dimensions", async ({ page }) => {
  await page.context().addCookies([{
    name: "chat_reader_session",
    value: "drag-size-test-session",
    domain: "127.0.0.1",
    path: "/",
  }]);
  const conversations = [
    conversationFixture("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "Drag size first"),
    conversationFixture("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "Drag size second"),
  ];
  const projects = [
    projectFixture("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", "Drag project first", 0),
    projectFixture("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", "Drag project second", 1024),
  ];
  const mutationRequests: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") mutationRequests.push(`${request.method()} ${path}`);
    if (path === "/api/preferences") return json(route, {
      theme_mode: "light",
      locale_mode: "en-US",
      reader_width_mode: "standard",
      reader_density_mode: "comfortable",
      reader_font_size_px: 17,
      section_toc_mode: "visible",
      conversation_sort_mode: "custom",
      conversation_sort_direction: "asc",
      project_sort_mode: "custom",
      project_sort_direction: "asc",
      created_at: "2026-08-31T00:00:00Z",
      updated_at: "2026-08-31T00:00:00Z",
    });
    if (path === "/api/projects") return json(route, projects);
    await mockOwnerApi(route, [], [], conversations);
  });
  await page.goto("/");

  const projectRow = page.getByTestId(`project-order-slot-${projects[0].id}`).locator(".reader-interactive-row").first();
  await assertDragOverlayMatchesSource(page, projectRow, page.getByTestId("sidebar-drag-overlay"));

  const conversationRow = page.getByTestId(`conversation-sortable-row-${conversations[0].id}`);
  await assertDragOverlayMatchesSource(page, conversationRow, page.getByTestId("conversation-list-drag-overlay"));
  expect(mutationRequests).toEqual([]);
});

test("conversation previews wait, flip inside the viewport, and cancel pending presentation", async ({ page }) => {
  await page.context().addCookies([{
    name: "chat_reader_session",
    value: "hover-preview-test-session",
    domain: "127.0.0.1",
    path: "/",
  }]);
  await page.setViewportSize({ width: 480, height: 280 });
  const projectId = "99999999-9999-4999-8999-999999999990";
  const conversation = conversationFixture("99999999-9999-4999-8999-999999999991", "Hover preview fixture");
  conversation.description_markdown = "A deliberately long conversation description used to prove delayed preview behavior without changing the row's click target. ".repeat(12);
  const projectConversation = {
    ...conversationFixture("99999999-9999-4999-8999-999999999992", "Project hover preview fixture"),
    description_markdown: "A long project conversation description that must use the same delayed non-blocking preview contract. ".repeat(12),
    project_id: projectId,
    project_name: "Hover preview project",
    project_relation: { is_pinned: false, pinned_at: null, added_at: "2026-08-31T00:00:00Z", sort_order: 0 },
  };
  const project = {
    id: projectId,
    name: "Hover preview project",
    description: null,
    color: null,
    icon: null,
    sort_order: 0,
    is_default: false,
    is_archived: false,
    archived_at: null,
    created_at: "2026-08-31T00:00:00Z",
    updated_at: "2026-08-31T00:00:00Z",
    last_read_at: null,
    conversation_count: 1,
    pinned_count: 0,
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/projects") return json(route, [project]);
    if (path === `/api/projects/${projectId}/conversations`) return json(route, [projectConversation]);
    await mockOwnerApi(route, [], [], [conversation]);
  });
  await page.goto("/");

  const link = page.getByRole("link", { name: /Hover preview fixture/ });
  await expect(link).toBeVisible();
  const linkBox = await link.boundingBox();
  expect(linkBox).not.toBeNull();
  const hoverPosition = { x: Math.max(1, linkBox!.width - 2), y: Math.max(1, linkBox!.height - 2) };
  await link.hover({ position: hoverPosition });
  await page.waitForTimeout(500);
  await expect(page.locator('[role="tooltip"]')).toHaveCount(0);
  await page.waitForTimeout(260);
  const preview = page.locator('[role="tooltip"]');
  await expect(preview).toBeVisible();
  const previewBox = await preview.boundingBox();
  expect(previewBox).not.toBeNull();
  expect(previewBox!.x).toBeGreaterThanOrEqual(0);
  expect(previewBox!.y).toBeGreaterThanOrEqual(0);
  expect(previewBox!.x + previewBox!.width).toBeLessThanOrEqual(480);
  expect(previewBox!.y + previewBox!.height).toBeLessThanOrEqual(280);

  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await link.hover({ position: hoverPosition });
  await page.waitForTimeout(250);
  await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
  await page.waitForTimeout(550);
  await expect(preview).toHaveCount(0);

  await link.dispatchEvent("pointerenter", { pointerType: "touch", clientX: 100, clientY: 100 });
  await page.waitForTimeout(750);
  await expect(preview).toHaveCount(0);

  await page.goto(`/projects/${projectId}`);
  const projectLink = page.getByRole("link", { name: /Project hover preview fixture/ });
  await expect(projectLink).toBeVisible();
  await projectLink.hover();
  await page.waitForTimeout(760);
  await expect(preview).toBeVisible();
  const projectPreviewBox = await preview.boundingBox();
  expect(projectPreviewBox).not.toBeNull();
  expect(projectPreviewBox!.x).toBeGreaterThanOrEqual(0);
  expect(projectPreviewBox!.y).toBeGreaterThanOrEqual(0);
  expect(projectPreviewBox!.x + projectPreviewBox!.width).toBeLessThanOrEqual(480);
  expect(projectPreviewBox!.y + projectPreviewBox!.height).toBeLessThanOrEqual(280);
});

async function clickBackdrop(page: Page): Promise<void> {
  const backdrop = page.getByTestId("task-center-backdrop");
  const panel = page.getByTestId("task-center-panel");
  const backdropBox = await backdrop.boundingBox();
  const panelBox = await panel.boundingBox();
  expect(backdropBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  const x = backdropBox!.x + 2;
  const y = panelBox!.y > backdropBox!.y + 4 ? backdropBox!.y + 2 : backdropBox!.y + backdropBox!.height - 2;
  await page.mouse.click(x, y);
}

async function assertActionableConversationRow(page: Page, title: string): Promise<void> {
  const article = page.getByRole("article").filter({ hasText: title });
  const wrapper = article.locator("xpath=..");
  const link = article.getByRole("link");
  await expect(article).toBeVisible();
  await expect(wrapper).not.toHaveAttribute("aria-disabled", "true");
  await expect.poll(() => link.evaluate((element) => Boolean(element.closest('[aria-disabled="true"]')))).toBe(false);
  const normal = await wrapper.evaluate((element) => {
    const style = getComputedStyle(element);
    return { cursor: style.cursor, opacity: style.opacity };
  });
  expect(normal).toEqual({ cursor: "pointer", opacity: "1" });
  await article.hover();
  await expect.poll(() => wrapper.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await expect.poll(() => link.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("auto");
}

async function mockOwnerApi(
  route: Route,
  cancelRequests: string[],
  tasks: Array<Record<string, unknown>>,
  conversations: Array<Record<string, unknown>> = [],
): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  if (path === "/api/auth/session") return json(route, {
    authenticated: true,
    principal_id: "owner",
    inactivity_expires_at: "2026-09-01T00:00:00Z",
    auth_mode: "single_password",
  });
  if (path === `/api/tasks/${taskId}/cancel` && request.method() === "POST") {
    cancelRequests.push(path);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...activeTask, status: "cancelling", phase: "cancelling", cancellable: false }) });
    return;
  }
  if (path === "/api/preferences") return json(route, {
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
  });
  if (path === "/api/tasks/active") return json(route, tasks);
  if (path === "/api/content-cleanup/scans/pending") return json(route, []);
  if (path === "/api/projects") return json(route, []);
  if (path === "/api/recent") return json(route, []);
  if (path === "/api/conversations") return json(route, conversations);
  await json(route, []);
}

async function assertDragOverlayMatchesSource(page: Page, source: Locator, overlay: Locator): Promise<void> {
  await expect(source).toBeVisible();
  const sourceBox = await source.boundingBox();
  expect(sourceBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + Math.min(80, sourceBox!.width / 2), sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox!.x + Math.min(92, sourceBox!.width / 2 + 12), sourceBox!.y + sourceBox!.height / 2 + 12, { steps: 4 });
  await expect(overlay).toBeVisible();
  const overlayBox = await overlay.boundingBox();
  expect(overlayBox).not.toBeNull();
  const overlaySizing = await overlay.evaluate((element) => ({
    inline: element.getAttribute("style"),
    boxSizing: getComputedStyle(element).boxSizing,
    height: getComputedStyle(element).height,
    minHeight: getComputedStyle(element).minHeight,
    paddingBlock: `${getComputedStyle(element).paddingTop} ${getComputedStyle(element).paddingBottom}`,
  }));
  const sizingEvidence = JSON.stringify({ sourceBox, overlayBox, overlaySizing });
  expect(Math.abs(overlayBox!.width - sourceBox!.width), sizingEvidence).toBeLessThanOrEqual(2);
  expect(Math.abs(overlayBox!.height - sourceBox!.height), sizingEvidence).toBeLessThanOrEqual(2);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(overlay).toHaveCount(0);
}

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
}

function conversationFixture(id: string, title: string): Record<string, unknown> {
  return {
    id,
    title,
    display_title: title,
    source_type: "test",
    source_profile: "test",
    message_count: 2,
    turn_count: 1,
    created_at: "2026-08-31T00:00:00Z",
    updated_at: "2026-08-31T00:00:00Z",
    imported_at: "2026-08-31T00:00:00Z",
    first_user_message: "Fixture",
    description_markdown: null,
    project_id: null,
    project_name: null,
    offline_revision: 1,
    status: "active",
    is_global_pinned: false,
    global_pinned_at: null,
    last_read_at: null,
    manual_sort_order: 0,
  };
}

function projectFixture(id: string, name: string, sortOrder: number): Record<string, unknown> {
  return {
    id,
    name,
    description: null,
    color: null,
    icon: null,
    sort_order: sortOrder,
    is_default: false,
    is_archived: false,
    archived_at: null,
    created_at: "2026-08-31T00:00:00Z",
    updated_at: "2026-08-31T00:00:00Z",
    last_read_at: null,
    conversation_count: 0,
    pinned_count: 0,
  };
}

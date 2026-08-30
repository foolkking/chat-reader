import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const runDndFlow = process.env.E2E_DND_FLOW === "1";

test.skip(!runDndFlow, "E2E_DND_FLOW=1 is required");
test.use({ serviceWorkers: "block" });

async function createConversation(request: APIRequestContext, title: string): Promise<string> {
  const response = await request.post("/api/conversations", {
    data: {
      title,
      messages: [
        { role: "user", content_markdown: `Synthetic drag fixture for ${title}.` },
        { role: "assistant", content_markdown: "Project drag fixture response." },
      ],
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).conversation.id as string;
}

async function pointerDrag(page: Page, source: Locator, target: Locator, hoverMs = 100): Promise<void> {
  await expect(page.getByTestId("sidebar-drag-overlay")).toHaveCount(0);
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  await source.focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("sidebar-drag-overlay")).toBeVisible({ timeout: 5_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("sidebar-drag-overlay")).toHaveCount(0);
  // The whole conversation row is the drag surface; there is no dedicated
  // handle. Starting from the title/summary area must still preserve click
  // navigation when the activation threshold is not crossed.
  const sourceBox = await source.boundingBox();
  expect(sourceBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2 + 16, sourceBox!.y + sourceBox!.height / 2, { steps: 4 });
  await expect(page.getByTestId("sidebar-drag-overlay")).toBeVisible({ timeout: 5_000 });
  // A pointer cannot be released on a DOM target outside the scrollport.
  // Scroll the destination into view after pickup, matching a user dragging
  // through the sidebar's auto-scroll region.
  await target.scrollIntoViewIfNeeded();
  const targetBox = await target.boundingBox();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 12 });
  await page.waitForTimeout(hoverMs);
  const settledTargetBox = await target.boundingBox();
  expect(settledTargetBox).not.toBeNull();
  await page.mouse.move(
    settledTargetBox!.x + settledTargetBox!.width / 2,
    settledTargetBox!.y + Math.min(settledTargetBox!.height / 2, 18),
    { steps: 4 },
  );
  await expect(page.getByTestId("sidebar-drag-overlay")).toHaveAttribute("data-drop-intent", "conversation-placement");
  await page.mouse.up();
  await expect(page.getByTestId("sidebar-drag-overlay")).toHaveCount(0);
}

async function conversationProject(request: APIRequestContext, conversationId: string): Promise<string | null> {
  const response = await request.get(`/api/conversations/${conversationId}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).project_id as string | null;
}

test("conversation drop targets do not collide with project sorting targets", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const firstId = await createConversation(page.request, `DnD first ${suffix}`);
  const secondId = await createConversation(page.request, `DnD second ${suffix}`);
  const firstProjectResponse = await page.request.post("/api/projects", { data: { name: `DnD A ${suffix}` } });
  const secondProjectResponse = await page.request.post("/api/projects", { data: { name: `DnD B ${suffix}` } });
  expect(firstProjectResponse.ok()).toBeTruthy();
  expect(secondProjectResponse.ok()).toBeTruthy();
  const firstProjectId = (await firstProjectResponse.json()).id as string;
  const secondProjectId = (await secondProjectResponse.json()).id as string;

  try {
    await page.goto("/");
    await pointerDrag(
      page,
      page.getByTestId(`conversation-row-${firstId}`),
      page.getByTestId(`project-conversation-container-${firstProjectId}`),
      800,
    );
    await expect.poll(() => conversationProject(page.request, firstId)).toBe(firstProjectId);
    await expect(page.getByTestId(`conversation-row-${firstId}`)).toHaveAttribute("data-project-id", firstProjectId);

    await pointerDrag(
      page,
      page.getByTestId(`conversation-row-${secondId}`),
      page.getByTestId(`project-conversation-container-${firstProjectId}`),
    );
    await expect.poll(() => conversationProject(page.request, secondId)).toBe(firstProjectId);
    await expect(page.getByTestId(`conversation-row-${secondId}`)).toHaveAttribute("data-project-id", firstProjectId);

    await pointerDrag(
      page,
      page.getByTestId(`conversation-row-${firstId}`),
      page.getByTestId(`project-conversation-container-${secondProjectId}`),
      800,
    );
    await expect.poll(() => conversationProject(page.request, firstId)).toBe(secondProjectId);
    await expect(page.getByTestId(`conversation-row-${firstId}`)).toHaveAttribute("data-project-id", secondProjectId);

    await pointerDrag(
      page,
      page.getByTestId(`conversation-row-${firstId}`),
      page.getByTestId(`conversation-insert:${firstProjectId}:${secondId}`),
    );
    await expect.poll(() => conversationProject(page.request, firstId)).toBe(firstProjectId);
    await expect(page.getByTestId(`conversation-row-${firstId}`)).toHaveAttribute("data-project-id", firstProjectId);
    await expect.poll(async () => {
      const response = await page.request.get(`/api/projects/${firstProjectId}/conversations?sort=custom&direction=asc&limit=100`);
      return ((await response.json()) as Array<{ id: string }>).map((item) => item.id).slice(0, 2);
    }).toEqual([firstId, secondId]);

    await pointerDrag(
      page,
      page.getByTestId(`conversation-row-${firstId}`),
      page.getByTestId("unclassified-container"),
    );
    await expect.poll(() => conversationProject(page.request, firstId)).toBeNull();
    await expect(page.getByTestId(`conversation-row-${firstId}`)).toHaveAttribute("data-project-id", "unclassified");
  } finally {
    await page.request.delete(`/api/conversations/${firstId}`);
    await page.request.delete(`/api/conversations/${secondId}`);
    await page.request.patch(`/api/projects/${firstProjectId}`, { data: { is_archived: true } });
    await page.request.patch(`/api/projects/${secondProjectId}`, { data: { is_archived: true } });
  }
});

test("open project page accepts a conversation from the sidebar without leaving the page", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const conversationId = await createConversation(page.request, `Current project drop ${suffix}`);
  const projectResponse = await page.request.post("/api/projects", { data: { name: `Current drop ${suffix}` } });
  expect(projectResponse.ok()).toBeTruthy();
  const projectId = (await projectResponse.json()).id as string;

  try {
    await page.goto(`/projects/${projectId}`);
    await expect(page.getByTestId("current-project-drop-zone")).toHaveCount(1);
    await pointerDrag(
      page,
      page.getByTestId(`conversation-row-${conversationId}`),
      page.getByTestId("current-project-drop-zone"),
    );

    await expect.poll(() => conversationProject(page.request, conversationId)).toBe(projectId);
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
    await expect(page.getByRole("article").getByRole("link", { name: `Current project drop ${suffix}`, exact: true })).toBeVisible();
    await expect(page.getByTestId("current-project-drop-zone")).toHaveCount(1);
    await expect(page.getByText(/Move failed|移动失败/)).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/conversations/${conversationId}`);
    await page.request.patch(`/api/projects/${projectId}`, { data: { is_archived: true } });
  }
});

test("failed current-project drop restores the sidebar and project caches", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const title = `Failed current drop ${suffix}`;
  const conversationId = await createConversation(page.request, title);
  const projectResponse = await page.request.post("/api/projects", { data: { name: `Rollback target ${suffix}` } });
  expect(projectResponse.ok()).toBeTruthy();
  const projectId = (await projectResponse.json()).id as string;

  try {
    await page.goto(`/projects/${projectId}`);
    await page.route(`**/api/conversations/${conversationId}/placement`, async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Revision conflict" }),
      });
    });
    await pointerDrag(
      page,
      page.getByTestId(`conversation-row-${conversationId}`),
      page.getByTestId("current-project-drop-zone"),
    );

    await expect(page.getByRole("alert").filter({ hasText: /Move failed|移动失败/ })).toContainText(/conversation changed|对话刚刚发生了变化/);
    await expect.poll(() => conversationProject(page.request, conversationId)).toBeNull();
    await expect(page.getByTestId(`conversation-row-${conversationId}`)).toHaveAttribute("data-project-id", "unclassified");
    await expect(page.getByRole("article").getByRole("link", { name: title, exact: true })).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/conversations/${conversationId}`);
    await page.request.patch(`/api/projects/${projectId}`, { data: { is_archived: true } });
  }
});

import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const runDndFlow = process.env.E2E_DND_FLOW === "1";

test.skip(!runDndFlow, "E2E_DND_FLOW=1 is required");

async function createConversation(request: APIRequestContext, title: string): Promise<string> {
  const preview = await request.post("/api/imports/preview", {
    multipart: {
      files: {
        name: `${title}.json`,
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({
          metadata: { title, powered_by: "ChatGPT Exporter" },
          messages: [{ role: "Prompt", say: `Synthetic drag fixture for ${title}.` }],
        })),
      },
    },
  });
  expect(preview.ok()).toBeTruthy();
  const previewBody = await preview.json();
  const commit = await request.post(`/api/imports/${previewBody.import_id}/commit`);
  expect(commit.ok()).toBeTruthy();
  return (await commit.json()).conversation_ids[0] as string;
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
  const handle = source.getByTestId(/^conversation-drag-handle-/);
  await expect(handle).toBeVisible();
  const sourceBox = await handle.boundingBox();
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

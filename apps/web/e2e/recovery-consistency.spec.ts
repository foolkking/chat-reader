import { expect, test as base, type Page } from "@playwright/test";
import { settingsAppearance } from "./settings-test-helper";

const test = base.extend<{ syntheticConversation: string }>({
  syntheticConversation: [async ({ page, baseURL }, use) => {
    await settingsAppearance(page.request, baseURL!, "en-US");
    const response = await page.request.post("/api/conversations", { data: {
      title: "Synthetic recovery consistency", messages: [
        { role: "user", content_markdown: "Synthetic question" },
        { role: "assistant", content_markdown: "Synthetic answer" },
      ],
    } });
    expect(response.status()).toBe(201);
    const id = (await response.json()).conversation.id as string;
    try { await use(id); } finally {
      await page.unrouteAll({ behavior: "wait" });
      expect((await page.request.delete(`/api/conversations/${id}`)).ok()).toBe(true);
    }
  }, { timeout: 30_000 }],
});
test.skip(process.env.E2E_MUTATION_FLOW !== "1", "Requires isolated mutation fixtures");
test.use({ serviceWorkers: "block", extraHTTPHeaders: { Origin: "http://127.0.0.1:3107" } });

async function openShare(page: Page, width: number) {
  if (width < 768) {
    await page.locator('[data-reader-mobile-more-actions="true"]').click();
    await page.getByRole("dialog", { name: "Reader tools", exact: true }).getByRole("button", { name: "Share", exact: true }).click();
  } else {
    await page.locator('[data-reader-header-more-actions="true"]').click();
    await page.locator('[data-reader-header-action="share"]').click();
  }
  return page.getByRole("dialog", { name: "Share conversation", exact: true });
}

for (const width of [375, 1440]) {
  test(`${width}px: Share lost response survives close and reopens with one creation intent`, async ({ page, syntheticConversation }, info) => {
    await page.setViewportSize({ width, height: 900 });
    let writes = 0;
    await page.route(`**/api/conversations/${syntheticConversation}/shares`, async route => {
      if (route.request().method() !== "POST") return route.continue();
      writes++;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort();
    });
    await page.goto(`/conversations/${syntheticConversation}`);
    let panel = await openShare(page, width);
    await panel.getByTestId("create-share-button").click();
    await expect(panel.getByRole("button", { name: "Check creation result (read only)" })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    panel = await openShare(page, width);
    await expect(panel.getByTestId("create-share-button")).toBeDisabled();
    await panel.getByRole("button", { name: "Check creation result (read only)" }).click();
    await expect(panel.getByTestId("created-share-url")).toBeVisible();
    expect(writes).toBe(1);
    const shares = await (await page.request.get(`/api/conversations/${syntheticConversation}/shares`)).json();
    expect(shares).toHaveLength(1);
    await panel.screenshot({ path: info.outputPath(`share-recovered-${width}.png`) });
  });

  test(`${width}px: changing Share options hides the previous scope preview`, async ({ page, syntheticConversation }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/conversations/${syntheticConversation}`);
    const panel = await openShare(page, width);
    await panel.getByRole("button", { name: "Preview visitor view" }).click();
    await expect(panel.getByTestId("share-preview")).toBeVisible();
    await panel.getByPlaceholder("Share title (optional)").fill("Changed scope title");
    await expect(panel.getByTestId("share-preview")).toHaveCount(0);
    await expect(panel.getByText("Options or source changed. Preview again to review the current scope.")).toBeVisible();
    await panel.getByRole("button", { name: "Preview visitor view" }).click();
    await expect(panel.getByTestId("share-preview")).toBeVisible();
  });
}

test("same-query search restarts the first page rather than keeping stale earlier pages", async ({ page, syntheticConversation }) => {
  const offsets: number[] = [];
  let generation = 0;
  await page.route("**/api/search?**", async route => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get("offset") ?? 0);
    offsets.push(offset);
    const name = generation ? "Synthetic fresh first page" : offset ? "Synthetic old second page" : "Synthetic old first page";
    await route.fulfill({ json: {
      query: "synthetic", offset, limit: 50, total: generation ? 1 : 51, has_more: !generation && offset === 0,
      items: [{ document_id: crypto.randomUUID(), document_type: "conversation", conversation_id: syntheticConversation,
        conversation_title: name, title: name, snippet: name, plain_text: name, score: 1, metadata: {}, message_id: null }],
    } });
  });
  await page.goto("/search?q=synthetic");
  await expect(page.getByRole("link", { name: /Synthetic old first page/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(page.getByRole("link", { name: /Synthetic old second page/ }).first()).toBeVisible();
  expect(offsets).toEqual([0, 50]);
  await expect(page.getByRole("button", { name: "Load more", exact: true })).toHaveCount(0);
  generation++;
  await page.getByRole("textbox", { name: "Search", exact: true }).press("Enter");
  await expect(page.getByRole("link", { name: /Synthetic fresh first page/ }).first()).toBeVisible();
  expect(offsets).toEqual([0, 50, 0]);
  await expect(page.getByRole("link", { name: /Synthetic old (first|second) page/ })).toHaveCount(0);
});

test("tag lost-response recovery retains the original UUID across panel close", async ({ page, syntheticConversation }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `Synthetic recovered tag ${crypto.randomUUID().slice(0, 8)}`;
  let writes = 0;
  await page.route("**/api/user-feature-entries/conversation-tag/**", async route => {
    if (route.request().method() !== "PUT") return route.continue();
    writes++;
    const response = await route.fetch(); expect(response.ok()).toBe(true);
    await route.abort();
  });
  const openTags = async () => {
    await page.locator('[data-reader-header-more-actions="true"]').click();
    await page.locator('[data-reader-header-action="tags"]').click();
    return page.getByRole("dialog", { name: "Conversation tags", exact: true });
  };
  try {
    await page.goto(`/conversations/${syntheticConversation}`);
    let panel = await openTags();
    await panel.getByRole("textbox", { name: "Tag name", exact: true }).fill(name);
    await panel.getByRole("button", { name: "Add", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Check current state", exact: true })).toBeEnabled();
    await page.keyboard.press("Escape");
    panel = await openTags();
    await expect(panel.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
    await panel.getByRole("button", { name: "Check current state", exact: true }).click();
    await panel.getByRole("button", { name: "Accept checked result", exact: true }).click();
    await expect(panel.getByRole("checkbox", { name: `Remove ${name}`, exact: true })).toBeChecked();
    expect(writes).toBe(1);
  } finally {
    const response = await page.request.get("/api/user-feature-entries/conversation-tag");
    if (response.ok()) {
      const tags = await response.json() as Array<{ id: string; revision: number; value: { name: string } }>;
      for (const tag of tags.filter(item => item.value.name === name))
        expect((await page.request.delete(`/api/user-feature-entries/conversation-tag/${tag.id}?expected_revision=${tag.revision}`)).ok()).toBe(true);
    }
  }
});

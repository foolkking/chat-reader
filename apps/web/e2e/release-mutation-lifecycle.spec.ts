import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const runMutationFlow = process.env.E2E_MUTATION_FLOW === "1";

test.skip(!runMutationFlow, "E2E_MUTATION_FLOW=1 is required");

type MutationFrame = { time: number; top: number; scroll: number; height: number; writer: string; stage: string; empty: boolean };
type MutationProbe = { baseline: number; frames: MutationFrame[]; stop: boolean };

test("initial recent-recording cannot make delete stale and failed undo remains retryable", async ({ page }, info) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const createdResponse = await page.request.post("/api/conversations", {
    data: {
      title: `QA mutation lifecycle ${suffix}`,
      messages: [
        { role: "user", content_markdown: "QA mutation user" },
        { role: "assistant", content_markdown: "QA mutation assistant" },
      ],
    },
  });
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json();
  const conversationId = created.conversation.id as string;
  try {
    let revision = created.conversation.offline_revision as number;
    let insertionAnchorId = created.messages.at(-1).id as string;
    let mutationMessageId = insertionAnchorId;
    let mutationMessageText = "QA mutation assistant";
    for (let index = 1; index <= 6; index += 1) {
      const insertResponse = await page.request.post(`/api/conversations/${conversationId}/messages/insert`, {
        data: {
          anchor_message_id: insertionAnchorId,
          position: "after",
          mode: "pair",
          expected_offline_revision: revision,
          messages: [
            { role: "user", content_markdown: `QA mutation user ${index}\n\n${"reader position context ".repeat(14)}` },
            { role: "assistant", content_markdown: `QA mutation assistant ${index}\n\n${"stable reader content ".repeat(18)}` },
          ],
        },
      });
      expect(insertResponse.status()).toBe(201);
      const inserted = await insertResponse.json();
      revision = inserted.conversation.offline_revision as number;
      insertionAnchorId = inserted.messages.at(-1).id as string;
      if (index === 4) {
        mutationMessageId = insertionAnchorId;
        mutationMessageText = `QA mutation assistant ${index}`;
      }
    }
    await page.goto(`/conversations/${conversationId}?messageId=${mutationMessageId}`);
    const assistant = page.locator(`#message-${mutationMessageId}`);
    await expect(assistant).toBeVisible();
    await expect(assistant).toContainText(mutationMessageText);
    const scrollRoot = page.getByTestId("reader-scroll-root");
    await expect(scrollRoot).toHaveAttribute("data-navigation-stage", "settled");
    // Visible is not navigation-ready. The failing trace captured a baseline
    // during URL alignment, then Locator.click scrolled twice before hitting
    // Delete. At confirmation the reading line was in a different, surviving
    // message, so preserving that real anchor correctly moved the next message.
    // Establish this test's intended "delete the currently read message" state
    // explicitly, then use a hit-tested pointer without hidden locator scrolls.
    await assistant.evaluate(article => {
      const root = article.closest<HTMLElement>("[data-reader-scroll-root='true']")!;
      root.scrollTop += article.getBoundingClientRect().top - root.getBoundingClientRect().top - 80;
    });
    await expect.poll(() => assistant.evaluate(article => Math.abs(article.getBoundingClientRect().top
      - article.closest("[data-reader-scroll-root='true']")!.getBoundingClientRect().top - 80))).toBeLessThanOrEqual(1);
    const articleBox = await assistant.boundingBox();
    await page.mouse.move(articleBox!.x + 30, articleBox!.y + 20);
    const deleteButton = assistant.getByRole("button", { name: /Delete message|\u5220\u9664\u6d88\u606f/ });
    const point = await deleteButton.evaluate(button => {
      const box = button.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
      const article = button.closest("article")!, root = article.closest("[data-reader-scroll-root='true']")!;
      const line = root.getBoundingClientRect().top + 120, bounds = article.getBoundingClientRect();
      return { x, y, hit: button.contains(document.elementFromPoint(x, y)), readingThisMessage: bounds.top <= line && line < bounds.bottom };
    });
    expect(point.hit).toBe(true);
    expect(point.readingThisMessage).toBe(true);
    const nextMessage = assistant.locator("xpath=following::article[@data-message-id][1]");
    await expect(nextMessage).toBeVisible();
    const nextMessageId = await nextMessage.getAttribute("data-message-id");
    expect(nextMessageId).toBeTruthy();
    const nextOffsetBefore = await nextMessage.evaluate((article) => {
      const root = article.closest<HTMLElement>("[data-reader-scroll-root='true']");
      if (!root) throw new Error("Reader scroll root is missing");
      return article.getBoundingClientRect().top - root.getBoundingClientRect().top;
    });
    await nextMessage.evaluate((article, baseline) => {
      const root = article.closest<HTMLElement>("[data-reader-scroll-root='true']")!;
      const host = window as unknown as { mutationProbe: MutationProbe };
      const probe: MutationProbe = { baseline, frames: [], stop: false };
      host.mutationProbe = probe;
      const tick = () => {
        if (probe.stop) return;
        const live = document.getElementById(article.id);
        probe.frames.push({ time: performance.now(), top: live ? live.getBoundingClientRect().top - root.getBoundingClientRect().top : -1,
          scroll: root.scrollTop, height: root.scrollHeight, writer: root.dataset.readerLastScrollWriter ?? "none",
          stage: root.dataset.navigationStage ?? "fresh", empty: root.querySelectorAll("article[data-message-id]").length === 0 });
        requestAnimationFrame(tick);
      }; tick();
    }, nextOffsetBefore);
    await scrollRoot.evaluate((root) => {
      root.dataset.testBecameEmpty = "false";
      const observer = new MutationObserver(() => {
        if (root.querySelectorAll("article[data-message-id]").length === 0) {
          root.dataset.testBecameEmpty = "true";
        }
      });
      observer.observe(root, { childList: true, subtree: true });
      (root as HTMLElement & { __mutationWindowObserver?: MutationObserver }).__mutationWindowObserver = observer;
    });

    await page.mouse.click(point.x, point.y);
    // Opening the confirmation must not have moved the reading baseline.
    expect(await nextMessage.evaluate((article, baseline) => Math.abs(article.getBoundingClientRect().top
      - article.closest("[data-reader-scroll-root='true']")!.getBoundingClientRect().top - baseline), nextOffsetBefore)).toBeLessThanOrEqual(1);
    const deleteResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "DELETE" && response.url().includes("/api/messages/")
    ));
    await page.getByRole("dialog").getByRole("button", { name: /Delete message|\u5220\u9664\u6d88\u606f/ }).click();
    expect((await deleteResponsePromise).status()).toBe(200);
    await expect(assistant).toHaveCount(0);
    const preservedNextMessage = page.locator(`#message-${nextMessageId}`);
    await expect(preservedNextMessage).toBeVisible();
    await expect.poll(() => preservedNextMessage.evaluate((article, expectedOffset) => {
      const root = article.closest<HTMLElement>("[data-reader-scroll-root='true']");
      if (!root) return Number.POSITIVE_INFINITY;
      return Math.abs((article.getBoundingClientRect().top - root.getBoundingClientRect().top) - expectedOffset);
    }, nextOffsetBefore)).toBeLessThanOrEqual(48);
    await expect(scrollRoot).toHaveAttribute("data-test-became-empty", "false");
    await page.evaluate(() => { (window as unknown as { mutationProbe: MutationProbe }).mutationProbe.stop = true; });

    const undo = page.getByRole("button", { name: /Undo|\u64a4\u9500/ });
    await expect(undo).toBeVisible();
    await page.route("**/api/messages/*/restore*", async (route) => {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "forced" }) });
    }, { times: 1 });
    await undo.click();

    const retry = page.getByRole("button", { name: /Retry|\u91cd\u8bd5/ });
    await expect(retry).toBeVisible();
    await expect(page.getByRole("alert").filter({ has: retry })).toContainText(/Undo failed|\u64a4\u9500\u5931\u8d25/);
    await retry.click();
    await expect(page.getByText(mutationMessageText)).toBeVisible();
    await page.reload();
    await expect(page.getByText(mutationMessageText)).toBeVisible();
    await scrollRoot.evaluate((root) => {
      (root as HTMLElement & { __mutationWindowObserver?: MutationObserver }).__mutationWindowObserver?.disconnect();
    });
  } finally {
    const probe = await page.evaluate(() => {
      const probe = (window as unknown as { mutationProbe?: MutationProbe }).mutationProbe;
      if (probe) probe.stop = true;
      return probe ?? null;
    }).catch(() => null);
    if (probe) await writeFile(info.outputPath("delete-reading-position-frames.json"), JSON.stringify(probe));
    await page.request.delete(`/api/conversations/${conversationId}`);
  }
});

test("revision conflict preserves the source draft until the latest base is compared and explicitly accepted", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const longAssistantSource = Array.from({ length: 180 }, (_, index) => `QA source line ${String(index + 1).padStart(3, "0")} with enough text to require editor scrolling.`).join("\n\n");
  const createdResponse = await page.request.post("/api/conversations", {
    data: {
      title: `QA conflict recovery ${suffix}`,
      messages: [
        { role: "user", content_markdown: "QA conflict user" },
        { role: "assistant", content_markdown: longAssistantSource },
      ],
    },
  });
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json();
  const conversationId = created.conversation.id as string;
  const messageId = created.messages[1].id as string;
  const messageEndpoint = `/api/messages/${messageId}`;

  try {
    const initial = (await (await page.request.get(messageEndpoint)).json()).current_version;
    await page.goto(`/conversations/${conversationId}`);
    const assistant = page.locator("article[data-message-id]").filter({ hasText: "QA source line 001" });
    await expect(assistant).toBeVisible();
    await assistant.getByRole("button", { name: /Edit Markdown source|\u7f16\u8f91 Markdown \u6e90\u7801/ }).click();
    const editor = page.getByTestId("source-editor-codemirror").locator(".cm-content");
    await editor.click();
    await page.keyboard.press("Control+End");
    const readCaret = () => editor.evaluate((element) => {
      const scroller = element.closest<HTMLElement>(".cm-scroller");
      const host = element.closest<HTMLElement>("[data-testid='source-editor-codemirror']");
      return {
        offset: Number(host?.dataset.cursorOffset ?? -1),
        scrollTop: scroller?.scrollTop ?? -1,
        distanceFromBottom: scroller ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop : -1,
      };
    });
    await expect.poll(async () => (await readCaret()).offset).toBe(longAssistantSource.length);
    await expect.poll(async () => (await readCaret()).distanceFromBottom).toBeLessThanOrEqual(12);
    const beforeFirstEdit = await readCaret();
    await page.keyboard.insertText("Z");
    await expect.poll(async () => (await readCaret()).offset).toBe(beforeFirstEdit.offset + 1);
    await expect.poll(async () => (await readCaret()).scrollTop).toBeGreaterThanOrEqual(beforeFirstEdit.scrollTop - 2);
    await page.keyboard.press("Backspace");
    await expect.poll(async () => (await readCaret()).offset).toBe(beforeFirstEdit.offset);
    await expect.poll(async () => (await readCaret()).scrollTop).toBeGreaterThanOrEqual(beforeFirstEdit.scrollTop - 2);
    await page.keyboard.insertText("\n\nQA preserved draft");
    await expect(editor).toContainText("QA preserved draft");
    const draft = `${longAssistantSource}\n\nQA preserved draft`;
    const draftCaret = await readCaret();

    // A real concurrent writer advances canonical state, not a fabricated 409.
    const latestSource = `${longAssistantSource}\n\nQA newer canonical source`;
    const concurrent = await page.request.patch(messageEndpoint, { data: {
      content_markdown: latestSource, base_version_id: initial.id,
      base_content_hash: initial.source_content_hash, operation_id: crypto.randomUUID(),
      save_mode: "create_version",
    } });
    expect(concurrent.status()).toBe(200);
    const latest = (await (await page.request.get(messageEndpoint)).json()).current_version;
    expect(latest.id).not.toBe(initial.id);
    expect(latest.source_content_hash).toBe(createHash("sha256").update(latestSource, "utf8").digest("hex"));

    const saves: Array<Record<string, unknown>> = [];
    await page.route(`**${messageEndpoint}`, async (route) => {
      if (route.request().method() === "PATCH") {
        saves.push(route.request().postDataJSON());
      }
      await route.continue();
    });
    await page.getByTestId("source-editor-create-version").click();

    const compareLatest = page.getByRole("button", { name: /Compare latest source|\u6bd4\u8f83\u6700\u65b0\u5185\u5bb9/ });
    await expect(compareLatest).toBeVisible();
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({
      content_markdown: draft, base_version_id: initial.id, base_content_hash: initial.source_content_hash,
    });
    await expect(editor).toContainText("QA preserved draft");
    await compareLatest.click();
    await expect(page.getByText(/Latest state loaded|\u5df2\u52a0\u8f7d\u6700\u65b0\u72b6\u6001/).last()).toBeVisible();
    await expect(editor).toContainText("QA preserved draft");
    await expect.poll(async () => (await readCaret()).offset).toBe(draftCaret.offset);
    const acceptLatest = page.getByRole("button", { name: /Reviewed — keep editing this draft against the latest version|\u5df2\u6838\u5bf9\uff0c\u4ee5\u6700\u65b0\u7248\u672c\u4e3a\u57fa\u7ebf\u7ee7\u7eed\u7f16\u8f91\u8349\u7a3f/ });
    await expect(acceptLatest).toBeVisible();
    // This footer is inside the production main: it has no implicit
    // contentinfo landmark, unlike the former detached component fixture.
    const comparison = page.getByTestId("floating-source-workspace").locator("footer");
    await expect(comparison).toHaveCount(1);
    await comparison.getByText(/Compare current source and local draft|\u6bd4\u8f83\u5f53\u524d\u6b63\u6587\u4e0e\u672c\u673a\u8349\u7a3f/, { exact: true }).click();
    await expect(comparison.getByText(/Comparing does not save changes|\u6bd4\u8f83\u4e0d\u4f1a\u63d0\u4ea4\u4fee\u6539/)).toBeVisible();
    expect(saves).toHaveLength(1);
    expect((await (await page.request.get(messageEndpoint)).json()).current_version.id).toBe(latest.id);

    await acceptLatest.click();
    expect(saves).toHaveLength(1);
    await expect(editor).toContainText("QA preserved draft");
    await expect.poll(async () => (await readCaret()).offset).toBe(draftCaret.offset);

    await page.getByTestId("source-editor-create-version").click();
    await expect.poll(async () => (await (await page.request.get(messageEndpoint)).json()).current_version.display_text).toBe(draft);
    expect(saves).toHaveLength(2);
    expect(saves[1]).toMatchObject({
      content_markdown: draft, base_version_id: latest.id, base_content_hash: latest.source_content_hash,
    });
    expect(saves[1].operation_id).not.toBe(saves[0].operation_id);
    const saved = (await (await page.request.get(messageEndpoint)).json()).current_version;
    expect(saved.version_number).toBe(latest.version_number + 1);
    expect(saved.source_content_hash).toBe(createHash("sha256").update(draft, "utf8").digest("hex"));
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await page.request.delete(`/api/conversations/${conversationId}`);
  }
});

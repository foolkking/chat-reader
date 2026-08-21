import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_AUTH_PASSWORD;

const MARKDOWN = `## Copy heading

First paragraph with **bold phrase** and [documentation](https://example.com/docs).

Second paragraph has *emphasis*, ~~removed text~~, and \`inline code\`.

Repeated **echo** and later **echo**.

- first item
- second item

\`\`\`js
const answer = 42;
\`\`\``;

test("Owner Reader copies partial formatting and complete cross-block/message Markdown", async ({ page, baseURL }) => {
  await login(page, baseURL!);
  const headers = { Origin: baseURL! };
  const create = await page.request.post("/api/conversations", {
    headers,
    data: {
      title: "Reader Markdown copy QA",
      messages: [
        { role: "user", content_markdown: "Opening **user bold phrase** for cross-message copy." },
        { role: "assistant", content_markdown: MARKDOWN },
      ],
    },
  });
  expect(create.status()).toBe(201);
  const conversation = await create.json() as { conversation: { id: string } };

  try {
    await page.goto(`/conversations/${conversation.conversation.id}`);
    const articles = page.locator("article[data-message-id]");
    await expect(articles).toHaveCount(2);

    const partialBold = await copySelection(page, {
      startSelector: "article[data-message-id]:has(strong) strong",
      startText: "bold phrase",
      startOffset: 0,
      endSelector: "article[data-message-id]:has(strong) strong",
      endText: "bold phrase",
      endOffset: 4,
    });
    expect(partialBold.plain).toBe("**bold**");
    expect(partialBold.markdown).toBe(partialBold.plain);

    const repeated = await copySelection(page, {
      startSelector: "article[data-message-id]:has(strong) strong",
      startSelectorIndex: 3,
      startText: "echo",
      startOffset: 0,
      endSelector: "article[data-message-id]:has(strong) strong",
      endSelectorIndex: 3,
      endText: "echo",
      endOffset: "echo".length,
    });
    expect(repeated.plain).toBe("**echo**");

    const assistant = articles.last();
    const assistantBlocks = assistant.locator('[data-reader-copy-block="true"]');
    const assistantCopy = await copySelection(page, {
      startSelector: await selectorFor(assistantBlocks.first()),
      startText: "Copy heading",
      startOffset: 0,
      endSelector: await selectorFor(assistantBlocks.last()),
      endText: "42;",
      endOffset: 3,
    });
    expect(assistantCopy.plain).toContain("## Copy heading");
    expect(assistantCopy.plain).toContain("[documentation](https://example.com/docs)");
    expect(assistantCopy.plain).toContain("`inline code`");
    expect(assistantCopy.plain).toContain("- first item");
    expect(assistantCopy.plain).toContain("```js\nconst answer = 42;\n```");
    expect(assistantCopy.plain).not.toContain("Copy code");

    const crossMessage = await copySelection(page, {
      startSelector: await selectorFor(articles.first().locator('[data-reader-copy-block="true"]').first()),
      startText: "Opening",
      startOffset: 0,
      endSelector: await selectorFor(assistantBlocks.nth(1)),
      endText: "documentation",
      endOffset: "documentation".length,
    });
    expect(crossMessage.plain).toContain("Opening **user bold phrase** for cross-message copy.");
    expect(crossMessage.plain).toContain("## Copy heading");
    expect(crossMessage.plain).toContain("[documentation](https://example.com/docs)");
    expect(crossMessage.plain).not.toContain("Assistant -");
    expect(crossMessage.plain).not.toContain("Message actions");
  } finally {
    await page.request.delete(`/api/conversations/${conversation.conversation.id}`, { headers });
  }
});

test("Public Share uses the same semantic Markdown copy boundary", async ({ browser, page, baseURL }) => {
  await login(page, baseURL!);
  const headers = { Origin: baseURL! };
  const create = await page.request.post("/api/conversations", {
    headers,
    data: {
      title: "Share Markdown copy QA",
      messages: [
        { role: "user", content_markdown: "Share question" },
        { role: "assistant", content_markdown: "Shared **formatted phrase** with [link](https://example.com/share)." },
      ],
    },
  });
  expect(create.status()).toBe(201);
  const conversation = await create.json() as { conversation: { id: string } };
  const shareResponse = await page.request.post(`/api/conversations/${conversation.conversation.id}/shares`, { headers, data: {} });
  expect(shareResponse.ok()).toBe(true);
  const share = await shareResponse.json() as { id: string; token: string };
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();

  try {
    await guestPage.goto(`${baseURL}/share/${share.token}`);
    await expect(guestPage.getByRole("heading", { name: "Share Markdown copy QA" })).toBeVisible();
    await expect(guestPage.locator("article[data-message-id] strong")).toHaveCount(1);
    const copy = await copySelection(guestPage, {
      startSelector: "article[data-message-id] strong",
      startText: "formatted phrase",
      startOffset: 0,
      endSelector: "article[data-message-id] strong",
      endText: "formatted phrase",
      endOffset: "formatted".length,
    });
    expect(copy.plain).toBe("**formatted**");
  } finally {
    await page.request.post(`/api/shares/${share.id}/revoke`, { headers });
    await page.request.delete(`/api/conversations/${conversation.conversation.id}`, { headers });
    await guest.close();
  }
});

async function login(page: Page, baseURL: string): Promise<void> {
  if (!password) {
    await page.goto(baseURL);
    return;
  }
  await page.goto(`${baseURL}/login`);
  await page.locator("#owner-password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${baseURL}/`);
}

async function selectorFor(locator: import("@playwright/test").Locator): Promise<string> {
  const id = await locator.getAttribute("id");
  if (!id) throw new Error("Copy test block is missing its stable DOM id.");
  return `#${id}`;
}

async function copySelection(page: Page, input: {
  startSelector: string;
  startSelectorIndex?: number;
  startText: string;
  startOffset: number;
  endSelector: string;
  endSelectorIndex?: number;
  endText: string;
  endOffset: number;
}): Promise<{ plain: string; markdown: string }> {
  return page.evaluate((selectionInput) => {
    function endpoint(root: Element, value: string, offset: number, end = false): { node: Text; offset: number } | null {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let last: Text | null = null;
      let node = walker.nextNode();
      while (node) {
        const text = node.textContent ?? "";
        if (text.includes(value)) return { node: node as Text, offset: text.indexOf(value) + offset };
        if (text.trim()) last = node as Text;
        node = walker.nextNode();
      }
      return end && last ? { node: last, offset: (last.textContent ?? "").length } : null;
    }
    const startRoot = resolveSelectionRoot(selectionInput.startSelector, selectionInput.startText, selectionInput.startSelectorIndex);
    const endRoot = resolveSelectionRoot(selectionInput.endSelector, selectionInput.endText, selectionInput.endSelectorIndex);
    if (!startRoot || !endRoot) throw new Error("Copy selection root not found.");
    const start = endpoint(startRoot, selectionInput.startText, selectionInput.startOffset);
    const end = endpoint(endRoot, selectionInput.endText, selectionInput.endOffset, true);
    if (!start || !end) throw new Error("Copy selection text endpoint not found.");
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const transfer = new DataTransfer();
    startRoot.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: transfer }));
    selection?.removeAllRanges();
    return { plain: transfer.getData("text/plain"), markdown: transfer.getData("text/markdown") };

    function resolveSelectionRoot(selector: string, value: string, selectorIndex = 0): Element | null {
      const direct = document.querySelectorAll(selector).item(selectorIndex);
      if (direct?.textContent?.includes(value)) return direct;
      return Array.from(document.querySelectorAll("article[data-message-id]"))
        .find((article) => article.textContent?.includes(value))
        ?.querySelector("strong, em, del, code, p, [data-reader-copy-block='true']") ?? direct;
    }
  }, input);
}

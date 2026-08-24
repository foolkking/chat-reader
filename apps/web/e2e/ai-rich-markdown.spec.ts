import { expect, test, type Page } from "@playwright/test";

const runRichMarkdown = process.env.E2E_RICH_MARKDOWN === "1";
const evidenceDir = process.env.E2E_SCREENSHOT_DIR ?? "../../docs/execution/screenshots";

test.skip(!runRichMarkdown, "E2E_RICH_MARKDOWN=1 is required");

const GOLDEN = String.raw`\[
\boxed{
\lim_{n\to\infty}
\left(
\frac{1^2}{\sqrt{n^6+n}}
+
\frac{2^2}{\sqrt{n^6+2n}}
+\cdots+
\frac{n^2}{\sqrt{n^6+n^2}}
\right)
}
\]`;

const RICH_MARKDOWN = `${GOLDEN}

中文行内公式 \\(x^2+y^2=z^2\\) 正常。

$x^2+y^2=z^2$

$$
\\begin{pmatrix}
1 & 2 \\\\
3 & 4
\\end{pmatrix}
$$

The price is $20. USD $20 and $5 and $10.

| A | B |
| - | - |
| 1 | 2 |

- [x] Completed
- [ ] Pending

~~old~~ new

Text[^1]

[^1]: Footnote text.

Inline code: \`\\(x^2\\)\`

\`\`\`latex
\\[
x^2
\\]
\`\`\`

[safe](https://example.com) [unsafe](javascript:alert(1))

https://example.org/autolink

<script>window.__richMarkdownXss = true</script>`;

const INVALID_MATH = String.raw`\[
\frac{
\]`;

const CHATGPT_BARE_BRACKET = String.raw`[
\boxed{
S_n
===

\frac1n
\sum_{k=1}^{n}
\frac{\left(\frac{k}{n}\right)^2}
{\sqrt{1+\frac{k}{n^5}}}
}
]`;

const CHATGPT_CONSUMED_INLINE = `## 第一步：为什么先提 (n^3)？

根号中最高次是 (n^6)，所以应该提出 (n^6)：

[
f(x)=x^2.
]

普通说明 (Appendix A)、日期 (2026-08-12) 与价格 $20 不应成为公式。`;

test("AI Rich Markdown renders semantic math, GFM, footnotes, and safe code", async ({ page }) => {
  await page.addInitScript(() => {
    const runtime = window as typeof window & { __cspDirectiveViolations?: string[] };
    runtime.__cspDirectiveViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      runtime.__cspDirectiveViolations!.push(`${event.effectiveDirective}:${event.disposition}`);
    });
  });
  const conversationId = await importFixture(page, RICH_MARKDOWN);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/conversations/${conversationId}`);
    const assistant = page.locator("article[data-message-id]").last();
    await expect(assistant.locator(".katex-display")).toHaveCount(2);
    await expect(assistant.locator(".katex")).toHaveCount(4);
    await expect(assistant.locator(".katex-mathml math")).toHaveCount(4);
    await expect(assistant.locator(".katex-html").first()).toBeVisible();
    await expect(assistant.locator('[data-math-error="true"]')).toHaveCount(0);
    await expect(assistant).toContainText("The price is $20. USD $20 and $5 and $10.");
    await expect(assistant.locator("table")).toHaveCount(1);
    await expect(assistant.locator("del")).toHaveText("old");
    const taskList = assistant.locator("[data-markdown-task-list='true']");
    await expect(taskList).toHaveCount(1);
    await expect(taskList.getByRole("checkbox")).toHaveCount(2);
    expect(await taskList.locator(":scope > li").first().evaluate((element) => getComputedStyle(element).listStyleType)).toBe("none");
    await expect(assistant.locator("[data-footnote-ref]")).toHaveCount(1);
    await expect(assistant.locator("[data-footnote-backref]")).toHaveCount(1);
    await expect(assistant.locator("code").filter({ hasText: "\\(x^2\\)" })).toHaveCount(1);
    const fencedCode = assistant.locator("pre").filter({ hasText: "\\[" });
    await expect(fencedCode).toHaveCount(1);
    await fencedCode.scrollIntoViewIfNeeded();
    await expect(fencedCode.locator("code > span").first()).toBeVisible();
    await expect(assistant.locator('a[href^="javascript:"]')).toHaveCount(0);
    await expect(assistant.locator('a[href="https://example.org/autolink"]')).toHaveCount(1);
    expect(await page.evaluate(() => (window as typeof window & { __richMarkdownXss?: boolean }).__richMarkdownXss)).not.toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: `${evidenceDir}/ai-rich-markdown-desktop-1440x900.png`, fullPage: false, animations: "disabled" });

    await assistant.getByRole("button", { name: /Edit Markdown source|\u7f16\u8f91 Markdown \u6e90\u7801/ }).click();
    const preview = page.getByTestId("source-editor-rich-preview");
    await expect(preview).toHaveCount(0);
    await expect(page.getByTestId("source-editor-preview-toggle")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("source-editor-preview-toggle").click();
    await expect(preview.locator(".katex-display")).toHaveCount(2);
    await expect(preview.locator("[data-footnote-ref]")).toHaveCount(1);
    const editorSource = await page.getByTestId("source-editor-codemirror").locator(".cm-content").innerText();
    expect(editorSource).toContain("\\[");
    expect(editorSource).toContain("\\boxed{");
    expect(editorSource).toContain("\\]");
    const editor = page.getByTestId("source-editor-codemirror");
    await editor.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    const cursorBefore = Number(await editor.getAttribute("data-cursor-offset"));
    await page.keyboard.type("x");
    await page.keyboard.press("Backspace");
    await expect.poll(async () => Number(await editor.getAttribute("data-cursor-offset"))).toBe(cursorBefore);
    await expect(preview.locator(".katex-display")).toHaveCount(2);
    expect(await page.evaluate(() => (
      (window as typeof window & { __cspDirectiveViolations?: string[] }).__cspDirectiveViolations ?? []
    ))).toEqual([]);
    await page.getByRole("button", { name: /Reading mode|\u9605\u8bfb\u6a21\u5f0f/ }).click();

    await page.setViewportSize({ width: 360, height: 800 });
    await page.reload();
    await expect(page.locator(".katex-display").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await page.locator(".katex-display").first().evaluate((element) => element.scrollWidth >= element.clientWidth)).toBe(true);
    await page.locator("[data-testid^='task-']").evaluateAll((elements) => {
      elements.forEach((element) => element.parentElement?.setAttribute("hidden", ""));
    });
    await page.screenshot({
      path: `${evidenceDir}/ai-rich-markdown-mobile-360x800.png`,
      fullPage: false,
      animations: "disabled",
    });
    expect(await page.evaluate(() => (
      (window as typeof window & { __cspDirectiveViolations?: string[] }).__cspDirectiveViolations ?? []
    ))).toEqual([]);
  } finally {
    await page.request.delete(`/api/conversations/${conversationId}`);
  }
});

test("advanced environments and 100-formula stress remain bounded", async ({ page }) => {
  const formulas = Array.from({ length: 105 }, (_, index) => `$x_${index}^2$`).join(" ");
  const source = String.raw`\[
\begin{aligned}
a &= b+c \\
  &= d+e
\end{aligned}
\]

\[
f(x)=\begin{cases}
x^2 & x>0 \\
0 & x\le 0
\end{cases}
\]

\[
\text{中文说明}
\]

` + formulas + String.raw`

\[
\frac{1}{1+\frac{1}{1+\frac{1}{1+\frac{1}{1+x}}}}+\underbrace{x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x}_{long\ display}
\]`;
  const conversationId = await importFixture(page, source);
  try {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/conversations/${conversationId}`);
    const assistant = page.locator("article[data-message-id]").last();
    await expect(assistant.locator(".katex-display")).toHaveCount(4);
    await expect(assistant.locator(".katex")).toHaveCount(109);
    await expect(assistant.locator(".katex-mathml math")).toHaveCount(109);
    await expect(assistant.locator('[data-math-error="true"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally {
    await page.request.delete(`/api/conversations/${conversationId}`);
  }
});

test("long display integrals with nested delimiters remain semantic math", async ({ page }) => {
  const source = String.raw`### Long integral

\[
\mathbb E[f(X)]
=
\int_{\mathbb R^n}
f(\mathbf x)
\frac{
1
}{
(2\pi)^{n/2}
|\Sigma|^{1/2}
}
\exp
\left[
-\frac12
(\mathbf x-\boldsymbol\mu)^\top
\Sigma^{-1}
\right]
\,d\mathbf x
\]`;
  const conversationId = await importFixture(page, source);
  try {
    await page.goto(`/conversations/${conversationId}`);
    const assistant = page.locator("article[data-message-id]").last();
    await expect(assistant.locator(".katex-display")).toHaveCount(1);
    await expect(assistant.locator(".katex-mathml math")).toHaveCount(1);
    await expect(assistant.locator('[data-math-error="true"]')).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/conversations/${conversationId}`);
  }
});

test("invalid and untrusted math is isolated without external fetch", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:3107")) externalRequests.push(request.url());
  });
  const source = `${INVALID_MATH}\n\nBefore.\n\n$$\\includegraphics{https://example.com/a.png}$$\n\n![remote](https://example.com/remote.png)\n\nAfter.`;
  const conversationId = await importFixture(page, source);
  try {
    await page.goto(`/conversations/${conversationId}`);
    const assistant = page.locator("article[data-message-id]").last();
    await expect(assistant).toContainText("Before.");
    await expect(assistant).toContainText("After.");
    await expect(assistant.locator('[data-math-error="true"]')).toHaveCount(1);
    await expect(assistant.locator('[data-math-error="true"]').first()).toHaveAttribute("aria-label", /\u65e0\u6cd5\u6e32\u67d3\u516c\u5f0f/);
    await expect(assistant.locator('img[src*="example.com"]')).toHaveCount(0);
    expect(externalRequests.filter((url) => url.includes("example.com"))).toEqual([]);
  } finally {
    await page.request.delete(`/api/conversations/${conversationId}`);
  }
});

test("ChatGPT clipboard source with consumed outer escapes renders as display math", async ({ page }) => {
  const conversationId = await importFixture(page, CHATGPT_BARE_BRACKET);
  try {
    await page.goto(`/conversations/${conversationId}`);
    const assistant = page.locator("article[data-message-id]").last();
    await expect(assistant.locator(".katex-display")).toHaveCount(1);
    await expect(assistant.locator(".katex-mathml math")).toHaveCount(1);
    expect(await assistant.evaluate((element) => {
      const clone = element.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(".katex").forEach((node) => node.remove());
      return clone.textContent?.includes("\\boxed") ?? false;
    })).toBe(false);

    await assistant.getByRole("button", { name: /Edit Markdown source|\u7f16\u8f91 Markdown \u6e90\u7801/ }).click();
    await expect(page.getByTestId("source-editor-rich-preview")).toHaveCount(0);
    await expect(page.getByTestId("source-editor-preview-toggle")).toHaveAttribute("aria-pressed", "false");
    const source = await page.getByTestId("source-editor-codemirror").locator(".cm-content").innerText();
    expect(source).toContain("[\n\\boxed{");
    expect(source).toContain("\n]");
    await page.getByTestId("source-editor-preview-toggle").click();
    await expect(page.getByTestId("source-editor-rich-preview").locator(".katex-display")).toHaveCount(1);
  } finally {
    await page.request.delete(`/api/conversations/${conversationId}`);
  }
});

test("ChatGPT clipboard source with consumed inline escapes renders bounded math", async ({ page }) => {
  const conversationId = await importFixture(page, CHATGPT_CONSUMED_INLINE);
  try {
    await page.goto(`/conversations/${conversationId}`);
    const assistant = page.locator("article[data-message-id]").last();
    await expect(assistant.locator(".katex-display")).toHaveCount(1);
    await expect(assistant.locator(".katex:not(.katex-display .katex)")).toHaveCount(3);
    await expect(assistant.locator(".katex-mathml math")).toHaveCount(4);
    await expect(assistant.locator('[data-math-error="true"]')).toHaveCount(0);
    await expect(assistant).toContainText("普通说明 (Appendix A)、日期 (2026-08-12) 与价格 $20 不应成为公式。");

    const headingMath = assistant.locator("h2 .katex");
    await expect(headingMath).toHaveCount(1);
    await expect(headingMath.locator(".katex-mathml math")).toHaveCount(1);
    await expect(headingMath.locator(".katex-html")).toBeVisible();
    expect(await headingMath.locator(".katex-mathml").evaluate((element) => {
      const style = getComputedStyle(element);
      return style.position === "absolute" && style.width === "1px" && style.height === "1px";
    })).toBe(true);

    await assistant.getByRole("button", { name: /Edit Markdown source|\u7f16\u8f91 Markdown \u6e90\u7801/ }).click();
    await expect(page.getByTestId("source-editor-rich-preview")).toHaveCount(0);
    const editorSource = await page.getByTestId("source-editor-codemirror").locator(".cm-content").innerText();
    expect(editorSource).toContain("## 第一步：为什么先提 (n^3)？");
    expect(editorSource).toContain("(n^6)");
    expect(editorSource).toContain("[\nf(x)=x^2.\n]");
    await page.getByTestId("source-editor-preview-toggle").click();
    const preview = page.getByTestId("source-editor-rich-preview");
    await expect(preview.locator(".katex-display")).toHaveCount(1);
    await expect(preview.locator(".katex-mathml math")).toHaveCount(4);
  } finally {
    await page.request.delete(`/api/conversations/${conversationId}`);
  }
});

async function importFixture(page: Page, markdown: string): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const create = await page.request.post("/api/conversations", {
    data: {
      title: `AI Rich Markdown ${suffix}`,
      messages: [
        { role: "user", content_markdown: "Render the Markdown fixture." },
        { role: "assistant", content_markdown: markdown },
      ],
    },
  });
  expect(create.ok()).toBeTruthy();
  const body = await create.json() as { conversation: { id: string } };
  return body.conversation.id;
}

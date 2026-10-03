import { expect, test } from "@playwright/test";
import { settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", extraHTTPHeaders: { Origin: "http://127.0.0.1:3107" } });
test.skip(process.env.E2E_CONTEXT_EXPORT !== "1", "Requires the isolated API");

for (const width of [375, 768, 1440]) {
  test(`${width}px: restore one file, find content and follow owned index references`, async ({ page, baseURL }, testInfo) => {
    const locale = width === 1440 ? "en-US" : "zh-CN";
    await page.setViewportSize({ width, height: 950 });
    await settingsAppearance(page.request, baseURL!, locale);
    const created = await page.request.post('/api/conversations', { data: { title: 'Synthetic reading tools', messages: [{ role: 'user', content_markdown: 'Synthetic message 1' }, { role: 'assistant', content_markdown: 'Synthetic message 2' }] } });
    expect(created.status()).toBe(201);
    const initial = await created.json();
    const id = initial.conversation.id;
    let last = initial.messages[1].id;
    for (let n = 3; n <= 61; n += 2) {
      const inserted = await page.request.post(`/api/conversations/${id}/messages/insert`, { data: {
        anchor_message_id: last, position: 'after', mode: 'pair', messages: [{ role: 'user', content_markdown: `Synthetic message ${n}` }, { role: 'assistant', content_markdown: `Synthetic message ${n + 1}` }],
      } });
      expect(inserted.status()).toBe(201);
      last = (await inserted.json()).messages[1].id;
    }
    const messages = await (await page.request.get(`/api/conversations/${id}/messages?limit=100`)).json();
    const targetId = messages[60].id;
    const foreign = await page.request.post('/api/conversations', { data: { title: 'Separate synthetic conversation', messages: [{ role: 'user', content_markdown: 'Unrelated synthetic message' }, { role: 'assistant', content_markdown: 'Unrelated response' }] } });
    const foreignId = (await foreign.json()).conversation.id;
    const foreignMessageId = (await (await page.request.get(`/api/conversations/${foreignId}/messages`)).json())[0].id;
    const endpoint = `/api/conversations/${id}/continuation`;
    const current = `# Restorable current\n\nNeedle **across formatting** here.\n\n${Array.from({ length: 70 }, (_, i) => `Paragraph ${i} with synthetic reading content.\n`).join('\n')}\nNeedle across formatting at the end.`;
    const index = JSON.stringify({ segments: Array.from({ length: 60 }, (_, i) => ({ title: `Topic ${i + 1}`, about: i === 59 ? 'Distinct navigation result' : 'Synthetic topic', key_refs: i === 59 ? [
      { message_id: targetId, purpose: 'exact target' }, { sequence: 62, purpose: 'current order' }, { message_id: foreignMessageId, purpose: 'wrong conversation' },
    ] : [] })) });
    const save = async (generation: number, name: 'current' | 'index', text: string) => {
      const response = await page.request.put(endpoint + '/files', { multipart: { base_generation: String(generation), [name]: { name: `${name}.${name === 'current' ? 'md' : 'json'}`, mimeType: 'text/plain', buffer: Buffer.from(text) } } });
      expect(response.status()).toBe(200);
    };
    await save(0, 'current', current);
    await save(1, 'current', '# Current replaced');
    await save(2, 'index', index);
    const open = async () => {
      if (width < 768) { await page.getByRole('button', { name: /^(更多|More)$/ }).click(); }
      await page.getByRole('button', { name: /^(接续|Continuation)$/ }).click();
    };
    await page.goto(`/conversations/${id}`);
    await expect(page.locator('article[data-message-id]').first()).toBeVisible();
    await open();
    const panel = page.getByRole('region', { name: /^(上下文接续|Context continuation)$/ });
    await panel.getByRole('button', { name: /^(历史|History)$/ }).click();
    await panel.getByRole('button', { name: /^(查看 current|View current)$/ }).last().click();
    await expect(panel.locator('pre')).toHaveText(current);
    await page.screenshot({ path: testInfo.outputPath(`history-${width}.png`) });
    const restore = panel.getByRole('button', { name: /^(仅恢复 Current|Restore Current only)$/ });
    page.once('dialog', dialog => dialog.dismiss());
    await restore.click();
    expect((await (await page.request.get(endpoint)).json()).generation).toBe(3);
    // A concurrent edit must survive a stale restore attempt.
    await save(3, 'index', index + '\n');
    page.once('dialog', dialog => dialog.accept());
    await restore.click();
    await expect(panel.getByRole('alert')).toContainText(/其他窗口|another window/);
    expect((await (await page.request.get(endpoint)).json()).generation).toBe(4);
    // It currently equals the newest Current, so create a different Current,
    // reopen the retained history and restore its actual bytes.
    await save(4, 'current', current);
    await expect.poll(async () => (await (await page.request.get(endpoint)).json()).generation).toBe(5);
    await page.getByRole('button', { name: /^(关闭接续|Close continuation)$/ }).click();
    await open();
    await panel.getByRole('button', { name: /^(历史|History)$/ }).click();
    await panel.getByRole('button', { name: /^(查看 current|View current)$/ }).last().click();
    await expect(panel.locator('pre')).toHaveText('# Current replaced');
    page.once('dialog', dialog => dialog.accept());
    await panel.getByRole('button', { name: /^(仅恢复 Current|Restore Current only)$/ }).click();
    await expect(panel.getByRole('heading', { name: 'Current replaced' })).toBeVisible();
    const restored = await (await page.request.get(endpoint)).json();
    expect(restored.generation).toBe(6);
    expect(await (await page.request.get(endpoint + `/revisions/${restored.adopted_revision_id}/members/index`)).text()).toBe(index + '\n');
    expect(await (await page.request.get(endpoint + '/revisions')).json()).toHaveLength(3);
    // Restore the long Current from the immediately preceding snapshot.
    await panel.getByRole('button', { name: /^(历史|History)$/ }).click();
    await panel.getByRole('button', { name: /^(查看 current|View current)$/ }).nth(1).click();
    page.once('dialog', dialog => dialog.accept());
    await panel.getByRole('button', { name: /^(仅恢复 Current|Restore Current only)$/ }).click();
    await expect(panel.getByRole('heading', { name: 'Restorable current' })).toBeVisible();
    await panel.getByRole('button', { name: /^(查找|Find)$/ }).click();
    await panel.getByRole('searchbox', { name: /查找文件内容|Find in file/ }).fill('needle across formatting');
    await expect(panel.getByRole('status').filter({ hasText: '1/2' })).toBeVisible();
    await panel.getByRole('button', { name: /下一个匹配|Next match/ }).click();
    await expect(panel.getByRole('status').filter({ hasText: '2/2' })).toBeVisible();
    expect(await page.locator('[data-continuation-scroll]').evaluate(el => el.scrollTop)).toBeGreaterThan(700);
    await page.screenshot({ path: testInfo.outputPath(`find-${width}.png`) });
    await panel.getByRole('button', { name: /关闭查找|Close find/ }).click();
    await panel.getByRole('button', { name: 'Index', exact: true }).click();
    await panel.getByRole('searchbox', { name: /搜索全部索引|Search entire index/ }).fill('Distinct navigation');
    await expect(panel.getByRole('status')).toContainText(/1 项匹配，共 60 项|1 matches across 60 entries/);
    await expect(panel.getByText('Topic 60', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: /wrong conversation/ }).click();
    await expect(panel.getByRole('alert')).toContainText(/当前对话|this conversation/);
    await page.screenshot({ path: testInfo.outputPath(`index-${width}.png`) });
    await panel.getByRole('button', { name: /exact target/ }).click();
    await expect(page.getByRole('dialog', { name: /上下文接续|Context continuation/ })).toHaveCount(0);
    await expect(page.locator(`#message-${targetId}`)).toBeVisible();
    await open();
    await expect(panel.getByRole('button', { name: 'Index', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByRole('searchbox')).toHaveValue('Distinct navigation');
    await panel.getByRole('button', { name: /current order/ }).click();
    await expect(page.getByRole('dialog', { name: /上下文接续|Context continuation/ })).toHaveCount(0);
    await expect(page.locator(`#message-${messages[61].id}`)).toBeVisible();
    const after = await (await page.request.get(`/api/conversations/${id}/messages?limit=100`)).json();
    expect(after.map((message: { current_version: { display_text: string } }) => message.current_version.display_text)).toEqual(messages.map((message: { current_version: { display_text: string } }) => message.current_version.display_text));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

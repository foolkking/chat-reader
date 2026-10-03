import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", extraHTTPHeaders: { Origin: "http://127.0.0.1:3107" } });
test.skip(process.env.E2E_CONTEXT_EXPORT !== "1", "Requires isolated API");

async function drafts(page: Page, conversationId: string) {
  return page.evaluate(async id => {
    const userId = localStorage.getItem('chat-reader:offline-active-user-v1') ?? 'local:default';
    const namespace = Array.from(new TextEncoder().encode(userId), byte => byte.toString(16).padStart(2, '0')).join('');
    const name = localStorage.getItem('chat-reader:offline-legacy-owner-v1') === userId
      ? 'chat-reader-offline-library' : `chat-reader-offline-library--user-${namespace}`;
    if (!(await indexedDB.databases()).some(database => database.name === name)) return [];
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const rows = await new Promise<Array<{ key: string; value: { text: string; original: string; base_generation: number } }>>((resolve, reject) => {
        const request = db.transaction('settings').objectStore('settings').getAll();
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      return rows.filter(row => row.key.startsWith(`continuation-draft:${id}:`));
    } finally { db.close(); }
  }, conversationId);
}

for (const width of [375, 1440]) test(`Current draft reload, concurrent editing, pending export and discard at ${width}`, async ({ page, context, baseURL }, info) => {
  await page.setViewportSize({ width, height: 950 });
  await settingsAppearance(page.request, baseURL!, width === 375 ? 'zh-CN' : 'en-US');
  const created = await page.request.post('/api/conversations', { data: { title: 'Synthetic persistent drafts', messages: [{ role: 'user', content_markdown: 'Synthetic raw question' }, { role: 'assistant', content_markdown: 'Synthetic raw answer' }] } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).conversation.id, endpoint = `/api/conversations/${id}/continuation`;
  const initial = '# Saved current';
  expect((await page.request.put(endpoint + '/files', { multipart: { base_generation: '0', current: { name: 'current.md', mimeType: 'text/markdown', buffer: Buffer.from(initial) } } })).status()).toBe(200);
  const open = async (target: Page) => {
    await target.goto(`/conversations/${id}?continuation=current`);
    await expect(target.getByRole('dialog', { name: /上下文接续|Context continuation/ })).toBeVisible();
  };
  await open(page);
  const panel = page.getByRole('region', { name: /^(上下文接续|Context continuation)$/ });
  await panel.getByRole('button', { name: /^(编辑|Edit)$/ }).click();
  const text = '# Local draft\n\nSurvives refresh without changing Raw.';
  await panel.getByRole('textbox').fill(text);
  await expect(panel.getByRole('status').filter({ hasText: /草稿已保存在本机|Draft saved on this device/ })).toBeVisible();
  expect((await drafts(page, id))[0].value).toMatchObject({ text, original: initial, base_generation: 1 });
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await panel.getByRole('button', { name: /继续编辑|Resume draft/, exact: true }).click();
  await expect(panel.getByRole('textbox')).toHaveValue(text);
  // A second real tab resumes the same record, then both edit it. Neither
  // local branch may overwrite the other or silently advance its server base.
  const other = await context.newPage();
  await other.setViewportSize({ width: 1440, height: 950 });
  await open(other);
  await other.getByRole('button', { name: /继续编辑|Resume draft/, exact: true }).click();
  await panel.getByRole('textbox').fill(text + '\nFirst window');
  await expect.poll(async () => (await drafts(page, id))[0].value.text).toBe(text + '\nFirst window');
  await other.getByRole('textbox', { name: /编辑 current|Edit current/ }).fill(text + '\nSecond window');
  await expect.poll(async () => (await drafts(page, id)).map(row => row.value.text).sort()).toEqual([text + '\nFirst window', text + '\nSecond window'].sort());
  let releaseHistory!: () => void;
  const delayedHistory = new Promise<void>(resolve => { releaseHistory = resolve; });
  await other.route(`**/api/conversations/${id}/continuation/revisions`, async route => {
    const response = await route.fetch(); await delayedHistory; await route.fulfill({ response });
  });
  const newerState = other.waitForResponse(async response => response.url().endsWith(endpoint) && response.status() === 200 && (await response.json()).generation === 2);
  expect((await page.request.put(endpoint + '/files', { multipart: { base_generation: '1', index: { name: 'index.json', mimeType: 'application/json', buffer: Buffer.from('{"note":"Newer server Index"}') } } })).status()).toBe(200);
  try {
    await newerState;
    await other.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(other.getByRole('textbox', { name: /编辑 current|Edit current/ })).toHaveValue(text + '\nSecond window');
  } finally { releaseHistory(); }
  await other.unroute(`**/api/conversations/${id}/continuation/revisions`);
  await panel.getByRole('button', { name: /^(保存|Save)$/ }).click();
  await expect(panel.getByRole('alert')).toContainText(/另一个窗口|Another window/);
  await expect(panel.getByRole('textbox')).toHaveValue(text + '\nFirst window');
  expect((await (await page.request.get(endpoint)).json()).generation).toBe(2);
  await page.screenshot({ path: info.outputPath(`retained-draft-${width}.png`) });
  const inspector = await context.newPage();
  await inspector.setViewportSize({ width: 1440, height: 950 });
  await inspector.goto('/recent');
  await inspector.getByRole('button', { name: /^(设置|Settings)$/ }).click();
  await inspector.getByRole('button', { name: /离线与同步|Offline & sync/ }).click();
  const center = inspector.getByRole('dialog', { name: /离线与同步|Offline & sync/ });
  await center.getByRole('tab', { name: /待同步修改|Pending edits/ }).click();
  const downloadPromise = inspector.waitForEvent('download');
  await center.getByRole('button', { name: /导出本机修改与草稿|Export local edits and drafts/ }).click();
  const archive = unzipSync(await readFile((await (await downloadPromise).path())!));
  const pending = JSON.parse(strFromU8(archive['changes.json']));
  expect(pending.continuation_drafts.map((row: { value: { text: string } }) => row.value.text).sort()).toEqual([text + '\nFirst window', text + '\nSecond window'].sort());
  expect(Object.keys(archive).filter(name => name.endsWith('current.md')).map(name => strFromU8(archive[name])).sort()).toEqual([text + '\nFirst window', text + '\nSecond window'].sort());
  await center.getByRole('link', { name: /Current/ }).first().click();
  await expect(inspector.getByRole('button', { name: /继续编辑|Resume draft/, exact: true })).toHaveCount(2);
  page.once('dialog', dialog => dialog.accept());
  await panel.getByRole('button', { name: /^(取消|Cancel)$/ }).click();
  await expect.poll(async () => (await drafts(page, id)).map(row => row.value.text)).toEqual([text + '\nSecond window']);
  other.once('dialog', dialog => dialog.accept());
  await other.getByRole('button', { name: /关闭接续|Close continuation/ }).click();
  await expect(other.getByRole('dialog', { name: /上下文接续|Context continuation/ })).toHaveCount(0);
  await expect.poll(async () => drafts(page, id)).toEqual([]);
  const state = await (await page.request.get(endpoint)).json();
  expect(await (await page.request.get(endpoint + `/revisions/${state.adopted_revision_id}/members/current`)).text()).toBe(initial);
  expect(await (await page.request.get(endpoint + `/revisions/${state.adopted_revision_id}/members/index`)).text()).toBe('{"note":"Newer server Index"}');
  expect((await (await page.request.get(`/api/conversations/${id}/messages`)).json()).map((message: { current_version: { display_text: string } }) => message.current_version.display_text)).toEqual(['Synthetic raw question', 'Synthetic raw answer']);
  await other.close(); await inspector.close();
});

test('Index draft clears after a successful save and restoring original text', async ({ page, baseURL }) => {
  await settingsAppearance(page.request, baseURL!, 'en-US');
  const result = await page.request.post('/api/conversations', { data: { title: 'Synthetic Index draft', messages: [{ role: 'user', content_markdown: 'Synthetic body' }, { role: 'assistant', content_markdown: 'Synthetic answer' }] } });
  expect(result.status()).toBe(201);
  const id = (await result.json()).conversation.id;
  await page.goto(`/conversations/${id}?continuation=index`);
  const panel = page.getByRole('region', { name: 'Context continuation', exact: true });
  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  await panel.getByRole('textbox').fill('{"about":"Synthetic Index draft"}');
  await expect.poll(async () => (await drafts(page, id)).length).toBe(1);
  await panel.getByRole('textbox').fill('{}\n');
  await expect.poll(async () => (await drafts(page, id)).length).toBe(0);
  const text = '{"about":"Saved Index"}';
  await panel.getByRole('textbox').fill(text);
  await expect.poll(async () => (await drafts(page, id)).length).toBe(1);
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.getByText('Saved Index', { exact: true })).toBeVisible();
  await expect.poll(async () => (await drafts(page, id)).length).toBe(0);
  await page.reload();
  await expect(panel.getByText('Saved Index', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Resume draft', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  await panel.getByRole('textbox').fill('{"about":"Chosen local Index"}');
  const endpoint = `/api/conversations/${id}/continuation`;
  expect((await page.request.put(endpoint + '/files', { multipart: { base_generation: '1', index: { name: 'index.json', mimeType: 'application/json', buffer: Buffer.from('{"about":"New server Index"}') } } })).status()).toBe(200);
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Another window');
  await panel.getByRole('button', { name: 'Compare latest file', exact: true }).click();
  const comparison = panel.getByRole('region', { name: 'Latest file comparison' });
  await expect(comparison).toContainText('New server Index');
  page.once('dialog', dialog => dialog.dismiss());
  await comparison.getByRole('button', { name: 'Update this version with draft' }).click();
  expect((await (await page.request.get(endpoint)).json()).generation).toBe(2);
  page.once('dialog', dialog => dialog.accept());
  await comparison.getByRole('button', { name: 'Update this version with draft' }).click();
  await expect(panel.getByText('Chosen local Index', { exact: true })).toBeVisible();
  await expect.poll(async () => (await drafts(page, id)).length).toBe(0);
  expect((await (await page.request.get(endpoint)).json()).generation).toBe(3);
});

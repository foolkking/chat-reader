import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { Origin: "http://127.0.0.1:3107" } });
test.skip(process.env.E2E_CONTEXT_EXPORT !== "1", "Requires isolated API and live worker");

async function downloadPackage(page: Page, info: TestInfo, name: string) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Context Package", exact: true }).click();
  const file = await pending;
  const path = info.outputPath(`${name}.context.zip`);
  await file.saveAs(path);
  const members = unzipSync(await readFile(path));
  const records = strFromU8(members["conversation.canjsonl"]).trim().split("\n").map(line => JSON.parse(line));
  const { stdout } = await promisify(execFile)(process.env.PYTHON ?? "python", [resolve("../../tools/testing/inspect_context_export.py"), path]);
  return { members, records, inspection: JSON.parse(stdout) };
}

for (const legacy of [false, true]) test(`${legacy ? "legacy optional-member compatibility" : "actual offline download"}: Context bodies, anchors, attachments and saved Pair`, async ({ page, context, baseURL }, info) => {
  test.setTimeout(180_000);
  await settingsAppearance(page.request, baseURL!, "en-US");
  const oldBody = "Synthetic obsolete quotation";
  const projectName = `Synthetic parity project ${Date.now()}`;
  const project = await page.request.post("/api/projects", { data: { name: projectName, description: "Synthetic initial constraints" } });
  expect(project.status()).toBe(201);
  const projectId = (await project.json()).id;
  const transcript = `# ${projectName}\n\n**User:** Anonymous  \n**Created:** Unknown  \n**Updated:** Unknown  \n**Exported:** 9/29/2026 15:29:29  \n**Link:** N/A\n\n## Prompt:\nUnknown\n\nSynthetic multilingual question 中文\n\n\`\`\`python\nprint('synthetic')\n\`\`\`\n\n## Response:\nUnknown · synthetic-test-model\n\n${oldBody}\n`;
  const imported = await page.request.post("/api/adaptive-import/sessions", { multipart: {
    files: { name: "synthetic.chat-transcript.md", mimeType: "text/markdown", buffer: Buffer.from(transcript) },
  } });
  expect(imported.status()).toBe(201);
  const sessionData = await imported.json();
  expect(sessionData.state).toBe("READY");
  const committed = await page.request.post(`/api/imports/${sessionData.import_id}/commit`);
  expect([200, 202]).toContain(committed.status());
  const statusURL = `/api/imports/${sessionData.import_id}/status`;
  await expect.poll(async () => (await (await page.request.get(statusURL)).json()).status,
    { message: "The real import worker must commit the transcript" }).toBe("committed");
  const persistedImport = await (await page.request.get(statusURL)).json();
  expect(persistedImport.conversation_ids).toHaveLength(1);
  const id = persistedImport.conversation_ids[0];
  expect((await page.request.post(`/api/projects/${projectId}/conversations/${id}`)).ok()).toBe(true);
  const beforeProjectEdit = (await (await page.request.get(`/api/conversations/${id}`)).json()).offline_revision;
  expect((await page.request.patch(`/api/projects/${projectId}`, { data: { description: "Synthetic project constraints" } })).ok()).toBe(true);
  expect((await (await page.request.get(`/api/conversations/${id}`)).json()).offline_revision).toBeGreaterThan(beforeProjectEdit);
  expect((await page.request.patch(`/api/conversations/${id}`, { data: { description_markdown: "Synthetic description" } })).ok()).toBe(true);
  const window = await (await page.request.get(`/api/conversations/${id}/message-window`)).json();
  const message = window.items[1], oldId = message.current_version.id;
  const annotation = await page.request.post(`/api/conversations/${id}/annotations`, { data: {
    message_id: message.id, message_version_id: oldId, annotation_type: "highlight", color: "yellow",
    start_block_index: 0, end_block_index: 0, start_offset: 0, end_offset: oldBody.length, quote: oldBody,
    comment_markdown: "Synthetic retained annotation",
  } });
  expect(annotation.status()).toBe(201);
  const annotationId = (await annotation.json()).id;
  const session = await page.request.post(`/api/conversations/${id}/attachment-upload-sessions`, { data: {} });
  expect(session.status()).toBe(201);
  const bytes = Buffer.from("Synthetic parity attachment bytes\n中文");
  const uploaded = await page.request.post(`/api/attachment-upload-sessions/${(await session.json()).id}/items`, { multipart: {
    file: { name: "synthetic-parity.txt", mimeType: "text/plain", buffer: bytes },
  } });
  expect(uploaded.status()).toBe(201);
  const attach = await page.request.post(`/api/conversations/${id}/attachments`, { data: { upload_item_ids: [(await uploaded.json()).id] } });
  expect(attach.status()).toBe(201);
  const attachments = await (await page.request.get(`/api/conversations/${id}/attachments`)).json();
  const attachmentId = attachments.items[0].id;
  const newBody = `Synthetic replacement answer\n\n[Fixture](cr-asset://${attachmentId})`;
  const edited = await page.request.patch(`/api/messages/${message.id}`, { data: {
    content_markdown: newBody, base_version_id: oldId,
    attachment_occurrences: [{ attachment_id: attachmentId, occurrence_key: "synthetic-attachment", placement: "inline", display_order: 0 }],
  } });
  expect(edited.status()).toBe(200);
  const latestAnnotation = (await (await page.request.get(`/api/conversations/${id}/annotations`)).json())[0];
  expect(latestAnnotation.message_version_id).toBe(oldId);
  const notebook = await (await page.request.get(`/api/conversations/${id}/notebook`)).json();
  expect((await page.request.put(`/api/conversations/${id}/notebook`, { data: { id: notebook.id, base_revision: notebook.revision,
    title: "Synthetic notes", blocks: [{ id: randomUUID(), type: "markdown", markdown: "Synthetic notebook text" },
      { id: randomUUID(), type: "annotation_reference", annotation_id: annotationId }],
  } })).ok()).toBe(true);
  const current = "# Synthetic continuation\n\nUser-maintained current.";
  const index = JSON.stringify({ chapters: [{ title: "Synthetic history", key_refs: [{ message_id: message.id }] }] });
  expect((await page.request.put(`/api/conversations/${id}/continuation/files`, { multipart: {
    base_generation: "0", current: { name: "current.md", mimeType: "text/markdown", buffer: Buffer.from(current) },
    index: { name: "index.json", mimeType: "application/json", buffer: Buffer.from(index) },
  } })).ok()).toBe(true);

  await page.goto(`/conversations/${id}`);
  await expect(page.locator("article[data-message-id]").first()).toBeVisible();
  await page.getByRole("button", { name: "Message actions", exact: true }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("checkbox", { name: /^Include attachments/ }).check();
  await page.getByRole("button", { name: "Generate export", exact: true }).click();
  const online = await downloadPackage(page, info, "online");

  // Exercise real worker packaging, HTTP download and app ingestion. Never seed IndexedDB.
  if (legacy) await page.route("**/api/offline/packages/*/download", async route => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const members = unzipSync(await response.body());
    const payload = JSON.parse(strFromU8(members["package.json"]));
    for (const conversation of payload.conversations) {
      delete conversation.project_context;
      for (const message of conversation.messages) delete message.annotation_versions;
    }
    members["package.json"] = strToU8(JSON.stringify(payload));
    await route.fulfill({ response, body: Buffer.from(zipSync(members)) });
  });
  await page.goto(`/library?conversationId=${id}`);
  await page.getByRole("button", { name: "Download offline copy", exact: true }).click();
  await expect(page.locator(`[data-message-id="${message.id}"]`).first()).toBeVisible();
  await expect(page.locator("p:visible, span:visible", { hasText: /^(Offline ready|Existing offline version is available)/ }).first()).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(`[data-message-id="${message.id}"]`).first()).toBeVisible();
  await page.getByRole("button", { name: "Message actions", exact: true }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const panel = page.getByTestId("offline-export-panel");
  await panel.getByLabel(/^Include cached attachments/).check();
  await panel.getByText("More content options", { exact: true }).click();
  for (const label of ["Include conversation description", "Include annotations", "Include notebook"]) await panel.getByLabel(label, { exact: true }).check();
  await panel.getByRole("button", { name: "Generate offline export", exact: true }).click();
  const offline = await downloadPackage(page, info, "offline");
  if (legacy) await expect(panel.getByRole("status")).toContainText("original message versions are not cached");
  expect(offline.inspection).toEqual(online.inspection);
  expect(offline.inspection.attachment_refs).toBe(1);
  expect(offline.inspection.message_count).toBe(2);
  expect(offline.records.filter(record => record.record_type === "source_ref")).toEqual(online.records.filter(record => record.record_type === "source_ref"));
  for (const saved of [online, offline]) {
    expect(saved.records.filter(record => record.record_type === "message").map(record => record.current_version.content_markdown)[1]).toBe(newBody);
    const missingHistory = legacy && saved === offline;
    expect(saved.records.find(record => record.record_type === "message_version" && record.id === oldId)?.content_markdown).toBe(missingHistory ? undefined : oldBody);
    const note = saved.records.find(record => record.record_type === "annotation");
    expect(note?.version_id).toBe(missingHistory ? null : oldId);
    expect(note?.quoted_text).toBe(oldBody);
    if (missingHistory) {
      expect(note.unavailable_anchor_version_id).toBe(oldId);
      expect(saved.records[0].extensions.chat_reader_offline_snapshot).toMatchObject({ unavailable_annotation_anchor_count: 1, project_context: "unavailable" });
    }
    expect(saved.records.find(record => record.record_type === "notebook")?.blocks).toHaveLength(2);
    expect(saved.records[0].conversation.description_markdown).toBe("Synthetic description");
    const sourceRefs = saved.records.filter(record => record.record_type === "source_ref");
    expect(sourceRefs).toHaveLength(2);
    expect(sourceRefs.find(record => record.message_id === message.id)?.source_metadata).toMatchObject({ model: "synthetic-test-model", timestamp_display: "Unknown" });
    expect(saved.records.find(record => record.record_type === "project_context")).toEqual(missingHistory ? undefined : { record_type: "project_context",
      project_id: projectId, name: projectName, description: "Synthetic project constraints", conversation_role: "member" });
    expect(strFromU8(saved.members["continuation/current.md"])).toBe(current);
    expect(strFromU8(saved.members["continuation/index.json"])).toBe(index);
    const asset = Object.keys(saved.members).find(name => name.startsWith("assets/"));
    expect(asset).toBeTruthy();
    expect(Buffer.from(saved.members[asset!])).toEqual(bytes);
  }
  // Omitting the binaries must not change message/attachment fingerprints.
  await panel.getByLabel(/^Include cached attachments/).uncheck();
  await panel.getByRole("button", { name: "Generate offline export", exact: true }).click();
  const metadata = await downloadPackage(page, info, "offline-metadata");
  expect(metadata.inspection).toEqual(online.inspection);
  expect(Object.keys(metadata.members).some(name => name.startsWith("assets/"))).toBe(false);
  await panel.getByLabel("Include annotations", { exact: true }).uncheck();
  await panel.getByRole("button", { name: "Generate offline export", exact: true }).click();
  const withoutAnnotations = await downloadPackage(page, info, "offline-without-annotations");
  expect(withoutAnnotations.records.filter(record => record.record_type === "message_version" || record.record_type === "annotation")).toHaveLength(0);
  expect(withoutAnnotations.records.find(record => record.record_type === "notebook")?.blocks).toHaveLength(1);
});

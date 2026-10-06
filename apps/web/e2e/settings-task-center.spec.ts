import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { settingsAdmin, settingsAppearance } from "./settings-test-helper";

test.use({ trace: "off", actionTimeout: 20_000, extraHTTPHeaders: { Origin: "http://127.0.0.1:3107" } });
test.skip(process.env.E2E_SETTINGS_MAILBOX !== "1", "Requires isolated PostgreSQL and real export worker");

for (const width of [375, 768, 1440]) {
  test(`${width}px: task identity survives refresh and delivers its own export`, async ({ page, context, playwright, baseURL }, info) => {
    const admin = await settingsAdmin(playwright.request, baseURL!);
    const locale = width === 768 ? "en-US" : "zh-CN";
    try {
      await context.addCookies((await admin.storageState()).cookies);
      await settingsAppearance(context.request, baseURL!, locale);
      await page.setViewportSize({ width, height: 900 });
      const title = `Synthetic task center ${width}`;
      const body = `Synthetic task body ${crypto.randomUUID()}`;
      const created = await admin.post("/api/conversations", { data: { title, messages: [
        { role: "user", content_markdown: body },
        { role: "assistant", content_markdown: "Synthetic task answer" },
      ] } });
      expect(created.status()).toBe(201);
      const id = (await created.json()).conversation.id;
      const jobs: Array<{ job_id: string; queued_at: string; format: string }> = [];
      for (const format of ["markdown_bundle", "canjson_bundle", "canjson_bundle"]) {
        // Ensure two identical operations have visibly different server times.
        if (jobs.length) await page.waitForTimeout(1100);
        const queued = await admin.post(`/api/conversations/${id}/exports`, {
          headers: { "Idempotency-Key": crypto.randomUUID() }, data: { format },
        });
        expect(queued.status()).toBe(202);
        const job = await queued.json();
        expect(job.source_label).toBe(title);
        expect(job.export_format).toBe(format);
        jobs.push({ ...job, format });
        await expect.poll(async () => (await (await admin.get(`/api/tasks/${job.job_id}`)).json()).status).toBe("committed");
      }
      await page.goto("/");
      await page.reload();
      if (width < 768) await page.getByTestId("mobile-sidebar-button").click();
      await page.getByTestId("sidebar-tasks-button").filter({ visible: true }).click();
      const center = page.getByTestId("task-center-panel");
      const times: string[] = [];
      for (const job of jobs) {
        const row = center.locator(`[id="task-row-${job.job_id}"]`);
        await expect(row).toContainText(title);
        await expect(row).toContainText(job.format === "markdown_bundle" ? "Markdown" : "CanJSON");
        await expect(row.locator("time")).toHaveAttribute("datetime", job.queued_at);
        times.push((await row.locator("time").textContent())!);
        await expect(row.getByRole("progressbar")).toHaveCount(0);
        const download = row.getByRole("button", { name: /^(下载结果|Download result)$/ });
        await expect(download).toBeEnabled();
        const received = page.waitForEvent("download");
        await download.focus(); await page.keyboard.press("Enter");
        const file = await received;
        expect(await file.failure()).toBeNull();
        const entries = unzipSync(await readFile((await file.path())!));
        const member = job.format === "markdown_bundle" ? "conversation.md" : "conversation.canjsonl";
        expect(strFromU8(entries[member])).toContain(body);
        if (job.format === "canjson_bundle") {
          const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
          for (const [name, bytes] of Object.entries(entries)) {
            if (name === "manifest.json") continue;
            expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest.files[name].sha256);
          }
        }
      }
      expect(new Set(times).size).toBe(3);
      expect(await center.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await center.locator(`[id="task-row-${jobs[0].job_id}"]`).scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`task-center-${width}-${locale}.png`) });
      await center.getByTestId(`task-dismiss-${jobs[0].job_id}`).click();
      await expect(center.locator(`[id="task-row-${jobs[0].job_id}"]`)).toHaveCount(0);
      await page.reload();
      if (width < 768) await page.getByTestId("mobile-sidebar-button").click();
      await page.getByTestId("sidebar-tasks-button").filter({ visible: true }).click();
      await expect(page.locator(`[id="task-row-${jobs[0].job_id}"]`)).toHaveCount(0);
      await expect(page.locator(`[id="task-row-${jobs[1].job_id}"]`)).toBeVisible();
    } finally { await admin.dispose(); }
  });
}

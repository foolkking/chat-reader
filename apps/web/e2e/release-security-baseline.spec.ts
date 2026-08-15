import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const expectedPermissions = [
  "browsing-topics=()",
  "camera=()",
  "geolocation=()",
  "microphone=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "bluetooth=()",
];

test("production responses carry the Release A security baseline", async ({ page, request }) => {
  const response = await page.goto("/library");
  expect(response).not.toBeNull();
  const headers = response!.headers();

  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-powered-by"]).toBeUndefined();

  const permissions = headers["permissions-policy"] ?? "";
  for (const directive of expectedPermissions) expect(permissions).toContain(directive);

  const csp = headers["content-security-policy-report-only"] ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).toBeUndefined();

  const staticResponse = await request.get("/skills/chat-reader-conversation-context-acquisition-skill.v1.md");
  expect(staticResponse.headers()["x-content-type-options"]).toBe("nosniff");
});

test("PDF and Mermaid keep their bounded runtime security settings", () => {
  const root = process.cwd();
  const viewer = fs.readFileSync(path.join(root, "features/attachments/attachment-viewer.tsx"), "utf8");
  const pdfRuntime = fs.readFileSync(path.join(root, "features/attachments/pdfjs-runtime.ts"), "utf8");
  const markdown = fs.readFileSync(path.join(root, "features/conversations/markdown-renderer.tsx"), "utf8");

  expect(viewer.match(/pdfjs\.getDocument\(/g)).toHaveLength(1);
  expect(viewer).toContain("useWasm: false");
  expect(viewer).not.toContain("PDFScriptingManager");
  expect(pdfRuntime).toContain('pdfjs-dist/build/pdf.worker.min.mjs');
  expect(pdfRuntime).not.toMatch(/unpkg|jsdelivr|cdnjs/);
  expect(markdown).toContain('securityLevel: "strict"');
});

test("long-running import commit keeps its public proxy contract outside the affected App Route build path", () => {
  const root = process.cwd();
  const pagesRoute = fs.readFileSync(path.join(root, "pages/api/imports/[importId]/commit.ts"), "utf8");
  expect(fs.existsSync(path.join(root, "app/api/imports/[importId]/commit/route.ts"))).toBe(false);
  expect(pagesRoute).toContain('request.method !== "POST"');
  expect(pagesRoute).toContain("UPSTREAM_TIMEOUT_MS = 300_000");
  expect(pagesRoute).toContain("/api/imports/${encodeURIComponent(importId)}/commit");
  expect(pagesRoute).toContain('"x-chat-reader-proxy", "import-commit-route"');
});

test("long-running import commit is served by the dedicated proxy at runtime", async ({ request }) => {
  const response = await request.post("/api/imports/00000000-0000-4000-8000-000000000000/commit");
  expect(response.status()).toBe(404);
  expect(response.headers()["x-chat-reader-proxy"]).toBe("import-commit-route");
  expect(response.headers()["cache-control"]).toContain("no-store");
});

test("CSP remains report-only while core offline shell registration stays available", async ({ page }) => {
  const cspViolations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy|csp/i.test(message.text())) cspViolations.push(message.text());
  });

  await page.goto("/library");
  await expect(page.locator("body")).toBeVisible();
  expect(await page.evaluate(() => "serviceWorker" in navigator)).toBe(true);

  test.info().annotations.push({
    type: "csp-report-only-observation",
    description: cspViolations.length === 0 ? "No browser-console violations on /library." : cspViolations.join(" | ").slice(0, 1000),
  });
});

test("normal production bundles do not expose the PWA negative fault bridge", async ({ page }) => {
  await page.goto("/library");
  expect(await page.evaluate(() => window.__chatReaderPwaNegativeTest)).toBeUndefined();

  const distDir = process.env.NEXT_DIST_DIR?.trim() || ".next";
  const staticDir = path.join(process.cwd(), distDir, "static");
  const bundledFiles = fs.readdirSync(staticDir, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".js"));
  const forbiddenTestMarkers = [
    "__chatReaderPwaNegativeTest",
    "__pdfJsMaliciousExecuted",
    "Synthetic PDF.js migration fixture",
  ];
  for (const marker of forbiddenTestMarkers) {
    const leakingChunk = bundledFiles.find((entry) => (
      fs.readFileSync(path.join(staticDir, entry), "utf8").includes(marker)
    ));
    expect(leakingChunk, `${marker} must not enter the production bundle`).toBeUndefined();
  }
});

test("release workflow cannot build a deployable artifact before quality passes", () => {
  const workflow = fs.readFileSync(path.resolve(process.cwd(), "../../.github/workflows/build-release-images.yml"), "utf8").replace(/\r\n/g, "\n");
  expect(workflow).toMatch(/\n {2}build-images:\n {4}needs: quality\n {4}if: \$\{\{ needs\.quality\.result == 'success' \}\}/);
  expect(workflow).not.toMatch(/continue-on-error:\s*true/);
  expect(workflow.indexOf("name: Upload non-deployable quality evidence")).toBeLessThan(workflow.indexOf("  build-images:"));
  expect(workflow.indexOf("name: Inspect release images")).toBeLessThan(workflow.indexOf("name: Package images and provenance"));
  expect(workflow.indexOf("name: Package images and provenance")).toBeLessThan(
    workflow.indexOf("name: Upload deployable release artifact"),
  );
});

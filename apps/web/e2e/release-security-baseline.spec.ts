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

  const csp = headers["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(csp).toContain("script-src-elem 'self' 'unsafe-inline'");
  expect(csp).toContain("script-src-attr 'none'");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(csp).toContain("worker-src 'self'");
  expect(csp).not.toContain("worker-src 'self' blob:");
  expect(csp).toContain("manifest-src 'self'");
  expect(csp).toContain("frame-src 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy-report-only"]).toBeUndefined();

  const builtinSkills = [
    "/skills/chat-reader-conversation-context-acquisition-skill.v1.md",
    "/skills/chat-reader-conversation-context-acquisition-skill.v1-en.md",
    "/import-rescue/Chat_Reader_Conversation_Rescue_Skill_zh.md",
    "/import-rescue/Chat_Reader_Conversation_Rescue_Skill_en.md",
  ];
  for (const path of builtinSkills) {
    const staticResponse = await request.get(path);
    const staticHeaders = staticResponse.headers();
    expect(staticResponse.status(), path).toBe(200);
    expect(staticHeaders["content-type"], path).toContain("text/markdown");
    expect(staticHeaders["x-content-type-options"], path).toBe("nosniff");
    expect(staticHeaders["content-security-policy"], path).toBe(
      "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox",
    );
    expect((await staticResponse.text()).length, path).toBeGreaterThan(1_000);
  }
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

test("Skill previews remain text-only and never execute uploaded content", () => {
  const root = process.cwd();
  const source = fs.readFileSync(path.join(root, "components/skill-settings.tsx"), "utf8");

  expect(source).toContain("<pre");
  expect(source).not.toContain("dangerouslySetInnerHTML");
  expect(source).not.toMatch(/(marked|remark|rehype|renderToStaticMarkup)/i);
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

test("enforced CSP keeps core offline shell registration available", async ({ page }) => {
  const cspViolations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy|csp/i.test(message.text())) cspViolations.push(message.text());
  });

  await page.goto("/library");
  await expect(page.locator("body")).toBeVisible();
  expect(await page.evaluate(() => "serviceWorker" in navigator)).toBe(true);

  test.info().annotations.push({
    type: "csp-enforcement-observation",
    description: cspViolations.length === 0 ? "No browser-console violations on /library." : cspViolations.join(" | ").slice(0, 1000),
  });
  expect(cspViolations).toEqual([]);
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
  expect(workflow).toMatch(/\n {2}build-images:\n {4}needs: \[api-quality, web-quality\]\n {4}if: \$\{\{ needs\.api-quality\.result == 'success' && needs\.web-quality\.result == 'success' \}\}/);
  expect(workflow).toMatch(/\n {2}api-quality:\n/);
  expect(workflow).toMatch(/\n {2}web-quality:\n/);
  expect(workflow).not.toMatch(/continue-on-error:\s*true/);
  expect(workflow.indexOf("name: Upload non-deployable quality evidence")).toBeLessThan(workflow.indexOf("  build-images:"));
  expect(workflow.indexOf("name: Inspect release images")).toBeLessThan(workflow.indexOf("name: Package images and provenance"));
  expect(workflow.indexOf("name: Package images and provenance")).toBeLessThan(
    workflow.indexOf("name: Upload deployable release artifact"),
  );
});

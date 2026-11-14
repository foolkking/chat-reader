import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";

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

  const legacySkillUrls = [
    "/skills/chat-reader-conversation-context-acquisition-skill.v1.md",
    "/skills/chat-reader-conversation-context-acquisition-skill.v1-en.md",
    "/import-rescue/Chat_Reader_Conversation_Rescue_Skill_zh.md",
    "/import-rescue/Chat_Reader_Conversation_Rescue_Skill_en.md",
  ];
  for (const path of legacySkillUrls) {
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

test("system Skill Bundles download as pinned ZIP attachments", async ({ request }) => {
  for (const name of ["context-acquisition", "context-continuation-maintainer", "chat-transcript-normalizer-skill"]) {
    const response = await request.get(`/skills/${name}.zip`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/zip");
    expect(response.headers()["content-disposition"]).toContain("attachment");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["content-security-policy"]).toBe("default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox");
    const bytes = await response.body();
    const pinned = fs.readFileSync(path.resolve("../../tools/context-skills/default-bundles", `${name}.zip`));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(createHash("sha256").update(pinned).digest("hex"));
    const bundleRoot = name === "chat-transcript-normalizer-skill" ? "chat-transcript-normalizer" : name;
    expect(Object.keys(unzipSync(bytes))).toContain(`${bundleRoot}/SKILL.md`);
  }
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

const releaseQualityJobs = ["api-quality", "web-quality", "settings-quality", "reading-performance-comparison"];
const readReleaseWorkflow = () => fs.readFileSync(
  path.resolve(process.cwd(), "../../.github/workflows/build-release-images.yml"), "utf8",
).replace(/\r\n/g, "\n");

function releaseJob(workflow: string, name: string) {
  const parts = workflow.split(`\n  ${name}:\n`);
  expect(parts, `Exactly one ${name} job is required`).toHaveLength(2);
  return `  ${name}:\n${parts[1].split(/\n {2}[a-z][a-z0-9-]*:\n/, 1)[0]}`;
}

function releaseStep(job: string, name: string) {
  const parts = job.split(`      - name: ${name}\n`);
  expect(parts, `Exactly one ${name} step is required`).toHaveLength(2);
  return `      - name: ${name}\n${parts[1].split(/\n {6}- /, 1)[0].trimEnd()}`;
}

function assertReleaseQualityGate(workflow: string) {
  expect(workflow).toMatch(/workflow_dispatch:\n {4}inputs:\n {6}quality_source_run_id:\n {8}description: [^\n]+\n {8}required: false\n {8}default: ''\n {8}type: string/);
  expect([...workflow.matchAll(/^ {2}[a-z][a-z0-9-]*:\n/gm)]).toHaveLength(6);
  for (const name of releaseQualityJobs) {
    expect(releaseJob(workflow, name).split("\n").slice(0, 2).join("\n")).toBe(
      `  ${name}:\n    if: \${{ inputs.quality_source_run_id == '' }}`,
    );
  }
  expect(releaseJob(workflow, "reading-performance-comparison")).toContain(
    "    needs: [api-quality]\n    uses: ./.github/workflows/reading-performance.yml",
  );

  const builder = releaseJob(workflow, "build-images");
  const successes = releaseQualityJobs.map((name) => `needs.${name}.result == 'success'`).join(" && ");
  const skips = releaseQualityJobs.map((name) => `needs.${name}.result == 'skipped'`).join(" && ");
  // Nonempty input only reaches the pinned source/lineage verifier below; it
  // is not permission to publish when fresh full-mode quality was skipped.
  expect(builder.split("\n").slice(0, 3).join("\n")).toBe([
    "  build-images:",
    `    needs: [${releaseQualityJobs.join(", ")}]`,
    `    if: \${{ !cancelled() && ((inputs.quality_source_run_id == '' && ${successes}) || (inputs.quality_source_run_id != '' && ${skips})) }}`,
  ].join("\n"));
  expect(releaseStep(builder, "Record verified release quality provenance")).toBe([
    "      - name: Record verified release quality provenance",
    "        env:",
    "          GH_TOKEN: ${{ github.token }}",
    "          QUALITY_JOB_RESULTS: ${{ toJSON(needs) }}",
    "          QUALITY_SOURCE_RUN_ID: ${{ inputs.quality_source_run_id }}",
    "        run: >-",
    "          python3 scripts/ci/image-only-quality-reuse.py",
    '          --source-run "$QUALITY_SOURCE_RUN_ID"',
    '          --head "$GITHUB_SHA"',
    '          --output "$RUNNER_TEMP/quality-verification.json"',
  ].join("\n"));

  let previousStep = -1;
  for (const name of [
    "Record verified release quality provenance",
    "Prepare pinned image bases with official-source fallback",
    "Build API and worker image",
    "Verify real 320 MiB worker ZIP analysis and commit without swap",
    "Verify bounded ZIP 100 and 500 MiB sources and long Markdown",
    "Verify real ORM memory-control-plane status and source guards",
    "Build Web image",
    "Inspect release images",
    "Package images and provenance",
    "Upload deployable release artifact",
  ]) {
    expect(releaseStep(builder, name), `${name} must not be conditional`).not.toMatch(/^ {8}if:/m);
    const position = builder.indexOf(`      - name: ${name}\n`);
    expect(position, `${name} must follow its prerequisite`).toBeGreaterThan(previousStep);
    previousStep = position;
  }
  expect(builder.indexOf("docker build")).toBeGreaterThan(
    builder.indexOf("      - name: Record verified release quality provenance\n"),
  );

  const consumer = releaseJob(workflow, "inspect-release-artifact");
  expect(consumer.split("\n").slice(0, 3).join("\n")).toBe(
    "  inspect-release-artifact:\n    needs: build-images\n    if: ${{ needs.build-images.result == 'success' }}",
  );
  const independentInspection = releaseStep(consumer, "Inspect downloaded release archive independently");
  expect(independentInspection.split("\n").slice(0, 6).join("\n")).toBe([
    "      - name: Inspect downloaded release archive independently",
    "        working-directory: release-artifact",
    "        env:",
    "          GH_TOKEN: ${{ github.token }}",
    "          QUALITY_SOURCE_RUN_ID: ${{ inputs.quality_source_run_id }}",
    "        run: |",
  ].join("\n"));
  expect(independentInspection).toContain([
    "          python3 ../scripts/ci/image-only-quality-reuse.py \\",
    '            --source-run "$QUALITY_SOURCE_RUN_ID" --head "$GITHUB_SHA" \\',
    '            --producer-attempt "$ARTIFACT_PRODUCER_ATTEMPT" \\',
    "            --verify-report quality-verification.json --manifest release-manifest.json \\",
    '            --output "$RUNNER_TEMP/quality-verification-consumer.json"',
  ].join("\n"));
  expect(independentInspection.indexOf("docker load")).toBeGreaterThan(
    independentInspection.indexOf("python3 ../scripts/ci/image-only-quality-reuse.py"),
  );
  expect(consumer.indexOf("docker load")).toBeGreaterThan(
    consumer.indexOf("      - name: Inspect downloaded release archive independently\n"),
  );

  expect(workflow).toContain('SETTINGS_POSTGRES_INTEGRATION: "1"');
  expect(workflow).toContain('E2E_SETTINGS_MAILBOX: "1"');
  expect(workflow).not.toMatch(/continue-on-error:\s*true/);
  expect(workflow.indexOf("name: Upload non-deployable quality evidence")).toBeGreaterThanOrEqual(0);
  expect(workflow.indexOf("name: Upload non-deployable quality evidence")).toBeLessThan(workflow.indexOf("  build-images:"));
}

test("release workflow cannot build a deployable artifact before quality passes", () => {
  assertReleaseQualityGate(readReleaseWorkflow());
});

function mutateReleaseJob(workflow: string, name: string, before: string, after: string) {
  const job = releaseJob(workflow, name);
  return workflow.replace(job, job.replace(before, after));
}

const unsafeReleaseMutations = [
  {
    name: "a nonempty default quality source",
    mutate: (workflow: string) => workflow.replace("        default: ''", "        default: '43578495558'"),
  },
  ...releaseQualityJobs.flatMap((name) => [
    {
      name: `skipping fresh ${name} in full mode`,
      mutate: (workflow: string) => mutateReleaseJob(workflow, name, "quality_source_run_id == ''", "quality_source_run_id != ''"),
    },
    {
      name: `omitting the ${name} build dependency`,
      mutate: (workflow: string) => mutateReleaseJob(workflow, "build-images",
        `    needs: [${releaseQualityJobs.join(", ")}]`,
        `    needs: [${releaseQualityJobs.filter((job) => job !== name).join(", ")}]`),
    },
    {
      name: `accepting skipped ${name} as fresh quality`,
      mutate: (workflow: string) => mutateReleaseJob(workflow, "build-images",
        `needs.${name}.result == 'success'`, `needs.${name}.result == 'skipped'`),
    },
    {
      name: `accepting fresh ${name} in the declared reuse branch`,
      mutate: (workflow: string) => mutateReleaseJob(workflow, "build-images",
        `needs.${name}.result == 'skipped'`, `needs.${name}.result == 'success'`),
    },
  ]),
  {
    name: "an absent cancellation guard",
    mutate: (workflow: string) => mutateReleaseJob(workflow, "build-images", "!cancelled() && ", ""),
  },
  {
    name: "quality failure ignored by the builder",
    mutate: (workflow: string) => mutateReleaseJob(workflow, "build-images",
      "    runs-on: ubuntu-latest", "    continue-on-error: true\n    runs-on: ubuntu-latest"),
  },
  {
    name: "optional producer provenance",
    mutate: (workflow: string) => workflow.replace(
      "      - name: Record verified release quality provenance\n",
      "      - name: Record verified release quality provenance\n        if: ${{ false }}\n",
    ),
  },
  {
    name: "missing fresh dependency results in provenance",
    mutate: (workflow: string) => workflow.replace("          QUALITY_JOB_RESULTS: ${{ toJSON(needs) }}\n", ""),
  },
  {
    name: "a provenance source different from the declared input",
    mutate: (workflow: string) => mutateReleaseJob(workflow, "build-images",
      "QUALITY_SOURCE_RUN_ID: ${{ inputs.quality_source_run_id }}", 'QUALITY_SOURCE_RUN_ID: ""'),
  },
  {
    name: "an absent producer source verifier",
    mutate: (workflow: string) => mutateReleaseJob(workflow, "build-images",
      "python3 scripts/ci/image-only-quality-reuse.py", "echo unverified-quality"),
  },
  {
    name: "an extra Docker build before provenance",
    mutate: (workflow: string) => workflow.replace(
      "      - name: Record verified release quality provenance\n",
      "      - name: Unverified early image\n        run: docker build .\n\n      - name: Record verified release quality provenance\n",
    ),
  },
  {
    name: "missing real bounded-memory verification",
    mutate: (workflow: string) => workflow.replace(
      releaseStep(releaseJob(workflow, "build-images"), "Verify bounded ZIP 100 and 500 MiB sources and long Markdown"), "",
    ),
  },
  {
    name: "optional real bounded-memory verification",
    mutate: (workflow: string) => workflow.replace(
      "      - name: Verify bounded ZIP 100 and 500 MiB sources and long Markdown\n",
      "      - name: Verify bounded ZIP 100 and 500 MiB sources and long Markdown\n        if: ${{ false }}\n",
    ),
  },
  {
    name: "missing non-deployable diagnostics",
    mutate: (workflow: string) => workflow.replace("name: Upload non-deployable quality evidence", "name: Missing quality diagnostics"),
  },
  {
    name: "packaging before image inspection",
    mutate: (workflow: string) => workflow
      .replace("name: Inspect release images", "name: Swapped image inspection")
      .replace("name: Package images and provenance", "name: Inspect release images")
      .replace("name: Swapped image inspection", "name: Package images and provenance"),
  },
  {
    name: "an independent consumer admitted without a successful producer",
    mutate: (workflow: string) => mutateReleaseJob(workflow, "inspect-release-artifact",
      "if: ${{ needs.build-images.result == 'success' }}", "if: ${{ always() }}"),
  },
  {
    name: "an absent independent source verifier",
    mutate: (workflow: string) => mutateReleaseJob(workflow, "inspect-release-artifact",
      "python3 ../scripts/ci/image-only-quality-reuse.py", "echo unverified-consumer"),
  },
  {
    name: "optional independent inspection",
    mutate: (workflow: string) => workflow.replace(
      "      - name: Inspect downloaded release archive independently\n",
      "      - name: Inspect downloaded release archive independently\n        if: ${{ false }}\n",
    ),
  },
  {
    name: "an extra Docker load before independent provenance",
    mutate: (workflow: string) => workflow.replace(
      "      - name: Inspect downloaded release archive independently\n",
      "      - name: Unverified early load\n        run: docker load --input unverified.tar\n\n      - name: Inspect downloaded release archive independently\n",
    ),
  },
  {
    name: "an independent proof for a different producer attempt",
    mutate: (workflow: string) => mutateReleaseJob(workflow, "inspect-release-artifact",
      '--producer-attempt "$ARTIFACT_PRODUCER_ATTEMPT"', '--producer-attempt "1"'),
  },
];

for (const { name, mutate } of unsafeReleaseMutations) {
  test(`release quality gate rejects ${name}`, () => {
    const workflow = readReleaseWorkflow();
    const unsafe = mutate(workflow);
    expect(unsafe, "The negative control must actually change the workflow").not.toBe(workflow);
    expect(() => assertReleaseQualityGate(unsafe)).toThrow();
  });
}

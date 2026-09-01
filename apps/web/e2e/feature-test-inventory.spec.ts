import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";

// Keep feature ownership explicit even where a feature is covered by a shared
// contract rather than a feature-named browser file.
const FEATURE_TEST_OWNERS: Record<string, string> = {
  annotations: "annotation-workspace.spec.ts / shared reader-location contracts",
  attachments: "attachment-preview-policy.spec.ts",
  auth: "account-access-settings.spec.ts and auth-gate.spec.ts",
  conversations: "reader-location-failure.spec.ts",
  editing: "source-editor-mutation.spec.ts",
  exporting: "context-package.spec.ts / export API coverage",
  import: "import-markdown.spec.ts",
  offline: "library-offline.spec.ts and pwa-negative.spec.ts",
  projects: "project-dnd.spec.ts / persistent-shell contracts",
  reading: "reader-restoration.spec.ts",
  "rich-markdown": "ai-rich-markdown.spec.ts",
  search: "reader-restoration.spec.ts / search API coverage",
  sharing: "share-focus.spec.ts",
  toc: "toc-refresh-contract.spec.ts",
};

test("every Web feature directory has a named test owner or explicit shared-contract reason", () => {
  const featureRoot = resolve(process.cwd(), "features");
  const featureDirectories = readdirSync(featureRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  expect(featureDirectories.length).toBeGreaterThan(0);
  expect(Object.keys(FEATURE_TEST_OWNERS).sort()).toEqual(featureDirectories);
  for (const feature of featureDirectories) {
    expect(FEATURE_TEST_OWNERS[feature]?.trim()).toBeTruthy();
  }
});

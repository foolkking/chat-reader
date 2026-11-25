import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// This extra native gate is not a skipped member of the original PWA matrix.
// Keep the original browser, timeouts, single worker and no-retry policy.
export default defineConfig({
  ...base,
  testMatch: "**/archive-navigation.browser.ts",
  outputDir: `${process.env.RUNNER_TEMP ?? process.env.TEMP}/archive-navigation-results`,
  reporter: [["list"], ["json"]],
});

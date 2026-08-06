import { defineConfig } from "@playwright/test";

const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3107",
    channel: "chrome",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "corepack pnpm exec next start -p 3107",
    url: "http://127.0.0.1:3107/library",
    timeout: 180_000,
    reuseExistingServer,
  },
});

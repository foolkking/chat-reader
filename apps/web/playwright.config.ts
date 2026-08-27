import { defineConfig } from "@playwright/test";

const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "1";
const useBundledChromium = process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1";
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const runPwaNegativeMatrix = process.env.E2E_PWA_NEGATIVE === "1";
const pnpmCommand = process.env.PNPM_HOME ? "pnpm" : "corepack pnpm";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: runPwaNegativeMatrix ? [] : ["**/pwa-negative.spec.ts"],
  timeout: 90_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3107",
    ...(useBundledChromium ? {} : chromiumExecutablePath ? { launchOptions: { executablePath: chromiumExecutablePath } } : { channel: "chrome" }),
    serviceWorkers: "allow",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `${pnpmCommand} exec next start -p 3107`,
    url: "http://127.0.0.1:3107/library",
    timeout: 180_000,
    reuseExistingServer,
  },
});

import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  globalTeardown: "./tests/e2e-cleanup.ts",
  timeout: 90000,
  use: {
    baseURL: "http://127.0.0.1:18081",
    actionTimeout: 15000,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm exec tsx tests/e2e-server.ts",
    url: "http://127.0.0.1:18081",
    reuseExistingServer: false,
    timeout: 60000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
  },
});

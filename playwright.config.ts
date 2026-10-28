import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end happy path against a running app and the real PayPal sandbox + Gemini.
 * Run manually (`npm run test:e2e`); it is never part of CI because it sends sandbox payouts.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

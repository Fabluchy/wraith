import { defineConfig, devices } from "@playwright/test";

/**
 * Browser matrix for the wallet and transaction flows.
 *
 * The suite runs against `e2e/fixtures/server.mjs`, an in-process fixture server
 * that serves the harness in `e2e/harness/` plus a deterministic wallet API.
 * Nothing here needs a wallet extension, a Stellar secret key, or a public RPC
 * endpoint: the provider is the scripted `e2e/fixtures/wallet-provider.js`.
 *
 * Every engine is a separate project so a browser-specific failure names the
 * engine instead of hiding behind the first engine that passed. Matrix jobs in
 * CI run one project each.
 */
const PORT = Number(process.env.E2E_PORT ?? 4310);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e/tests",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // Retries are bounded. A flaky browser is a browser we want to see, not one
  // we paper over: two attempts in CI, none locally so a rerun is intentional.
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL,
    // Artifacts are kept only for attempts that end a retry chain. A test that
    // fails once and passes on retry leaves nothing to upload; the CI job only
    // uploads `test-results/` when the job itself fails.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  webServer: {
    command: `node e2e/fixtures/server.mjs`,
    url: `${baseURL}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: { E2E_PORT: String(PORT) },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});

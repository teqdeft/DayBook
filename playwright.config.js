import { defineConfig, devices } from '@playwright/test';

// End-to-end tests (guide 15.3). Two ways to run them:
//
// - Local: E2E_BASE_URL=http://localhost:3000 npm run test:e2e
//   Reuses the dev server that is already running; no server is started. The tests use that
//   server's database (DB_NAME from .env.local, normally "daybook"), so DB_NAME must match it.
// - CI: npm run test:e2e
//   Starts `next dev -p 3100` on its own database (daybook_e2e, or E2E_DB_NAME; created when
//   missing) with the development sign-in on.
//   `next start` can't be used: the sign-in shortcut the tests rely on never exists in a production
//   build. Next.js allows one `next dev` per project directory, so CI runs this on a clean checkout
//   (locally, with a dev server already running, use the first way).
//
// Either way the global setup migrates the database and loads the demo data
// (`npm run seed:demo`), and the global teardown loads it again, so the database is left in the
// normal demo state. The tests share one database, so they run one at a time.
const reuseServer = Boolean(process.env.E2E_BASE_URL);
const CI_PORT = 3100;
const CI_URL = `http://localhost:${CI_PORT}`;

if (!reuseServer) {
  // The global setup, the tests and the teardown read the same database the server uses.
  process.env.DB_NAME = process.env.E2E_DB_NAME || 'daybook_e2e';
}

const baseURL = reuseServer ? process.env.E2E_BASE_URL.replace(/\/$/, '') : CI_URL;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.js',
  globalSetup: './tests/e2e/global-setup.js',
  globalTeardown: './tests/e2e/global-teardown.js',
  // The specs change shared demo data, so one worker and no parallel tests.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // No retries: a retried test would start from data its first try already changed.
  retries: 0,
  // `next dev` compiles each route on its first visit, which can take a few seconds.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: 'chrome',
      // The installed Google Chrome, so no browser download is needed.
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: reuseServer
    ? undefined
    : {
        command: `npx next dev -p ${CI_PORT}`,
        // A public file that needs no database: the server starts before the global setup has
        // created and seeded daybook_e2e.
        url: `${CI_URL}/manifest.webmanifest`,
        reuseExistingServer: false,
        timeout: 180_000,
        stdout: 'ignore',
        stderr: 'pipe',
        env: {
          DB_NAME: process.env.DB_NAME,
          DEV_LOGIN_ENABLED: 'true',
          APP_URL: CI_URL,
          PORT: String(CI_PORT),
          WORKER_CRON_ENABLED: 'false',
        },
      },
});

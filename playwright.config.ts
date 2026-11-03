import { defineConfig } from '@playwright/test';

const FIXTURE_URL = 'http://localhost:4173';

export default defineConfig({
  testDir: 'tests',
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
  },
  // Synthetic fixture site (Task 10). Builds then serves fixtures/synthetic/dist on a fixed port.
  webServer: {
    command: 'pnpm fixtures:build && pnpm fixtures:preview',
    url: `${FIXTURE_URL}/native/`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: 'e2e', testDir: 'tests/e2e' },
    // Driver/engine tests on fixtures, extension not loaded.
    { name: 'drivers', testDir: 'tests/drivers', use: { baseURL: FIXTURE_URL } },
  ],
});

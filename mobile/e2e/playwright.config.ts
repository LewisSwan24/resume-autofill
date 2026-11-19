// Device test of the mobile app's profile page in a real Android WebView (emulator or phone on adb).
// Run from the repo root: RAF_SERIAL=<serial> npx playwright test --config mobile/e2e/playwright.config.ts
// Needs the debug APK built first (mobile/android: gradlew assembleDevDebug); WebView debugging is on in debug builds.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: HERE,
  testMatch: /\.device\.spec\.ts$/,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  outputDir: path.join(HERE, 'results'),
  reporter: [['list']],
});

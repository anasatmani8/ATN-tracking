import { defineConfig, devices } from '@playwright/test';

/**
 * Web smoke tests against the exported build (`npm run export:web` first).
 * These exercise the same screens and data layer as the phone apps, in Chromium.
 * They do not replace on-device verification; see docs/release-checklist.md.
 */
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.out',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8081', trace: 'off', ...devices['iPhone 13'], browserName: 'chromium', locale: 'en-GB', timezoneId: 'Europe/Paris',
    // Use a preinstalled Chromium when the environment provides one (PW_CHROMIUM_PATH), else Playwright's own.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'phone-small', use: { viewport: { width: 375, height: 667 } } },
  ],
  webServer: { command: 'node scripts/serve-web.js 8081', url: 'http://127.0.0.1:8081', reuseExistingServer: true, timeout: 30_000 },
});

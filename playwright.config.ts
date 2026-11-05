import { defineConfig } from '@playwright/test';

// Each full viewport run gets its own disposable database. Existing write
// fixtures intentionally use stable identities within one complete suite.
const width = process.env.PLAYWRIGHT_VIEWPORT_WIDTH === '390' ? 390 : 1280;

export default defineConfig({
  testDir: './tests/ui',
  globalSetup: './tests/ui/global-setup.ts',
  testMatch: process.env.HUB_HOSTED_TEST_SIMULATION === '1' ? '**/*h1.spec.ts' : '**/*.spec.ts',
  testIgnore: process.env.HUB_HOSTED_TEST_SIMULATION === '1' ? [] : ['**/*h1.spec.ts'],
  fullyParallel: false,
  workers: 1,
  outputDir: './artifacts/playwright',
  reporter: 'list',
  projects: process.env.HUB_HOSTED_TEST_SIMULATION === '1' ? undefined : [
    { name: width === 390 ? 'mobile-390' : 'desktop-1280', use: { viewport: { width, height: width === 390 ? 900 : 1000 } } },
  ],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    viewport: { width: 1280, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  globalSetup: './tests/ui/global-setup.ts',
  testMatch: process.env.HUB_HOSTED_TEST_SIMULATION === '1' ? '**/*h1.spec.ts' : '**/*.spec.ts',
  testIgnore: process.env.HUB_HOSTED_TEST_SIMULATION === '1' ? [] : ['**/*h1.spec.ts'],
  fullyParallel: false,
  workers: 1,
  outputDir: './artifacts/playwright',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});

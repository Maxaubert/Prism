import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'browse.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: '../../.e2e/browse-results',
  reporter: [['list'], ['html', { outputFolder: '../../.e2e/browse-report', open: 'never' }]],
  use: { trace: 'retain-on-failure' }
})

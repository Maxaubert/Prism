import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'fullscreen.native.spec.ts',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: '../../.e2e/fullscreen-native-results',
  reporter: 'list'
})

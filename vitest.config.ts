import { readFileSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))

// Unit tests only (pure logic under src/). The aliases mirror
// electron.vite.config.ts so test imports match app imports.
export default defineConfig({
  // The version XTVERSION reports: electron.vite.config.ts defines the same.
  define: {
    __PRISM_VERSION__: JSON.stringify((JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }).version)
  },
  resolve: {
    alias: [
      { find: '@shared', replacement: resolve(root, 'src/shared') },
      { find: '@renderer', replacement: resolve(root, 'src/renderer/src') },
      // The core's plain .ts settings modules its package does not export
      // (#292): see CORE_TS in electron.vite.config.ts.
      ...[
        'renderer/settings/coreIndex',
        'renderer/settings/sectionIds',
        'renderer/settings/layout/icons',
        'renderer/settings/diagnosticsOptions'
      ].map((m) => ({
        find: new RegExp(`^prism-term-core/${m}$`),
        replacement: resolve(root, `packages/term-core/${m}.ts`)
      }))
    ]
  },
  test: {
    include: [
      'src/**/*.test.ts',
      'packages/term-core/**/*.test.{ts,tsx}',
      'tools/lib/**/*.test.mjs'
    ],
    environment: 'node',
    // The renderer's stores read localStorage at import time; the setup gives
    // them one so their pure logic can be tested without a browser.
    setupFiles: ['./vitest.setup.ts'],
    // Every scratch folder a test makes lands in one per-run folder, removed
    // when the run ends (vitest.global.ts).
    globalSetup: ['./vitest.global.ts']
  }
})

import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { configDefaults, defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * THE TESTS THAT START A REAL POWERSHELL RUN LAST, ONE FILE AT A TIME
 * (release unit flakes, 2026-11-01). Each starts Windows PowerShell for real,
 * because the real process is the point: the Win+E helper's .NET pipe, a
 * file another process holds, the WMI drive query through the process
 * worker. Started alongside 300 other files on a four-core GitHub runner,
 * PowerShell took 9 s to answer a one-line echo, and on 2026-10-30 these
 * four failed together (the drive query passed the app's 10 s, the lock
 * holder had not started in 25 s). Alone on an idle runner they start in
 * about a second. `src/main/processTests.test.ts` holds the list: a test
 * file that starts PowerShell is in it, or says why not (`// process-ok:`).
 */
export const PROCESS_TESTS = [
  'src/main/winERequests.test.ts',
  'src/main/moveOps.test.ts',
  'src/main/driveUsage.test.ts',
  'src/main/driveModel.test.ts'
]

// Unit tests only (pure logic under src/). The aliases mirror
// electron.vite.config.ts so test imports match app imports.
export default defineConfig({
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
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: [
            'src/**/*.test.ts',
            'packages/term-core/**/*.test.{ts,tsx}',
            'tools/lib/**/*.test.mjs'
          ],
          exclude: [...configDefaults.exclude, ...PROCESS_TESTS]
        }
      },
      {
        extends: true,
        test: {
          name: 'process',
          include: PROCESS_TESTS,
          sequence: { groupOrder: 1 },
          poolOptions: { forks: { singleFork: true } }
        }
      }
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

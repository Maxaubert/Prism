import { app } from 'electron'
import { appendFile } from 'fs/promises'
import { join } from 'path'
import { performance } from 'perf_hooks'
import { haveInstanceLock } from './instanceLock'
import { userPaths } from './paths'
import { bootFields } from './startupLog'
import { shortId, winERequest } from './winERequests'

/**
 * HAND OVER FIRST (owner, 2026-11-28: "the startup of prism is still slow ...
 * when cold starting its very slow up to like 3-4 seconds";
 * research/prism/2026-11-28-cold-start-variance.md). Every launch while Prism
 * rests in standby starts a second Prism.exe, whose only job is to hand its
 * arguments to the running one and leave. It used to load ALL of main (a
 * 776 KB bundle, the indexer, the preferences, 800 lines of setup) before it
 * asked for the lock: 150 ms warm, 0.5 s and more once its files were paged
 * out. This entry asks first, and loads the app (`app.js`, which is index.ts)
 * only in the process that wins. The lock depends on the profile folder alone,
 * which Electron reads from the command line before any of our code runs.
 */
if (!haveInstanceLock()) {
  /**
   * A PROCESS THAT LOST THE LOCK SAYS SO (owner, 2026-11-06; the audit could
   * not tell which of four presses' processes won, nor when). One line in the
   * winner's log, appended whole (a single small write), then gone; the
   * handoff itself is the winner's `second-instance`.
   */
  const created = bootFields(process.getCreationTime(), Date.now())
  const winE = winERequest(process.argv)
  const lost = JSON.stringify({
    t: new Date().toISOString(),
    up: Math.round(performance.now()),
    src: 'main',
    k: 'lock-lost',
    pid: process.pid,
    ...(created ?? {}),
    ...(winE ? { winE: shortId(winE) } : {}),
    ...(process.argv.includes('--e2e') ? { e2e: true } : {})
  })
  const quit = setTimeout(() => app.quit(), 300)
  void appendFile(join(userPaths.logs(), 'diag.jsonl'), lost + '\n')
    .catch(() => {})
    .finally(() => {
      clearTimeout(quit)
      app.quit()
    })
} else {
  // Synchronous, so the app registers `second-instance` before the event loop
  // can deliver one: a launch that arrives while this loads waits, it is not lost.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the app is its own entry (electron.vite.config.ts), loaded only by the winner
  require(join(__dirname, 'app.js'))
}

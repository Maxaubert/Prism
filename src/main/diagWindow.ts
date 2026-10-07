import { diagMain } from 'prism-term-core/main/diagLog'

/**
 * THE WINDOW GUARD'S EVENTS ON THE DIAGNOSTICS LOG (#322, review). Every one
 * goes to window-crashes.log as before; here only what the core does not
 * already say, under a kind `npm run diag` reads:
 *
 * - `gone`, `unresponsive`, `responsive`: NOT written. The core writes its own
 *   `gone` (`hookCrashes`) and `unresponsive` / `responsive`
 *   (`watchWindowHealth`) for the same events, and a second copy made every
 *   hang and every death read twice.
 * - `hang` (the 45 s timer that restarts the page) and `watchdog` (the window
 *   not on screen in time): `window-slow`, a problem by the reader's "an app's
 *   own `-slow` kind" rule. As `k: 'window'` they were never listed.
 * - Anything else (`handoff`, `restore`): a crumb, `a: 'window-<event>'`,
 *   context for the problem that follows it.
 */
const CORE_SAYS_IT = new Set(['gone', 'unresponsive', 'responsive'])
const PROBLEM = new Set(['hang', 'watchdog'])

export function diagWindowEvent(event: string, fields: Record<string, unknown>): void {
  if (CORE_SAYS_IT.has(event)) return
  if (PROBLEM.has(event)) diagMain().write('main', 'window-slow', { ...fields, event })
  else diagMain().write('main', 'crumb', { ...fields, a: `window-${event}` })
}

import { diagMain } from 'prism-term-core/main/diagLog'

/**
 * A crumb said in MAIN (#322): an action on the diagnostics log's timeline,
 * as the page's `crumb()` is. `often` is the page's rule too: a crumb that can
 * fire many times a second is written only while Detailed logging is on, so
 * the quiet log stays a handful of lines a minute.
 */
export function mainCrumb(a: string, fields: Record<string, unknown> = {}, opts: { often?: boolean } = {}): void {
  const log = diagMain()
  if (opts.often && !log.verbose()) return
  log.write('main', 'crumb', { ...fields, a })
}

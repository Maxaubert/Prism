import { renameSync, writeFileSync } from 'fs'

/**
 * WRITE A FILE ALL AT ONCE OR NOT AT ALL (code review 2026-09-24, #18).
 * `writeFileSync` truncates and then writes, and the app flushes tabs.json at
 * the moments it is most likely to be killed: on close, on quit, at Windows'
 * session end. A power cut between the two left a short or empty file, and
 * every tab and every agent resume with it. So the data goes to a sibling
 * `.tmp` first and is renamed over the real file, which Windows does in one
 * step: the file is always the old one or the new one, never half of either.
 */
export function writeAtomic(file: string, data: string): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

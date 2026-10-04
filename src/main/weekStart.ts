import { execFile } from 'child_process'
import { join } from 'path'

/**
 * THE USER'S FIRST DAY OF THE WEEK, as Windows has it (#285). File Explorer's
 * "Last week" and "Earlier this week" are calendar weeks that start on this
 * day (MEASURED: on this en-GB machine, Monday 21 Sep was Last week on Sunday
 * 4 Oct, and Sunday 27 Sep was too). It is a setting of its own in Windows
 * (Settings > Time and language > Language and region > Regional format),
 * stored as iFirstDayOfWeek: 0 Monday ... 6 Sunday. The page's own locale
 * does not know it, so main reads it once, after the window is up, through
 * reg.exe with arguments only, never a shell.
 */

/** reg.exe's line to JavaScript's day number (0 Sunday ... 6 Saturday), or
 *  null when the value is not there or not a day. Pure. */
export function parseFirstDayOfWeek(regOutput: string): number | null {
  const m = /iFirstDayOfWeek\s+REG_SZ\s+(\d)\s*$/m.exec(regOutput)
  if (!m) return null
  const windowsDay = Number(m[1])
  if (windowsDay > 6) return null
  return (windowsDay + 1) % 7
}

/** Monday, ISO's and most of Europe's, when Windows cannot be asked. */
export const FALLBACK_WEEK_START = 1

let asked: Promise<number> | null = null

export function weekStart(): Promise<number> {
  if (process.platform !== 'win32') return Promise.resolve(FALLBACK_WEEK_START)
  asked ??= new Promise((done) => {
    const reg = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe')
    execFile(
      reg,
      ['query', 'HKCU\\Control Panel\\International', '/v', 'iFirstDayOfWeek'],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) =>
        done(err ? FALLBACK_WEEK_START : (parseFirstDayOfWeek(String(stdout)) ?? FALLBACK_WEEK_START))
    )
  })
  return asked
}

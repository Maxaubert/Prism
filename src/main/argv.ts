import { existsSync, statSync } from 'fs'
import { resolve } from 'path'

/**
 * EVERY path an OS "open" or a command line passed us.
 *
 * A FOLDER counts (2026-08-25). Explorer's Directory verb and its
 * Directory\Background verb both hand over a folder, and this used to demand
 * `isFile()`: the menu entry was there, Prism launched, and nothing happened.
 * The caller needs to know which it got, because a folder roots a tab and a
 * file opens inside one.
 *
 * ALL of them, not one (2026-08-30). This returned at the first existing path
 * walking argv BACKWARDS, so `prism a.jpg b.jpg` showed b.jpg and dropped
 * a.jpg without a word - and a command line is not a rare case now that the
 * app ships a terminal. Each path goes through the ordinary arriving-file
 * route, so the documented rule still holds: five photos from one folder is
 * one tab, not five. Capped, because argv is not a promise.
 */
const ARGV_MAX = 32

/**
 * The app's own files, which are never something to open.
 *
 * Unpackaged - `electron out/main/index.js photo.jpg`, which is how dev and
 * the whole e2e suite run - the entry SCRIPT is an argument, and it is a file
 * that exists, so walking argv opened it as a second tab called "main" beside
 * the one you asked for.
 *
 * Skipping argv[1] by POSITION is not enough, and that is the interesting
 * part: Chromium reorders its own switches, so a second instance arrives as
 * `[exe, --user-data-dir=..., --e2e, out/main/index.js, photo.jpg]` and the
 * script is at index 3. Identity is the only reliable test. (Measured: the
 * positional version passed at launch and failed on every handoff.)
 */
function ownFiles(): string[] {
  const mine: string[] = [process.execPath]
  if (process.defaultApp && process.argv[1]) mine.push(process.argv[1])
  return mine
}

export function pathsFromArgv(
  argv: string[],
  ignore: string[] = ownFiles()
): Array<{ path: string; dir: boolean }> {
  const out: Array<{ path: string; dir: boolean }> = []
  const seen = new Set<string>()
  const mine = new Set(ignore.filter(Boolean).map((p) => resolve(p).toLowerCase()))
  for (let i = 1; i < argv.length && out.length < ARGV_MAX; i += 1) {
    const a = argv[i]
    if (a.startsWith('--')) continue
    try {
      if (!existsSync(a)) continue
      const key = resolve(a).toLowerCase()
      if (seen.has(key) || mine.has(key)) continue
      const st = statSync(a)
      if (st.isFile()) {
        seen.add(key)
        out.push({ path: a, dir: false })
      } else if (st.isDirectory()) {
        seen.add(key)
        out.push({ path: a, dir: true })
      }
    } catch {
      /* ignore */
    }
  }
  return out
}


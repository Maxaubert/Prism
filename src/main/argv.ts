import { statSync } from 'fs'
import { stat } from 'fs/promises'
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

/**
 * RELATIVE TO THE SHELL THAT NAMED IT (#21, 2026-11-01). A second instance's
 * argv is relative to ITS working directory, which Electron hands over with
 * `second-instance`; read against the resident Prism's own cwd, `prism
 * photo.jpg` from D:\pics opened nothing, or an unrelated photo.jpg that
 * happened to sit where Prism was first started. So every reader takes the
 * cwd the paths came from (this process's own at startup) and answers
 * absolute paths. The app's own files are this process's, read against its
 * own cwd.
 */
const here = (): string => process.cwd()

/** The argv entries worth a stat, in order, absolute: no switches, no
 *  repeats, none of the app's own files. Pure, so both readers below share it. */
function candidates(argv: string[], ignore: string[], cwd: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const mine = new Set(ignore.filter(Boolean).map((p) => resolve(p).toLowerCase()))
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i]
    if (a.startsWith('--')) continue
    const full = resolve(cwd, a)
    const key = full.toLowerCase()
    if (seen.has(key) || mine.has(key)) continue
    seen.add(key)
    out.push(full)
  }
  return out
}

/** A relaunch's command line with its paths made absolute against the cwd
 *  they were named in (#21): the relaunched Prism starts in THIS process's
 *  folder, not the shell's. Switches pass through untouched. */
export function argsAgainst(args: string[], cwd: string): string[] {
  return args.map((a) => (a.startsWith('-') ? a : resolve(cwd, a)))
}

/** At startup, before the first window, and in a quit's
 *  relaunch decision. A handoff while Prism runs uses pathsFromArgvAsync. */
export function pathsFromArgv(
  argv: string[],
  ignore: string[] = ownFiles(),
  cwd: string = here()
): Array<{ path: string; dir: boolean }> {
  const out: Array<{ path: string; dir: boolean }> = []
  for (const a of candidates(argv, ignore, cwd)) {
    if (out.length >= ARGV_MAX) break
    try {
      const st = statSync(a) // sync-ok: startup argv (before the first window) and the quit relaunch only
      if (st.isFile()) out.push({ path: a, dir: false })
      else if (st.isDirectory()) out.push({ path: a, dir: true })
    } catch {
      /* missing or unreadable: ignore */
    }
  }
  return out
}

/** The same answer, awaited: a second instance's handoff arrives while the
 *  user works (owner, 2026-10-12: main never waits on the disk). A handoff
 *  passes the second instance's `workingDirectory` as `cwd` (#21). */
export async function pathsFromArgvAsync(
  argv: string[],
  ignore: string[] = ownFiles(),
  cwd: string = here()
): Promise<Array<{ path: string; dir: boolean }>> {
  const out: Array<{ path: string; dir: boolean }> = []
  for (const a of candidates(argv, ignore, cwd)) {
    if (out.length >= ARGV_MAX) break
    try {
      const st = await stat(a)
      if (st.isFile()) out.push({ path: a, dir: false })
      else if (st.isDirectory()) out.push({ path: a, dir: true })
    } catch {
      /* missing or unreadable: ignore */
    }
  }
  return out
}

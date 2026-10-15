import { spawn } from 'child_process'
import { stat } from 'fs/promises'
import { homedir } from 'os'
import { extname, isAbsolute, resolve, win32 } from 'path'

/**
 * A PATH CLICKED IN THE TERMINAL (#99; owner, 2026-09-29: "clickable links that
 * would open the file or folder"). Main's half: the page says what text it saw
 * and which folder the shell is in; main alone decides what that names, whether
 * it exists, and what opening it means. The page is never trusted with a path
 * to open: it hands over the TEXT again, and main resolves and checks it anew.
 *
 * What a click does. A folder opens in the app Windows gives folders (File
 * Explorer, unless the user picked another; see `openFolderDefault`). A file opens in the app
 * Windows gives it, EXCEPT anything Windows would RUN (an .exe, a script, a
 * shortcut, an installer): that is shown selected in Explorer instead. Clicking
 * text in a terminal must never start a program.
 */

export type PathKind = 'file' | 'dir'

export interface PathHit {
  kind: PathKind
  /** Resolved and normalised: what is opened. */
  abs: string
}

/** Opened by Windows as a PROGRAM, or as something that runs one. */
const RUNNABLE = new Set(
  (
    'exe com scr pif cpl msc msi msp msix msixbundle appx appxbundle appref-ms application gadget ' +
    'bat cmd ps1 psm1 psd1 ps1xml vbs vbe js jse wsf wsh ws wsc sct hta jar ' +
    'py pyw pyc pyz rb pl sh bash ahk au3 lnk url website reg inf ins isp scf shb shs ' +
    'library-ms settingcontent-ms search-ms diagcab xbap vsto'
  ).split(/\s+/).filter(Boolean)
)

export function isRunnable(file: string): boolean {
  return RUNNABLE.has(extname(file).slice(1).toLowerCase())
}

/** The most a page may ask about in one go, and the longest text. */
export const PATHS_MAX = 300
const TEXT_MAX = 1024

/**
 * What `text` names from inside `cwd`, or null when it names nothing this
 * checks: a network path (a UNC share can stall a stat for many seconds, and
 * the terminal asks about every path on screen), a relative path with no
 * folder to be relative to, anything with a NUL in it.
 */
export function resolveTermPath(cwd: string, text: string, home = homedir()): string | null {
  if (typeof text !== 'string' || !text || text.length > TEXT_MAX || text.includes('\0')) return null
  let p = text
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = home + p.slice(1)
  if (/^[\\/]{2}/.test(p)) return null
  if (isAbsolute(p) || win32.isAbsolute(p)) {
    // "\foo" is absolute on Windows but names no drive: the shell's drive.
    if (!/^[A-Za-z]:/.test(p)) {
      if (!/^[A-Za-z]:[\\/]/.test(cwd)) return null
      p = cwd.slice(0, 2) + p
    }
    return win32.normalize(p)
  }
  if (typeof cwd !== 'string' || !/^[A-Za-z]:[\\/]/.test(cwd) || cwd.includes('\0')) return null
  return win32.normalize(resolve(cwd, p))
}

/** What each text names, in order: a file, a folder, or null. */
export async function pathKinds(cwd: string, texts: string[]): Promise<Array<PathHit | null>> {
  const list = texts.slice(0, PATHS_MAX)
  return Promise.all(
    list.map(async (t) => {
      const abs = resolveTermPath(cwd, t)
      if (!abs) return null
      try {
        const s = await stat(abs)
        if (s.isDirectory()) return { kind: 'dir' as const, abs }
        if (s.isFile()) return { kind: 'file' as const, abs }
        return null
      } catch {
        return null
      }
    })
  )
}

export interface PathOpeners {
  /** The app Windows gives it. */
  openPath(abs: string): void
  /** A folder, through Windows' default verb for folders (`openFolderDefault`).
   *  Absent: `openPath`. */
  openFolder?(abs: string): void
  /** Explorer, with it selected. */
  revealPath(abs: string): void
}

/** Open or reveal what `text` names, after resolving and checking it here.
 *  Answers what was done, for a test to read. */
export async function openTermPath(
  cwd: string,
  text: string,
  mode: 'open' | 'reveal',
  openers: PathOpeners
): Promise<'opened' | 'revealed' | null> {
  const [hit] = await pathKinds(cwd, [text])
  if (!hit) return null
  if (mode === 'reveal' || (hit.kind === 'file' && isRunnable(hit.abs))) {
    openers.revealPath(hit.abs)
    return 'revealed'
  }
  if (hit.kind === 'dir' && openers.openFolder) openers.openFolder(hit.abs)
  else openers.openPath(hit.abs)
  return 'opened'
}

/**
 * A FOLDER OPENS IN WHATEVER THE USER PICKED FOR FOLDERS (Prism #393; owner,
 * 2026-10-15). Electron's `shell.openPath` and `shell.openExternal` open a
 * folder WITHOUT any shell verb (measured: a default verb registered on
 * Directory, Drive or Folder, and overrides of their `open` and `explore`
 * verbs, were never run), so a folder handler the user chose never got it and
 * File Explorer always did. ShellExecute with NO verb is the route Windows
 * gives that choice; PowerShell's Start-Process is that call, and the path
 * travels in the environment, never on a command line a shell would parse.
 * This names no app: with nothing picked it is File Explorer, as before.
 * Anything short of a clean exit hands the folder to `fallback`.
 */
export function openFolderDefault(
  abs: string,
  fallback: (abs: string) => void,
  run: typeof spawn = spawn
): void {
  let fell = false
  const fall = (): void => {
    if (fell) return
    fell = true
    fallback(abs)
  }
  try {
    const child = run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:PT_OPEN_FOLDER'],
      {
        env: { ...process.env, PT_OPEN_FOLDER: abs },
        windowsHide: true,
        stdio: 'ignore'
      }
    )
    child.on('error', fall)
    child.on('exit', (code) => {
      if (code !== 0) fall()
    })
  } catch {
    fall()
  }
}

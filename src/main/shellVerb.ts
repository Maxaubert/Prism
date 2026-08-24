import { execFile } from 'child_process'

/**
 * "Open in Prism" in File Explorer's context menu.
 *
 * Written to HKCU only - per user, no elevation, nothing machine-wide - as a
 * classic shell verb under `*` (any file) and `Directory` (any folder). The
 * file verb opens the file with its own folder as the root, which is what
 * Prism does with any file handed to it; the folder verb opens the folder.
 *
 * WINDOWS 11 CAVEAT, stated rather than papered over: the short menu that
 * appears on right-click is built from IExplorerCommand handlers, which need a
 * registered COM DLL. A classic verb like this one appears under "Show more
 * options" (Shift+F10 opens that menu directly). Every app that has not
 * shipped a shell extension DLL is in the same position.
 *
 * Registry writes go through reg.exe with arguments only - never a command
 * line - the same enumerated-exe rule the rest of Prism follows.
 */

const FILE_KEY = 'HKCU\\Software\\Classes\\*\\shell\\OpenWithPrism'
const DIR_KEY = 'HKCU\\Software\\Classes\\Directory\\shell\\OpenWithPrism'

export const verbKeys = (): string[] => [FILE_KEY, DIR_KEY]

/** The complete `reg` argument lists that create the verb - verb included,
 *  so a caller cannot forget it (one did, and the switch read as off after a
 *  successful write). */
export function addArgs(exe: string): string[][] {
  const out: string[][] = []
  for (const key of verbKeys()) {
    // The label Explorer shows, and the icon beside it.
    out.push(['add', key, '/ve', '/t', 'REG_SZ', '/d', 'Open in Prism', '/f'])
    out.push(['add', key, '/v', 'Icon', '/t', 'REG_SZ', '/d', `${exe},0`, '/f'])
    // "%1" quoted inside the value: a path with spaces is one argument.
    out.push(['add', `${key}\\command`, '/ve', '/t', 'REG_SZ', '/d', `"${exe}" "%1"`, '/f'])
  }
  return out
}

/** The `reg delete` argument lists that remove it. */
export function removeArgs(): string[][] {
  return verbKeys().map((key) => ['delete', key, '/f'])
}

/** The `reg query` argument list that asks whether it is there. */
export function queryArgs(): string[] {
  return ['query', `${FILE_KEY}\\command`, '/ve']
}

/**
 * Does the value reg.exe printed point at THIS build?
 *
 * An installer that moved, or a second copy run from a build folder, would
 * otherwise leave a verb pointing somewhere the user did not mean.
 */
export function pointsAt(regOutput: string, exe: string): boolean {
  return regOutput.toLowerCase().includes(exe.toLowerCase())
}

function reg(args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true, timeout: 10000 }, (err, stdout) =>
      resolve({ ok: !err, out: stdout ?? '' })
    )
  })
}

/** Is the verb registered, and pointing at this executable? */
export async function verbInstalled(exe: string): Promise<boolean> {
  const r = await reg(queryArgs())
  return r.ok && pointsAt(r.out, exe)
}

/** Add the verb (or repoint it at this build). True when Explorer has it. */
export async function installVerb(exe: string): Promise<boolean> {
  for (const args of addArgs(exe)) {
    const r = await reg(args)
    if (!r.ok) return false
  }
  return true
}

/** Remove the verb. True when it is gone (including when it never existed). */
export async function removeVerb(): Promise<boolean> {
  for (const args of removeArgs()) {
    await reg(args)
  }
  return true
}

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
/** Right-click on the folder's BACKGROUND - Explorer's empty space, nothing
 *  selected. A different key with a different substitution: %V is the folder
 *  being viewed and %1 is empty there, which is why one verb cannot serve
 *  both. Its label says where you land: "Open Prism here". */
const BG_KEY = 'HKCU\\Software\\Classes\\Directory\\Background\\shell\\OpenWithPrism'

export const verbKeys = (): string[] => [FILE_KEY, DIR_KEY, BG_KEY]

/** What each key is called in the menu, and what Explorer substitutes for it. */
export function verbSpec(key: string): { label: string; arg: string } {
  return key === BG_KEY
    ? { label: 'Open Prism here', arg: '%V' }
    : { label: 'Open in Prism', arg: '%1' }
}

/** The complete `reg` argument lists that create the verb - verb included,
 *  so a caller cannot forget it (one did, and the switch read as off after a
 *  successful write). */
export function addArgs(exe: string): string[][] {
  const out: string[][] = []
  for (const key of verbKeys()) {
    const { label, arg } = verbSpec(key)
    // The label Explorer shows, and the icon beside it.
    out.push(['add', key, '/ve', '/t', 'REG_SZ', '/d', label, '/f'])
    out.push(['add', key, '/v', 'Icon', '/t', 'REG_SZ', '/d', `${exe},0`, '/f'])
    // The substitution is quoted inside the value: a path with spaces is one
    // argument.
    out.push(['add', `${key}\\command`, '/ve', '/t', 'REG_SZ', '/d', `"${exe}" "${arg}"`, '/f'])
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

/**
 * Should the verb be (re)written on this launch?
 *
 * THE ONE FACT WORTH STORING IS THE NO. Everything else can be read back from
 * the registry, and a marker saying "the default has been applied" recorded the
 * wrong thing: every upgrade runs the old uninstaller, which deletes the verb
 * keys, while userData survives - so the marker said done, the keys were gone,
 * and the verb had to be switched on by hand after every build.
 *
 * `saidNo` is honoured forever, which is the rule that stops a default
 * reapplying itself and making the switch a lie. Without it, an absent verb is
 * simply a verb to put back: a user who never touched the switch cannot tell an
 * upgrade from a fresh install and should not have to.
 */
export function shouldWriteVerb(saidNo: boolean, installed: boolean): boolean {
  return !saidNo && !installed
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

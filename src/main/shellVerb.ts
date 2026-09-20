import { execFile } from 'child_process'
import { existsSync } from 'fs'

/**
 * Prism's entries in File Explorer's context menu: "Open file" on a file,
 * "Open as project" on a folder and on the empty space inside one.
 *
 * THE LABELS DO NOT SAY "PRISM" (owner, 2026-09-19, #167). They were "Open in
 * Prism" and "Open Prism here" until then. The owner: "Prism is split now into
 * File Explorer and Project ... maybe just say Open As Project ... and don't
 * have any of them mention Prism, you can see that by the logo." The icon
 * beside the row is Prism's own, so the name was being said twice, and what
 * the row never said was WHAT the click does: a folder becomes a project, a
 * file is opened. The key names keep "OpenWithPrism": a key is an identity,
 * not copy, and renaming it would orphan every entry already written.
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
 *  both. Its label is the folder verb's own, "Open as project": it is the
 *  same act on the same folder, reached from inside it. */
const BG_KEY = 'HKCU\\Software\\Classes\\Directory\\Background\\shell\\OpenWithPrism'

export const verbKeys = (): string[] => [FILE_KEY, DIR_KEY, BG_KEY]

/** What each key is called in the menu, and what Explorer substitutes for it. */
export function verbSpec(key: string): { label: string; arg: string } {
  if (key === BG_KEY) return { label: 'Open as project', arg: '%V' }
  if (key === DIR_KEY) return { label: 'Open as project', arg: '%1' }
  return { label: 'Open file', arg: '%1' }
}

/** The one `reg add` that sets a key's label, and nothing else about it. */
function labelArgs(key: string): string[] {
  return ['add', key, '/ve', '/t', 'REG_SZ', '/d', verbSpec(key).label, '/f']
}

/** The complete `reg` argument lists that create the verb - verb included,
 *  so a caller cannot forget it (one did, and the switch read as off after a
 *  successful write). */
export function addArgs(exe: string): string[][] {
  const out: string[][] = []
  for (const key of verbKeys()) {
    const { arg } = verbSpec(key)
    // The label Explorer shows, and the icon beside it.
    out.push(labelArgs(key))
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
export function queryArgs(key = FILE_KEY): string[] {
  return ['query', `${key}\\command`, '/ve']
}

/** The `reg query` argument list that asks what a key is CALLED in the menu:
 *  the key's own default value, where `queryArgs` asks for its command's. */
export function labelQueryArgs(key: string): string[] {
  return ['query', key, '/ve']
}

/**
 * The label out of what `reg query <key> /ve` printed, or null.
 *
 * MEASURED (2026-09-19): the answer is CRLF, the columns are four spaces
 * apart, and the label has spaces of its own, so it is everything after the
 * type to the end of that line. The value's NAME is not matched, because
 * "(Default)" is localised and the type is not.
 *
 * A key with NO default value still answers, with a placeholder in the label's
 * place (MEASURED the same day: "(value not set)", and that text is localised
 * too). It is deliberately not special-cased: it reads as a label that differs,
 * and since `relabelVerb` only gets here for a verb that is on and is this
 * exe's, writing the label is right. Explorer shows such a row under its KEY
 * name, "OpenWithPrism", which is the one wording the owner ruled out.
 */
export function labelOf(output: string): string | null {
  const match = /\bREG_SZ[ \t]+(.*?)[ \t]*\r?$/m.exec(output)
  return match ? match[1] : null
}

/**
 * Does the value reg.exe printed point at THIS build?
 *
 * An installer that moved, or a second copy run from a build folder, would
 * otherwise leave a verb pointing somewhere the user did not mean.
 */
export function pointsAt(regOutput: string, exe: string): boolean {
  return commandOf(regOutput)?.exe.toLowerCase() === exe.toLowerCase()
}

function commandOf(output: string): { exe: string; arg: string } | null {
  const match = /\bREG_SZ\s+"([^"\r\n]+)"\s+"(%1|%V)"\s*$/im.exec(output)
  return match ? { exe: match[1], arg: match[2] } : null
}

type RegistryRunner = (args: string[]) => Promise<{ ok: boolean; out: string }>

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
export async function verbInstalled(exe: string, run: RegistryRunner = reg): Promise<boolean> {
  for (const key of verbKeys()) {
    const result = await run(queryArgs(key))
    const command = commandOf(result.out)
    if (!result.ok || !pointsAt(result.out, exe) || command?.arg !== verbSpec(key).arg) return false
  }
  return true
}

/** A preview must report the installed menu without taking it over. */
export async function verbRegistered(
  run: RegistryRunner = reg,
  exists: (path: string) => boolean = existsSync
): Promise<boolean> {
  let target = ''
  for (const key of verbKeys()) {
    const result = await run(queryArgs(key))
    const command = commandOf(result.out)
    if (
      !result.ok ||
      !command ||
      command.arg !== verbSpec(key).arg ||
      !/(?:^|[\\/])Prism\.exe$/i.test(command.exe) ||
      (target && command.exe.toLowerCase() !== target.toLowerCase())
    )
      return false
    target = command.exe
  }
  return exists(target)
}

/**
 * Bring the labels of an EXISTING registration up to date. True when a label
 * was rewritten.
 *
 * The labels changed on 2026-09-19 (#167), and the verb is on by default, so
 * nearly every machine carried the old text. AN UPGRADE THROUGH THE INSTALLER
 * DOES NOT NEED THIS: the old uninstaller deletes the three keys on the way
 * (see `shouldWriteVerb`), the startup repair writes them back, and what it
 * writes carries the current labels by construction. This is for the
 * registration that SURVIVES into a build with new words, which everything
 * else in this file leaves alone precisely because it works: an uninstaller
 * that was skipped or cut short, an exe replaced in place. There the old text
 * would otherwise stay for ever. The rule is narrow on purpose:
 *
 * - the entry must be ON, all three keys, and pointing at THIS exe. `reg add
 *   <key> /ve` CREATES a missing key, so without that check a relabel would put
 *   a dead, commandless row into the menu of someone who switched the verb
 *   off; and a verb that belongs to another copy of Prism is that copy's to
 *   word. A half-present verb is left to the startup repair, which rewrites
 *   the lot.
 * - only the LABEL is written, never the command and never the icon, and only
 *   on a key whose label was READ and differs. One that could not be read is
 *   left as it is.
 *
 * It compares against the current label rather than a list of old ones, so the
 * next rewording needs nothing here.
 */
export async function relabelVerb(exe: string, run: RegistryRunner = reg): Promise<boolean> {
  if (!(await verbInstalled(exe, run))) return false
  let rewritten = false
  for (const key of verbKeys()) {
    const result = await run(labelQueryArgs(key))
    const label = result.ok ? labelOf(result.out) : null
    if (label === null || label === verbSpec(key).label) continue
    if ((await run(labelArgs(key))).ok) rewritten = true
  }
  return rewritten
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

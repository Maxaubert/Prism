import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { addArgs, pointsAt, queryArgs, removeArgs, verbKeys, verbSpec } from './shellVerb'

const EXE = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\Prism\\Prism.exe'

describe('the Explorer verb', () => {
  it('is written per USER, never machine-wide', () => {
    // HKLM would need elevation, and Prism installs per user.
    for (const k of verbKeys()) expect(k.startsWith('HKCU\\'), k).toBe(true)
  })

  it('covers files, folders, and the empty space inside a folder', () => {
    expect(verbKeys().some((k) => k.includes('\\*\\shell\\'))).toBe(true)
    expect(verbKeys().some((k) => k.includes('\\Directory\\shell\\'))).toBe(true)
    expect(verbKeys().some((k) => k.includes('\\Directory\\Background\\shell\\'))).toBe(true)
  })

  it('gives the background verb %V, not %1', () => {
    // %1 is empty on a background click: the verb would launch Prism with no
    // path at all, which is exactly the "nothing happens" this fixes.
    const bg = verbKeys().find((k) => k.includes('Background'))!
    expect(verbSpec(bg)).toEqual({ label: 'Open Prism here', arg: '%V' })
    expect(verbSpec(verbKeys()[0]).arg).toBe('%1')
  })

  it('says where you land, on the verb that lands you somewhere else', () => {
    const flat = addArgs(EXE).map((a) => a.join(' ')).join('\n')
    expect(flat).toContain('Open Prism here')
  })

  it('quotes the path inside the command, so a folder with spaces survives', () => {
    const cmd = addArgs(EXE).find((a) => a[1].endsWith('\\command'))
    expect(cmd?.[cmd.length - 2]).toBe(`"${EXE}" "%1"`)
  })

  it('names the menu item and gives it the app icon', () => {
    const flat = addArgs(EXE).map((a) => a.join(' ')).join('\n')
    expect(flat).toContain('Open in Prism')
    expect(flat).toContain(`${EXE},0`)
  })

  it('forces every write, so a stale verb is replaced rather than refused', () => {
    for (const a of addArgs(EXE)) expect(a, a.join(' ')).toContain('/f')
    for (const a of removeArgs()) expect(a).toContain('/f')
  })

  it('passes the path as an argument, never as a command line', () => {
    // reg.exe is given argv; nothing is ever concatenated into a shell string.
    const weird = 'C:\\Program Files\\A "quoted" & piped\\Prism.exe'
    const cmd = addArgs(weird).find((a) => a[1].endsWith('\\command'))
    expect(cmd?.[cmd.length - 2]).toContain(weird)
  })

  it('carries the reg verb itself, so a caller cannot leave it out', () => {
    // It was left out once: every write succeeded and the switch still read
    // as off, because `reg <key> /ve` is not a query.
    expect(queryArgs()[0]).toBe('query')
    expect(addArgs(EXE).every((a) => a[0] === 'add')).toBe(true)
    expect(removeArgs().every((a) => a[0] === 'delete')).toBe(true)
  })

  it('asks about the file verb when checking, and asks for its default value', () => {
    expect(queryArgs()[1]).toContain('\\*\\shell\\OpenWithPrism\\command')
    expect(queryArgs()).toContain('/ve')
  })
})

describe('reading what Windows says back', () => {
  const output = `
HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\OpenWithPrism\\command
    (Default)    REG_SZ    "${EXE}" "%1"
`

  it('recognises a verb pointing at this build', () => {
    expect(pointsAt(output, EXE)).toBe(true)
  })

  it('is case-insensitive, as Windows paths are', () => {
    expect(pointsAt(output, EXE.toUpperCase())).toBe(true)
  })

  it('does NOT claim a verb pointing at some other copy', () => {
    // A build folder, or an install that moved: the switch should read as off
    // so turning it on repoints it here.
    expect(pointsAt(output, 'D:\\builds\\Prism\\Prism.exe')).toBe(false)
  })

  it('reads an empty answer as absent', () => {
    expect(pointsAt('', EXE)).toBe(false)
  })
})


/**
 * Every verb key the app can write must be a key the uninstaller deletes.
 *
 * Two of these keys survived uninstall for months, pointing at an exe that no
 * longer existed (2026-08-30), and the reason nobody noticed is that a
 * registry key is invisible until someone right-clicks. This is the same
 * shape as fileAssoc.test.ts: two lists in two languages, checked by a test
 * rather than by a comment claiming they agree.
 */
describe('the uninstaller removes every verb key', () => {
  const nsh = readFileSync('build/installer/assoc.nsh', 'utf8')

  it.each(verbKeys())('deletes %s', (key) => {
    // HKCU is SHELL_CONTEXT in the .nsh; the rest of the path is written as is.
    const sub = key.replace(/^HKCU\\/, '')
    expect(nsh).toContain(`DeleteRegKey SHELL_CONTEXT "${sub}"`)
  })

  it('and the macro that runs them is where the uninstaller can see it', () => {
    // pages.nsh is excluded from the uninstaller build, so customUnInstall
    // defined there is a macro the uninstaller never has.
    expect(nsh).toContain('!macro customUnInstall')
    expect(readFileSync('build/installer/pages.nsh', 'utf8')).not.toContain('!macro customUnInstall')
  })
})

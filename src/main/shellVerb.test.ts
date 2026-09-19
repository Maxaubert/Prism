import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  addArgs,
  labelOf,
  labelQueryArgs,
  pointsAt,
  queryArgs,
  relabelVerb,
  removeArgs,
  shouldWriteVerb,
  verbKeys,
  verbSpec,
  verbInstalled,
  verbRegistered
} from './shellVerb'

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
    expect(verbSpec(bg)).toEqual({ label: 'Open as project', arg: '%V' })
    expect(verbSpec(verbKeys()[0]).arg).toBe('%1')
  })

  it('says what the click DOES: a file is opened, a folder becomes a project', () => {
    // Owner, 2026-09-19 (#167): "Prism is split now into File Explorer and
    // Project", so a folder, and the empty space inside one, opens AS A
    // PROJECT, and a single file is simply opened.
    const [file, dir, bg] = verbKeys()
    expect(verbSpec(file).label).toBe('Open file')
    expect(verbSpec(dir).label).toBe('Open as project')
    expect(verbSpec(bg).label).toBe('Open as project')
  })

  it('never names Prism in a label, because the icon beside it already does', () => {
    // Owner, same day: "don't have any of them mention Prism, you can see that
    // by the logo."
    for (const key of verbKeys()) expect(verbSpec(key).label).not.toMatch(/prism/i)
    const labels = addArgs(EXE)
      .filter((a) => a.includes('/ve') && !a[1].endsWith('\\command'))
      .map((a) => a[a.length - 2])
    expect(labels).toEqual(['Open file', 'Open as project', 'Open as project'])
  })

  it('quotes the path inside the command, so a folder with spaces survives', () => {
    const cmd = addArgs(EXE).find((a) => a[1].endsWith('\\command'))
    expect(cmd?.[cmd.length - 2]).toBe(`"${EXE}" "%1"`)
  })

  it('names the menu item and gives it the app icon', () => {
    const flat = addArgs(EXE)
      .map((a) => a.join(' '))
      .join('\n')
    expect(flat).toContain('Open file')
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

  it('does not accept a path merely mentioned in another command', () => {
    expect(pointsAt(`REG_SZ "D:\\Other\\Prism.exe" "${EXE}" "%1"`, EXE)).toBe(false)
    expect(pointsAt(`REG_SZ "${EXE}.old" "%1"`, EXE)).toBe(false)
  })
})

describe('complete live menu registration', () => {
  const registry =
    (overrides: Record<string, string | null> = {}) =>
    async (args: string[]) => {
      const key = args[1].replace(/\\command$/, '')
      const command = key in overrides ? overrides[key] : `"${EXE}" "${verbSpec(key).arg}"`
      return {
        ok: command !== null,
        out: command === null ? '' : `    (Default)    REG_SZ    ${command}\r\n`
      }
    }

  it('reports the installed copy as enabled when viewed from a preview', async () => {
    expect(await verbRegistered(registry(), (path) => path === EXE)).toBe(true)
    expect(await verbInstalled('D:\\Preview\\Prism.exe', registry())).toBe(false)
  })

  it.each(verbKeys())('requires the %s command as well as the file entry', async (key) => {
    expect(await verbRegistered(registry({ [key]: null }), () => true)).toBe(false)
    expect(await verbInstalled(EXE, registry({ [key]: null }))).toBe(false)
  })

  it('rejects a stale executable, mixed targets and the wrong background argument', async () => {
    expect(await verbRegistered(registry(), () => false)).toBe(false)
    const background = verbKeys()[2]
    expect(
      await verbRegistered(registry({ [background]: '"D:\\Other\\Prism.exe" "%V"' }), () => true)
    ).toBe(false)
    expect(await verbRegistered(registry({ [background]: `"${EXE}" "%1"` }), () => true)).toBe(
      false
    )
  })
})

/**
 * Relabelling an existing install (2026-09-19, #167).
 *
 * The verb is on by default, so nearly every machine already carries the old
 * text ("Open in Prism", "Open Prism here"), and `shouldWriteVerb` leaves a
 * working verb alone: without this the new labels would reach only fresh
 * installs. The rule is narrow on purpose. The entry must be ON, all three
 * keys, and pointing at THIS exe; then only the label value is rewritten,
 * never the command and never the icon. A relabel can therefore not turn on
 * what somebody turned off, and cannot take a verb away from another copy.
 */
describe('a stale label is rewritten, and nothing else is', () => {
  const OLD: Record<string, string | null> = {
    [verbKeys()[0]]: 'Open in Prism',
    [verbKeys()[1]]: 'Open in Prism',
    [verbKeys()[2]]: 'Open Prism here'
  }

  /** A registry that answers the two queries the way reg.exe prints them, and
   *  records every write it is asked for. */
  function registry(
    options: {
      exe?: string
      labels?: Record<string, string | null>
      missing?: string[]
    } = {}
  ) {
    const exe = options.exe ?? EXE
    const labels = { ...(options.labels ?? OLD) }
    const writes: string[][] = []
    const run = async (args: string[]): Promise<{ ok: boolean; out: string }> => {
      if (args[0] === 'add') {
        writes.push(args)
        labels[args[1]] = args[args.indexOf('/d') + 1]
        return { ok: true, out: '' }
      }
      const isCommand = args[1].endsWith('\\command')
      const key = args[1].replace(/\\command$/, '')
      if (options.missing?.includes(key)) return { ok: false, out: '' }
      if (isCommand)
        return {
          ok: true,
          out: `\r\n${args[1]}\r\n    (Default)    REG_SZ    "${exe}" "${verbSpec(key).arg}"\r\n\r\n`
        }
      const label = labels[key]
      if (label === null) return { ok: false, out: '' }
      return { ok: true, out: `\r\n${key}\r\n    (Default)    REG_SZ    ${label}\r\n\r\n` }
    }
    return { run, writes, labels }
  }

  it('reads the label out of what reg.exe prints, CRLF and all', () => {
    // MEASURED on this machine (2026-09-19): reg.exe answers in CRLF, with
    // four spaces between the columns, and the label itself has spaces in it.
    const out =
      '\r\nHKEY_CURRENT_USER\\Software\\Classes\\Directory\\Background\\shell\\OpenWithPrism\r\n' +
      '    (Default)    REG_SZ    Open Prism here\r\n\r\n'
    expect(labelOf(out)).toBe('Open Prism here')
    expect(labelOf('')).toBeNull()
  })

  it("asks for the key's own default value, not its command's", () => {
    const key = verbKeys()[1]
    expect(labelQueryArgs(key)).toEqual(['query', key, '/ve'])
  })

  it('rewrites all three labels on an install that carries the old text', async () => {
    const { run, writes, labels } = registry()
    expect(await relabelVerb(EXE, run)).toBe(true)
    expect(writes).toEqual(
      verbKeys().map((key) => [
        'add',
        key,
        '/ve',
        '/t',
        'REG_SZ',
        '/d',
        verbSpec(key).label,
        '/f'
      ])
    )
    expect(Object.values(labels)).toEqual(['Open file', 'Open as project', 'Open as project'])
  })

  it('writes the label ONLY: never the command, never the icon', async () => {
    const { run, writes } = registry()
    await relabelVerb(EXE, run)
    expect(writes.length).toBe(3)
    for (const w of writes) {
      expect(w[1].endsWith('\\command'), w.join(' ')).toBe(false)
      expect(w, w.join(' ')).not.toContain('Icon')
    }
  })

  it('rewrites only the label that is stale', async () => {
    const [file, dir, bg] = verbKeys()
    const { run, writes } = registry({
      labels: { [file]: 'Open file', [dir]: 'Open in Prism', [bg]: 'Open as project' }
    })
    expect(await relabelVerb(EXE, run)).toBe(true)
    expect(writes.map((w) => w[1])).toEqual([dir])
  })

  it('writes nothing at all when the labels are already current', async () => {
    const labels = Object.fromEntries(verbKeys().map((k) => [k, verbSpec(k).label]))
    const { run, writes } = registry({ labels })
    expect(await relabelVerb(EXE, run)).toBe(false)
    expect(writes).toEqual([])
  })

  it('leaves a verb that belongs to ANOTHER copy of Prism alone', async () => {
    // A preview, or a build folder, must not relabel the installed app's menu:
    // that copy may be an older build whose own text is the right text for it.
    const { run, writes } = registry({ exe: 'D:\\Other\\Prism.exe' })
    expect(await relabelVerb(EXE, run)).toBe(false)
    expect(writes).toEqual([])
  })

  it('never turns on what is off: no keys, no writes', async () => {
    // `reg add <key> /ve` CREATES a missing key, which would put a dead,
    // commandless entry into the menu of someone who switched the verb off.
    const { run, writes } = registry({ missing: verbKeys() })
    expect(await relabelVerb(EXE, run)).toBe(false)
    expect(writes).toEqual([])
  })

  it.each(verbKeys())('does not touch a half-present verb (%s missing)', async (key) => {
    // A partial registration reads as OFF everywhere else in this file, and
    // the startup repair owns it; a relabel is not a repair.
    const { run, writes } = registry({ missing: [key] })
    expect(await relabelVerb(EXE, run)).toBe(false)
    expect(writes).toEqual([])
  })

  it('leaves a label it could not read alone', async () => {
    const [file] = verbKeys()
    const { run, writes } = registry({ labels: { ...OLD, [file]: null } })
    await relabelVerb(EXE, run)
    expect(writes.map((w) => w[1])).not.toContain(file)
    expect(writes.length).toBe(2)
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
    expect(readFileSync('build/installer/pages.nsh', 'utf8')).not.toContain(
      '!macro customUnInstall'
    )
  })
})

describe('the verb survives an upgrade', () => {
  /**
   * Every upgrade dropped it and it had to be switched on by hand. The
   * uninstaller runs as part of an upgrade and deletes the three keys - which
   * is right for a real uninstall - while userData survives, so a marker
   * reading "the default has been applied" said done over a registry that was
   * empty. The fact worth storing is the NO, not the yes.
   */
  it('puts an absent verb back when nobody said no', () => {
    expect(shouldWriteVerb(false, false)).toBe(true)
  })

  it('leaves a working verb alone', () => {
    expect(shouldWriteVerb(false, true)).toBe(false)
  })

  it('never argues with a deliberate off, even with the keys gone', () => {
    // The rule the old marker existed to enforce, and the one that matters: a
    // default that reapplies itself makes the switch a setting that lies.
    expect(shouldWriteVerb(true, false)).toBe(false)
    expect(shouldWriteVerb(true, true)).toBe(false)
  })
})

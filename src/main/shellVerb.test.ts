import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  addArgs,
  commandFor,
  labelOf,
  labelQueryArgs,
  pointsAt,
  queryArgs,
  recommandVerb,
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
    const [, dir, bg] = addArgs(EXE).filter((a) => a[1].endsWith('\\command'))
    expect(dir[dir.length - 2]).toBe(`"${EXE}" "%1"`)
    expect(bg[bg.length - 2]).toBe(`"${EXE}" "%V"`)
  })

  it('asks for the Explorer tab from "Open file", and from nothing else', () => {
    // Owner (#167), asked what the entry on a single file should do: "open
    // file ... in file explorer, thats probably best rather than a project".
    // The switch is the whole of that route, so it is pinned word for word,
    // and the two folder verbs must never grow it: a folder IS a project.
    const [file, dir, bg] = verbKeys()
    expect(commandFor(EXE, file)).toBe(`"${EXE}" --explorer-tab "%1"`)
    expect(commandFor(EXE, dir)).toBe(`"${EXE}" "%1"`)
    expect(commandFor(EXE, bg)).toBe(`"${EXE}" "%V"`)
    const written = addArgs(EXE)
      .filter((a) => a[1].endsWith('\\command'))
      .map((a) => a[a.length - 2])
    expect(written).toEqual(verbKeys().map((key) => commandFor(EXE, key)))
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

  it('recognises its own command with the switch in it', () => {
    expect(pointsAt(`    (Default)    REG_SZ    "${EXE}" --explorer-tab "%1"\r\n`, EXE)).toBe(true)
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
      const command = key in overrides ? overrides[key] : commandFor(EXE, key)
      return {
        ok: command !== null,
        out: command === null ? '' : `    (Default)    REG_SZ    ${command}\r\n`
      }
    }

  it('is installed when every command is word for word what this build writes', async () => {
    expect(await verbInstalled(EXE, registry())).toBe(true)
  })

  it('reads an older "Open file" as ON, but not as what this build writes', async () => {
    // Every build before 2026-09-20 wrote the file command without the switch.
    // That menu is there and working, so Settings must say so (and a preview
    // must not take it over); but it is not what `installVerb` writes, which
    // is what a fresh install is checked against.
    const old = registry({ [verbKeys()[0]]: `"${EXE}" "%1"` })
    expect(await verbRegistered(old, () => true)).toBe(true)
    expect(await verbInstalled(EXE, old)).toBe(false)
  })

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
 * working verb alone. An upgrade through the installer gets the new words
 * anyway (the old uninstaller deletes the keys and the startup repair writes
 * them back); this covers the registration that SURVIVES into the new build,
 * where the old text would otherwise stay. The rule is narrow on purpose. The entry must be ON, all three
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

  it('labels a verb whose label value is missing, which Explorer shows as "OpenWithPrism"', async () => {
    // MEASURED on this machine (2026-09-20), on a key with no default value:
    // reg.exe still answers, with "(value not set)" where the label would be,
    // and that placeholder is localised. It is not special-cased: it reads as
    // a label that differs, and on a verb that is on and ours the write is
    // right, because Explorer falls back to the KEY's name for such a row,
    // which names Prism.
    expect(labelOf('\r\nHKEY_CURRENT_USER\\x\r\n    (Default)    REG_SZ    (value not set)\r\n\r\n')).toBe(
      '(value not set)'
    )
    const [file] = verbKeys()
    const current = Object.fromEntries(verbKeys().map((k) => [k, verbSpec(k).label]))
    const { run, writes, labels } = registry({ labels: { ...current, [file]: '(value not set)' } })
    expect(await relabelVerb(EXE, run)).toBe(true)
    expect(writes.map((w) => w[1])).toEqual([file])
    expect(labels[file]).toBe('Open file')
  })

  it('reads an EMPTY label as empty, not as unreadable', () => {
    // A default value that exists and is "" prints nothing after the type. It
    // must come back as '' (a label that differs) and not as null (left alone).
    expect(labelOf('\r\nHKEY_CURRENT_USER\\x\r\n    (Default)    REG_SZ    \r\n\r\n')).toBe('')
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

/**
 * Bringing an existing COMMAND up to date (2026-09-20, #167).
 *
 * "Open file" asks for the Explorer tab through a switch in its command. An
 * upgrade through the installer gets it anyway (the keys are deleted and
 * written back); this is for the registration that survives into the new
 * build, which would otherwise go on making a project under a label that no
 * longer says so. The rule is `relabelVerb`'s: on, all three keys, THIS exe,
 * and then only what was read and found different is written.
 */
describe('a stale command is rewritten, and nothing else is', () => {
  function registry(options: { exe?: string; commands?: Record<string, string | null> } = {}) {
    const exe = options.exe ?? EXE
    const commands: Record<string, string | null> = {
      ...Object.fromEntries(verbKeys().map((key) => [key, `"${exe}" "${verbSpec(key).arg}"`])),
      ...options.commands
    }
    const writes: string[][] = []
    const run = async (args: string[]): Promise<{ ok: boolean; out: string }> => {
      const key = args[1].replace(/\\command$/, '')
      if (args[0] === 'add') {
        writes.push(args)
        commands[key] = args[args.indexOf('/d') + 1]
        return { ok: true, out: '' }
      }
      const command = commands[key]
      if (command == null) return { ok: false, out: '' }
      return { ok: true, out: `\r\n${args[1]}\r\n    (Default)    REG_SZ    ${command}\r\n\r\n` }
    }
    return { run, writes, commands }
  }

  it('gives an older registration the switch, on the file verb alone', async () => {
    const [file] = verbKeys()
    const { run, writes, commands } = registry()
    expect(await verbInstalled(EXE, run)).toBe(false)
    expect(await recommandVerb(EXE, run)).toBe(true)
    expect(writes).toEqual([
      ['add', `${file}\\command`, '/ve', '/t', 'REG_SZ', '/d', commandFor(EXE, file), '/f']
    ])
    expect(commands[file]).toBe(`"${EXE}" --explorer-tab "%1"`)
    expect(await verbInstalled(EXE, run)).toBe(true)
  })

  it('writes nothing when the commands are already current', async () => {
    const commands = Object.fromEntries(verbKeys().map((key) => [key, commandFor(EXE, key)]))
    const { run, writes } = registry({ commands })
    expect(await recommandVerb(EXE, run)).toBe(false)
    expect(writes).toEqual([])
  })

  it('takes a switch OFF a verb that should not carry one', async () => {
    // A later build that moves the switch, then a downgrade to this one: the
    // command is this exe's, so it is this build's to word.
    const [file, dir] = verbKeys()
    const { run, writes } = registry({
      commands: { [file]: commandFor(EXE, file), [dir]: `"${EXE}" --explorer-tab "%1"` }
    })
    expect(await recommandVerb(EXE, run)).toBe(true)
    expect(writes.map((w) => w[w.length - 2])).toEqual([`"${EXE}" "%1"`])
  })

  it('leaves a verb that belongs to ANOTHER copy of Prism alone', async () => {
    const { run, writes } = registry({ exe: 'D:\\Other\\Prism.exe' })
    expect(await recommandVerb(EXE, run)).toBe(false)
    expect(writes).toEqual([])
  })

  it.each(verbKeys())('never turns on what is off or half there (%s missing)', async (key) => {
    // `reg add <key>\command` CREATES the key: without the "on" check this
    // would put an unlabelled row into the menu of someone who said no.
    const { run, writes } = registry({ commands: { [key]: null } })
    expect(await recommandVerb(EXE, run)).toBe(false)
    expect(writes).toEqual([])
  })

  it('does not touch a command of some other shape, which is an edit somebody made', async () => {
    const [file] = verbKeys()
    const { run, writes } = registry({ commands: { [file]: `"${EXE}" --e2e "%1" --more` } })
    expect(await recommandVerb(EXE, run)).toBe(false)
    expect(writes).toEqual([])
  })
})

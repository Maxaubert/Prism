import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  ALL_HELP,
  blankless,
  HELP_CATEGORIES,
  HELP_ID_PREFIXES,
  HELP_SHELLS,
  helpFor,
  isKeyPress,
  shellOfShellId,
  variantsIn,
  type HelpShellChoice
} from './index'
import { searchHelp } from './search'
import type { HelpEntry } from './types'

/**
 * THE GATE FOR THE CATALOGUE'S CONTENT (#12). The catalogue is curated text,
 * several hundred entries of it, written to be copied into somebody's shell:
 * what a compiler cannot see is exactly what matters here. So every rule in
 * `types.ts` is held by a test, the destructive commands most of all: an entry
 * that deletes, kills or overwrites and does not SAY so is the one mistake in
 * this feature that can cost somebody their work.
 *
 * Each check collects every offender and reports them together, so one run
 * names everything there is to fix.
 */

/** Built from its code point, so this file does not hold the character it forbids. */
const EM_DASH = String.fromCharCode(0x2014)

/** Every command an entry offers: its own, then each variant's. */
const commandsOf = (e: HelpEntry): string[] => [e.command, ...(e.variants ?? []).map((v) => v.command)]

/** Every string a person reads or copies, for the rules that cover all text. */
const textsOf = (e: HelpEntry): string[] => [
  e.id,
  e.task,
  e.summary,
  e.danger ?? '',
  ...commandsOf(e),
  ...(e.variants ?? []).map((v) => v.label),
  ...Object.entries(e.placeholders ?? {}).flat(),
  ...e.keywords
]

/**
 * UPPER-CASE WORDS THAT ARE THE COMMAND'S OWN, not something to replace: git's
 * HEAD, netstat's LISTENING, an environment variable's real name. Everything
 * else in capitals (three letters or more) must be a declared placeholder,
 * which is what keeps a reader from pasting the word FOLDER into a shell.
 */
const LITERAL_CAPS = new Set([
  'HEAD',
  'LISTENING',
  'PATH',
  'PATHEXT',
  'DATE',
  'TIME',
  'HOME',
  'USERPROFILE',
  'USERNAME',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'PROFILE',
  'PWD',
  'LASTEXITCODE',
  'ERRORLEVEL',
  'PSVERSIONTABLE',
  'MX',
  'TXT',
  'POST',
  'GET',
  'JSON',
  'CSV',
  'README',
  'CLAUDE',
  'AGENTS',
  'SHA256',
  'SHA1',
  'LTS',
  'FALSE',
  'GEQ',
  'MD5',
  'UTF8',
  'WSL',
  'PID',
  'CPU',
  'WS',
  'AND',
  'TCP',
  'UDP'
])

/** The capitalised words of a command that stand for something the reader
 *  supplies. A word right after `$`, `%` or `env:` is a variable's real name. */
function placeholdersIn(command: string): string[] {
  const found: string[] = []
  for (const m of command.matchAll(/(^|[^A-Za-z0-9_$%:])([A-Z][A-Z0-9_]{2,})(?![A-Za-z0-9_])/g)) {
    if (!LITERAL_CAPS.has(m[2])) found.push(m[2])
  }
  return found
}

/**
 * WHAT COUNTS AS DESTRUCTIVE. A pattern is tested against each COMMAND (the
 * main one and every variant); a hit anywhere obliges the ENTRY to carry a
 * `danger` line. Written against the start of a pipeline stage where the word
 * is also an everyday English one ("del", "kill", "format"), so a summary-like
 * command such as `Format-Table` or `git log --format` is not swept in.
 */
const STAGE = String.raw`(?:^|[|;&(]\s*|\bsudo\s+|\bxargs\s+(?:-\S+\s+)*)`
const DESTRUCTIVE: ReadonlyArray<{ name: string; re: RegExp }> = [
  // Env:, Alias:, Function: and Variable: are the session's own drives: removing
  // from one forgets a name until the window closes, and touches no file.
  // Nor is ASKING about it: `Get-Help Remove-Item` reads a manual page.
  {
    name: 'Remove-Item',
    re: /(?<!Get-Help\s)(?<!Get-Command\s)\bRemove-Item\b(?!\s+(?:Env|Alias|Function|Variable):)(?!.*-WhatIf)/i
  },
  { name: 'rm', re: new RegExp(STAGE + String.raw`rm(?:\s|$)`) },
  { name: 'rmdir /s', re: /\brmdir\s+\/s\b/i },
  { name: 'rd /s', re: new RegExp(STAGE + String.raw`rd\s+\/s\b`, 'i') },
  { name: 'del', re: new RegExp(STAGE + String.raw`(?:del|erase)(?:\s|$)`, 'i') },
  { name: 'format', re: new RegExp(STAGE + String.raw`format\s+[A-Za-z]:`, 'i') },
  { name: 'Stop-Process', re: /\bStop-Process\b(?!.*-WhatIf)/i },
  { name: 'taskkill', re: /\btaskkill\b/i },
  { name: 'kill', re: new RegExp(STAGE + String.raw`(?:kill|pkill|killall)(?:\s|$)`) },
  { name: 'git reset --hard', re: /\bgit\s+reset\s+--hard\b/ },
  { name: 'git clean', re: /\bgit\s+clean\b(?!\s+-\w*n)/ },
  { name: 'git push --force', re: /\bgit\s+push\b.*(?:--force|\s-f\b)/ },
  { name: 'git checkout --', re: /\bgit\s+checkout\s+(?:\S+\s+)?--\s/ },
  { name: 'git restore', re: /\bgit\s+restore\s+(?!--staged)/ },
  { name: 'git branch -D', re: /\bgit\s+branch\s+-D\b/ },
  { name: 'git stash drop / clear', re: /\bgit\s+stash\s+(?:drop|clear)\b/ },
  { name: 'DROP', re: /\bDROP\s+(?:TABLE|DATABASE)\b/i },
  { name: 'mkfs', re: /\bmkfs\b/ },
  { name: 'dd', re: new RegExp(STAGE + String.raw`dd\s+.*\bof=`) },
  { name: 'Set-Content / Out-File', re: /\b(?:Set-Content|Out-File)\b/i },
  { name: 'Clear-Content', re: /\bClear-Content\b/i },
  { name: 'npm cache clean', re: /\bnpm\s+cache\s+clean\b/ },
  { name: 'sed -i', re: /\bsed\s+-i(?!\.)/ },
  // A single > writes OVER the file it names. Not >>, not a numbered stream's
  // own (2>nul, 2>&1), not the bin (nul, /dev/null, $null), not an arrow (->, =>).
  { name: 'redirect over a file', re: /(?<![>0-9&=-])>(?!>)\s*(?!nul\b|\/dev\/null|\$null|&)\S/i },
  { name: 'download over a file', re: /\bcurl(?:\.exe)?\b.*\s-\w*[oO]\b|-OutFile\b/ }
]

const destructiveHits = (e: HelpEntry): string[] =>
  DESTRUCTIVE.filter((d) => commandsOf(e).some((c) => d.re.test(c))).map((d) => d.name)

describe('the help catalogue', () => {
  it('is a few hundred entries, and one constant list', () => {
    expect(ALL_HELP.length).toBeGreaterThan(250)
    expect(ALL_HELP.length).toBeLessThan(600)
  })

  it('gives every entry a unique, kebab-case id', () => {
    const seen = new Map<string, number>()
    for (const e of ALL_HELP) seen.set(e.id, (seen.get(e.id) ?? 0) + 1)
    expect([...seen].filter(([, n]) => n > 1).map(([id]) => id)).toEqual([])
    expect(ALL_HELP.filter((e) => !/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(e.id)).map((e) => e.id)).toEqual([])
  })

  it('prefixes an id by its shell, and an any-shell or Windows id by its tool', () => {
    const anyPrefix: Partial<Record<HelpEntry['category'], RegExp>> = {
      git: /^git-/,
      agents: /^(claude|codex)-/,
      packages: /^pkg-/,
      wsl: /^wsl-/
    }
    const wrong = ALL_HELP.filter((e) =>
      e.shell === 'any' || e.shell === 'windows'
        ? !anyPrefix[e.category]?.test(e.id)
        : !e.id.startsWith(HELP_ID_PREFIXES[e.shell])
    )
    expect(wrong.map((e) => `${e.id} (${e.shell}/${e.category})`)).toEqual([])
  })

  it('files every entry under a category the panel lists', () => {
    const listed = new Set(HELP_CATEGORIES.map((c) => c.id))
    expect(ALL_HELP.filter((e) => !listed.has(e.category)).map((e) => e.id)).toEqual([])
    // ...and lists no category that is empty for every shell.
    for (const c of HELP_CATEGORIES) expect(ALL_HELP.some((e) => e.category === c.id)).toBe(true)
  })

  it('writes the task as a short sentence with no full stop', () => {
    const bad = ALL_HELP.filter(
      (e) => e.task.length < 8 || e.task.length > 62 || /\.$/.test(e.task) || !/^["A-Z]/.test(e.task)
    )
    expect(bad.map((e) => `${e.id}: ${e.task}`)).toEqual([])
  })

  it('gives every entry a summary, and every variant a label and a command', () => {
    expect(ALL_HELP.filter((e) => e.summary.trim().length < 20).map((e) => e.id)).toEqual([])
    const bad = ALL_HELP.filter((e) => (e.variants ?? []).some((v) => !v.label.trim() || !v.command.trim()))
    expect(bad.map((e) => e.id)).toEqual([])
  })

  it('keeps every command to one line of plain ASCII, trimmed, with no angle-bracket placeholder', () => {
    const bad: string[] = []
    for (const e of ALL_HELP)
      for (const c of commandsOf(e)) {
        // A shell reads "<NAME>" as redirection from a file called NAME. A lone
        // "<" or ">" is real redirection and is allowed; a bracketed word is not.
        // Printable ASCII only (which also rules out a line break): a curly quote
        // or a non-breaking space looks right on screen and is a different
        // command to a shell.
        if (!c || c !== c.trim() || /[^\x20-\x7e]/.test(c) || /<[A-Za-z][A-Za-z0-9_ -]*>/.test(c))
          bad.push(`${e.id}: ${c}`)
      }
    expect(bad).toEqual([])
  })

  it('has no em-dash anywhere, in the entries or in the files that hold them', () => {
    const inEntries = ALL_HELP.filter((e) => textsOf(e).some((t) => t.includes(EM_DASH)))
    expect(inEntries.map((e) => e.id)).toEqual([])
    const files = readdirSync(__dirname).filter((f) => f.endsWith('.ts'))
    expect(files.filter((f) => readFileSync(join(__dirname, f), 'utf8').includes(EM_DASH))).toEqual([])
  })

  it('gives every entry 6 to 16 keywords, lower case, none twice', () => {
    const bad = ALL_HELP.filter(
      (e) =>
        e.keywords.length < 6 ||
        e.keywords.length > 16 ||
        new Set(e.keywords).size !== e.keywords.length ||
        e.keywords.some((k) => !k.trim() || k !== k.trim() || k !== k.toLowerCase())
    )
    expect(bad.map((e) => `${e.id} (${e.keywords.length})`)).toEqual([])
  })

  it('declares every placeholder a command uses, and uses every one it declares', () => {
    const bad: string[] = []
    for (const e of ALL_HELP) {
      const declared = Object.keys(e.placeholders ?? {})
      const used = new Set(commandsOf(e).flatMap(placeholdersIn))
      for (const name of declared) {
        if (!/^[A-Z][A-Z0-9_]*$/.test(name)) bad.push(`${e.id}: "${name}" is not UPPER_SNAKE`)
        else if (!commandsOf(e).some((c) => new RegExp(`(^|[^A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(c)))
          bad.push(`${e.id}: declares ${name}, which no command uses`)
        if (!(e.placeholders?.[name] ?? '').trim()) bad.push(`${e.id}: ${name} has no explanation`)
      }
      for (const name of used) if (!declared.includes(name)) bad.push(`${e.id}: uses ${name}, undeclared`)
    }
    expect(bad).toEqual([])
  })

  it('carries a danger line on everything that deletes, kills or overwrites', () => {
    const silent = ALL_HELP.filter((e) => !e.danger?.trim() && destructiveHits(e).length > 0)
    expect(silent.map((e) => `${e.id}: ${destructiveHits(e).join(', ')}`)).toEqual([])
  })

  it('knows a destructive command when it sees one, and an innocent one too', () => {
    const probe = (command: string): string[] =>
      destructiveHits({ id: 'x-y', shell: 'any', category: 'files', task: '', summary: '', command, keywords: [] })
    for (const c of [
      'Remove-Item FILE',
      'rm -rf FOLDER',
      'sudo rm FILE',
      'find . -name "*.tmp" | xargs rm',
      'rmdir /s /q FOLDER',
      'del /q *.tmp',
      'format D:',
      'Stop-Process -Id 12',
      'taskkill /pid 12 /f',
      'kill -9 12',
      'git reset --hard HEAD~1',
      'git clean -fd',
      'git push --force-with-lease',
      'git checkout -- FILE',
      'git branch -D NAME',
      'dd if=/dev/zero of=/dev/sda',
      'mkfs.ext4 /dev/sdb1',
      'tree /f /a > tree.txt',
      'echo TEXT> NAME',
      'COMMAND *> FILE',
      'curl -L -o FILE URL',
      'curl -LO URL',
      'Invoke-WebRequest URL -OutFile FILE'
    ])
      expect(probe(c), c).not.toEqual([])
    for (const c of [
      'Get-ChildItem | Format-Table',
      'git log --format=%H',
      'git clean -nd',
      'Remove-Item FOLDER -Recurse -WhatIf',
      'Get-Help Remove-Item',
      'git branch -d NAME',
      'git restore --staged FILE',
      'sed -i.bak s/A/B/ FILE',
      'COMMAND >> FILE',
      'COMMAND 2>nul',
      'COMMAND *> $null',
      'COMMAND 2>/dev/null',
      'whoami /groups | findstr /c:"S-1-16-12288" >nul && echo elevated',
      "COMMAND | awk '{print $2}'",
      'curl -I URL',
      'curl -s https://ifconfig.me'
    ])
      expect(probe(c), c).toEqual([])
  })

  it('writes every danger line as a sentence', () => {
    const bad = ALL_HELP.filter((e) => e.danger !== undefined && (e.danger.trim().length < 15 || !/[.!]$/.test(e.danger.trim())))
    expect(bad.map((e) => e.id)).toEqual([])
  })
})

describe('a key to press', () => {
  it('is told from a command to paste', () => {
    for (const k of ['Ctrl+C', 'Esc', 'Shift+Tab', 'Ctrl+D', 'Alt+V', 'Shift+Enter', 'Ctrl+J', 'F1']) expect(isKeyPress(k), k).toBe(true)
    for (const c of ['cd ..', ':q!', '/compact', 'git status', 'Get-ChildItem', 'ls', 'Ctrl+C twice', '@PATH', 'q'])
      expect(isKeyPress(c), c).toBe(false)
  })

  it('is what every key-shaped entry in the catalogue is read as, so none gets a copy button', () => {
    const keys = ALL_HELP.flatMap(commandsOf).filter((c) => /^(Ctrl|Alt|Shift|Esc)\b/.test(c))
    expect(keys.length).toBeGreaterThan(5)
    expect(keys.filter((c) => !isKeyPress(c))).toEqual([])
  })
})

describe('the shells', () => {
  it('reads a detected shell id as the language it speaks', () => {
    expect(shellOfShellId('pwsh')).toBe('powershell')
    expect(shellOfShellId('powershell')).toBe('powershell')
    expect(shellOfShellId('cmd')).toBe('cmd')
    expect(shellOfShellId('wsl-Ubuntu')).toBe('bash')
    expect(shellOfShellId('wsl-Debian-12')).toBe('bash')
    expect(shellOfShellId('git-bash')).toBe('bash')
    // A shell that has gone falls back to PowerShell, as the spawn does.
    expect(shellOfShellId('')).toBe('powershell')
    expect(shellOfShellId(undefined)).toBe('powershell')
    expect(shellOfShellId(null)).toBe('powershell')
  })

  it('offers each shell its own entries, every any-shell one, and the Windows ones outside Bash', () => {
    for (const s of HELP_SHELLS) {
      const list = helpFor(s.id)
      expect(list.length).toBeGreaterThan(100)
      expect(list.every((e) => e.shell === s.id || e.shell === 'any' || (e.shell === 'windows' && s.id !== 'bash'))).toBe(true)
      expect(list.some((e) => e.shell === 'windows')).toBe(s.id !== 'bash')
      expect(list.filter((e) => e.category === 'git').length).toBeGreaterThan(30)
      expect(list.filter((e) => e.category === 'agents').length).toBeGreaterThan(30)
    }
  })

  // A WSL TAB IS FOR LEARNING LINUX (owner, 2026-10-13: if the shared rows
  // "mostly consist of things that dont work in wsl, its better that we have"
  // Bash its own, "even though we duplicate stuff"). No row a Bash reader is
  // shown from a SHARED entry may be a Windows-only command: winget, a .exe,
  // PowerShell's $env: or irm, a Windows path (a backslash next to a name;
  // Claude's lone \ new-line key is not one), a .ps1 or .bat. Bash's own
  // entries may name explorer.exe or C:\ on purpose (the WSL seams).
  it('shows a Bash reader no Windows-only command from a shared entry', () => {
    const WINDOWS_ONLY = /\bwinget\b|\.exe\b|\$env:|\birm\b|\w\\|\\\w|\.ps1\b|\.bat\b/i
    const bad: string[] = []
    for (const e of helpFor('bash').filter((x) => x.shell !== 'bash')) {
      const rows = [e.command, ...variantsIn(e.variants, 'bash').map((v) => v.command)]
      for (const c of rows) if (WINDOWS_ONLY.test(c)) bad.push(`${e.id}: ${c}`)
    }
    expect(bad).toEqual([])
  })
  it('shows a Bash reader python3, never a bare python that Ubuntu does not have', () => {
    const bad = helpFor('bash').flatMap((e) =>
      [e.command, ...variantsIn(e.variants, 'bash').map((v) => v.command)].filter((c) => /(^|\s)python\s/.test(c)).map((c) => `${e.id}: ${c}`)
    )
    expect(bad).toEqual([])
  })
})

/**
 * REAL QUESTIONS AGAINST THE REAL CATALOGUE. `search.test.ts` proves the
 * ranking on a fixture; this proves the pairing, since a search can be right
 * and the catalogue still lack the keyword that would have let it land. Each
 * question names the entries that would be a sensible FIRST answer.
 */
const QUESTIONS: Readonly<Record<HelpShellChoice, ReadonlyArray<[string, string[]]>>> = {
  powershell: [
    ['how do I find big files', ['ps-biggest-files']],
    ['what is using port 3000', ['ps-port-in-use']],
    ['undo last commit', ['git-undo-last-commit']],
    ['where am i', ['ps-where-am-i']],
    ['delete a folder', ['ps-delete-folder']],
    ['grep', ['ps-search-in-files']],
    ['go back a folder', ['ps-go-up-a-folder']],
    ['kill a process', ['ps-stop-process']],
    ['unzip a file', ['ps-unzip']],
    ['see hidden files', ['ps-show-hidden-files']],
    ['running scripts is disabled', ['ps-scripts-disabled']],
    ['set an environment variable', ['ps-env-set-session']],
    ['how much disk space is left', ['ps-disk-space']],
    ['/compact', ['claude-compact']],
    ['install a program', ['pkg-winget-install']],
    ['how do i see whats in this folder', ['ps-list-files']],
    ['what files are here', ['ps-list-files']],
    ['ls -la', ['ps-list-files']],
    ['newest files', ['ps-recent-files', 'ps-list-files']],
    ['search for a word in all files', ['ps-search-in-files']],
    ['direcotry size', ['ps-folder-size']],
    ['close a frozen program', ['ps-stop-process']],
    ['install wsl', ['wsl-install']],
    ['wsl is stuck', ['wsl-shutdown']],
    ['install claude code', ['ps-install-claude']]
  ],
  cmd: [
    ['list files', ['cmd-list-files']],
    ['how do I find big files', ['cmd-biggest-files']],
    ['unzip a file', ['cmd-unzip']],
    ['what is using port 3000', ['cmd-port-in-use']],
    ['delete a folder', ['cmd-delete-folder']],
    ['where am i', ['cmd-where-am-i']],
    ['kill a process', ['cmd-kill-process']],
    ['search for text in files', ['cmd-find-text-in-files']],
    ['go back a folder', ['cmd-go-up']],
    ['copy a folder', ['cmd-copy-folder']],
    ['what is my ip address', ['cmd-ip-address']],
    ['rename a file', ['cmd-rename']],
    ['undo last commit', ['git-undo-last-commit']],
    ['add to path', ['cmd-add-to-path']],
    ['how do i see whats in this folder', ['cmd-list-files']],
    ['show me the files here', ['cmd-list-files']],
    ['newest files', ['cmd-list-files']],
    ['copy output to clipboard', ['cmd-pipe']],
    ['install codex', ['cmd-install-codex']],
    ['delete a linux distro', ['wsl-unregister']]
  ],
  bash: [
    ['how do I find big files', ['sh-biggest-files']],
    ['what is using port 3000', ['sh-port-in-use']],
    ['delete a folder', ['sh-delete-folder']],
    ['permission denied when running a script', ['sh-make-executable']],
    ['where am i', ['sh-where-am-i']],
    ['grep', ['sh-grep-recursive']],
    ['kill a process', ['sh-kill-process']],
    ['extract a tar.gz', ['sh-tar-extract']],
    ['install a package with apt', ['sh-apt-install']],
    ['how much disk space is left', ['sh-disk-free']],
    ['undo last commit', ['git-undo-last-commit']],
    ['resume my last claude conversation', ['claude-continue', 'claude-resume']],
    ['how do i see whats in this folder', ['sh-list-files']],
    ['what files are here', ['sh-list-files']],
    ['how do i exit vim', ['sh-edit-file']],
    ['where are my windows files', ['sh-windows-drives']],
    ['script says bad interpreter ^M', ['sh-line-endings']],
    ['install claude code', ['sh-install-claude']],
    ['python virtual environment', ['sh-python-venv']],
    ['pip install', ['sh-pip-install']]
  ]
}

describe('real questions, real catalogue', () => {
  it('names only entries that exist', () => {
    const ids = new Set(ALL_HELP.map((e) => e.id))
    const missing = Object.values(QUESTIONS)
      .flat()
      .flatMap(([, want]) => want)
      .filter((id) => !ids.has(id))
    expect([...new Set(missing)]).toEqual([])
  })

  for (const shell of HELP_SHELLS) {
    it(`finds a sensible first answer in ${shell.name}`, () => {
      const wrong: string[] = []
      for (const [question, want] of QUESTIONS[shell.id]) {
        const first = searchHelp(ALL_HELP, question, { shell: shell.id, limit: 3 })[0]?.entry.id
        if (!first || !want.includes(first)) wrong.push(`"${question}" -> ${first ?? 'nothing'} (wanted ${want.join(' or ')})`)
      }
      expect(wrong).toEqual([])
    })
  }

  it('answers a keystroke quickly, on the whole catalogue', () => {
    searchHelp(ALL_HELP, 'warm the index', { shell: 'powershell' })
    const t0 = performance.now()
    for (let i = 0; i < 20; i += 1) searchHelp(ALL_HELP, 'how do I find the biggest files in a folder', { shell: 'powershell' })
    // Well under a millisecond on a desktop; the bound leaves a busy CI runner
    // an order of magnitude of room and still catches a search gone quadratic.
    expect((performance.now() - t0) / 20).toBeLessThan(25)
  })
})

/**
 * A ROW SAYS WHAT IT IS, IN AS FEW WORDS AS POSSIBLE (owner, 2026-09-20: "make
 * sure the names or description headers are good. they should be ultra concise
 * and they should not say things like copy it to the clipboard. what is it?
 * and they should be very searchable. including a lot of meta tags that are
 * not visible to the user but lets them search easier").
 *
 * The panel draws one row per command and nothing else, so a name that was
 * written as a caption under its parent ("Copy it to the clipboard", "Another
 * folder", "The short way") is a row that says nothing on its own. These are
 * the rules that keep that from coming back.
 */
describe('a row name stands alone', () => {
  /** Every name the panel can draw: an entry's task, and each variant's label. */
  const NAMES: Array<{ id: string; name: string }> = ALL_HELP.flatMap((e) => [
    { id: e.id, name: e.task },
    ...(e.variants ?? []).map((v, i) => ({ id: `${e.id}#${i + 1}`, name: v.label }))
  ])

  it('is ultra concise: at most eight words and 54 characters', () => {
    const bad = NAMES.filter((n) => n.name.trim().split(/\s+/).length > 8 || n.name.length > 54)
    expect(bad.map((n) => `${n.id}: ${n.name}`)).toEqual([])
  })

  it('never opens with a word that points at another row', () => {
    // "Copy IT", "ALSO remove...", "ANOTHER folder", "THE SAME, in bash": each
    // of these needs the row above to mean anything, and the panel does not
    // promise there is one - a search shows a row on its own.
    const LEANS = /^(it|its|this|that|these|those|the same|same|also|another|other|a second|and |or |but |plus |then |or else)\b/i
    const bad = NAMES.filter((n) => LEANS.test(n.name.trim()))
    expect(bad.map((n) => `${n.id}: ${n.name}`)).toEqual([])
  })

  it('never says "it" or "the same" before naming the thing itself', () => {
    // Only where the pronoun comes FIRST, with nothing in the name for it to
    // refer to: "Copy it to the clipboard" points at the row above, while
    // "Delete a folder and everything in it" names its own subject and is fine.
    const EARLY = /^(?:\S+\s+){0,2}(?:it|them|the same)\b/i
    const bad = NAMES.filter((n) => EARLY.test(n.name.trim()))
    expect(bad.map((n) => `${n.id}: ${n.name}`)).toEqual([])
  })

  it('is written as a name, not a sentence: no full stop, no trailing comma', () => {
    const bad = NAMES.filter((n) => /[.,;:]$/.test(n.name.trim()) || n.name !== n.name.trim())
    expect(bad.map((n) => `${n.id}: ${n.name}`)).toEqual([])
  })

  it('is not the same as another row of the same entry', () => {
    const bad: string[] = []
    for (const e of ALL_HELP) {
      const names = [e.task, ...(e.variants ?? []).map((v) => v.label)].map((n) => n.toLowerCase())
      if (new Set(names).size !== names.length) bad.push(e.id)
    }
    expect(bad).toEqual([])
  })
})

describe('the hidden words', () => {
  it('gives every variant 3 to 12 of its own, lower case, none twice', () => {
    // The entry's keywords already cover every row; these are what is true of
    // THIS row only ("clipboard", "paste the path", "pwd to clipboard"). None
    // of them is ever drawn.
    const bad: string[] = []
    for (const e of ALL_HELP)
      (e.variants ?? []).forEach((v, i) => {
        const k = v.keywords ?? []
        if (
          k.length < 3 ||
          k.length > 12 ||
          new Set(k).size !== k.length ||
          k.some((w) => !w.trim() || w !== w.trim() || w !== w.toLowerCase())
        )
          bad.push(`${e.id}#${i + 1} (${k.length})`)
      })
    expect(bad).toEqual([])
  })

  it('is never only the row own words: a hidden word has to add something', () => {
    // A keyword that is already in the name is spent: the name is indexed too.
    const bad: string[] = []
    for (const e of ALL_HELP)
      (e.variants ?? []).forEach((v, i) => {
        const inName = new Set(v.label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
        const fresh = (v.keywords ?? []).filter((k) => !k.split(/\s+/).every((w) => inName.has(w)))
        if (fresh.length < 2) bad.push(`${e.id}#${i + 1}`)
      })
    expect(bad).toEqual([])
  })
})

// A BLANK AT THE END IS NOT DRAWN (owner, 2026-10-13: "dont say folder the
// user understand"): the row reads, and copies, the command up to it.
describe('blankless', () => {
  it('drops trailing bare placeholders and keeps the space', () => {
    expect(blankless('Set-Location FOLDER', ['FOLDER'])).toBe('Set-Location ')
    expect(blankless('wsl --export DISTRO FILE', ['DISTRO', 'FILE'])).toBe('wsl --export ')
  })
  it('drops a wholly quoted one at the end too', () => {
    expect(blankless('git commit -m "MESSAGE"', ['MESSAGE'])).toBe('git commit -m ')
    expect(blankless("Add-Content FILE 'TEXT'", ['FILE', 'TEXT'])).toBe('Add-Content ')
  })
  it('keeps a placeholder in the middle, a partly quoted one, and a command with none', () => {
    expect(blankless('Remove-Item FOLDER -Recurse -Force', ['FOLDER'])).toBe('Remove-Item FOLDER -Recurse -Force')
    expect(blankless("Get-ChildItem -Filter '*.EXT'", ['EXT'])).toBe("Get-ChildItem -Filter '*.EXT'")
    expect(blankless('git status', [])).toBe('git status')
    // Never the whole command.
    expect(blankless('FOLDER', ['FOLDER'])).toBe('FOLDER')
  })
})

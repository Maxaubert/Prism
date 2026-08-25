import { describe, expect, it } from 'vitest'
import { extractArgs, isSevenArchive, listArgs, parseListing, safeMemberPath, sevenDirs } from './sevenZip'

// Real `7z l -slt` output, kept verbatim: the parser's whole job is to survive
// what 7-Zip actually prints.
const REAL = `
7-Zip 25.00 (x64) : Copyright (c) 1999-2025 Igor Pavlov : 2025-07-05

Scanning the drive for archives:
1 file, 209 bytes (1 KiB)

Listing archive: test.7z

--
Path = test.7z
Type = 7z
Physical Size = 209

----------
Path = sub
Size = 0
Packed Size = 0
Modified = 2026-08-24 12:06:08
Attributes = D_ drwxr-xr-x
CRC =
Encrypted = -

Path = note.txt
Size = 25
Packed Size = 40
Modified = 2026-08-24 12:06:00
Attributes = A_ -rw-r--r--
CRC = 12345678
Encrypted = -

Path = sub\\deep.txt
Size = 7
Packed Size = 20
Attributes = A_
Encrypted = +
`

describe('reading a 7-Zip listing', () => {
  const entries = parseListing(REAL)

  it('finds every member and nothing from the header', () => {
    // "Path = test.7z" above the ---- line is the ARCHIVE, not a member.
    expect(entries.map((e) => e.name)).toEqual(['sub', 'note.txt', 'deep.txt'])
  })

  it('tells folders from files by their attributes', () => {
    expect(entries[0].dir).toBe(true)
    expect(entries[1].dir).toBe(false)
  })

  it('leaves NO trailing slash on a folder, the panel convention', () => {
    // With one on, parentOf('sub/') is 'sub', and the folder lands inside
    // itself: the row simply never appears.
    expect(entries[0].path).toBe('sub')
  })

  it('turns backslashes into the forward slashes the panel navigates by', () => {
    expect(entries[2].path).toBe('sub/deep.txt')
  })

  it('carries sizes and the encrypted flag', () => {
    expect(entries[1].size).toBe(25)
    expect(entries[1].encrypted).toBeUndefined()
    expect(entries[2].encrypted).toBe(true)
  })

  it('carries the packed size and the entry time, for the columns', () => {
    expect(entries[1].packed).toBe(40)
    // "2026-08-24 12:06:00", 7-Zip's own format, read as local time.
    expect(new Date(entries[1].mtime!).getHours()).toBe(12)
    expect(new Date(entries[1].mtime!).getDate()).toBe(24)
  })

  it('leaves them undefined when the listing has none, rather than guessing', () => {
    // deep.txt in the fixture has no Modified line at all.
    expect(entries[2].mtime).toBeUndefined()
    expect(entries[2].packed).toBe(20)
  })

  it('says nothing rather than inventing members', () => {
    expect(parseListing('')).toEqual([])
    expect(parseListing('7-Zip 25.00\nnothing here\n')).toEqual([])
  })
})

describe('which archives this module owns', () => {
  it('takes the read-only family', () => {
    for (const e of ['.7z', '.rar', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.iso', '.cab']) {
      expect(isSevenArchive(e), e).toBe(true)
    }
  })

  it('never takes zip, which Prism writes itself', () => {
    expect(isSevenArchive('.zip')).toBe(false)
    expect(isSevenArchive('.ZIP')).toBe(false)
  })
})

describe('the 7-Zip command', () => {
  it('puts switches before the archive, and -- before any name', () => {
    // A member called "-something" inside a hostile archive must never be
    // read as a switch.
    const a = listArgs('C:\\a.rar', 'secret')
    expect(a.indexOf('--')).toBeGreaterThan(a.indexOf('-slt'))
    expect(a[a.indexOf('--') + 1]).toBe('C:\\a.rar')
    expect(a).toContain('-psecret')
  })

  it('extracts one named member into a given folder, keeping its path', () => {
    const a = extractArgs('C:\\a.7z', 'sub/deep.txt', 'C:\\tmp\\x', '')
    expect(a[0]).toBe('x') // not 'e': folders are preserved
    expect(a).toContain('-oC:\\tmp\\x')
    expect(a[a.length - 1]).toBe('sub/deep.txt')
    expect(a[a.length - 2]).toBe('C:\\a.7z')
  })

  it('passes a password through even when empty, so it never prompts', () => {
    // 7-Zip stops for input on an encrypted archive without -p, and a stopped
    // child with nobody reading it hangs the call.
    expect(listArgs('a.7z', '')).toContain('-p')
  })
})

describe('where the binary is looked for', () => {
  it('prefers what the installer shipped', () => {
    expect(sevenDirs(true, 'C:\\app\\resources', 'C:\\app')[0]).toBe('C:\\app\\resources\\bin')
  })

  it('walks up to vendor when running from a build dir', () => {
    expect(sevenDirs(false, '', 'C:\\repo\\out\\main')).toContain('C:\\repo\\vendor\\7zip')
  })
})

describe('refusing a hostile member name', () => {
  const dir = String.raw`C:\tmp\prism-arc-1`

  it('accepts an ordinary member, folders and all', () => {
    expect(safeMemberPath('note.txt', dir)).toBe('note.txt')
    expect(safeMemberPath('sub/deep.txt', dir)).toBe('sub/deep.txt')
    expect(safeMemberPath(String.raw`sub\deep.txt`, dir)).toBe('sub/deep.txt')
  })

  it('refuses traversal, before anything is extracted', () => {
    // The check has to happen BEFORE 7-Zip runs: afterwards, a file that
    // escaped is already written wherever it went.
    expect(safeMemberPath('../evil.exe', dir)).toBeNull()
    expect(safeMemberPath(String.raw`..\..\Startup\evil.exe`, dir)).toBeNull()
    expect(safeMemberPath('sub/../../evil', dir)).toBeNull()
  })

  it('refuses absolute paths and drive letters', () => {
    expect(safeMemberPath('/etc/passwd', dir)).toBeNull()
    expect(safeMemberPath(String.raw`C:\Windows\System32\evil.dll`, dir)).toBeNull()
    expect(safeMemberPath(String.raw`\\server\share\evil`, dir)).toBeNull()
  })

  it('refuses nothing at all, and absurd lengths', () => {
    expect(safeMemberPath('', dir)).toBeNull()
    expect(safeMemberPath('a'.repeat(5000), dir)).toBeNull()
  })
})

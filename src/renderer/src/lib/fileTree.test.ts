import { describe, expect, it } from 'vitest'
import { ancestorChain, parentDir, stepRow, toggleExpanded, visibleRows } from './fileTree'

const R = 'C:\\photos'

describe('ancestorChain', () => {
  it('lists the root down to the folder holding the file', () => {
    expect(ancestorChain(R, 'C:\\photos\\2024\\trip\\a.jpg')).toEqual([
      'C:\\photos',
      'C:\\photos\\2024',
      'C:\\photos\\2024\\trip'
    ])
  })

  it('is just the root for a file sitting in it', () => {
    expect(ancestorChain(R, 'C:\\photos\\a.jpg')).toEqual([R])
  })

  it('ignores case differences in the root, as Windows does', () => {
    expect(ancestorChain(R, 'C:\\PHOTOS\\2024\\a.jpg')).toEqual([R, 'C:\\photos\\2024'])
  })

  it('is empty for a path outside the root', () => {
    expect(ancestorChain(R, 'C:\\elsewhere\\a.jpg')).toEqual([])
    expect(ancestorChain(R, 'C:\\photos-old\\a.jpg')).toEqual([])
  })

  it('is empty when either side is missing', () => {
    expect(ancestorChain('', 'C:\\photos\\a.jpg')).toEqual([])
    expect(ancestorChain(R, '')).toEqual([])
  })

  it('handles forward slashes', () => {
    expect(ancestorChain('C:/photos', 'C:/photos/2024/a.jpg')).toEqual(['C:/photos', 'C:/photos/2024'])
  })
})

describe('parentDir', () => {
  it('drops the last segment', () => {
    expect(parentDir('C:\\photos\\2024\\a.jpg')).toBe('C:\\photos\\2024')
    expect(parentDir('C:/photos/a.jpg')).toBe('C:/photos')
  })

  it('returns empty when there is nothing to drop', () => {
    expect(parentDir('a.jpg')).toBe('')
    expect(parentDir('')).toBe('')
  })
})

describe('toggleExpanded', () => {
  it('adds a closed folder and removes an open one', () => {
    const once = toggleExpanded(new Set<string>(), 'C:\\photos\\2024')
    expect([...once]).toEqual(['C:\\photos\\2024'])
    expect([...toggleExpanded(once, 'C:\\photos\\2024')]).toEqual([])
  })

  it('leaves the original set alone', () => {
    const before = new Set(['C:\\photos'])
    toggleExpanded(before, 'C:\\photos\\2024')
    expect([...before]).toEqual(['C:\\photos'])
  })
})

/* ---------- the keyboard's view of the tree ---------- */

const entry = (path: string): { path: string; name: string } => ({
  path,
  name: path.slice(path.lastIndexOf('\\') + 1)
})
const listing = (
  folders: string[],
  files: string[]
): { folders: Array<{ path: string; name: string }>; files: Array<{ path: string; name: string }> } => ({
  folders: folders.map(entry),
  files: files.map(entry)
})
const OPTS = {
  fileVisible: (): boolean => true,
  orderFiles: <T,>(x: T[]): T[] => x,
  foldersReversed: false
}

describe('visibleRows', () => {
  const CHILDREN = {
    'C:\\r': listing(['C:\\r\\code', 'C:\\r\\img'], ['C:\\r\\a.txt']),
    'C:\\r\\code': listing(['C:\\r\\code\\deep'], ['C:\\r\\code\\m.py']),
    'C:\\r\\code\\deep': listing([], ['C:\\r\\code\\deep\\x.ts']),
    'C:\\r\\img': listing([], ['C:\\r\\img\\p.png'])
  }
  type Children = Record<
    string,
    { folders: Array<{ path: string; name: string }>; files: Array<{ path: string; name: string }>; unreadable?: boolean }
  >
  const names = (expanded: string[], children: Children = CHILDREN, opts = OPTS): string[] =>
    visibleRows('C:\\r', new Set(expanded), children, opts).map((r) => r.name)

  it('lists folders before files, a collapsed folder contributing only itself', () => {
    expect(names(['C:\\r'])).toEqual(['code', 'img', 'a.txt'])
  })

  // `deep` is still a row here: expanding a folder shows its subfolders, it
  // just doesn't open them.
  it('walks into what is expanded, depth first', () => {
    expect(names(['C:\\r', 'C:\\r\\code'])).toEqual(['code', 'deep', 'm.py', 'img', 'a.txt'])
  })

  it('goes as deep as the expansion does', () => {
    expect(names(['C:\\r', 'C:\\r\\code', 'C:\\r\\code\\deep'])).toEqual([
      'code',
      'deep',
      'x.ts',
      'm.py',
      'img',
      'a.txt'
    ])
  })

  it('shows an expanded folder whose children have not loaded as just itself', () => {
    expect(names(['C:\\r', 'C:\\r\\img'], { 'C:\\r': CHILDREN['C:\\r'] })).toEqual([
      'code',
      'img',
      'a.txt'
    ])
  })

  it('skips an unreadable folder rather than throwing', () => {
    const children = { ...CHILDREN, 'C:\\r\\img': { folders: [], files: [], unreadable: true } }
    expect(names(['C:\\r', 'C:\\r\\img'], children)).toEqual(['code', 'img', 'a.txt'])
  })

  it('applies the filter to files and never to folders', () => {
    expect(names(['C:\\r'], CHILDREN, { ...OPTS, fileVisible: () => false })).toEqual(['code', 'img'])
  })

  it('takes its order from the caller, for files and folders alike', () => {
    expect(
      names(['C:\\r', 'C:\\r\\code'], CHILDREN, {
        ...OPTS,
        foldersReversed: true,
        orderFiles: (x) => [...x].reverse()
      })
    ).toEqual(['img', 'code', 'deep', 'm.py', 'a.txt'])
  })

  it('survives a folder that contains itself', () => {
    const loop = { 'C:\\r': listing(['C:\\r'], []) }
    expect(() => visibleRows('C:\\r', new Set(['C:\\r']), loop, OPTS)).not.toThrow()
  })

  it('is empty when the root has not loaded', () => {
    expect(visibleRows('C:\\r', new Set(['C:\\r']), {}, OPTS)).toEqual([])
  })
})

describe('stepRow', () => {
  // code / m.py / a.txt - one expanded folder, so the cursor can cross it.
  const ROWS = visibleRows(
    'C:\\r',
    new Set(['C:\\r', 'C:\\r\\code']),
    {
      'C:\\r': listing(['C:\\r\\code'], ['C:\\r\\a.txt']),
      'C:\\r\\code': listing([], ['C:\\r\\code\\m.py'])
    },
    OPTS
  )

  it('steps one row at a time, folders included', () => {
    expect(stepRow(ROWS, 'C:\\r\\code', 1)?.name).toBe('m.py')
    expect(stepRow(ROWS, 'C:\\r\\code\\m.py', 1)?.name).toBe('a.txt')
    expect(stepRow(ROWS, 'C:\\r\\a.txt', -1)?.name).toBe('m.py')
  })

  it('skips folders when asked for files only', () => {
    expect(stepRow(ROWS, 'C:\\r\\code\\m.py', -1, true)).toBeNull()
    expect(stepRow(ROWS, 'C:\\r\\a.txt', -1, true)?.name).toBe('m.py')
  })

  it('crosses a folder boundary, which is the point of walking the whole tree', () => {
    expect(stepRow(ROWS, 'C:\\r\\code\\m.py', 1, true)?.name).toBe('a.txt')
  })

  it('stops at the ends instead of wrapping', () => {
    expect(stepRow(ROWS, 'C:\\r\\a.txt', 1)).toBeNull()
    expect(stepRow(ROWS, 'C:\\r\\code', -1)).toBeNull()
  })

  it('steps in from the near end when nothing is selected', () => {
    expect(stepRow(ROWS, null, 1)?.name).toBe('code')
    expect(stepRow(ROWS, null, -1)?.name).toBe('a.txt')
  })

  it('is case-insensitive about the path it is given, as Windows is', () => {
    expect(stepRow(ROWS, 'c:\\R\\CODE', 1)?.name).toBe('m.py')
  })

  it('has nowhere to go in an empty tree', () => {
    expect(stepRow([], null, 1)).toBeNull()
  })
})


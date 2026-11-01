import { describe, expect, it } from 'vitest'
import {
  baseName,
  byName,
  extOf,
  isInside,
  naturalCompare,
  parentDir,
  pathKey,
  samePath,
  trimSep,
  volumeOf
} from './path'

describe('trimSep', () => {
  it('drops trailing separators of either kind, and only those', () => {
    expect(trimSep('C:\\a\\')).toBe('C:\\a')
    expect(trimSep('C:/a//')).toBe('C:/a')
    expect(trimSep('C:\\')).toBe('C:')
    expect(trimSep('C:\\a')).toBe('C:\\a')
    expect(trimSep('')).toBe('')
  })
})

describe('baseName', () => {
  it('is the last name, with either separator', () => {
    expect(baseName('C:\\photos\\a.jpg')).toBe('a.jpg')
    expect(baseName('C:/photos/a.jpg')).toBe('a.jpg')
    expect(baseName('C:\\photos/mixed\\b.png')).toBe('b.png')
  })

  it('ignores a trailing separator', () => {
    expect(baseName('C:\\photos\\')).toBe('photos')
    expect(baseName('C:\\photos//')).toBe('photos')
  })

  it('answers the drive at a drive root, and the share at a UNC root', () => {
    expect(baseName('C:\\')).toBe('C:')
    expect(baseName('C:')).toBe('C:')
    expect(baseName('\\\\server\\share')).toBe('share')
    expect(baseName('\\\\server\\share\\')).toBe('share')
  })

  it('keeps dotfiles and names that start with two dots', () => {
    expect(baseName('C:\\a\\.gitignore')).toBe('.gitignore')
    expect(baseName('C:\\a\\..foo')).toBe('..foo')
  })

  it('answers a bare name, and a nameless path, as themselves', () => {
    expect(baseName('a.jpg')).toBe('a.jpg')
    expect(baseName('')).toBe('')
    expect(baseName('\\')).toBe('\\')
  })
})

describe('parentDir', () => {
  it('is everything before the last separator', () => {
    expect(parentDir('C:\\photos\\2024\\a.jpg')).toBe('C:\\photos\\2024')
    expect(parentDir('C:/photos/a.jpg')).toBe('C:/photos')
    expect(parentDir('C:\\photos/a.jpg')).toBe('C:\\photos')
  })

  it('answers the bare drive for a file at a drive root', () => {
    expect(parentDir('C:\\a.jpg')).toBe('C:')
    expect(parentDir('C:\\')).toBe('C:')
  })

  it('counts a trailing separator as the last one', () => {
    expect(parentDir('C:\\a\\')).toBe('C:\\a')
  })

  it('reads a UNC path', () => {
    expect(parentDir('\\\\server\\share\\a.jpg')).toBe('\\\\server\\share')
  })

  it('answers empty for a bare name or a leading separator only', () => {
    expect(parentDir('a.jpg')).toBe('')
    expect(parentDir('')).toBe('')
    expect(parentDir('\\a')).toBe('')
  })
})

describe('extOf', () => {
  it('is the lower-cased extension with its dot', () => {
    expect(extOf('a.JPG')).toBe('.jpg')
    expect(extOf('C:\\x\\archive.tar.GZ')).toBe('.gz')
    expect(extOf('README')).toBe('')
    expect(extOf('')).toBe('')
  })

  it('reads a dotfile as all extension, as fileKind does', () => {
    expect(extOf('.gitignore')).toBe('.gitignore')
    expect(extOf('C:\\repo\\.gitignore')).toBe('.gitignore')
  })

  it('never takes a dot from a folder name', () => {
    expect(extOf('C:\\v1.2\\notes')).toBe('')
    expect(extOf('C:/v1.2/notes')).toBe('')
  })

  it('answers a bare dot for a trailing dot', () => {
    expect(extOf('a.')).toBe('.')
  })
})

describe('pathKey and samePath', () => {
  it('ignores case, the separator and a trailing separator', () => {
    expect(pathKey('C:/Photos/')).toBe('c:\\photos')
    expect(samePath('C:/Photos/', 'c:\\photos')).toBe(true)
    expect(samePath('C:\\', 'c:')).toBe(true)
  })

  it('keeps two different folders different', () => {
    expect(samePath('C:\\a', 'C:\\ab')).toBe(false)
    expect(samePath('\\\\server\\share', '\\\\server\\share2')).toBe(false)
  })
})

describe('isInside', () => {
  it('is true under the folder, with either separator and any case', () => {
    expect(isInside('C:\\Photos', 'c:\\photos\\a.jpg')).toBe(true)
    expect(isInside('C:/Photos/', 'C:\\Photos\\2024\\a.jpg')).toBe(true)
  })

  it('needs the separator: a same-prefixed sibling is outside', () => {
    expect(isInside('C:\\r', 'C:\\roots\\a')).toBe(false)
    expect(isInside('C:\\a', 'C:\\a..foo')).toBe(false)
  })

  it('counts a child whose name starts with two dots as inside', () => {
    expect(isInside('C:\\a', 'C:\\a\\..foo')).toBe(true)
  })

  it('counts the folder itself only with orEqual', () => {
    expect(isInside('C:\\a', 'C:\\a')).toBe(false)
    expect(isInside('C:\\a', 'c:\\A\\')).toBe(false)
    expect(isInside('C:\\a', 'c:\\A\\', { orEqual: true })).toBe(true)
  })

  it('reads a drive root and a UNC root', () => {
    expect(isInside('C:\\', 'C:\\a')).toBe(true)
    expect(isInside('C:\\', 'D:\\a')).toBe(false)
    expect(isInside('\\\\srv\\share', '\\\\srv\\share\\a')).toBe(true)
    expect(isInside('\\\\srv\\share', '\\\\srv\\shared\\a')).toBe(false)
  })

  it('puts nothing inside an empty path, and an empty path inside nothing', () => {
    expect(isInside('', 'C:\\a')).toBe(false)
    expect(isInside('C:\\a', '')).toBe(false)
  })
})

describe('volumeOf (#70, the drive rule)', () => {
  it('reads a drive letter, either case, with or without a separator', () => {
    expect(volumeOf('C:\\')).toBe('c:')
    expect(volumeOf('c:')).toBe('c:')
    expect(volumeOf('D:\\Photos\\a.jpg')).toBe('d:')
    expect(volumeOf('d:/photos')).toBe('d:')
  })

  it('reads a share root as its volume', () => {
    expect(volumeOf('\\\\srv\\share\\x')).toBe('\\\\srv\\share')
    expect(volumeOf('\\\\SRV\\Share')).toBe('\\\\srv\\share')
    expect(volumeOf('//srv/share/x')).toBe('\\\\srv\\share')
  })

  it("puts a place inside a zip on the zip file's drive", () => {
    expect(volumeOf('E:\\Downloads\\a.zip\\inner\\b.txt')).toBe('e:')
  })

  it('answers empty for anything it cannot read', () => {
    expect(volumeOf('')).toBe('')
    expect(volumeOf('relative\\x')).toBe('')
    expect(volumeOf('\\\\srv')).toBe('')
  })
})

describe('naturalCompare and byName', () => {
  it('orders numbers by value', () => {
    expect(['10.jpg', '2.jpg', '1.jpg'].sort(naturalCompare)).toEqual(['1.jpg', '2.jpg', '10.jpg'])
    expect([{ name: 'b10' }, { name: 'b9' }].sort(byName).map((x) => x.name)).toEqual(['b9', 'b10'])
  })

  it('is case-blind at first glance, with case only breaking a tie', () => {
    expect(naturalCompare('apple', 'Banana')).toBeLessThan(0)
    expect(naturalCompare('a', 'A')).not.toBe(0)
  })
})

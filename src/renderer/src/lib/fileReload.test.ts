import { describe, expect, it } from 'vitest'
import { reloadAction, stampChanged, touchesFile } from './fileReload'

const change = (root: string, ...dirs: string[]): { root: string; dirs: string[] } => ({ root, dirs })

describe('whether a watcher event could be about this file', () => {
  const file = 'C:\\work\\notes\\todo.txt'

  it('hits when the file own folder is named', () => {
    expect(touchesFile(file, change('C:\\work', 'C:\\work\\notes'))).toBe(true)
  })

  it('misses when a sibling folder changed', () => {
    expect(touchesFile(file, change('C:\\work', 'C:\\work\\other'))).toBe(false)
  })

  it('ignores casing, because the watcher reports the OS casing', () => {
    expect(touchesFile(file, change('c:\\WORK', 'C:\\Work\\NOTES'))).toBe(true)
  })

  it('takes the root itself as a hit, which is what a nameless event reports', () => {
    // ReadDirectoryChangesW sometimes gives no file name; dirWatch then
    // reports the root, and there is no way to tell what moved.
    expect(touchesFile(file, change('C:\\work', 'C:\\work'))).toBe(true)
  })

  it('does not take some OTHER root as a hit', () => {
    expect(touchesFile(file, change('C:\\elsewhere', 'C:\\elsewhere'))).toBe(false)
  })

  it('handles a file sitting directly in the root', () => {
    expect(touchesFile('C:\\work\\a.txt', change('C:\\work', 'C:\\work'))).toBe(true)
  })

  it('says no about nothing', () => {
    expect(touchesFile('', change('C:\\work', 'C:\\work'))).toBe(false)
  })
})

describe('whether the file really moved', () => {
  it('sees a new mtime', () => {
    expect(stampChanged({ mtimeMs: 1, size: 10 }, { mtimeMs: 2, size: 10 })).toBe(true)
  })

  it('sees a new size even at the same mtime', () => {
    expect(stampChanged({ mtimeMs: 1, size: 10 }, { mtimeMs: 1, size: 11 })).toBe(true)
  })

  it('says no when nothing moved - which is Prism own save, arriving late', () => {
    // ownWrite mutes the directory, but a muted directory is DEFERRED and
    // emitted when the mute lifts. Every Ctrl+S therefore produces an event
    // about 1.2s later, and only the stamp tells them apart.
    expect(stampChanged({ mtimeMs: 7, size: 42 }, { mtimeMs: 7, size: 42 })).toBe(false)
  })

  it('says no when the file has momentarily vanished', () => {
    // A rename-into-place write, or a git checkout. Reading nothing and
    // calling it the new contents is how you lose a file.
    expect(stampChanged({ mtimeMs: 1, size: 10 }, null)).toBe(false)
  })

  it('says no when we never had a stamp to compare against', () => {
    expect(stampChanged(null, { mtimeMs: 1, size: 10 })).toBe(false)
  })
})

describe('what to do about it', () => {
  const at = (o: Partial<Parameters<typeof reloadAction>[0]>) =>
    reloadAction({ changed: true, dirty: false, asking: false, fullscreen: false, ...o })

  it('does nothing when the file did not move', () => {
    expect(at({ changed: false })).toBe('ignore')
    expect(at({ changed: false, dirty: true })).toBe('ignore')
  })

  it('swaps silently when the editor holds no edits', () => {
    expect(at({})).toBe('swap')
  })

  it('asks when it would throw away typing', () => {
    expect(at({ dirty: true })).toBe('ask')
  })

  it('asks only once, however many times the file is rewritten', () => {
    // An agent in a build loop rewrites every quiet window; a dialog that
    // re-raises every second is worse than the frozen copy it replaced.
    expect(at({ dirty: true, asking: true })).toBe('ignore')
  })

  it('holds the question until fullscreen ends, but still swaps a clean file', () => {
    // Dialogs render outside the fullscreen element, where nobody sees them.
    expect(at({ dirty: true, fullscreen: true })).toBe('ignore')
    expect(at({ fullscreen: true })).toBe('swap')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newBrowse } from '../lib/browse'
import { newTab } from '../lib/tabs/tabs'
import type { ViewerFile } from '@shared/types'

// useEffect runs at once, so the hook's key listener can be driven by hand.
vi.mock('react', async (orig) => {
  const real = await orig<typeof import('react')>()
  return { ...real, useEffect: (fn: () => void): void => void fn() }
})

import { useAppKeys, type AppKeysDeps } from './useAppKeys'

const body = { closest: () => null }
let listener: ((e: unknown) => void) | undefined

beforeEach(() => {
  // The setup's stand-in document is a plain object: give it what the keys read.
  Object.assign(document, {
    body,
    activeElement: null,
    querySelector: () => null,
    querySelectorAll: () => []
  })
  vi.stubGlobal('window', {
    addEventListener: (_: string, fn: (e: unknown) => void) => {
      listener = fn
    },
    removeEventListener: () => {},
    getSelection: () => null
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  listener = undefined
})

const file = (extra: Partial<ViewerFile> = {}): ViewerFile => ({
  path: 'C:\\t\\a.txt',
  name: 'a.txt',
  ext: '.txt',
  kind: 'text',
  size: 1,
  mtimeMs: 0,
  ...extra
})

function press(key: string, f: ViewerFile, ctrl = false): { ask: unknown[]; rename: unknown[]; prevented: boolean } {
  const ask: unknown[] = []
  const rename: unknown[] = []
  const browse = newBrowse('C:\\t', 'viewer')
  const active = newTab({ root: 'C:\\t', files: [f], index: 0, browse, role: 'explorer' }, 'explorer')
  const noop = (): void => {}
  // The effect is mocked to run at once, so this is not a component render.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useAppKeys({
    setup: false,
    settingsOpen: false,
    fullscreen: false,
    active,
    browsing: { folder: false } as unknown as AppKeysDeps['browsing'],
    viewerDirectory: 'C:\\t',
    pasteFiles: async () => {},
    file: f,
    setBrowseRename: ((v: unknown) => rename.push(v)) as AppKeysDeps['setBrowseRename'],
    setAsk: ((v: unknown) => ask.push(v)) as AppKeysDeps['setAsk'],
    viewingFile: true,
    returnToFolder: noop,
    setFs: noop,
    redo: noop,
    undo: noop,
    newTab: noop,
    closeActiveTab: noop,
    stepTab: noop,
    jumpTab: noop,
    togglePanel: noop,
    go: noop,
    hasNavigated: false
  })
  let prevented = false
  listener!({
    target: body,
    key,
    code: '',
    ctrlKey: ctrl,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    preventDefault: () => {
      prevented = true
    },
    stopPropagation: noop
  })
  return { ask, rename, prevented }
}

describe('Delete and F2 on a file in full view (audit #77)', () => {
  it('ask to delete and rename an ordinary file', () => {
    expect(press('Delete', file()).ask).toHaveLength(1)
    expect(press('F2', file()).rename).toHaveLength(1)
  })

  it('ask nothing for an archive member or a binned file', () => {
    const member = file({ member: true })
    const binned = file({ binned: {} as unknown as ViewerFile['binned'] })
    for (const f of [member, binned]) {
      expect(press('Delete', f).ask).toHaveLength(0)
      expect(press('F2', f).rename).toHaveLength(0)
    }
  })
})
import { describe, expect, it } from 'vitest'
import { createOwnClipboard, PRISM_COPY_FORMAT, type ClipView } from './ownClipboard'

/** A clipboard as Electron's main sees it: formats, text, raw buffers. */
function fakeView(): ClipView & { set(formats: string[], text?: string, buffers?: Record<string, string>): void } {
  let formats: string[] = ['text/plain']
  let text = 'what the owner copied in a browser'
  let buffers: Record<string, string> = {}
  return {
    set(f, t = '', b = {}) {
      formats = f
      text = t
      buffers = b
    },
    availableFormats: () => formats,
    readText: () => text,
    readBuffer: (format) => Buffer.from(buffers[format] ?? '', 'utf8')
  }
}

/** What Prism's write puts on the clipboard once it lands: the files and its token. */
const landed = (view: ReturnType<typeof fakeView>, token: string, text = ''): void =>
  view.set(['text/uri-list'], text, { [PRISM_COPY_FORMAT]: token + '\0\0' })

describe('Prism pastes its own copy (#484)', () => {
  it('nothing copied in Prism: the Windows clipboard is read', () => {
    const own = createOwnClipboard(() => fakeView())
    expect(own.source()).toMatchObject({ from: 'windows', why: 'no-prism-copy' })
  })

  it('a copy whose Windows write has not finished: paste uses the record, not the clipboard', () => {
    const view = fakeView()
    const own = createOwnClipboard(() => view)
    own.begin(['C:\\zip-member\\a.txt'], false)
    expect(own.source()).toEqual({
      from: 'prism',
      paths: ['C:\\zip-member\\a.txt'],
      cut: false,
      why: 'write-pending',
      copy: expect.any(String)
    })
  })

  it('a write that TIMED OUT (the owner, 2026-11-06 18:12): paste still has the files', () => {
    const view = fakeView()
    const own = createOwnClipboard(() => view)
    const c = own.begin(['C:\\zip-member\\a.txt'], true)
    own.settle(c.id, false, 'timeout')
    expect(own.source()).toMatchObject({ from: 'prism', paths: ['C:\\zip-member\\a.txt'], cut: true, why: 'write-failed' })
    expect(own.latest()).toMatchObject({ state: 'failed', reason: 'timeout' })
  })

  it('a write that landed: the clipboard holds Prism\u2019s token, so the record answers (no PowerShell read)', () => {
    const view = fakeView()
    const own = createOwnClipboard(() => view)
    const c = own.begin(['C:\\a.txt', 'C:\\b.txt'], false)
    landed(view, c.id)
    own.settle(c.id, true)
    expect(own.source()).toMatchObject({ from: 'prism', why: 'clipboard-holds-it', paths: ['C:\\a.txt', 'C:\\b.txt'] })
  })

  it('the clipboard changed OUTSIDE Prism after the copy: Windows wins', () => {
    const view = fakeView()
    const own = createOwnClipboard(() => view)
    const c = own.begin(['C:\\a.txt'], false)
    own.settle(c.id, false, 'timeout')
    view.set(['text/plain'], 'copied in another app afterwards')
    expect(own.source()).toMatchObject({ from: 'windows', why: 'changed-outside' })
  })

  it('after a landed write, another app copying replaces it: Windows wins', () => {
    const view = fakeView()
    const own = createOwnClipboard(() => view)
    const c = own.begin(['C:\\a.txt'], false)
    landed(view, c.id)
    own.settle(c.id, true)
    view.set(['text/uri-list'], '', {})
    expect(own.source()).toMatchObject({ from: 'windows', why: 'changed-outside' })
  })

  it('an OLDER Prism copy still on the clipboard while the newest write hangs: the newest record answers', () => {
    const view = fakeView()
    const own = createOwnClipboard(() => view)
    const first = own.begin(['C:\\old.txt'], false)
    landed(view, first.id)
    own.settle(first.id, true)
    own.begin(['C:\\new.txt'], false)
    expect(own.source()).toMatchObject({ from: 'prism', paths: ['C:\\new.txt'], why: 'write-pending' })
  })

  it('a settle for a superseded copy changes nothing', () => {
    const view = fakeView()
    const own = createOwnClipboard(() => view)
    const first = own.begin(['C:\\old.txt'], false)
    const second = own.begin(['C:\\new.txt'], false)
    own.settle(first.id, true)
    expect(own.latest()).toMatchObject({ id: second.id, state: 'pending' })
  })

  it('a cut pasted from the record is used up: the next paste has nothing to move', () => {
    const view = fakeView()
    const own = createOwnClipboard(() => view)
    const c = own.begin(['C:\\a.txt'], true)
    landed(view, c.id)
    own.settle(c.id, true)
    own.used(c.id)
    expect(own.source()).toMatchObject({ from: 'prism', paths: [], why: 'cut-already-pasted' })
  })

  it('a clipboard that will not answer counts as unchanged, never as a crash', () => {
    const own = createOwnClipboard(() => ({
      availableFormats: () => {
        throw new Error('busy')
      },
      readText: () => {
        throw new Error('busy')
      },
      readBuffer: () => {
        throw new Error('busy')
      }
    }))
    own.begin(['C:\\a.txt'], false)
    expect(own.source()).toMatchObject({ from: 'prism', why: 'write-pending' })
  })
})

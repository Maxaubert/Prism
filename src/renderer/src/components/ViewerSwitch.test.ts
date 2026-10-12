import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { FileKind, ViewerFile } from '@shared/types'
import { ViewerSwitch, type ViewerMode } from './ViewerSwitch'

// KIND TO VIEWER, ONCE. What each host gets for the kinds it decides itself:
// its own archive, its own "no viewer", and a member's narrower set. (The
// viewers proper are held by the e2e: phone, phoneDocs, zip and the stage.)

beforeAll(() => {
  const prism = { mediaUrl: (p: string) => `fsmedia://local/${encodeURIComponent(p)}` }
  Object.defineProperty(globalThis, 'window', { value: { prism }, configurable: true })
})

const file = (kind: FileKind, name = 'x'): ViewerFile => ({ path: `C:\${name}`, name, ext: '', kind })

const render = (kind: FileKind, mode: ViewerMode): string =>
  renderToStaticMarkup(
    createElement(ViewerSwitch, {
      file: file(kind),
      mode,
      loading: null,
      archive: () => createElement('i', null, 'ARCHIVE'),
      unsupported: () => createElement('i', null, 'NONE')
    })
  )

describe('ViewerSwitch', () => {
  it('an archive is whatever the host says it is', () => {
    for (const mode of ['full', 'phone', 'member'] as const) expect(render('archive', mode)).toBe('<i>ARCHIVE</i>')
  })

  it("a kind with no viewer is the host's own line", () => {
    expect(render('other' as FileKind, 'full')).toBe('<i>NONE</i>')
  })

  it('a member is not offered documents or comics', () => {
    expect(render('doc', 'member')).toBe('<i>NONE</i>')
    expect(render('comic', 'member')).toBe('<i>NONE</i>')
    expect(render('doc', 'full')).not.toContain('NONE')
    expect(render('comic', 'phone')).not.toContain('NONE')
  })
})

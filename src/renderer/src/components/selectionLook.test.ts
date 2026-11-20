import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// One selection look (#524): the tint, the edge round a run and the dimmed
// state live in assets/selection.css, on [data-selected], and nowhere else.
const src = (p: string): string => readFileSync(join(__dirname, '..', p), 'utf8')
const css = src('assets/selection.css')

describe('the one selection look', () => {
  it('is one rule on [data-selected], with joins and a dimmed state', () => {
    expect(css).toMatch(/\[data-selected\][^{]*\{[^}]*var\(--sel-fill\)/)
    expect(css).toMatch(/--sel-fill: var\(--p-sel-tint\)/)
    expect(css).toMatch(/\[data-join-up\]/)
    expect(css).toMatch(/\[data-join-down\]/)
    expect(css).toMatch(/\[data-inactive\] \[data-selected\]/)
    expect(css).toMatch(/--sel-fill: var\(--p-sel-tint-dim\)/)
    expect(src('index.css')).toContain("@import './assets/selection.css'")
  })

  it('no surface keeps a copy of the tint on a selected row or tile', () => {
    for (const f of ['components/browse/browse.css', 'components/browse/archive.css', 'components/browse/grid.css']) {
      const hits = [...src(f).matchAll(/([^{}]*\[data-selected\][^{}]*)\{([^}]*)\}/g)].filter((m) => /sel-tint|sel-line/.test(m[2]))
      expect(hits.map((m) => m[1].trim()), f).toEqual([])
    }
  })

  it('the archive tab draws it from attributes, not inline styles, and dims', () => {
    const view = src('components/ArchiveView.tsx')
    expect(view).not.toMatch(/markedLook/)
    expect(view).toMatch(/data-join-up=/)
    expect(view).toMatch(/data-inactive=\{!listFocused/)
  })

  it('the Explorer hands its inactive side to the same attribute', () => {
    expect(src('components/browse/FolderBrowser.tsx')).toMatch(/data-inactive=\{area === 'places'/)
  })
})
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { binStripLabels } from '../../lib/binView'
import { BinStrip } from './BinStrip'

const verbs = (html: string): { verb: string; text: string; disabled: boolean }[] =>
  [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    verb: /data-bin-verb="([^"]+)"/.exec(m[1])?.[1] ?? '',
    text: m[2].replace(/<[^>]*>/g, ''),
    disabled: /\bdisabled\b/.test(m[1])
  }))

const draw = (marked: number, count: number): string =>
  renderToStaticMarkup(
    createElement(BinStrip, { marked, count, onRestore: vi.fn(), onDelete: vi.fn(), onEmpty: vi.fn() })
  )

describe('the bin strip (D20): three plain buttons', () => {
  it('Restore, Delete permanently, Empty Recycle Bin, with nothing marked the first two off', () => {
    expect(verbs(draw(0, 5))).toEqual([
      { verb: 'restore', text: 'Restore', disabled: true },
      { verb: 'delete', text: 'Delete permanently', disabled: true },
      { verb: 'empty', text: 'Empty Recycle Bin', disabled: false }
    ])
  })
  it('says how many with several marked', () => {
    expect(binStripLabels(3)).toEqual({ restore: 'Restore 3 items', remove: 'Delete 3 items permanently' })
    expect(binStripLabels(1)).toEqual({ restore: 'Restore', remove: 'Delete permanently' })
    expect(verbs(draw(3, 5)).map((v) => v.text)).toEqual([
      'Restore 3 items',
      'Delete 3 items permanently',
      'Empty Recycle Bin'
    ])
  })
  it('Empty is off when the bin is empty', () => {
    expect(verbs(draw(0, 0)).at(-1)).toMatchObject({ verb: 'empty', disabled: true })
  })
})
